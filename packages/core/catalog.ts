import { z } from "zod";
import type { Agent, FactKey, Run } from "./domain.js";

export const toolArgsSchema = z
  .object({
    claimId: z.string().regex(/^SYN-\d{4,8}$/),
    topic: z
      .enum(["status", "denial", "appeal", "billing", "clarification"])
      .optional(),
  })
  .strict();
export const agentTools = {
  claim_lookup: ["get_claim"],
  payer_contact: ["call_payer"],
  document_lookup: ["get_documents"],
  coverage_lookup: ["check_eligibility", "check_authorization"],
  billing_lookup: ["get_remittance", "validate_coding", "check_submission"],
  history_lookup: ["get_claim_history", "get_prior_contacts"],
  policy_lookup: ["get_payer_policy"],
  portal_lookup: ["check_portal_status"],
} as const;
export type GatheringAgent = keyof typeof agentTools;
export type ToolName = (typeof agentTools)[GatheringAgent][number];
export function isGatheringAgent(agent: Agent): agent is GatheringAgent {
  return agent in agentTools;
}
export const toolCatalog: {
  name: ToolName;
  agent: GatheringAgent;
  description: string;
  fields: FactKey[];
}[] = [
  {
    name: "get_claim",
    agent: "claim_lookup",
    description:
      "Read the assigned billing claim and investigation requirements.",
    fields: ["claim_status", "denial_reason", "investigation_requirements"],
  },
  {
    name: "call_payer",
    agent: "payer_contact",
    description:
      "Contact the synthetic payer about status, denial, appeal, billing, or clarification of an earlier response. Use clarification to resolve incomplete contact findings.",
    fields: [
      "claim_status",
      "denial_reason",
      "payer_instruction",
      "contact_reference",
      "appeal_deadline",
      "submission_channel",
    ],
  },
  {
    name: "get_documents",
    agent: "document_lookup",
    description:
      "Check the availability of clinical records required by the payer.",
    fields: ["documents_available"],
  },
  {
    name: "check_eligibility",
    agent: "coverage_lookup",
    description: "Check coverage at the date of service.",
    fields: ["eligibility_status"],
  },
  {
    name: "check_authorization",
    agent: "coverage_lookup",
    description: "Look up prior authorization for this service.",
    fields: ["authorization_status"],
  },
  {
    name: "get_remittance",
    agent: "billing_lookup",
    description: "Read remittance reconciliation for this claim.",
    fields: ["remittance_status"],
  },
  {
    name: "validate_coding",
    agent: "billing_lookup",
    description:
      "Check whether the requested billing correction can be supported.",
    fields: ["coding_status"],
  },
  {
    name: "check_submission",
    agent: "billing_lookup",
    description: "Check clearinghouse acceptance and rejected submissions.",
    fields: ["submission_status"],
  },
  {
    name: "get_claim_history",
    agent: "history_lookup",
    description: "Read prior claim submissions and account activity.",
    fields: ["claim_history"],
  },
  {
    name: "get_prior_contacts",
    agent: "history_lookup",
    description: "Read previous payer contacts before repeating outreach.",
    fields: ["previous_contact"],
  },
  {
    name: "get_payer_policy",
    agent: "policy_lookup",
    description:
      "Read the synthetic payer requirements and current appeal-window assessment.",
    fields: ["policy_requirement", "appeal_window"],
  },
  {
    name: "check_portal_status",
    agent: "portal_lookup",
    description: "Check the current synthetic payer portal status.",
    fields: ["portal_status"],
  },
];
export function availableTools(agent: GatheringAgent, run: Run): ToolName[] {
  return agentTools[agent].filter(
    (name) =>
      name === "call_payer" || !run.receipts.some((r) => r.tool === name),
  );
}
export function requiredFacts(run: Run): FactKey[] {
  const text =
    run.facts.find((f) => f.key === "investigation_requirements")?.value ?? "";
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) =>
      toolCatalog.some((t) => t.fields.includes(s as FactKey)),
    ) as FactKey[];
}
export function fixtureTool(agent: GatheringAgent, run: Run): ToolName {
  const allowed = availableTools(agent, run);
  const missing = requiredFacts(run).filter(
    (key) => !run.facts.some((f) => f.key === key),
  );
  return (
    allowed.find((name) =>
      toolCatalog
        .find((t) => t.name === name)!
        .fields.some((f) => missing.includes(f)),
    ) ?? allowed[0]
  );
}
