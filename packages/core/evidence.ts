import {
  factInputSchema,
  notePlanSchema,
  type Fact,
  type FactInput,
  type NotePlan,
  type Receipt,
  type Run,
  type TaskAction,
} from "./domain.js";

import { requiredFacts } from "./catalog.js";

const labels: Record<Fact["key"], string> = {
  claim_status: "Claim status",
  denial_reason: "Denial reason",
  payer_instruction: "Payer instruction",
  appeal_deadline: "Payer-stated appeal deadline",
  contact_reference: "Contact reference",
  documents_available: "Required records available",
  submission_channel: "Submission channel",
  investigation_requirements: "Required checks",
  eligibility_status: "Coverage at service date",
  authorization_status: "Authorization status",
  coding_status: "Correction support",
  remittance_status: "Remittance status",
  claim_history: "Claim history",
  previous_contact: "Prior payer contact",
  policy_requirement: "Payer policy",
  appeal_window: "Appeal window",
  submission_status: "Submission status",
  portal_status: "Portal status",
  lookup_status: "Lookup result",
};
export function addFacts(
  run: Run,
  inputs: FactInput[],
  allowedSources: Receipt[],
) {
  // A quoted fragment alone is not enough: key/value must match the fixture's
  // authoritative observation fields as well as its exact source text.
  const pending: FactInput[] = [];
  for (const input of inputs) {
    const fact = factInputSchema.parse(input);
    const source = allowedSources.find((s) => s.id === fact.sourceId);
    if (
      !source ||
      source.claimId !== run.claimId ||
      source.fields[fact.key] !== fact.value ||
      !source.text.includes(fact.quote) ||
      !fact.quote.includes(fact.value)
    ) {
      throw new Error(
        "Extracted fact does not match its authoritative tool receipt",
      );
    }
    if (pending.some((f) => f.key === fact.key && f.sourceId === fact.sourceId))
      throw new Error("Extraction duplicated a source field");
    pending.push(fact);
  }
  if (!inputs.length) throw new Error("Agent returned no sourced facts");
  for (const source of allowedSources) {
    if (
      Object.keys(source.fields).some(
        (key) =>
          !pending.some((f) => f.sourceId === source.id && f.key === key),
      )
    )
      throw new Error("Extraction omitted a source field");
  }
  for (const fact of pending) {
    if (
      !run.facts.some(
        (f) =>
          f.key === fact.key &&
          f.value === fact.value &&
          f.sourceId === fact.sourceId,
      )
    )
      run.facts.push({ ...fact, id: crypto.randomUUID(), verified: false });
  }
  run.verified = false;
  // New evidence invalidates downstream artifacts.
  delete run.taskAction;
  delete run.completionNote;
}
export function value(run: Run, key: Fact["key"]): string | undefined {
  return run.facts.filter((f) => f.key === key).at(-1)?.value;
}
export function detectConflicts(run: Run): string[] {
  return (["claim_status", "denial_reason", "payer_instruction"] as const)
    .filter(
      (key) =>
        new Set(run.facts.filter((f) => f.key === key).map((f) => f.value))
          .size > 1,
    )
    .map((key) => `Sources disagree about ${labels[key].toLowerCase()}`);
}
export function verifyFacts(run: Run) {
  for (const fact of run.facts) {
    const source = run.receipts.find((s) => s.id === fact.sourceId);
    if (
      !source ||
      source.claimId !== run.claimId ||
      source.fields[fact.key] !== fact.value ||
      !source.text.includes(fact.quote) ||
      !fact.quote.includes(fact.value)
    ) {
      throw new Error("Evidence verification failed");
    }
  }
  run.facts.forEach((fact) => {
    fact.verified = true;
  });
  run.conflicts = detectConflicts(run);
  run.verified = true;
}
export function payerComplete(run: Run): boolean {
  return Boolean(
    value(run, "payer_instruction") &&
    value(run, "contact_reference") &&
    (value(run, "claim_status") === "in process" ||
      value(run, "denial_reason")),
  );
}
export function supportedAction(run: Run, action: TaskAction): boolean {
  if (action === "human_review") return true;
  if (
    !run.verified ||
    run.conflicts.length ||
    !run.payerCalls ||
    !payerComplete(run)
  )
    return false;
  if (requiredFacts(run).some((key) => !value(run, key))) return false;
  const allowed: Partial<Record<Fact["key"], string[]>> = {
    eligibility_status: ["active"],
    authorization_status: ["valid", "not_required"],
    coding_status: ["correction_supported"],
    appeal_window: ["open"],
  };
  if (
    Object.entries(allowed).some(
      ([key, valid]) =>
        value(run, key as Fact["key"]) &&
        !valid.includes(value(run, key as Fact["key"])!),
    )
  )
    return false;
  if (
    ["inactive", "missing", "unsupported", "expired"].some((bad) =>
      [
        "eligibility_status",
        "authorization_status",
        "coding_status",
        "appeal_window",
      ].some((key) => value(run, key as Fact["key"]) === bad),
    )
  )
    return false;
  const instruction = value(run, "payer_instruction")?.toLowerCase() ?? "";
  if (action === "appeal")
    return (
      instruction.includes("appeal") &&
      value(run, "documents_available") === "yes" &&
      Boolean(value(run, "appeal_deadline"))
    );
  if (action === "correct_claim")
    return instruction.includes("corrected claim");
  return instruction.includes("follow up");
}
export function renderNote(run: Run, input: NotePlan): string {
  const plan = notePlanSchema.parse(input);
  if (!run.verified || plan.action !== run.taskAction)
    throw new Error("Note action differs from the approved routing decision");
  if (new Set(plan.factIds).size !== plan.factIds.length)
    throw new Error("Note contains duplicate citations");
  const selected = plan.factIds.map((id) => {
    const fact = run.facts.find((f) => f.id === id && f.verified);
    if (!fact) throw new Error("Note cites an unknown or unverified fact");
    return fact;
  });
  // Keep every observation visible, including a conflict in a human-review note.
  if (selected.length !== run.facts.length)
    throw new Error("Note omits verified evidence");
  const groups = new Map<string, { fact: Fact; sources: string[] }>();
  for (const fact of selected) {
    const key = `${fact.key}\u0000${fact.value}`;
    const group = groups.get(key) ?? { fact, sources: [] };
    if (!group.sources.includes(fact.sourceId))
      group.sources.push(fact.sourceId);
    groups.set(key, group);
  }
  const lines = [...groups.values()].map(
    ({ fact, sources }) =>
      `${labels[fact.key]}: ${fact.value}. [${sources.join(", ")}]`,
  );
  return [
    `Synthetic claim ${run.claimId}.`,
    ...lines,
    `Task Action: ${actionLabel(plan.action)}.`,
    run.reviewReason
      ? `Review reason: ${run.reviewReason}.`
      : "Draft for review; no external claim action has been performed.",
  ].join("\n");
}
export function actionLabel(action: TaskAction): string {
  return {
    appeal: "Prepare appeal",
    correct_claim: "Prepare corrected claim",
    follow_up: "Schedule follow-up",
    human_review: "Human review",
  }[action];
}
