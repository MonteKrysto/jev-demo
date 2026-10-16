import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchmarkOptionsSchema, makeBenchmarkPlan, selectBenchmarkCases, scoreTrial, summarizeBenchmark, sameBenchmarkOptions } from "../packages/core/benchmark.js";
import { defaultSettings } from "../packages/core/domain.js";
import { RunStore } from "../apps/api/store.js";
import { buildApp } from "../apps/api/app.js";
import { configFromEnv, createEngine } from "../apps/api/config.js";
import { Worker } from "../apps/worker/worker.js";
import { newRun } from "../packages/core/engine.js";

const models = { jev: "jev-latest", openai: "gpt-4.1-mini" };
test("benchmark samples are reproducible, diverse, and isolated by family split", () => {
  const options = benchmarkOptionsSchema.parse({ scope: "all", split: "all", limit: 32 });
  const first = selectBenchmarkCases(options);
  assert.deepEqual(first, selectBenchmarkCases(options));
  assert.equal(first.length, 32);
  assert.equal(new Set(first.map(s => s.id)).size, 32);
  assert.equal(new Set(first.slice(0, 16).map(s => s.family)).size, 16);
  assert.notDeepEqual(first, selectBenchmarkCases({ ...options, seed: "another-seed" }));
  const dev = selectBenchmarkCases({ ...options, limit: 528, split: "development" });
  const held = selectBenchmarkCases({ ...options, limit: 528, split: "test" });
  assert.ok(held.length);
  assert.ok(held.every(s => !dev.some(d => d.family === s.family)));
  const small = selectBenchmarkCases(benchmarkOptionsSchema.parse({ limit: 4 }));
  assert.equal(new Set(small.map(s => s.expected)).size, 4, "Small authored samples should cover available action categories");
  assert.equal(new Set(small.map(s => s.family)).size, 4);
});
test("paired trials share case selection and frozen settings without exposing labels to agents", () => {
  const options = benchmarkOptionsSchema.parse({ limit: 4, repeats: 3 });
  const { plan, runs } = makeBenchmarkPlan(crypto.randomUUID(), options, defaultSettings, models);
  assert.equal(runs.length, 24);
  for (let i = 0; i < runs.length; i += 2) {
    assert.equal(runs[i].scenarioId, runs[i + 1].scenarioId);
    assert.notEqual(runs[i].mode, runs[i + 1].mode);
    assert.equal(plan.trials[i].repeat, plan.trials[i + 1].repeat);
    assert.equal("expected" in runs[i], false);
    assert.deepEqual(runs[i].benchmark?.settings, defaultSettings);
  }
  const engine = createEngine("demo", configFromEnv({ MAX_STEPS: "40" }), undefined, runs[0]);
  assert.equal(engine.settings.maxSteps, defaultSettings.maxSteps);
  assert.ok(sameBenchmarkOptions(options, JSON.parse(JSON.stringify(options))));
  assert.equal(sameBenchmarkOptions(options, { ...options, repeats: 2 }), false);
});
test("scoring keeps failed extractions and missing fields out of successful outcomes", async () => {
  const options = benchmarkOptionsSchema.parse({ mode: "fixture", limit: 1, repeats: 1 });
  const { plan } = makeBenchmarkPlan(crypto.randomUUID(), options, defaultSettings, models);
  const run = newRun("corrected-claim");
  const engine = createEngine("demo", configFromEnv({}));
  while (run.status === "ready") await engine.step(run);
  const trial = { ...plan.trials[0], scenarioId: run.scenarioId, expected: "correct_claim" as const, runId: run.id };
  const good = scoreTrial(trial, run, 2);
  assert.equal(good.matched, true);
  assert.equal(good.noteChecksPassed, true);
  assert.equal(good.sourceCoverage, 1);
  const missing = structuredClone(run);
  missing.facts = missing.facts.filter(f => f.key !== "denial_reason");
  assert.ok(scoreTrial(trial, missing, 2).sourceCoverage! < 1);
  assert.equal(scoreTrial(trial, missing, 2).noteChecksPassed, false);
  const failed = structuredClone(run);
  failed.status = "failed";
  failed.reviewReason = "Extracted fact does not match its authoritative tool receipt";
  const bad = scoreTrial(trial, failed, 3);
  assert.equal(bad.matched, false);
  assert.equal(bad.groundingFailure, true);
  assert.equal(bad.noteChecksPassed, false);
  const pairedPlan = { ...plan, trials: [{ ...trial, mode: "live" as const }, { ...trial, mode: "openai" as const }] };
  const paired = summarizeBenchmark(pairedPlan, [{ ...good, mode: "live" }, { ...bad, mode: "openai" }]);
  assert.equal(paired.paired.count, 1);
  assert.equal(paired.paired.liveOnlyCorrect, 1);
  assert.equal(paired.paired.accuracyDifference, 1);
  assert.equal(paired.summaries.find(s => s.mode === "openai")?.failed, 1);
  const incomplete = summarizeBenchmark(pairedPlan, [{ ...good, mode: "live" }, { ...bad, mode: "openai", finished: false }]);
  assert.equal(incomplete.paired.count, 0);
  assert.equal(incomplete.complete, false);
});
test("cost estimates require explicit prices and use the routing provider for each call", () => {
  const { plan, runs } = makeBenchmarkPlan(crypto.randomUUID(), benchmarkOptionsSchema.parse({ limit: 1, repeats: 1 }), defaultSettings, models);
  const run = runs.find(r => r.mode === "live")!;
  const trial = plan.trials.find(t => t.mode === "live")!;
  run.metrics = [
    { provider: "jev", model: "jev-1", ms: 4, inputTokens: 1000, outputTokens: 100 },
    { provider: "llm", model: "gpt-model", ms: 12, inputTokens: 2000, outputTokens: 200 },
  ];
  assert.equal(scoreTrial(trial, run, 0).estimatedCostUsd, null);
  const scored = scoreTrial(trial, run, 0, { jev: { input: 1, output: 2 }, openai: { input: 3, output: 4 } });
  assert.ok(Math.abs(scored.estimatedCostUsd! - .008) < 1e-10);
  assert.equal(scored.providerUsage["gpt-model"].calls, 1);
});
test("benchmark batches persist, enqueue atomically, deduplicate, pause/resume, and preserve trial evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-benchmark-"));
  let store = await RunStore.open({ directory });
  const config = configFromEnv({});
  let app = await buildApp(store, config);
  const id = crypto.randomUUID();
  const options = benchmarkOptionsSchema.parse({ mode: "fixture", limit: 2, repeats: 2 });
  try {
    const preview = await app.inject({ method: "POST", url: "/api/benchmarks/preview", payload: options });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().runs, 4);
    assert.equal((await store.benchmarks()).length, 0);
    const start = () => app.inject({ method: "POST", url: "/api/benchmarks", payload: { id, options } });
    const responses = await Promise.all([start(), start()]);
    assert.ok(responses.every(r => r.statusCode === 200), responses.map(r => r.body).join("\n"));
    const plan = await store.benchmarkPlan(id);
    assert.equal(plan.trials.length, 4);
    assert.equal((await store.jobs()).length, 4);
    assert.equal((await store.list()).length, 0);
    const report = await store.benchmarkReport(id);
    assert.equal(report.analysis.finished, 0);
    assert.ok(report.analysis.summaries.every(s => s.accuracy === null));
    const changed = await app.inject({ method: "POST", url: "/api/benchmarks", payload: { id, options: { ...options, repeats: 3 } } });
    assert.equal(changed.statusCode, 409);
    const noKeys = await app.inject({ method: "POST", url: "/api/benchmarks", payload: { id: crypto.randomUUID(), options: { ...options, mode: "compare" } } });
    assert.equal(noKeys.statusCode, 400);
    const huge = await app.inject({ method: "POST", url: "/api/benchmarks", payload: { id: crypto.randomUUID(), options: { ...options, scope: "all", split: "all", limit: 528 } } });
    assert.equal(huge.statusCode, 400);
    assert.equal((await store.benchmarks()).length, 1);
    for (const action of ["start", "step", "pause", "retry", "approve"]) {
      const response = await app.inject({ method: "POST", url: `/api/runs/${plan.trials[0].runId}/${action}`, payload: { expectedRevision: 0 } });
      assert.equal(response.statusCode, 409);
    }
    const paused = await app.inject({ method: "POST", url: `/api/benchmarks/${id}/control`, payload: { action: "pause" } });
    assert.equal(paused.statusCode, 200);
    assert.equal((await store.benchmarkReport(id)).paused, true);
    assert.equal(await new Worker(store, config).tick(), false);
    await app.close(); await store.close();
    store = await RunStore.open({ directory }); app = await buildApp(store, config);
    assert.equal((await store.benchmarkReport(id)).paused, true);
    await app.inject({ method: "POST", url: `/api/benchmarks/${id}/control`, payload: { action: "resume" } });
    const worker = new Worker(store, config);
    for (let i = 0; i < 60 && !(await store.benchmarkReport(id)).analysis.complete; i++) await worker.tick();
    const completed = (await app.inject(`/api/benchmarks/${id}`)).json();
    assert.equal(completed.analysis.complete, true);
    assert.equal(completed.analysis.finished, 4);
    assert.equal(completed.analysis.summaries[0].accuracy, 1);
    assert.equal(completed.analysis.summaries[0].noteChecksPassed, 4);
    assert.equal(completed.analysis.summaries[0].stableRepeats, 2);
    assert.ok(completed.results.every((r: { toolAttempts: number }) => r.toolAttempts > 0));
    for (const trial of plan.trials) assert.equal((await store.get(trial.runId)).handoff, undefined);
    assert.equal((await app.inject(`/api/benchmarks/${crypto.randomUUID()}`)).statusCode, 404);
  } finally { await app.close(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});
