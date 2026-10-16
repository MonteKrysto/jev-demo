import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, newRun } from "../packages/core/engine.js";
import {
  DemoRouter,
  mockChoice,
  routingRequest,
} from "../packages/core/jev.js";
import { FixtureAgents } from "../packages/core/agents.js";
import { actions, agents, defaultSettings } from "../packages/core/domain.js";
import { scenarios } from "../packages/core/scenarios.js";
import {
  addFacts,
  renderNote,
  verifyFacts,
} from "../packages/core/evidence.js";
import { SyntheticTools } from "../packages/core/tools.js";

for (const scenario of scenarios)
  test(`end-to-end: ${scenario.id}`, async () => {
    const engine = new Engine(new DemoRouter(), new FixtureAgents());
    const run = newRun(scenario.id);
    for (let i = 0; i < 16 && run.status === "ready"; i++)
      await engine.step(run);
    assert.ok(
      ["awaiting_review", "needs_human"].includes(run.status),
      JSON.stringify(run),
    );
    assert.equal(run.taskAction, scenario.expected);
    assert.ok(run.completionNote?.includes(`Synthetic claim ${run.claimId}`));
    assert.ok(run.facts.every((f) => f.verified));
    assert.ok(run.steps <= defaultSettings.maxSteps);
    assert.equal(
      run.handoff,
      undefined,
      "No synthetic write occurs before approval",
    );
    const saved = engine.approve(run, "Test reviewer");
    assert.equal(saved.status, "completed");
    assert.equal(saved.handoff?.taskAction, scenario.expected);
    const originalHandoff = JSON.stringify(run.handoff);
    const eventCount = run.events.length;
    engine.approve(run, "Repeated click");
    assert.equal(JSON.stringify(run.handoff), originalHandoff);
    assert.equal(run.events.length, eventCount, "Approval is idempotent");
    if (scenario.id === "second-contact") assert.equal(run.payerCalls, 2);
    if (scenario.expected === "appeal")
      assert.ok(run.receipts.some((r) => r.tool === "get_documents"));
    if (scenario.id === "contradiction") assert.ok(run.conflicts.length);
  });
test("policy blocks an early Task Action even when the model is certain", async () => {
  const run = newRun("corrected-claim");
  const router = {
    async evaluate() {
      const d = await new DemoRouter().evaluate(run, defaultSettings);
      d.answers.next_agent = mockChoice(agents, "task_action");
      d.answers.task_action = mockChoice(actions, "correct_claim");
      return d;
    },
  };
  await new Engine(router, new FixtureAgents()).step(run);
  assert.equal(run.status, "needs_human");
  assert.equal(run.taskAction, "human_review");
  assert.equal(run.receipts.length, 0);
});
test("step budget terminates investigation", async () => {
  const run = newRun("records-appeal");
  const engine = new Engine(new DemoRouter(), new FixtureAgents(), {
    ...defaultSettings,
    maxSteps: 1,
  });
  await engine.step(run);
  await engine.step(run);
  assert.equal(run.status, "needs_human");
  assert.equal(run.reviewReason, "Workflow step budget exhausted");
  assert.equal(run.steps, 1);
});
test("payer contact budget prevents endless re-investigation", async () => {
  const run = newRun("second-contact");
  const engine = new Engine(new DemoRouter(), new FixtureAgents(), {
    ...defaultSettings,
    maxPayerCalls: 1,
  });
  while (run.status === "ready") await engine.step(run);
  assert.equal(run.taskAction, "human_review");
  assert.equal(run.payerCalls, 1);
});
test("provider outage fails visibly without fixture fallback", async () => {
  const run = newRun("records-appeal", "jev");
  await new Engine(
    {
      async evaluate() {
        throw Object.assign(new Error("Secret provider detail"), {
          status: 401,
        });
      },
    },
    new FixtureAgents(),
  ).step(run);
  assert.equal(run.status, "failed");
  assert.equal(run.receipts.length, 0);
  assert.match(run.reviewReason!, /401/);
  assert.doesNotMatch(run.reviewReason!, /Secret/);
});
test("all facts validate before any extraction mutates state", () => {
  const run = newRun("contradiction");
  const receipt = new SyntheticTools().execute(
    "get_claim",
    { claimId: run.claimId },
    run,
  );
  assert.throws(
    () =>
      addFacts(
        run,
        [
          {
            key: "claim_status",
            value: "denied",
            sourceId: receipt.id,
            quote: "claim_status: denied",
          },
          {
            key: "denial_reason",
            value: "already paid",
            sourceId: receipt.id,
            quote: "denial_reason: already paid",
          },
        ],
        [receipt],
      ),
    /authoritative/,
  );
  assert.equal(run.facts.length, 0);
});
test("cross-claim tool calls are rejected", () => {
  const run = newRun("records-appeal");
  assert.throws(
    () =>
      new SyntheticTools().execute("call_payer", { claimId: "SYN-1002" }, run),
    /another claim/,
  );
});
test("note rejects invented citations and a changed Task Action", async () => {
  const run = newRun("corrected-claim");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  assert.throws(
    () => renderNote(run, { factIds: ["fabricated"], action: "correct_claim" }),
    /unknown/,
  );
  assert.throws(
    () =>
      renderNote(run, {
        factIds: run.facts.map((f) => f.id),
        action: "appeal",
      }),
    /differs/,
  );
  assert.throws(
    () =>
      renderNote(run, { factIds: [run.facts[0].id], action: "correct_claim" }),
    /omits/,
  );
});
test("source tampering fails re-verification and approval", async () => {
  const run = newRun("corrected-claim");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  run.receipts[0].text = "tampered source";
  assert.throws(() => verifyFacts(run), /verification failed/);
  assert.throws(() => engine.approve(run, "Reviewer"), /verification failed/);
  assert.equal(run.handoff, undefined);
});
test("approval is blocked before reviewable outputs exist", () => {
  assert.throws(
    () =>
      new Engine(new DemoRouter(), new FixtureAgents()).approve(
        newRun("records-appeal"),
        "Reviewer",
      ),
    /reviewable/,
  );
});
test("model state does not expose fixture answer keys or undiscovered observations", () => {
  const serialized = JSON.stringify(routingRequest(newRun("corrected-claim")));
  for (const secret of [
    "scenarioId",
    "expected",
    "missing modifier",
    "SYN-REF-102",
  ])
    assert.ok(!serialized.includes(secret));
});
