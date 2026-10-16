import {
  defaultSettings,
  type Agent,
  type Run,
  type Settings,
  type Decision,
  type TaskAction,
} from "./domain.js";
import {
  availableTools,
  agentTools,
  requiredFacts,
  toolCatalog,
} from "./catalog.js";
import {
  detectConflicts,
  payerComplete,
  supportedAction,
  value,
} from "./evidence.js";

export function eligibleAgents(
  run: Run,
  settings: Settings = defaultSettings,
): Agent[] {
  if (run.status !== "ready") return [];
  const eligible: Agent[] = ["human_review"];
  if (run.taskAction) return [...eligible, "completion_note"];
  if (!run.receipts.some((r) => r.tool === "get_claim"))
    return [...eligible, "claim_lookup"];
  if (detectConflicts(run).length)
    return run.verified ? eligible : [...eligible, "verify_findings"];
  const readAgents = Object.keys(agentTools).filter(
    (a) =>
      a !== "claim_lookup" &&
      a !== "payer_contact" &&
      availableTools(a as keyof typeof agentTools, run).length,
  ) as Agent[];
  if (!payerComplete(run))
    return run.payerCalls < settings.maxPayerCalls
      ? [...eligible, "payer_contact", ...readAgents]
      : eligible;
  const missing = requiredFacts(run).filter((key) => !value(run, key));
  if (
    value(run, "payer_instruction")?.toLowerCase().includes("appeal") &&
    !value(run, "documents_available")
  )
    missing.push("documents_available");
  const useful = readAgents.filter((a) =>
    toolCatalog.some(
      (tool) =>
        tool.agent === a && tool.fields.some((key) => missing.includes(key)),
    ),
  );
  const additional = readAgents.filter((a) => !useful.includes(a));
  if (missing.length)
    return useful.length ? [...eligible, ...useful, ...additional] : eligible;
  return [
    ...eligible,
    run.verified ? "task_action" : "verify_findings",
    ...additional,
  ];
}
export function gateDecision(
  run: Run,
  decision: Decision,
  settings: Settings = defaultSettings,
): { agent: Agent; reason: string } {
  if (run.steps >= settings.maxSteps)
    return { agent: "human_review", reason: "Workflow step budget exhausted" };
  const answer = decision.answers.next_agent;
  if (
    decision.confidenceKind !== "not_provided" &&
    (answer.confidence ?? 0) < settings.confidenceThreshold
  )
    return {
      agent: "human_review",
      reason: "Routing confidence below the configured threshold",
    };
  if (!eligibleAgents(run, settings).includes(answer.choice))
    return {
      agent: "human_review",
      reason: "Suggested agent is blocked by evidence dependencies",
    };
  if (answer.choice === "task_action") {
    if (
      decision.confidenceKind !== "not_provided" &&
      (decision.answers.task_action.confidence ?? 0) <
        settings.confidenceThreshold
    )
      return {
        agent: "human_review",
        reason: "Task Action confidence below the configured threshold",
      };
    if (!supportedAction(run, decision.answers.task_action.choice))
      return {
        agent: "human_review",
        reason: "Task Action lacks verified supporting evidence",
      };
  }
  return {
    agent: answer.choice,
    reason: "Agent is eligible and confidence gate passed",
  };
}
export function deriveDemoAction(run: Run): TaskAction {
  if (detectConflicts(run).length) return "human_review";
  if (
    run.verified &&
    !["appeal", "correct_claim", "follow_up"].some((action) =>
      supportedAction(run, action as TaskAction),
    )
  )
    return "human_review";
  const instruction = value(run, "payer_instruction")?.toLowerCase() ?? "";
  if (instruction.includes("appeal"))
    return value(run, "documents_available") === "no"
      ? "human_review"
      : "appeal";
  if (instruction.includes("corrected claim")) return "correct_claim";
  if (instruction.includes("follow up")) return "follow_up";
  return "human_review";
}
