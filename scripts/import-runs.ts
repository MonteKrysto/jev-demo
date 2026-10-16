import { z } from "zod";
import { RunStore, NotFoundError } from "../apps/api/store.js";
import { configFromEnv } from "../apps/api/config.js";
import type { Run } from "../packages/core/domain.js";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const schema = z.array(
  z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      scenarioId: z.string(),
      claimId: z.string(),
      status: z.enum([
        "ready",
        "awaiting_review",
        "needs_human",
        "completed",
        "failed",
      ]),
      receipts: z.array(z.object({}).passthrough()),
      facts: z.array(z.object({}).passthrough()),
      events: z.array(z.object({}).passthrough()),
      metrics: z.array(z.object({}).passthrough()),
    })
    .passthrough(),
);
const runs = schema.parse(data) as unknown as Run[];
const config = configFromEnv();
const store = await RunStore.open({
  databaseUrl: config.DATABASE_URL,
  directory: config.DATA_DIR,
});
let imported = 0;
try {
  for (const run of runs) {
    try {
      await store.get(run.id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await store.create(run);
      imported++;
    }
  }
  console.log(
    `Imported ${imported} runs; skipped ${runs.length - imported} existing IDs.`,
  );
} finally {
  await store.close();
}
