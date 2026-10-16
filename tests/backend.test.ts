import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, type SQL } from "drizzle-orm";
import { RunStore } from "../apps/api/store.js";
import { DatabaseTools } from "../apps/api/tool-adapter.js";
import { Worker } from "../apps/worker/worker.js";
import { configFromEnv, createEngine } from "../apps/api/config.js";
import { newRun } from "../packages/core/engine.js";
import { corpus } from "../packages/core/scenarios.js";
import { eligibleAgents } from "../packages/core/policy.js";
import { addFacts } from "../packages/core/evidence.js";
import { toolCatalog } from "../packages/core/catalog.js";
import { SyntheticTools } from "../packages/core/tools.js";

// Fault injection simulates a process dying after claiming a lease; no minute-long sleeps.
function inject(store: RunStore, statement: SQL) {
  return (
    store as unknown as {
      query(statement: SQL): Promise<Record<string, unknown>[]>;
    }
  ).query(statement);
}
test("durable queue, fencing, pause, cached tools and isolated snapshots", async (t) => {
  const store = await RunStore.open({ directory: ":memory:" });
  const worker = new Worker(store, configFromEnv({}));
  try {
    await t.test(
      "a queued run advances without any browser step requests",
      async () => {
        const run = await store.create(newRun("corrected-claim"));
        await store.enqueue(run.id, 0);
        await assert.rejects(
          store.mutate(run.id, 0, async (r) => r),
          /background job/,
        );
        for (
          let i = 0;
          i < 8 && (await store.get(run.id)).status === "ready";
          i++
        )
          await worker.tick();
        assert.equal((await store.get(run.id)).status, "awaiting_review");
        assert.equal((await store.job(run.id))?.status, "completed");
        assert.equal((await store.get(run.id)).handoff, undefined);
      },
    );
    await t.test('approval saves one handoff atomically with the run', async () => {
      let run = await store.create(newRun('processing'));
      const engine = createEngine('demo', configFromEnv({}), store);
      while (run.status === 'ready') run = await store.mutate(run.id, run.revision, current => engine.step(current));
      run = await store.mutate(run.id, run.revision, async current => engine.approve(current, 'Transaction reviewer'));
      const saved = await inject(store, sql`select payload from synthetic_handoffs where run_id = ${run.id}`);
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].payload, run.handoff);
      await store.mutate(run.id, run.revision, async current => engine.approve(current, 'Repeated approval'));
      assert.equal((await inject(store, sql`select payload from synthetic_handoffs where run_id = ${run.id}`)).length, 1);
    });
    await t.test('repeated process interruptions stop at a bounded recovery budget', async () => {
      const run = await store.create(newRun('processing'));
      await store.enqueue(run.id, 0);
      await store.claimJob('interrupted');
      await inject(store, sql`update workflow_jobs set recoveries = 2, lease_until = now() - interval '1 second' where run_id = ${run.id}`);
      await worker.tick();
      const stopped = await store.get(run.id);
      assert.equal(stopped.status, 'failed');
      assert.match(stopped.reviewReason!, /recovery budget/);
      assert.equal(stopped.steps, 0);
      assert.equal((await store.job(run.id))?.status, 'failed');
    });
    await t.test(
      "workers cannot claim the same job and expired owners are fenced",
      async () => {
        const run = await store.create(newRun("processing"));
        await store.enqueue(run.id, 0);
        const claims = await Promise.all([
          store.claimJob("worker-a"),
          store.claimJob("worker-b"),
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
        const first = claims.find(Boolean)!;
        await inject(
          store,
          sql`update workflow_jobs set lease_until = now() - interval '1 second' where run_id = ${run.id}`,
        );
        assert.equal((await store.claimJob("recovery"))?.runId, run.id);
        await store.finishJob(run.id, first.owner!, "completed");
        assert.equal((await store.job(run.id))?.owner, "recovery");
        await store.pause(run.id);
        await store.finishJob(run.id, "recovery", "ready");
        assert.equal((await store.job(run.id))?.status, "paused");
        assert.equal((await store.get(run.id)).steps, 0);
        await store.enqueue(run.id, 0);
        await worker.tick();
        await store.pause(run.id);
        assert.equal((await store.get(run.id)).steps, 1);
      },
    );
    await t.test(
      "run revision and lease fencing reject zombie checkpoints",
      async () => {
        const run = await store.create(newRun("processing"));
        await store.acquire(run.id, "old");
        await inject(
          store,
          sql`update workflow_runs set lease_until = now() - interval '1 second' where id = ${run.id}`,
        );
        await store.acquire(run.id, "new");
        run.steps++;
        await assert.rejects(store.save(run, "old"), /Workflow changed/);
        assert.equal((await store.get(run.id)).steps, 0);
        await store.release(run.id, "new");
      },
    );
    await t.test(
      "transient failure retries once and extraction retries reuse the receipt",
      async () => {
        const run = await store.create(newRun("corrected-claim-v07"));
        const tools = new DatabaseTools(store);
        const first = await tools.execute(
          "get_claim",
          { claimId: run.claimId, topic: "status" },
          run,
        );
        const second = await tools.execute(
          "get_claim",
          { claimId: run.claimId, topic: "status" },
          run,
        );
        assert.deepEqual(second, first);
        const calls = await store.invocations(run.id);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].attempts, 2);
        const replay = await store.completeInvocation(calls[0].id as string, { ...first, observedAt: '2099-01-01T00:00:00Z' });
        assert.deepEqual(replay, first, 'A late executor receives the already committed receipt');
        await assert.rejects(
          tools.execute("get_claim", { claimId: "SYN-9999" }, run),
          /another claim/,
        );
      },
    );
    await t.test(
      "source changes do not rewrite existing investigation snapshots",
      async () => {
        const run = await store.create(newRun("corrected-claim"));
        await inject(
          store,
          sql`update rcm_sources set payload = '{"fields":{"claim_status":"closed"}}'::jsonb where case_id = 'corrected-claim' and tool = 'get_claim'`,
        );
        const receipt = await new DatabaseTools(store).execute(
          "get_claim",
          { claimId: run.claimId },
          run,
        );
        assert.equal(receipt.fields.claim_status, "denied");
        const next = await store.create(newRun("corrected-claim"));
        assert.equal(
          (
            await new DatabaseTools(store).execute(
              "get_claim",
              { claimId: next.claimId },
              next,
            )
          ).fields.claim_status,
          "closed",
        );
      },
    );
    await t.test(
      "payer clarification depends on query rather than call count",
      async () => {
        const run = await store.create(newRun("second-contact"));
        const tools = new DatabaseTools(store);
        const initial = await tools.execute(
          "call_payer",
          { claimId: run.claimId, topic: "status" },
          run,
        );
        assert.equal(initial.fields.payer_instruction, undefined);
        run.payerCalls = 2;
        const repeated = await tools.execute(
          "call_payer",
          { claimId: run.claimId, topic: "status" },
          run,
        );
        assert.equal(repeated.fields.payer_instruction, undefined);
        const clarified = await tools.execute(
          "call_payer",
          { claimId: run.claimId, topic: "clarification" },
          run,
        );
        assert.match(clarified.fields.payer_instruction!, /appeal/);
      },
    );
  } finally {
    await store.close();
  }
});
test("case families never straddle evaluation splits and answer keys stay out of routing state", () => {
  assert.equal(corpus.length, 528);
  for (const family of new Set(corpus.map((item) => item.family))) {
    assert.equal(
      new Set(
        corpus
          .filter((item) => item.family === family)
          .map((item) => item.split),
      ).size,
      1,
    );
  }
  assert.equal(toolCatalog.length, 12);
  const run = newRun("coverage-active");
  const receipt = new SyntheticTools().execute(
    "get_claim",
    { claimId: run.claimId },
    run,
  );
  addFacts(
    run,
    Object.entries(receipt.fields).map(([key, value]) => ({
      key: key as keyof typeof receipt.fields,
      value: value!,
      sourceId: receipt.id,
      quote: `${key}: ${value}`,
    })),
    [receipt],
  );
  run.receipts.push(receipt);
  assert.ok(
    eligibleAgents(run).length > 3,
    "Routing has several legitimate investigative options",
  );
  assert.ok(
    !eligibleAgents(run).includes("task_action"),
    "Evidence gate still blocks a premature decision",
  );
});
