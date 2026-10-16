import type { Scenario } from "./domain.js";

// Fixture outcomes stay in the tool server/evaluator. Never send `expected` or
// undiscovered fixture payloads to JEV or the tool-using LLM.
const appeal = {
  claim_status: "denied",
  denial_reason: "missing clinical records",
  payer_instruction: "prepare an appeal with clinical records",
  appeal_deadline: "2026-12-15",
  contact_reference: "SYN-REF-101",
  submission_channel: "synthetic payer portal",
};
export const scenarios: Scenario[] = [
  {
    id: "records-appeal",
    title: "Records needed for appeal",
    description:
      "Payer follow-up reveals a records request; retrieve records before routing.",
    claimId: "SYN-1001",
    claim: { claim_status: "denied" },
    payer: [appeal],
    documents: { documents_available: "yes" },
    expected: "appeal",
  },
  {
    id: "corrected-claim",
    title: "Correct a claim",
    description: "A payer instruction identifies a missing billing modifier.",
    claimId: "SYN-1002",
    claim: { claim_status: "denied" },
    payer: [
      {
        claim_status: "denied",
        denial_reason: "missing modifier",
        payer_instruction: "submit a corrected claim with the modifier",
        contact_reference: "SYN-REF-102",
      },
    ],
    documents: {},
    expected: "correct_claim",
  },
  {
    id: "processing",
    title: "Still processing",
    description:
      "An in-process claim needs scheduled follow-up rather than an appeal.",
    claimId: "SYN-1003",
    claim: { claim_status: "in process" },
    payer: [
      {
        claim_status: "in process",
        payer_instruction: "follow up in 14 days",
        contact_reference: "SYN-REF-103",
      },
    ],
    documents: {},
    expected: "follow_up",
  },
  {
    id: "second-contact",
    title: "A second payer contact",
    description:
      "The first conversation lacks a reason and next step. The loop must gather more evidence.",
    claimId: "SYN-1004",
    claim: { claim_status: "denied" },
    payer: [
      { claim_status: "denied", contact_reference: "SYN-REF-104" },
      { ...appeal, contact_reference: "SYN-REF-104" },
    ],
    documents: { documents_available: "yes" },
    expected: "appeal",
  },
  {
    id: "contradiction",
    title: "Conflicting explanations",
    description:
      "The billing system and payer disagree about the denial reason.",
    claimId: "SYN-1005",
    claim: {
      claim_status: "denied",
      denial_reason: "missing prior authorization",
    },
    payer: [
      {
        claim_status: "denied",
        denial_reason: "duplicate claim",
        payer_instruction: "follow up with a supervisor",
        contact_reference: "SYN-REF-105",
      },
    ],
    documents: {},
    expected: "human_review",
  },
  {
    id: "ambiguous",
    title: "Insufficient payer information",
    description:
      "The payer cannot determine a disposition; the demo deliberately returns a diffuse decision.",
    claimId: "SYN-1006",
    claim: { claim_status: "denied" },
    payer: [
      {
        claim_status: "denied",
        denial_reason: "unknown",
        payer_instruction: "unable to determine the next action",
        contact_reference: "SYN-REF-106",
      },
    ],
    documents: {},
    expected: "human_review",
  },
  {
    id: "records-unavailable",
    title: "Records unavailable",
    description:
      "An appeal is suggested, but required records cannot be found.",
    claimId: "SYN-1007",
    claim: { claim_status: "denied" },
    payer: [{ ...appeal, contact_reference: "SYN-REF-107" }],
    documents: { documents_available: "no" },
    expected: "human_review",
  },
];
// Authored scenarios add operational prerequisites, beyond the original seven smoke cases.
const extra: Array<{
  id: string;
  title: string;
  requirements: string;
  sources: NonNullable<Scenario["sources"]>;
  expected: Scenario["expected"];
  instruction?: string;
}> = [
  {
    id: "coverage-active",
    title: "Coverage supports a correction",
    requirements: "eligibility_status, coding_status",
    sources: {
      check_eligibility: { fields: { eligibility_status: "active" } },
      validate_coding: { fields: { coding_status: "correction_supported" } },
    },
    expected: "correct_claim",
  },
  {
    id: "coverage-inactive",
    title: "Coverage needs reconciliation",
    requirements: "eligibility_status",
    sources: {
      check_eligibility: { fields: { eligibility_status: "inactive" } },
    },
    expected: "human_review",
  },
  {
    id: "authorization-found",
    title: "Authorization supports an appeal",
    requirements: "authorization_status, appeal_window",
    sources: {
      check_authorization: { fields: { authorization_status: "valid" } },
      get_payer_policy: {
        fields: {
          policy_requirement: "Authorization and records required",
          appeal_window: "open",
        },
      },
    },
    expected: "appeal",
    instruction: "prepare an appeal with clinical records",
  },
  {
    id: "authorization-missing",
    title: "Authorization cannot be established",
    requirements: "authorization_status",
    sources: {
      check_authorization: { fields: { authorization_status: "missing" } },
    },
    expected: "human_review",
  },
  {
    id: "appeal-window-expired",
    title: "Appeal window has closed",
    requirements: "appeal_window",
    sources: {
      get_payer_policy: {
        fields: {
          policy_requirement:
            "Escalation required after the synthetic deadline",
          appeal_window: "expired",
        },
      },
    },
    expected: "human_review",
    instruction: "prepare an appeal with clinical records",
  },
  {
    id: "remittance-reconcile",
    title: "Reconcile remittance and submission",
    requirements: "remittance_status, submission_status",
    sources: {
      get_remittance: { fields: { remittance_status: "unpaid" } },
      check_submission: { fields: { submission_status: "accepted" } },
    },
    expected: "follow_up",
    instruction: "follow up in 14 days",
  },
  {
    id: "prior-outreach",
    title: "Review prior outreach and claim history",
    requirements: "previous_contact, claim_history",
    sources: {
      get_prior_contacts: {
        fields: {
          previous_contact:
            "Prior inquiry requested a billing correction; no submission made",
        },
      },
      get_claim_history: {
        fields: {
          claim_history: "One original submission; no corrected claim recorded",
        },
      },
    },
    expected: "correct_claim",
  },
  {
    id: "portal-processing",
    title: "Confirm processing through the portal",
    requirements: "portal_status",
    sources: {
      check_portal_status: { fields: { portal_status: "processing" } },
    },
    expected: "follow_up",
    instruction: "follow up in 14 days",
  },
  {
    id: "coding-unsupported",
    title: "Requested correction lacks support",
    requirements: "coding_status",
    sources: { validate_coding: { fields: { coding_status: "unsupported" } } },
    expected: "human_review",
  },
];
for (const [i, item] of extra.entries()) {
  scenarios.push({
    id: item.id,
    title: item.title,
    description: `Synthetic investigation requiring ${item.requirements.replaceAll("_", " ")}.`,
    claimId: `SYN-${1100 + i}`,
    claim: {
      claim_status: "denied",
      investigation_requirements: item.requirements,
    },
    payer: [
      {
        claim_status: "denied",
        denial_reason: "supporting information required",
        payer_instruction:
          item.instruction ?? "submit a corrected claim with the modifier",
        contact_reference: `SYN-REF-${1100 + i}`,
        ...(item.instruction?.includes("appeal")
          ? {
              appeal_deadline: "2026-12-15",
              submission_channel: "synthetic payer portal",
            }
          : {}),
      },
    ],
    documents: { documents_available: "yes" },
    sources: item.sources,
    expected: item.expected,
  });
}
export const corpusVersion = 2;
export const corpus: Scenario[] = [];
const perturbations = [
  "nominal",
  "wording",
  "missing-reference",
  "missing-deadline",
  "missing-records",
  "conflicting-status",
  "transient-tool",
  "delayed-tool",
];
for (const [familyIndex, original] of scenarios.entries()) {
  const split =
    familyIndex % 5 === 3
      ? "validation"
      : familyIndex % 5 === 4
        ? "test"
        : "development";
  original.family = original.id;
  original.split = split;
  original.variant = "curated";
  corpus.push(original);
  for (let variant = 0; variant < 32; variant++) {
    const item = structuredClone(original);
    const perturbation = perturbations[variant % perturbations.length];
    item.id = `${original.id}-v${String(variant + 1).padStart(2, "0")}`;
    item.claimId = `SYN-${50000 + familyIndex * 32 + variant}`;
    item.variant = `${perturbation}-${Math.floor(variant / 8) + 1}`;
    item.title = `${original.title} · ${item.variant}`;
    item.description =
      "Controlled synthetic variation; evaluation labels are withheld from model state.";
    item.sources ??= {};
    item.sources.get_claim = {
      fields: item.claim,
      wording: [
        `Synthetic billing account ${item.claimId}.`,
        `Synthetic observation for assigned claim ${item.claimId}.`,
        `Training environment: account ${item.claimId}; no patient record.`,
        `RCM sandbox record ${item.claimId}.`,
      ][Math.floor(variant / 8)],
    };
    for (const payer of item.payer) {
      if (payer.contact_reference)
        payer.contact_reference = `SYN-REF-${50000 + familyIndex * 32 + variant}`;
      if (perturbation === "wording" && payer.payer_instruction)
        payer.payer_instruction = `Please ${payer.payer_instruction}; retain the source reference`;
      if (perturbation === "missing-reference") {
        delete payer.contact_reference;
        item.expected = "human_review";
      }
      if (perturbation === "missing-deadline") {
        delete payer.appeal_deadline;
        if (original.expected === "appeal") item.expected = "human_review";
      }
      if (perturbation === "conflicting-status") {
        payer.claim_status = "closed";
        item.expected = "human_review";
      }
    }
    if (perturbation === "missing-records") {
      item.documents = { documents_available: "no" };
      if (original.expected === "appeal") item.expected = "human_review";
    }
    if (perturbation === "transient-tool")
      item.sources.get_claim.transientFailures = 1;
    if (perturbation === "delayed-tool") item.sources.get_claim.delayMs = 60;
    corpus.push(item);
  }
}
const byId = new Map(corpus.map((item) => [item.id, item]));
export function getScenario(id: string): Scenario {
  const item = byId.get(id);
  if (!item) throw new Error("Unknown synthetic scenario");
  return item;
}
export function publicScenarios() {
  return corpus.map(
    ({ id, title, description, claimId, family, split, variant }) => ({
      id,
      title,
      description,
      claimId,
      family,
      split,
      variant,
    }),
  );
}
