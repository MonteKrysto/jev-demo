import { z } from "zod";

export const agents = [
  "claim_lookup",
  "payer_contact",
  "document_lookup",
  "coverage_lookup",
  "billing_lookup",
  "history_lookup",
  "policy_lookup",
  "portal_lookup",
  "verify_findings",
  "task_action",
  "completion_note",
  "human_review",
] as const;
export const actions = [
  "appeal",
  "correct_claim",
  "follow_up",
  "human_review",
] as const;
export const factKeys = [
  "claim_status",
  "denial_reason",
  "payer_instruction",
  "appeal_deadline",
  "contact_reference",
  "documents_available",
  "submission_channel",
  "investigation_requirements",
  "eligibility_status",
  "authorization_status",
  "coding_status",
  "remittance_status",
  "claim_history",
  "previous_contact",
  "policy_requirement",
  "appeal_window",
  "submission_status",
  "portal_status",
  "lookup_status",
] as const;
export type Agent = (typeof agents)[number];
export type TaskAction = (typeof actions)[number];
export type FactKey = (typeof factKeys)[number];
export type Mode = "demo" | "jev" | "live" | "openai";
export const factInputSchema = z
  .object({
    key: z.enum(factKeys),
    value: z.string().min(1).max(600),
    sourceId: z.string().min(1).max(100),
    quote: z.string().min(1).max(1200),
  })
  .strict();
export type FactInput = z.infer<typeof factInputSchema>;
export interface Fact extends FactInput {
  id: string;
  verified: boolean;
}
export interface Receipt {
  id: string;
  tool: string;
  claimId: string;
  observedAt: string;
  text: string;
  fields: Partial<Record<FactKey, string>>;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface CallMetric extends Usage {
  provider: "jev" | "llm";
  model: string;
  ms: number;
}
export interface ChoiceAnswer<T extends string> {
  type: "choice";
  choice: T;
  confidence?: number;
  probabilities?: Record<T, number>;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface Decision {
  model: string;
  confidenceKind?: "model_probability" | "not_provided";
  answers: {
    next_agent: ChoiceAnswer<Agent>;
    task_action: ChoiceAnswer<TaskAction>;
    payer_incomplete: NoulAnswer;
    needs_documents: NoulAnswer;
    conflicting_evidence: NoulAnswer;
  };
  usage: Usage;
}
export interface AuditEvent {
  id: string;
  at: string;
  kind: "decision" | "tool" | "agent" | "policy" | "error" | "approval";
  title: string;
  data: unknown;
}
export interface Run {
  id: string;
  revision: number;
  scenarioId: string;
  mode: Mode;
  claimId: string;
  task: string;
  purpose?: "interactive" | "evaluation";
  benchmark?: {
    id: string;
    settings: Settings;
    models: { jev: string; openai: string };
  };
  benchmarkOrder?: number;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "awaiting_review" | "needs_human" | "completed" | "failed";
  steps: number;
  activeMs?: number;
  payerCalls: number;
  receipts: Receipt[];
  facts: Fact[];
  events: AuditEvent[];
  metrics: CallMetric[];
  verified: boolean;
  conflicts: string[];
  taskAction?: TaskAction;
  completionNote?: string;
  reviewReason?: string;
  lastDecision?: Decision;
  approval?: { actor: string; at: string; note: string };
  handoff?: {
    id: string;
    claimId: string;
    taskAction: TaskAction;
    completionNote: string;
    savedAt: string;
  };
}
export interface Scenario {
  id: string;
  title: string;
  description: string;
  claimId: string;
  claim: Partial<Record<FactKey, string>>;
  payer: Array<Partial<Record<FactKey, string>>>;
  documents: Partial<Record<FactKey, string>>;
  expected: TaskAction;
  sources?: Record<string, SourceSpec>;
  family?: string;
  split?: "development" | "validation" | "test";
  variant?: string;
}
export interface SourceSpec {
  fields: Partial<Record<FactKey, string>>;
  clarification?: Partial<Record<FactKey, string>>;
  delayMs?: number;
  transientFailures?: number;
  wording?: string;
}
export const notePlanSchema = z
  .object({
    factIds: z.array(z.string()).min(1).max(200),
    action: z.enum(actions),
  })
  .strict();
export type NotePlan = z.infer<typeof notePlanSchema>;
export interface Settings {
  confidenceThreshold: number;
  maxSteps: number;
  maxPayerCalls: number;
}
export const defaultSettings: Settings = {
  confidenceThreshold: 0.7,
  maxSteps: 12,
  maxPayerCalls: 2,
};
export function event(
  run: Run,
  kind: AuditEvent["kind"],
  title: string,
  data: unknown = {},
) {
  run.events.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    title,
    data,
  });
}
