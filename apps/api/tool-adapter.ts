import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { event, type Run } from "../../packages/core/domain.js";
import {
  makeReceipt,
  toolArgsSchema,
  type ToolExecutor,
  type ToolName,
} from "../../packages/core/tools.js";
import type { RunStore } from "./store.js";

export class DatabaseTools implements ToolExecutor {
  constructor(private store: RunStore) {}
  async execute(name: ToolName, args: unknown, run: Run) {
    const input = toolArgsSchema.parse(args);
    if (input.claimId !== run.claimId)
      throw new Error("Tool attempted to access another claim");
    const id = createHash("sha256")
      .update(JSON.stringify([run.id, run.receipts.length, name, input]))
      .digest("hex");
    const source = await this.store.caseSource(run, name);
    for (let retry = 0; retry < 2; retry++) {
      const invocation = await this.store.invocation(id, run, name, input);
      if (invocation.receipt) return invocation.receipt;
      if (source.delayMs) await delay(Math.min(source.delayMs, 2000));
      if (invocation.attempts <= (source.transientFailures ?? 0)) {
        await this.store.failInvocation(
          id,
          "Synthetic upstream temporarily unavailable",
        );
        event(run, "tool", `${name} transient failure`, {
          attempt: invocation.attempts,
          retrying: retry === 0,
        });
        if (retry === 0) {
          await delay(100);
          continue;
        }
        throw new Error("Synthetic tool retry budget exhausted");
      }
      const receipt = makeReceipt(
        name,
        input,
        run,
        source,
        `${run.id}:${id.slice(0, 16)}`,
      );
      return this.store.completeInvocation(id, receipt);
    }
    throw new Error("Synthetic tool retry budget exhausted");
  }
}
