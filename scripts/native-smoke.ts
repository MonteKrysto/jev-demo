import assert from "node:assert/strict";
import pg from "pg";
import { RunStore } from "../apps/api/store.js";
import { configFromEnv } from "../apps/api/config.js";
import { Worker } from "../apps/worker/worker.js";
import { newRun } from "../packages/core/engine.js";
import { defaultSettings } from "../packages/core/domain.js";
import { benchmarkOptionsSchema, makeBenchmarkPlan } from "../packages/core/benchmark.js";
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Run this check inside the Docker app, or configure a PostgreSQL DATABASE_URL.",
  );
const admin = new pg.Pool({ connectionString });
const schema = `rcm_smoke_${crypto.randomUUID().replaceAll("-", "")}`;
const url = new URL(connectionString);
url.searchParams.set("options", `-c search_path=${schema}`);
let first: RunStore | undefined;
let second: RunStore | undefined;
try {
  await admin.query(`create schema ${schema}`);
  first = await RunStore.open({ databaseUrl: url.toString() });
  second = await RunStore.open({ databaseUrl: url.toString() });
  const runs = await Promise.all(
    ["corrected-claim", "second-contact", "coverage-active"].map(async (id) => {
      const run = await first!.create(newRun(id));
      await first!.enqueue(run.id, 0);
      return run;
    }),
  );
  const one = new Worker(first, configFromEnv({}));
  const two = new Worker(second, configFromEnv({}));
  for (let checkpoint = 0; checkpoint < 16; checkpoint++) {
    await Promise.all([one.tick(), two.tick()]);
    if (
      (await Promise.all(runs.map((run) => first!.get(run.id)))).every(
        (run) => run.status !== "ready",
      )
    )
      break;
  }
  const results = await Promise.all(runs.map((run) => first!.get(run.id)));
  assert.deepEqual(
    results.map((run) => run.taskAction),
    ["correct_claim", "appeal", "correct_claim"],
  );
  assert.deepEqual(
    results.map((run) => run.steps),
    [5, 7, 7],
  );
  assert.ok(results.every((run) => run.status === "awaiting_review"));
  for (const run of results) {
    const invocations = await first.invocations(run.id);
    assert.equal(
      invocations.length,
      run.receipts.length,
      "No duplicate reads across workers",
    );
    assert.equal((await first.job(run.id))?.status, "completed");
  }
  const preserved = results[0];
  const { plan, runs: trials } = makeBenchmarkPlan(crypto.randomUUID(),
    benchmarkOptionsSchema.parse({ mode: "fixture", limit: 2, repeats: 2 }),
    defaultSettings, { jev: "jev-latest", openai: "gpt-4.1-mini" });
  await Promise.all([first.createBenchmark(plan, trials), second.createBenchmark(plan, trials)]);
  await first.controlBenchmark(plan.id, "pause");
  assert.equal((await second.benchmarkReport(plan.id)).paused, true);
  await second.controlBenchmark(plan.id, "resume");
  for (let checkpoint = 0; checkpoint < 32; checkpoint++) {
    await Promise.all([one.tick(), two.tick()]);
    if ((await first.benchmarkReport(plan.id)).analysis.complete) break;
  }
  const batch = await second.benchmarkReport(plan.id);
  assert.equal(batch.analysis.finished, 4);
  assert.equal(batch.analysis.summaries[0].accuracy, 1);
  assert.equal(batch.analysis.summaries[0].noteChecksPassed, 4);
  await first.close();
  first = await RunStore.open({ databaseUrl: url.toString() });
  assert.equal((await first.get(preserved.id)).revision, preserved.revision);
  assert.equal((await first.benchmarkReport(plan.id)).analysis.finished, 4);
  console.log(
    "PASS native PostgreSQL: two worker connections, three complete investigations, atomic deduplicated four-trial benchmark, pause/resume, no duplicate reads, state retained on reconnect.",
  );
} finally {
  await first?.close();
  await second?.close();
  await admin.query(`drop schema if exists ${schema} cascade`);
  await admin.end();
}
