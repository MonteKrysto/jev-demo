import { test } from "node:test";
import assert from "node:assert/strict";
import { newRun } from "../packages/core/engine.js";
import { recordedDuration, runUsage } from "../apps/web/lib/run-usage.js";

test("usage separates execution time from recorded provider totals and groups models by provider", () => {
  const run = newRun("corrected-claim", "live");
  run.activeMs = 6200;
  run.metrics = [
    { provider: "jev", model: "jev-test", ms: 600, inputTokens: 100, outputTokens: 10 },
    { provider: "llm", model: "agent-test", ms: 1400, inputTokens: 250, outputTokens: 20 },
    { provider: "llm", model: "agent-test", ms: 2500, inputTokens: 150, outputTokens: 40 },
    { provider: "jev", model: "fixture-demo", ms: 99, inputTokens: 0, outputTokens: 0 },
  ];
  const original = structuredClone(run);
  const usage = runUsage(run);
  assert.equal(usage.executionMs, 6200);
  assert.equal(usage.providerMs, 4500);
  assert.equal(usage.jevMs, 600);
  assert.equal(usage.openaiMs, 3900);
  assert.equal(usage.modelCalls, 3);
  assert.equal(usage.tokens, 570);
  assert.equal(usage.inputTokens, 500);
  assert.equal(usage.outputTokens, 70);
  assert.deepEqual(usage.providers.map(row => [row.provider, row.model, row.calls]), [["jev", "jev-test", 1], ["llm", "agent-test", 2]]);
  assert.deepEqual(run, original);
});

test("missing historical execution timing stays unknown; a new run and fixture API totals are zero", () => {
  const run = newRun("corrected-claim");
  assert.equal(runUsage(run).executionMs, 0);
  run.steps = 2;
  run.updatedAt = "2026-10-15T23:00:00Z";
  run.createdAt = "2026-10-14T09:00:00Z";
  run.metrics = [{ provider: "jev", model: "fixture-demo", ms: 25, inputTokens: 0, outputTokens: 0 }];
  assert.equal(runUsage(run).executionMs, null, "timestamps include pauses and are not a substitute for active timing");
  assert.equal(runUsage(run).providerMs, 0);
  assert.equal(runUsage(run).modelCalls, 0);
  assert.deepEqual(runUsage(run).providers, []);
  run.activeMs = 0;
  assert.equal(runUsage(run).executionMs, 0, "a recorded zero is distinct from missing timing");
  assert.equal(recordedDuration(null), "Not recorded");
  assert.equal(recordedDuration(0), "0.00s");
  assert.equal(recordedDuration(4), "<0.01s");
  assert.equal(recordedDuration(6200), "6.20s");
});
