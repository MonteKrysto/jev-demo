import type { Agent, Mode, Run } from "../../../packages/core/domain";

export const agentNames: Record<Agent, string> = {
  claim_lookup: "Look up the claim",
  payer_contact: "Contact the payer",
  document_lookup: "Find supporting records",
  coverage_lookup: "Check coverage and authorization",
  billing_lookup: "Investigate billing and remittance",
  history_lookup: "Review prior activity",
  policy_lookup: "Check payer requirements",
  portal_lookup: "Check the payer portal",
  verify_findings: "Verify the evidence",
  task_action: "Determine the next action",
  completion_note: "Prepare the completion note",
  human_review: "Request human review",
};
export const modeNames: Record<Mode, string> = {
  openai: "OpenAI baseline",
  demo: "Fixture demo",
  jev: "Live JEV",
  live: "Live JEV + OpenAI",
};
export const modeDescriptions: Record<Mode, string> = {
  openai:
    "OpenAI routes and calls tools using the same evidence rules. No JEV confidence gate.",
  demo: "Scripted routing and extraction. No provider requests.",
  jev: "JEV makes decisions. Scripted agents gather evidence.",
  live: "JEV makes decisions. OpenAI calls tools and extracts findings.",
};
export const statusNames: Record<Run["status"], string> = {
  ready: "Ready to continue",
  awaiting_review: "Awaiting approval",
  needs_human: "Needs human review",
  completed: "Handoff saved",
  failed: "Stopped with an error",
};
export const factNames: Record<string, string> = {
  claim_status: "Claim status",
  denial_reason: "Denial reason",
  payer_instruction: "Payer instruction",
  appeal_deadline: "Appeal deadline",
  contact_reference: "Contact reference",
  documents_available: "Records available",
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
export const number = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export const shortId = (id: string) => id.slice(0, 8);
export const needsReview = (run: Run) =>
  run.status === "awaiting_review" || run.status === "needs_human";
export function runMetrics(run: Run) {
  return {
    tokens: run.metrics.reduce(
      (sum, m) => sum + m.inputTokens + m.outputTokens,
      0,
    ),
    providerMs: run.metrics.reduce((sum, m) => sum + m.ms, 0),
    modelCalls: run.metrics.filter((m) => !m.model.startsWith("fixture"))
      .length,
    verified: run.facts.filter((f) => f.verified).length,
  };
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
