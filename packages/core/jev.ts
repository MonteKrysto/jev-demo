import {
  choice,
  noul,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import {
  agents,
  actions,
  defaultSettings,
  type Agent,
  type ChoiceAnswer,
  type Decision,
  type Run,
  type Settings,
} from "./domain.js";
import { detectConflicts, payerComplete, value } from "./evidence.js";
import { deriveDemoAction, eligibleAgents } from "./policy.js";

export function routingRequest(
  run: Run,
  settings: Settings = defaultSettings,
  model = "jev-latest",
) {
  return {
    model,
    // Explicit projection prevents the fixture's answer key, hidden payer
    // response, previous model answer, and scenario name from leaking into state.
    state: {
      task: run.task,
      claimId: run.claimId,
      evidence: run.facts.map((f) => ({
        key: f.key,
        value: f.value,
        sourceId: f.sourceId,
        verified: f.verified,
      })),
      observations: run.receipts.map((r) => ({
        id: r.id,
        tool: r.tool,
        text: r.text,
      })),
      verification: { complete: run.verified, conflicts: run.conflicts },
      execution: {
        payerCalls: run.payerCalls,
        maxPayerCalls: settings.maxPayerCalls,
        eligibleAgents: eligibleAgents(run, settings),
        draftedAction: run.taskAction ?? null,
      },
    },
    questions: {
      next_agent: choice(
          `Choose the single eligible capability that should execute next
            to advance this investigation.

            Use only the current evidence and execution.eligibleAgents.
            Choose the next step, not the eventual claim disposition.
            This workflow gathers findings and drafts an action and note for review;
            it does not perform the billing correction or submit the claim.

            Missing information does not by itself require human review.
            If an eligible capability can obtain the missing information,
            select the capability most directly suited to obtaining it.

            For a denied claim, when the denial reason, payer instruction,
            or contact reference is missing, select payer_contact if eligible.

            Once payer findings are available, obtain any missing evidence
            required by investigation_requirements or the payer's instructions.
            Avoid unrelated lookups and repeating information already collected.
            An instruction to prepare a corrected claim is an action to draft,
            not by itself a request for a coding, remittance, or submission lookup.
            Use billing_lookup when a required billing finding is still missing
            or the payer explicitly asks for that investigation.

            When payer findings and required evidence have been collected:
            - If verification.complete is false, select verify_findings.
            - If verification.complete is true and there are no conflicts or
              established unsupported conditions, select task_action when no
              draftedAction exists. Do not verify the same evidence again.
            - If a draftedAction exists, select completion_note.

            If observations conflict, select verify_findings when eligible.
            If conflicts have been verified, select human_review.

            Select human_review when evidence establishes an unsupported condition,
            required information cannot be obtained through the eligible capabilities,
            or the permitted investigation attempts are exhausted.`,
        // "Which single capability should run next? Use `execution.eligibleAgents` and the current `evidence`. Gather missing information before deciding a Task Action. Prioritize evidence keys listed in investigation_requirements. Avoid repeating available evidence or reading unrelated sources. Once all requirements are covered, verify and decide; do not exhaust every tool. Choose human_review if nothing suitable is eligible. Only choose completion_note when a draftedAction exists.",
        {
          claim_lookup:
            "Read the synthetic billing claim when no claim observation exists.",
          payer_contact:
            // "Contact the synthetic payer for missing denial reason, disposition, reference or next step.",
            "Obtain missing payer findings, including the denial reason, " +
            "next-step instruction, or contact reference. Also request " +
            "clarification when a prior payer response was incomplete.",
          document_lookup:
            "Retrieve record availability when the payer requests an appeal with records.",
          coverage_lookup:
            "Investigate eligibility at service date or prior authorization.",
          billing_lookup:
            "Obtain a missing required remittance_status, coding_status, or submission_status finding, or investigate an explicit payer request for such a check. A correction instruction alone is not a missing billing finding.",
          history_lookup: "Investigate previous submissions or payer contacts.",
          policy_lookup: "Check payer requirements and appeal window.",
          portal_lookup: "Check current portal status.",
          verify_findings:
            "Check collected facts against their tool sources when verification.complete is false and required findings are available, or when conflicting observations need verification. Already-completed verification must not be repeated.",
          task_action:
            "Draft the operational action from complete payer findings and required evidence when verification.complete is true, conflicts are absent, and draftedAction is null. This records an action for review; it does not execute a correction or submit a claim.",
          completion_note:
            "Compose a completion note for an already drafted Task Action.",
          human_review:
            // "Evidence is conflicting, insufficient, unsupported or requires human judgment.",
            "Escalate verified conflicts, established unsupported conditions, " +
            "or missing required information that cannot be obtained through " +
            "the remaining eligible capabilities. Information that has not " +
            "yet been requested is not, by itself, a reason to escalate.",
        },
      ),
      task_action: choice(
        "Given `evidence`, which Task Action matches the payer instruction? This is speculative until verification completes. Choose human_review if the evidence is unclear or conflicting, or required appeal records are explicitly unavailable. Inactive eligibility, missing authorization, unsupported coding, or an expired appeal window require human_review in this synthetic policy.",
        {
          appeal:
            "Prepare an appeal with requested records for a denied claim; a payer-stated deadline must be known.",
          correct_claim:
            "Prepare a corrected claim when the payer explicitly requests a billing correction.",
          follow_up:
            "Schedule follow-up when the payer says processing continues or requests later follow-up.",
          human_review:
            "No supported action, conflicting findings or unavailable required records.",
        },
      ),
      payer_incomplete: noul(
        "Does `evidence` lack the payer instruction or contact reference, or a denial reason for a denied claim?",
      ),
      needs_documents: noul(
        "Does the payer instruction in `evidence` require records whose availability has not yet been checked?",
      ),
      conflicting_evidence: noul(
        "Do observations in `evidence` conflict on claim status, denial reason or payer instruction?",
      ),
    },
  };
}
const probability = z.number().finite().min(0).max(1);
const choiceSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: probability,
  probabilities: z.record(probability),
});
const noulSchema = z.object({ type: z.literal("noul"), noul: probability });
const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.object({
    next_agent: choiceSchema,
    task_action: choiceSchema,
    payer_incomplete: noulSchema,
    needs_documents: noulSchema,
    conflicting_evidence: noulSchema,
  }),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
function validateChoice<T extends string>(
  answer: z.infer<typeof choiceSchema>,
  options: readonly T[],
): ChoiceAnswer<T> {
  if (
    !options.includes(answer.choice as T) ||
    Object.keys(answer.probabilities).sort().join("|") !==
      [...options].sort().join("|")
  )
    throw new Error("JEV returned an unknown or missing routing option");
  const ps = Object.values(answer.probabilities);
  if (Math.abs(ps.reduce((sum, p) => sum + p, 0) - 1) > 0.01)
    throw new Error("JEV probabilities do not sum to one");
  const top = Math.max(...ps);
  const expectedConfidence =
    (top - 1 / options.length) / (1 - 1 / options.length);
  if (
    answer.probabilities[answer.choice] < top - 0.001 ||
    Math.abs(answer.confidence - expectedConfidence) > 0.02
  )
    throw new Error(
      "JEV choice or confidence is inconsistent with its probability distribution",
    );
  return answer as ChoiceAnswer<T>;
}
export function parseDecision(input: unknown): Decision {
  const raw = responseSchema.parse(input);
  return {
    model: raw.model,
    answers: {
      ...raw.answers,
      next_agent: validateChoice(raw.answers.next_agent, agents),
      task_action: validateChoice(raw.answers.task_action, actions),
    },
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
  };
}
export interface Router {
  readonly model?: string;
  evaluate(run: Run, settings: Settings): Promise<Decision>;
}
export class JevRouter implements Router {
  readonly client: TypeSafeClient;
  constructor(
    config: TypeSafeClientConfig = {},
    readonly model = "jev-latest",
  ) {
    this.client = new TypeSafeClient({
      timeout: 15000,
      retry: { maxRetries: 1 },
      logLevel: "off",
      ...config,
    });
  }
  async evaluate(run: Run, settings: Settings) {
    // These are the actual TypeSafe SDK primitives and method names.
    const response = await this.client.systemOne(
      routingRequest(run, settings, this.model),
      { signal: AbortSignal.timeout(35000) },
    );
    return parseDecision(response);
  }
}
export function mockChoice<T extends string>(
  options: readonly T[],
  selected: T,
  topProbability = 0.98,
): ChoiceAnswer<T> {
  const probabilities = Object.fromEntries(
    options.map((option) => [
      option,
      option === selected
        ? topProbability
        : (1 - topProbability) / (options.length - 1),
    ]),
  ) as Record<T, number>;
  return {
    type: "choice",
    choice: selected,
    probabilities,
    confidence:
      (topProbability - 1 / options.length) / (1 - 1 / options.length),
  };
}
export class DemoRouter implements Router {
  async evaluate(run: Run, settings: Settings): Promise<Decision> {
    const eligible = eligibleAgents(run, settings);
    const ambiguous = value(run, "payer_instruction")
      ?.toLowerCase()
      .includes("unable to determine");
    const next = eligible.find((a) => a !== "human_review") ?? "human_review";
    return {
      model: "fixture-router (not JEV)",
      answers: {
        next_agent: mockChoice(agents, next, ambiguous ? 0.3 : 0.98),
        task_action: mockChoice(
          actions,
          deriveDemoAction(run),
          ambiguous ? 0.3 : 0.98,
        ),
        payer_incomplete: {
          type: "noul",
          noul: payerComplete(run) ? 0.02 : 0.98,
        },
        needs_documents: {
          type: "noul",
          noul:
            value(run, "payer_instruction")?.includes("appeal") &&
            !value(run, "documents_available")
              ? 0.98
              : 0.02,
        },
        conflicting_evidence: {
          type: "noul",
          noul: detectConflicts(run).length ? 0.98 : 0.02,
        },
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
