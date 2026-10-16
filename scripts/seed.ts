import { configFromEnv } from "../apps/api/config.js";
import { RunStore } from "../apps/api/store.js";
const config = configFromEnv();
const store = await RunStore.open({
  databaseUrl: config.DATABASE_URL,
  directory: config.DATA_DIR,
});
try {
  console.log(
    `Migrations applied; ${(await store.cases()).length} synthetic cases available. Existing runs and snapshots retained.`,
  );
} finally {
  await store.close();
}
