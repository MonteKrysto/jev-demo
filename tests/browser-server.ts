import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/api/app.js";
import { configFromEnv } from "../apps/api/config.js";
import { Worker } from "../apps/worker/worker.js";
import { RunStore } from "../apps/api/store.js";

// Isolated from the user's saved runs and provider credentials.
const directory = await mkdtemp(join(tmpdir(), "jev-browser-"));
const store = await RunStore.open({ directory });
// Dummy credentials allow live-mode creation tests. Loopback-only provider URLs
// ensure an accidental execution cannot contact a real provider.
const config = configFromEnv({
  PORT: "3101",
  TYPESAFE_API_KEY: "browser-test-key",
  OPENAI_API_KEY: "browser-test-key",
  TYPESAFE_BASE_URL: "http://127.0.0.1:9",
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
});
const app = await buildApp(store, config);
// A paced worker makes pause controls testable without delaying browser requests.
const worker = new Worker(store, config);
let ticking: Promise<boolean> | undefined;
const interval = setInterval(() => {
  if (!ticking)
    ticking = worker.tick().finally(() => {
      ticking = undefined;
    });
}, 600);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    clearInterval(interval);
    await ticking;
    await app.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  });
await app.listen({ port: 3101, host: "127.0.0.1" });
