import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../apps/api/store.js";
import { buildApp } from "../apps/api/app.js";
import { configFromEnv } from "../apps/api/config.js";
import { newRun } from "../packages/core/engine.js";
import { scenarios } from "../packages/core/scenarios.js";

test("Postgres persistence, API workflows and concurrency protections", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-rcm-test-"));
  let store = await RunStore.open({ directory });
  let app = await buildApp(store, configFromEnv({}));
  const durableRun = newRun("corrected-claim");
  try {
    await t.test(
      "health and credential status do not disclose secrets",
      async () => {
        assert.equal((await app.inject("/api/health")).statusCode, 200);
        const config = (await app.inject("/api/config")).json();
        assert.deepEqual(config.modes, {
          demo: true,
          jev: false,
          live: false,
          openai: false,
        });
        assert.equal(config.TYPESAFE_API_KEY, undefined);
        const live = await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { scenarioId: "corrected-claim", mode: "live" },
        });
        assert.equal(live.statusCode, 400);
        assert.match(live.json().error, /TYPESAFE_API_KEY/);
      },
    );
    await t.test(
      "all curated scenarios run through the HTTP API and require approval",
      async () => {
        for (const scenario of scenarios) {
          const response = await app.inject({
            method: "POST",
            url: "/api/runs",
            payload: { scenarioId: scenario.id },
          });
          assert.equal(response.statusCode, 200);
          let run = response.json();
          for (let i = 0; i < 16 && run.status === "ready"; i++) {
            const step = await app.inject({
              method: "POST",
              url: `/api/runs/${run.id}/step`,
              payload: { expectedRevision: run.revision },
            });
            assert.equal(step.statusCode, 200, step.body);
            run = step.json();
          }
          assert.equal(run.taskAction, scenario.expected);
          assert.equal(run.handoff, undefined);
          const approved = await app.inject({
            method: "POST",
            url: `/api/runs/${run.id}/approve`,
            payload: { expectedRevision: run.revision, actor: "API reviewer" },
          });
          assert.equal(approved.statusCode, 200, approved.body);
          assert.equal(approved.json().status, "completed");
          assert.equal(approved.json().handoff.taskAction, scenario.expected);
          assert.equal(approved.json().approval.actor, "API reviewer");
        }
      },
    );
    await t.test(
      "stale revisions are rejected without applying an agent",
      async () => {
        await store.create(durableRun);
        await store.mutate(durableRun.id, 0, async (run) => run);
        const response = await app.inject({
          method: "POST",
          url: `/api/runs/${durableRun.id}/step`,
          payload: { expectedRevision: 0 },
        });
        assert.equal(response.statusCode, 409);
        assert.equal((await store.get(durableRun.id)).steps, 0);
      },
    );
    await t.test(
      "a competing step cannot acquire an active lease",
      async () => {
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((r) => {
          release = r;
        });
        const acquired = new Promise<void>((r) => {
          entered = r;
        });
        const first = store.mutate(durableRun.id, 1, async (run) => {
          entered();
          await held;
          return run;
        });
        await acquired;
        await assert.rejects(
          () => store.mutate(durableRun.id, 1, async (run) => run),
          /already advancing/,
        );
        release();
        await first;
      },
    );
    await t.test(
      "untrusted browser origins cannot mutate the local API",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/api/runs",
          headers: { origin: "https://untrusted.example" },
          payload: { scenarioId: "corrected-claim" },
        });
        assert.equal(response.statusCode, 403);
      },
    );
    await t.test(
      "invalid claim identifiers and request schemas fail visibly",
      async () => {
        assert.equal((await app.inject("/api/runs/unknown")).statusCode, 404);
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/runs",
              payload: { scenarioId: "unknown" },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/runs",
              payload: { scenarioId: "corrected-claim", secret: "unsupported" },
            })
          ).statusCode,
          400,
        );
      },
    );
    await t.test("runs and queued jobs survive database close and reopen", async () => {
      await store.enqueue(durableRun.id, 2);
      await app.close();
      await store.close();
      store = await RunStore.open({ directory });
      app = await buildApp(store, configFromEnv({}));
      const saved = await store.get(durableRun.id);
      assert.equal((await store.job(durableRun.id))?.status, "queued");
      assert.equal(saved.revision, 2);
      assert.equal(saved.claimId, durableRun.claimId);
      assert.equal((await store.list()).length, scenarios.length + 1);
    });
  } finally {
    await app.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
