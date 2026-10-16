import type { Agent, AuditEvent, Decision, Fact, Settings, TaskAction } from "../../../packages/core/domain";
import { agentNames, factNames } from "./format";

export interface DecisionData {
  response: Decision;
  appliedAgent: Agent;
  policyReason: string;
  settings?: Settings;
  request?: { state?: {
    evidence?: Pick<Fact, "key" | "value" | "sourceId" | "verified">[];
    observations?: { id: string; tool: string; text: string }[];
    verification?: { complete: boolean; conflicts: string[] };
    execution?: { eligibleAgents?: Agent[]; draftedAction?: TaskAction | null };
  } };
}

export const sourceNames: Record<string, string> = {
  get_claim: "Claim record", call_payer: "Payer contact", get_documents: "Clinical records",
  check_eligibility: "Eligibility lookup", check_authorization: "Authorization lookup",
  get_remittance: "Remittance", validate_coding: "Coding check", check_submission: "Submission check",
  get_claim_history: "Claim history", get_prior_contacts: "Prior contacts",
  get_payer_policy: "Payer policy", check_portal_status: "Payer portal",
};

// Explain the saved checkpoint, never the run's final facts or today's policy.
// This is an evidence/rule summary, not a provider-generated rationale.
export function explainDecision(data: DecisionData) {
  const state = data.request?.state;
  const evidence = state?.evidence ?? [];
  const allowed = state?.execution?.eligibleAgents;
  const selected = data.response.answers.next_agent;
  const changed = selected.choice !== data.appliedAgent;
  const conflicts = (["claim_status", "denial_reason", "payer_instruction"] as const)
    .filter(key => new Set(evidence.filter(f => f.key === key).map(f => f.value)).size > 1)
    .map(key => ({ key, facts: evidence.filter(f => f.key === key) }));
  const onlyReview = allowed?.length === 1 && allowed[0] === "human_review";
  const conflictLabels = conflicts.map(c => (factNames[c.key] ?? c.key).toLowerCase()).join(" and ");
  let title = "Router selection";
  let explanation = `The router proposed “${agentNames[selected.choice]}” from the recorded inputs. No written rationale was returned.`;
  let rule = data.policyReason === "Agent is eligible and confidence gate passed"
    ? "The proposed step was permitted by the application."
    : data.policyReason;

  if (!state) {
    explanation = "The inputs for this checkpoint were not saved. Its recorded proposal and application result are shown below.";
  } else if (conflicts.length && onlyReview && data.appliedAgent === "human_review") {
    title = "Evidence conflict";
    explanation = `The recorded sources disagree about ${conflictLabels}. ${state.verification?.complete ? "The source check confirmed the recorded values, but did not resolve the disagreement." : "The disagreement is present in the saved inputs."}`;
    rule = "Only human review was permitted at this checkpoint. An automated Task Action could not proceed with the conflicting evidence.";
  } else if (selected.choice === "verify_findings") {
    title = conflicts.length ? "Check conflicting sources" : "Check source support";
    explanation = state.verification?.complete
      ? "Verification was already complete in the saved inputs. This proposal repeats a completed stage."
      : conflicts.length
      ? `Different values for ${conflictLabels} are already present. This checkpoint checks whether each recorded fact matches its own source.`
      : `${evidence.length} recorded facts were available${state.verification?.complete === false ? "; their source check was still pending" : ""}. Verification checks them against their tool sources before an action is drafted.`;
  } else if (selected.choice === "claim_lookup" && state.observations && !state.observations.length) {
    title = "Start with the claim";
    explanation = "No tool evidence had been collected. The claim lookup supplies the first facts for the investigation.";
  } else if (selected.choice === "payer_contact") {
    const missing = ["payer_instruction", "contact_reference", ...(evidence.some(f => f.key === "claim_status" && f.value === "denied") ? ["denial_reason"] : [])]
      .filter(key => !evidence.some(f => f.key === key && f.value));
    title = "Gather payer findings";
    explanation = missing.length
      ? `The saved inputs were missing ${missing.map(key => (factNames[key] ?? key).toLowerCase()).join(", ")}. The router selected payer contact to gather more evidence.`
      : "Payer findings were already recorded. The router requested another contact; no written rationale was returned.";
  } else if (selected.choice === "completion_note" && state.execution?.draftedAction) {
    title = "Prepare the handoff";
    explanation = "A Task Action had already been drafted. This step prepares a completion note from the recorded facts for review.";
  } else if (selected.choice === "task_action") {
    title = "Propose the disposition";
    explanation = `The proposed step would draft a Task Action from ${state.verification?.complete ? "source-verified" : "the recorded"} findings, subject to the application's evidence checks.`;
  }
  // Preserve the evidence context even when a separate application gate rejects
  // the proposal. The returned distribution is evidence, not a written rationale.
  const proposalExplanation = explanation;
  const confidenceGate = data.policyReason === "Routing confidence below the configured threshold" ||
    data.policyReason === "Task Action confidence below the configured threshold"
    ? {
      kind: data.policyReason.startsWith("Task Action") ? "Task Action" : "Routing",
      score: data.policyReason.startsWith("Task Action") ? data.response.answers.task_action.confidence : selected.confidence,
      threshold: data.settings?.confidenceThreshold,
    } : undefined;
  if (confidenceGate) {
    title = "Confidence gate";
    const { kind, score, threshold } = confidenceGate;
    explanation = `${kind} confidence${score === undefined ? "" : ` (${Math.round(score * 100)}%)`} was below ${threshold === undefined ? "the configured threshold" : `the ${Math.round(threshold * 100)}% threshold`}. The application required human review${changed ? ` instead of “${agentNames[selected.choice]}”` : ""}.`;
    rule = "A score below the configured threshold stops automatic investigation and requires review.";
  } else if (changed) {
    title = "Application override";
    explanation = `The router proposed “${agentNames[selected.choice]}”, but the application applied “${agentNames[data.appliedAgent]}”. ${data.policyReason}.`;
  }
  const choices = selected.probabilities
    ? Object.entries(selected.probabilities).map(([agent, probability]) => ({
      agent: agent as Agent, probability, permitted: allowed?.includes(agent as Agent),
    })).sort((a, b) => b.probability - a.probability)
    : [];
  const permission = allowed === undefined ? "Permitted steps were not saved."
    : onlyReview ? "Only human review was permitted."
    : allowed.length === 0 ? "No permitted steps were recorded."
    : allowed.length === 2 && allowed.includes("human_review") ? "The current policy permits one workflow step plus human review."
    : `${allowed.length} next steps were permitted, including human review.`;
  return { state, evidence, allowed, selected, changed, conflicts, onlyReview, title, explanation, rule, permission,
    proposalExplanation, confidenceGate, choices };
}

export function groupCheckpoints(events: AuditEvent[]) {
  const checkpoints: { event: AuditEvent; following: AuditEvent[] }[] = [];
  const other: AuditEvent[] = [];
  for (const event of events) {
    if (event.kind === "decision") checkpoints.push({ event, following: [] });
    else if (checkpoints.length) checkpoints.at(-1)!.following.push(event);
    else other.push(event);
  }
  return { checkpoints, other };
}
