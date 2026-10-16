import { buildApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { RunStore } from "./store.js";
import { Worker } from "../worker/worker.js";
const config = configFromEnv();
const store = await RunStore.open({
  databaseUrl: config.DATABASE_URL,
  directory: config.DATA_DIR,
});
const app = await buildApp(store, config);
const worker = !config.DATABASE_URL
  ? new Worker(store, config).start()
  : undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => worker?.close())
      .then(() => store.close())
      .then(() => process.exit(0));
  });
await app.listen({ port: config.PORT, host: config.HOST });
console.log(
  `JEV RCM POC available at http://localhost:${config.PORT}. ${store.backend}; synthetic tools only.`,
);
