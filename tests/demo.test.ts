import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, newRun } from "../packages/core/engine.js";
import { DemoRouter } from "../packages/core/jev.js";
import { FixtureAgents } from "../packages/core/agents.js";
import { demoFrame, demoNote } from "../apps/web/lib/demo.js";
import { event } from "../packages/core/domain.js";

async function completed(scenario: string) {
  const run = newRun(scenario);
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  return run;
}

test("demo replay reveals only evidence already obtained and only shows outputs at the end", async () => {
  const run = await completed("corrected-claim");
  assert.equal(demoFrame(run, 0).findings.length, 0);
  const first = demoFrame(run, 1);
  assert.deepEqual(first.findings.map(f => f.value), ["denied"]);
  assert.equal(first.finished, false);
  const payer = demoFrame(run, 2);
  assert.ok(payer.findings.some(f => f.value === "missing modifier" && f.added));
  assert.equal(payer.findings.filter(f => f.key === "claim_status").length, 1, "matching source values are grouped");
  assert.equal(payer.findings.find(f => f.key === "claim_status")?.sources.length, 2);
  const verified = demoFrame(run, 3);
  assert.equal(verified.findings.some(f => f.added), false);
  assert.equal(verified.finished, false);
  assert.equal(demoFrame(run, Infinity).finished, true);
  assert.equal(demoFrame(run, -2).step, 0);
  assert.equal(demoFrame(run, 999).step, 5);
});

test("simplified evidence preserves disagreeing source values", async () => {
  const run = await completed("contradiction");
  assert.deepEqual(demoFrame(run, 1).findings.filter(f => f.key === "denial_reason").map(f => f.value), ["missing prior authorization"]);
  assert.deepEqual(demoFrame(run, 2).findings.filter(f => f.key === "denial_reason").map(f => f.value), ["missing prior authorization", "duplicate claim"]);
  const checked = demoFrame(run, 3).sequence.at(-1)!.entries.at(-1)!;
  assert.equal(checked.role, "application");
  assert.equal(checked.warning, true);
  assert.match(checked.detail!, /disagree/);
});

test("sequence keeps decisions, tool results, verification, action, and note in their recorded order", async () => {
  const run = await completed("corrected-claim");
  assert.deepEqual(demoFrame(run, 0).sequence, []);
  const early = demoFrame(run, 1).sequence;
  assert.equal(early.length, 1);
  assert.deepEqual(early[0].entries.map(entry => entry.role), ["decision", "agent"]);
  assert.deepEqual(early[0].entries[1].receipt?.fields, { claim_status: "denied" });
  const sequence = demoFrame(run, Infinity).sequence;
  assert.deepEqual(sequence.map(group => group.entries.map(entry => entry.role)), [
    ["decision", "agent"], ["decision", "agent"], ["decision", "application"],
    ["decision", "application"], ["decision", "agent", "application"],
  ]);
  assert.match(sequence[3].entries[1].detail!, /corrected claim/);
  assert.equal(sequence[4].entries[2].title, "Completion note prepared");

  // Live calls include a separate tool-call event before the accepted receipt.
  const receiptIndex = run.events.findIndex(event => event.kind === "tool");
  run.events.splice(receiptIndex, 0, {
    id: "live-call", at: run.createdAt, kind: "tool", title: "LLM called get_claim",
    data: { tool: "get_claim", sourceId: run.receipts[0].id, arguments: {} },
  });
  assert.deepEqual(demoFrame(run, Infinity).sequence, sequence, "a successful call and receipt appear as one operation");
});

test("sequence separates a router proposal from an application override and never invents its tool call", async () => {
  const run = newRun("contradiction", "live");
  const router = new DemoRouter();
  const engine = new Engine({ async evaluate(state, settings) {
    const decision = await router.evaluate(state, settings);
    if (state.steps === 1) {
      decision.answers.next_agent.choice = "coverage_lookup";
      decision.answers.next_agent.confidence = .26;
    }
    return decision;
  } }, new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  const entries = demoFrame(run, 2).sequence[1].entries;
  assert.deepEqual(entries.map(entry => entry.role), ["decision", "application", "application"]);
  assert.equal(entries[0].title, "Check coverage and authorization");
  assert.equal(entries[1].title, "Changed to: Request human review");
  assert.match(entries[1].detail!, /26%.*70%/);
  assert.equal(entries[2].title, "Handed off for human review");
  assert.equal(entries.some(entry => entry.receipt), false);
});

test("sequence preserves failed tool attempts and failures before the first decision", async () => {
  const run = newRun("corrected-claim");
  const engine = new Engine(new DemoRouter(), { async gather(_capability, state) {
    event(state, "tool", "LLM called get_claim", { tool: "get_claim", sourceId: "unaccepted" });
    throw new Error("Extraction failed");
  }, async composeNote() { throw new Error("Unexpected note call"); } });
  await engine.step(run);
  const entries = demoFrame(run, 1).sequence[0].entries;
  assert.deepEqual(entries.map(entry => entry.role), ["decision", "agent", "application"]);
  assert.match(entries[1].detail!, /No accepted findings/);
  assert.equal(entries[2].title, "Extraction failed");
  assert.equal(entries.some(entry => entry.receipt), false);
  const before = newRun("corrected-claim");
  event(before, "error", "Router unavailable");
  assert.equal(demoFrame(before, 0).sequence[0].entries[0].title, "Router unavailable");
});

test("the confidence stop remains visible when the router also proposed human review", async () => {
  const run = newRun("corrected-claim");
  const router = new DemoRouter();
  await new Engine({ async evaluate(state, settings) {
    const decision = await router.evaluate(state, settings);
    decision.answers.next_agent.choice = "human_review";
    decision.answers.next_agent.confidence = .2;
    return decision;
  } }, new FixtureAgents()).step(run);
  const entries = demoFrame(run, 1).sequence[0].entries;
  assert.equal(entries[0].title, "Request human review");
  assert.equal(entries[1].title, "Human review required by confidence rule");
  assert.match(entries[1].detail!, /20%.*70%/);
  assert.equal(entries[1].gate?.appliedAgent, "human_review");
});

test("presented notes retain text and use source names only for known receipt IDs", async () => {
  const run = await completed("corrected-claim");
  const original = run.completionNote;
  run.completionNote += "\n[unknown reference]";
  const note = demoNote(run, receipt => receipt.tool);
  assert.match(note, /\[get_claim, call_payer\]/);
  assert.match(note, /missing modifier/);
  assert.match(note, /\[unknown reference\]/);
  assert.equal(run.completionNote, original + "\n[unknown reference]");
});
