import {
  defaultSettings,
  event,
  type Run,
  type Settings,
  type Mode,
} from "./domain.js";
import {
  addFacts,
  detectConflicts,
  renderNote,
  supportedAction,
  verifyFacts,
} from "./evidence.js";
import { gateDecision } from "./policy.js";
import { routingRequest, type Router } from "./jev.js";
import {
  isGatheringAgent,
  SyntheticTools,
  type ToolExecutor,
} from "./tools.js";
import type { AgentRuntime } from "./agents.js";
import { getScenario } from "./scenarios.js";

export function newRun(scenarioId: string, mode: Mode = "demo"): Run {
  const scenario = getScenario(scenarioId);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    revision: 0,
    scenarioId,
    mode,
    claimId: scenario.claimId,
    task: `Investigate synthetic claim ${scenario.claimId}, determine the next Task Action from payer findings, and draft a sourced completion note.`,
    createdAt: now,
    updatedAt: now,
    status: "ready",
    steps: 0,
    payerCalls: 0,
    receipts: [],
    facts: [],
    events: [],
    metrics: [],
    verified: false,
    conflicts: [],
  };
}
function safeError(error: unknown): string {
  const e = error as { name?: string; status?: number; message?: string };
  if (
    e.status ||
    /API|Connection|Timeout|Authentication|RateLimit/.test(e.name ?? "")
  )
    return `Provider request failed (${e.status ?? e.name}); check server-side provider configuration and retry`;
  if (e.name === "ZodError") return "Provider output failed schema validation";
  return e.message?.slice(0, 220) ?? "Workflow step failed";
}
export class Engine {
  constructor(
    readonly router: Router,
    readonly runtime: AgentRuntime,
    readonly settings: Settings = defaultSettings,
    readonly tools: ToolExecutor = new SyntheticTools(),
  ) {}
  private review(run: Run, reason: string) {
    run.taskAction = "human_review";
    run.reviewReason = reason;
    if (run.facts.length) {
      verifyFacts(run);
      run.completionNote = renderNote(run, {
        action: "human_review",
        factIds: run.facts.map((f) => f.id),
      });
    } else
      run.completionNote = `Synthetic claim ${run.claimId}.\nTask Action: Human review.\nReview reason: ${reason}.\nNo payer findings were established.`;
    run.status = "needs_human";
    event(run, "policy", "Handed off for human review", { reason });
  }
  async step(run: Run): Promise<Run> {
    if (run.status !== "ready")
      throw new Error("Only a ready workflow may advance");
    const stepStarted = performance.now();
    try {
      if (run.steps >= this.settings.maxSteps) {
        this.review(run, "Workflow step budget exhausted");
        return run;
      }
      const start = performance.now();
      const decision = await this.router.evaluate(run, this.settings);
      run.metrics.push({
        provider: run.mode === "openai" ? "llm" : "jev",
        model: decision.model,
        ms: Math.round(performance.now() - start),
        ...decision.usage,
      });
      run.lastDecision = decision;
      const gate = gateDecision(run, decision, this.settings);
      event(
        run,
        "decision",
        `${decision.answers.next_agent.choice} → ${gate.agent}`,
        {
          request: routingRequest(
            run,
            this.settings,
            this.router.model ?? "jev-latest",
          ),
          response: decision,
          appliedAgent: gate.agent,
          policyReason: gate.reason,
          settings: this.settings,
        },
      );
      run.steps++;
      if (isGatheringAgent(gate.agent)) {
        const result = await this.runtime.gather(gate.agent, run, this.tools);
        // A step's read result is committed only after extraction validates.
        addFacts(run, result.facts, [result.receipt]);
        run.receipts.push(result.receipt);
        if (gate.agent === "payer_contact") run.payerCalls++;
        event(
          run,
          "tool",
          `${result.receipt.tool} returned evidence`,
          result.receipt,
        );
        event(run, "agent", `${gate.agent} completed`, {
          addedFacts: result.facts.length,
        });
      } else if (gate.agent === "verify_findings") {
        verifyFacts(run);
        event(run, "agent", "Verified facts against tool receipts", {
          conflicts: run.conflicts,
          verifiedFacts: run.facts.length,
        });
      } else if (gate.agent === "task_action") {
        run.taskAction = decision.answers.task_action.choice;
        if (run.taskAction === "human_review") {
          this.review(run, "Router selected human review from verified findings");
        } else
          event(run, "agent", "Task Action drafted", {
            taskAction: run.taskAction,
          });
      } else if (gate.agent === "completion_note") {
        const plan = await this.runtime.composeNote(run);
        run.completionNote = renderNote(run, plan);
        run.status = "awaiting_review";
        event(run, "agent", "Completion note drafted", { notePlan: plan });
      } else {
        const conflicts = detectConflicts(run);
        const reason =
          gate.reason === "Agent is eligible and confidence gate passed"
            ? conflicts.length
              ? conflicts.join("; ")
              : "Router selected human review; evidence may be insufficient or unsupported"
            : gate.reason;
        this.review(run, reason);
      }
    } catch (error) {
      run.status = "failed";
      run.reviewReason = safeError(error);
      event(run, "error", run.reviewReason);
    } finally {
      run.activeMs = (run.activeMs ?? 0) + Math.round(performance.now() - stepStarted);
    }
    run.updatedAt = new Date().toISOString();
    return run;
  }
  approve(run: Run, actor: string): Run {
    if (run.status === "completed" && run.handoff) return run; // Idempotent synthetic write.
    if (
      !["awaiting_review", "needs_human"].includes(run.status) ||
      !run.taskAction ||
      !run.completionNote
    )
      throw new Error("Workflow does not have reviewable outputs");
    // Re-check the authoritative receipts at the write boundary.
    if (run.facts.length) verifyFacts(run);
    if (!supportedAction(run, run.taskAction))
      throw new Error(
        "Task Action lacks supporting evidence at the write boundary",
      );
    run.approval = {
      actor,
      at: new Date().toISOString(),
      note: "Reviewer approved the synthetic Task Action and sourced note",
    };
    run.handoff = {
      id: `handoff-${run.id}`,
      claimId: run.claimId,
      taskAction: run.taskAction,
      completionNote: run.completionNote,
      savedAt: run.approval.at,
    };
    run.status = "completed";
    event(run, "approval", "Saved synthetic Task Action and completion note", {
      actor,
      handoffId: run.handoff.id,
    });
    return run;
  }
}
