import { randomUUID } from "node:crypto";
import { event } from "../../packages/core/domain.js";
import type { RunStore } from "../api/store.js";
import { createEngine, type Config } from "../api/config.js";

/** A checkpoint is the transaction boundary. Provider calls never hold a DB transaction. */
export class Worker {
  readonly id = randomUUID();
  private stopped = false;
  private loop?: Promise<void>;
  private wake?: () => void;
  constructor(
    private store: RunStore,
    private config: Config,
  ) {}
  async tick(): Promise<boolean> {
    await this.store.heartbeat(this.id);
    const owner = randomUUID(); // Fencing token is unique for every claim, even in one process.
    const job = await this.store.claimJob(owner);
    if (!job) return false;
    const heartbeat = setInterval(() => {
      void Promise.all([
        this.store.renewJob(job.runId, owner),
        this.store.heartbeat(this.id),
      ]).catch(() => undefined);
    }, 10000);
    try {
      let run = await this.store.get(job.runId);
      if (job.recoveries >= 3 && run.status === "ready") {
        run = await this.store.mutate(
          run.id,
          run.revision,
          async (current) => {
            current.status = "failed";
            current.reviewReason =
              "Background recovery budget exhausted; review and retry explicitly";
            event(current, "error", current.reviewReason);
            return current;
          },
          owner,
        );
      }
      if (!job.pauseRequested && run.status === "ready") {
        run = await this.store.mutate(
          run.id,
          run.revision,
          (current) =>
            createEngine(current.mode, this.config, this.store, current).step(current),
          owner,
        );
      }
      await this.store.finishJob(
        run.id,
        owner,
        run.status,
        run.status === "failed" ? run.reviewReason : undefined,
      );
    } catch {
      // Leave the lease to expire. Another worker can recover the last committed checkpoint.
      // Error details can contain credentials; never persist raw driver/provider exceptions.
      console.error(
        "Worker checkpoint interrupted; the lease will be recovered.",
      );
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  start() {
    this.loop ??= this.run();
    return this;
  }
  private async run() {
    while (!this.stopped) {
      try {
        if (await this.tick()) continue;
      } catch {
        console.error("Worker database unavailable; retrying shortly.");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
  async close() {
    this.stopped = true;
    this.wake?.();
    await this.loop;
  }
}
