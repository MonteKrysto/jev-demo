import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, newRun } from "../packages/core/engine.js";
import { DemoRouter } from "../packages/core/jev.js";
import { FixtureAgents } from "../packages/core/agents.js";
import { explainDecision, groupCheckpoints, type DecisionData } from "../apps/web/lib/decision-explanation.js";

test("a contradiction explanation uses each historical snapshot, not the final run facts", async () => {
  const run = newRun("contradiction");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  const checkpoints = groupCheckpoints(run.events).checkpoints;
  const explanations = checkpoints.map(c => explainDecision(c.event.data as DecisionData));
  assert.equal(explanations[0].evidence.length, 0);
  assert.equal(explanations[1].conflicts.length, 0, "payer conflict was not known before contacting the payer");
  assert.equal(explanations[1].evidence.find(f => f.key === "denial_reason")?.value, "missing prior authorization");
  assert.equal(explanations[2].title, "Check conflicting sources");
  assert.equal(explanations[2].state?.verification?.complete, false);
  const final = explanations[3];
  assert.equal(final.title, "Evidence conflict");
  assert.equal(final.changed, false, "a policy-constrained choice is not an override");
  assert.equal(final.onlyReview, true);
  assert.equal(final.permission, "Only human review was permitted.");
  assert.deepEqual(final.conflicts[0].facts.map(f => f.value), ["missing prior authorization", "duplicate claim"]);
  assert.equal(final.state?.verification?.complete, true);
  assert.match(final.explanation, /did not resolve/);
});

test("a confidence override explains the proposed step and the saved threshold without inventing a conflict", async () => {
  const run = newRun("contradiction");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  await engine.step(run);
  await engine.step(run);
  const data = structuredClone(groupCheckpoints(run.events).checkpoints[1].event.data) as DecisionData;
  data.response.answers.next_agent.choice = "coverage_lookup";
  data.response.answers.next_agent.confidence = .26;
  data.appliedAgent = "human_review";
  data.policyReason = "Routing confidence below the configured threshold";
  const info = explainDecision(data);
  assert.equal(info.title, "Confidence gate");
  assert.match(info.explanation, /26%/);
  assert.match(info.explanation, /70%/);
  assert.match(info.explanation, /Check coverage and authorization/);
  assert.equal(info.conflicts.length, 0);
  assert.equal(info.changed, true);
  data.settings!.confidenceThreshold = .8;
  assert.match(explainDecision(data).explanation, /80%/, "must use the recorded settings");
});

test("Task Action confidence and routing confidence are kept distinct", async () => {
  const run = newRun("corrected-claim");
  const data: DecisionData = {
    response: await new DemoRouter().evaluate(run, { maxSteps: 12, maxPayerCalls: 2, confidenceThreshold: .7 }),
    appliedAgent: "human_review", policyReason: "Task Action confidence below the configured threshold",
    request: { state: { evidence: [] } },
    settings: { maxSteps: 12, maxPayerCalls: 2, confidenceThreshold: .7 },
  };
  data.response.answers.next_agent.choice = "task_action";
  data.response.answers.task_action.confidence = .33;
  const info = explainDecision(data);
  assert.match(info.explanation, /Task Action confidence \(33%\)/);
  assert.doesNotMatch(info.explanation, /98%/);
});

test("legacy checkpoints with missing inputs do not invent evidence or permitted choices", async () => {
  const run = newRun("contradiction");
  const data: DecisionData = {
    response: await new DemoRouter().evaluate(run, { maxSteps: 12, maxPayerCalls: 2, confidenceThreshold: .7 }),
    appliedAgent: "claim_lookup", policyReason: "Agent is eligible and confidence gate passed",
  };
  const info = explainDecision(data);
  assert.match(info.explanation, /not saved/);
  assert.equal(info.permission, "Permitted steps were not saved.");
  assert.deepEqual(info.evidence, []);
  assert.deepEqual(info.conflicts, []);
});

test("a step 3 handoff keeps the verification proposal separate from the confidence rule and final action", async () => {
  const run = newRun("corrected-claim", "live");
  const fixture = new DemoRouter();
  const engine = new Engine({ async evaluate(state, settings) {
    const decision = await fixture.evaluate(state, settings);
    if (state.steps === 2) {
      decision.answers.next_agent.confidence = .69;
      decision.answers.next_agent.probabilities = {
        claim_lookup: .02, payer_contact: .01, document_lookup: 0, coverage_lookup: 0,
        billing_lookup: .19, history_lookup: 0, policy_lookup: .01, portal_lookup: 0,
        verify_findings: .72, task_action: .04, completion_note: 0, human_review: .01,
      };
      decision.answers.task_action.confidence = .97;
    }
    return decision;
  } }, new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  const data = groupCheckpoints(run.events).checkpoints[2].event.data as DecisionData;
  const info = explainDecision(data);
  assert.equal(run.status, "needs_human");
  assert.equal(run.verified, true, "handoff prepares a source-checked note after the routing decision");
  assert.equal(info.state?.verification?.complete, false, "UI must show the inputs before that later check");
  assert.match(info.proposalExplanation, /5 recorded facts.*source check was still pending/);
  assert.match(info.explanation, /69%.*70%.*instead of “Verify the evidence”/);
  assert.deepEqual(info.confidenceGate, { kind: "Routing", score: .69, threshold: .7 });
  assert.deepEqual(info.choices.slice(0, 2).map(c => [c.agent, c.probability]), [["verify_findings", .72], ["billing_lookup", .19]]);
  assert.equal(info.choices.find(c => c.agent === "human_review")?.probability, .01);
  assert.equal(info.choices.find(c => c.agent === "task_action")?.permitted, false);
  assert.equal(data.response.answers.task_action.choice, "correct_claim");
  assert.equal(data.response.answers.task_action.confidence, .97);
  assert.equal(info.conflicts.length, 0);
});

test("a proposal to repeat completed verification is identified even when confidence causes the stop", async () => {
  const run = newRun("corrected-claim");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  for (let i = 0; i < 4; i++) await engine.step(run);
  const data = structuredClone(groupCheckpoints(run.events).checkpoints[3].event.data) as DecisionData;
  data.response.answers.next_agent.choice = "verify_findings";
  data.response.answers.next_agent.confidence = .39;
  data.appliedAgent = "human_review";
  data.policyReason = "Routing confidence below the configured threshold";
  const info = explainDecision(data);
  assert.match(info.proposalExplanation, /already complete.*repeats a completed stage/);
  assert.equal(info.choices.find(c => c.agent === "verify_findings")?.permitted, false);
  assert.equal(info.confidenceGate?.score, .39);
});
