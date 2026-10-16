import { configFromEnv } from "../api/config.js";
import { RunStore } from "../api/store.js";
import { Worker } from "./worker.js";
const config = configFromEnv();
if (!config.DATABASE_URL)
  throw new Error(
    "A separate worker requires DATABASE_URL. The local embedded database runs its worker inside the API process.",
  );
const store = await RunStore.open({ databaseUrl: config.DATABASE_URL });
const worker = new Worker(store, config).start();
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void worker
      .close()
      .then(() => store.close())
      .then(() => process.exit(0));
  });
console.log("RCM worker ready; durable PostgreSQL queue enabled.");
