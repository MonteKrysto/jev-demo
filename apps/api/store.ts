import { readFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  corpus,
  corpusVersion,
  publicScenarios,
} from "../../packages/core/scenarios.js";
import { sourcesFor, toolCatalog } from "../../packages/core/tools.js";
import type { Run, Receipt, SourceSpec } from "../../packages/core/domain.js";
import { scoreTrial, summarizeBenchmark, sameBenchmarkOptions, type BenchmarkPlan, type BenchmarkReport } from "../../packages/core/benchmark.js";

export class ConflictError extends Error {
  readonly statusCode = 409;
}
export class NotFoundError extends Error {
  readonly statusCode = 404;
}
export interface Job {
  runId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  pauseRequested: boolean;
  attempts: number;
  recoveries: number;
  owner: string | null;
  lastError: string | null;
  benchmarkId?: string;
}
type Query = (statement: SQL) => Promise<Record<string, unknown>[]>;
export class RunStore {
  constructor(
    private readonly query: Query,
    private readonly disconnect: () => Promise<void>,
    readonly backend: string,
  ) {}
  static async open(
    options: { databaseUrl?: string; directory?: string } = {},
  ): Promise<RunStore> {
    let store: RunStore;
    let unlock: (() => Promise<void>) | undefined;
    if (options.databaseUrl) {
      const pool = new pg.Pool({
        connectionString: options.databaseUrl,
        max: 5,
      });
      const connection = await pool.connect();
      await connection.query("select pg_advisory_lock(728491)");
      unlock = async () => {
        await connection.query("select pg_advisory_unlock(728491)");
        connection.release();
      };
      const db = pgDrizzle(pool);
      store = new RunStore(
        async (statement) => (await db.execute(statement)).rows,
        async () => {
          await pool.end();
        },
        "PostgreSQL + Drizzle",
      );
    } else {
      const path =
        options.directory === ":memory:"
          ? undefined
          : resolve(options.directory ?? ".data/postgres");
      if (path) await mkdir(path, { recursive: true });
      const client = new PGlite(path);
      const db = pgliteDrizzle(client);
      store = new RunStore(
        async (statement) => (await db.execute(statement)).rows,
        async () => {
          await client.close();
        },
        "PGlite + Drizzle",
      );
    }
    try {
      await store.query(
        sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
      );
      const directory = new URL("../../db/", import.meta.url);
      for (const name of (await readdir(directory))
        .filter((n) => /^\d+.*\.sql$/.test(n))
        .sort()) {
        if (
          (
            await store.query(
              sql`select name from schema_migrations where name = ${name}`,
            )
          ).length
        )
          continue;
        const migration = await readFile(new URL(name, directory), "utf8");
        for (const statement of migration.split(";").filter((s) => s.trim()))
          await store.query(sql.raw(statement));
        await store.query(
          sql`insert into schema_migrations(name) values (${name}) on conflict do nothing`,
        );
      }
    } finally {
      await unlock?.();
    }
    await store.seedCases();
    return store;
  }
  async create(run: Run) {
    await this.query(sql`with created as (
      insert into workflow_runs (id, revision, state) values (${run.id}, ${run.revision}, ${JSON.stringify(run)}::jsonb) returning id
    ), snapshot as (
      insert into run_case_snapshots(run_id, version, sources) select created.id, ${corpusVersion},
      coalesce((select jsonb_object_agg(tool, payload) from rcm_sources where case_id = ${run.scenarioId}), '{}'::jsonb) from created
    ) insert into synthetic_handoffs(run_id, claim_id, payload)
      select id, ${run.claimId}, ${JSON.stringify(run.handoff ?? null)}::jsonb from created where ${Boolean(run.handoff)}`);
    return run;
  }
  async ping() {
    await this.query(sql`select 1 as ok`);
  }
  async get(id: string): Promise<Run> {
    const rows = await this.query(
      sql`select state, revision from workflow_runs where id = ${id}`,
    );
    if (!rows.length) throw new NotFoundError("Workflow not found");
    return { ...(rows[0].state as Run), revision: rows[0].revision as number };
  }
  async list(): Promise<Run[]> {
    const rows = await this.query(
      sql`select state, revision from workflow_runs where coalesce(state->>'purpose', 'interactive') = 'interactive' order by updated_at desc limit 50`,
    );
    return rows.map((row) => ({
      ...(row.state as Run),
      revision: row.revision as number,
    }));
  }
  async acquire(id: string, owner: string) {
    const rows = await this
      .query(sql`update workflow_runs set lease_owner = ${owner}, lease_until = now() + interval '60 seconds'
      where id = ${id} and (lease_owner is null or lease_until < now()) returning id`);
    if (!rows.length) {
      await this.get(id);
      throw new ConflictError("This workflow is already advancing");
    }
  }
  async release(id: string, owner: string) {
    await this.query(
      sql`update workflow_runs set lease_owner = null, lease_until = null where id = ${id} and lease_owner = ${owner}`,
    );
  }
  async save(run: Run, owner: string): Promise<Run> {
    const state = {
      ...run,
      revision: run.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const rows = await this.query(sql`with saved as (
      update workflow_runs set state = ${JSON.stringify(state)}::jsonb, revision = revision + 1, updated_at = now()
      where id = ${run.id} and revision = ${run.revision} and lease_owner = ${owner} and lease_until > now() returning id, revision
    ), handoff as (
      insert into synthetic_handoffs(run_id, claim_id, payload)
      select id, ${run.claimId}, ${JSON.stringify(run.handoff ?? null)}::jsonb from saved where ${Boolean(run.handoff)}
      on conflict(run_id) do nothing
    ) select revision from saved`);
    if (!rows.length)
      throw new ConflictError(
        "Workflow changed while this step was running; reload before retrying",
      );
    return state;
  }
  async mutate(
    id: string,
    expectedRevision: number,
    work: (run: Run) => Promise<Run>,
    workerOwner?: string,
  ): Promise<Run> {
    const owner = crypto.randomUUID();
    await this.acquire(id, owner);
    const heartbeat = setInterval(() => {
      void this.renewRun(id, owner).catch(() => undefined);
    }, 10000);
    try {
      const job = await this.job(id);
      if (
        job &&
        ["queued", "running"].includes(job.status) &&
        job.owner !== workerOwner
      )
        throw new ConflictError(
          "Pause the background job before advancing manually",
        );
      const run = await this.get(id);
      if (run.revision !== expectedRevision)
        throw new ConflictError(
          "Stale workflow revision; reload before retrying",
        );
      return await this.save(await work(run), owner);
    } finally {
      clearInterval(heartbeat);
      await this.release(id, owner);
    }
  }
  async renewRun(id: string, owner: string) {
    await this.query(
      sql`update workflow_runs set lease_until = now() + interval '60 seconds' where id = ${id} and lease_owner = ${owner} and lease_until > now()`,
    );
  }
  private jobRow(row: Record<string, unknown>): Job {
    return {
      runId: row.run_id as string,
      status: row.status as Job["status"],
      pauseRequested: row.pause_requested as boolean,
      attempts: row.attempts as number,
      recoveries: row.recoveries as number,
      owner: row.lease_owner as string | null,
      lastError: row.last_error as string | null,
      benchmarkId: row.benchmark_id as string | undefined,
    };
  }
  async job(id: string): Promise<Job | null> {
    const rows = await this.query(
      sql`select * from workflow_jobs where run_id = ${id}`,
    );
    return rows[0] ? this.jobRow(rows[0]) : null;
  }
  async jobs(): Promise<Job[]> {
    return (
      await this.query(
        sql`select j.*, r.state->'benchmark'->>'id' as benchmark_id from workflow_jobs j join workflow_runs r on r.id = j.run_id
          order by case when j.status in ('queued', 'running') then 0 else 1 end, j.updated_at desc limit 100`,
      )
    ).map((row) => this.jobRow(row));
  }
  async enqueue(id: string, revision: number) {
    const owner = crypto.randomUUID();
    await this.acquire(id, owner);
    try {
      const run = await this.get(id);
      const job = await this.job(id);
      if (job && ["queued", "running"].includes(job.status)) return job;
      if (run.revision !== revision)
        throw new ConflictError(
          "Stale workflow revision; reload before retrying",
        );
      if (run.status !== "ready")
        throw new ConflictError("Only a ready workflow can be queued");
      await this
        .query(sql`insert into workflow_jobs (run_id, status) values (${id}, 'queued')
        on conflict (run_id) do update set status = 'queued', pause_requested = false, available_at = now(), lease_owner = null, lease_until = null, last_error = null, recoveries = 0, updated_at = now()`);
      return this.job(id);
    } finally {
      await this.release(id, owner);
    }
  }
  async pause(id: string) {
    await this.get(id);
    await this.query(sql`update workflow_jobs set pause_requested = true,
      status = case when status = 'queued' then 'paused' else status end, updated_at = now()
      where run_id = ${id} and status in ('queued', 'running')`);
    return this.job(id);
  }
  async claimJob(owner: string): Promise<Job | null> {
    const rows = await this.query(sql`with candidate as (
      select j.run_id from workflow_jobs j join workflow_runs r on r.id = j.run_id
      where ((j.status = 'queued' and j.available_at <= now()) or (j.status = 'running' and j.lease_until < now()))
      and (r.lease_owner is null or r.lease_until < now())
      order by j.available_at, j.run_id for update of j skip locked limit 1
    ) update workflow_jobs j set status = 'running', lease_owner = ${owner}, lease_until = now() + interval '60 seconds',
      attempts = attempts + 1, recoveries = case when j.status = 'running' then j.recoveries + 1 else j.recoveries end, updated_at = now() from candidate c where j.run_id = c.run_id returning j.*`);
    return rows[0] ? this.jobRow(rows[0]) : null;
  }
  async renewJob(id: string, owner: string) {
    const rows = await this
      .query(sql`update workflow_jobs set lease_until = now() + interval '60 seconds', updated_at = now()
      where run_id = ${id} and lease_owner = ${owner} and lease_until > now() returning run_id`);
    return rows.length > 0;
  }
  async finishJob(
    id: string,
    owner: string,
    status: Run["status"],
    error?: string,
  ) {
    await this.query(sql`update workflow_jobs set status = case
      when ${status} = 'failed' then 'failed'
      when ${status} <> 'ready' then 'completed'
      when pause_requested then 'paused' else 'queued' end,
      lease_owner = null, lease_until = null, last_error = ${error ?? null}, recoveries = 0, available_at = now(), updated_at = now()
      where run_id = ${id} and lease_owner = ${owner} and lease_until > now()`);
  }
  async heartbeat(id: string) {
    await this.query(
      sql`insert into worker_heartbeats(id) values (${id}) on conflict(id) do update set last_seen = now()`,
    );
  }
  async queueHealth() {
    const workers = await this.query(
      sql`select count(*)::integer as count from worker_heartbeats where last_seen > now() - interval '30 seconds'`,
    );
    const jobs = await this.query(
      sql`select status, count(*)::integer as count from workflow_jobs group by status`,
    );
    return {
      workers: workers[0].count as number,
      jobs: Object.fromEntries(jobs.map((j) => [j.status, j.count])),
    };
  }
  async evaluations() {
    return this.query(
      sql`select id, report, created_at as "createdAt" from workflow_evaluations order by created_at desc limit 25`,
    );
  }
  async seedCases() {
    const rows = await this.query(
      sql`select count(*)::integer as count from rcm_cases where version = ${corpusVersion}`,
    );
    const sourceCount = await this.query(
      sql`select count(*)::integer as count from rcm_sources`,
    );
    const truthCount = await this.query(
      sql`select count(*)::integer as count from evaluation_expectations`,
    );
    if (
      rows[0].count === corpus.length &&
      sourceCount[0].count === corpus.length * toolCatalog.length &&
      truthCount[0].count === corpus.length
    )
      return;
    const metadata = publicScenarios().map((item) => ({
      ...item,
      metadata: item,
      version: corpusVersion,
    }));
    await this
      .query(sql`insert into rcm_cases(id, family, split, variant, metadata, version)
      select id, family, split, variant, metadata, version from jsonb_to_recordset(${JSON.stringify(metadata)}::jsonb)
      as x(id text, family text, split text, variant text, metadata jsonb, version integer)
      on conflict(id) do update set metadata = excluded.metadata, version = excluded.version`);
    const sources = corpus.flatMap((item) =>
      Object.entries(sourcesFor(item)).map(([tool, payload]) => ({
        case_id: item.id,
        tool,
        payload,
      })),
    );
    await this.query(sql`insert into rcm_sources(case_id, tool, payload)
      select case_id, tool, payload from jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) as x(case_id text, tool text, payload jsonb)
      on conflict(case_id, tool) do update set payload = excluded.payload`);
    const truth = corpus.map((item) => ({
      case_id: item.id,
      expected: {
        action: item.expected,
        family: item.family,
        variant: item.variant,
        split: item.split,
      },
    }));
    await this.query(sql`insert into evaluation_expectations(case_id, expected)
      select case_id, expected from jsonb_to_recordset(${JSON.stringify(truth)}::jsonb) as x(case_id text, expected jsonb)
      on conflict(case_id) do update set expected = excluded.expected`);
  }
  async cases() {
    return (
      await this.query(
        sql`select metadata from rcm_cases order by case when variant = 'curated' then 0 else 1 end, id`,
      )
    ).map((row) => row.metadata);
  }
  async caseSource(run: Run, tool: string): Promise<SourceSpec> {
    // Older saved runs gain a snapshot on first continued tool use; completed runs remain untouched.
    await this
      .query(sql`insert into run_case_snapshots(run_id, version, sources)
      select ${run.id}, ${corpusVersion}, coalesce(jsonb_object_agg(tool, payload), '{}'::jsonb) from rcm_sources where case_id = ${run.scenarioId}
      on conflict(run_id) do nothing`);
    const rows = await this.query(
      sql`select sources -> ${tool} as source from run_case_snapshots where run_id = ${run.id}`,
    );
    if (!rows[0]?.source)
      throw new Error("No source data exists for the assigned case and tool");
    return rows[0].source as SourceSpec;
  }
  async invocation(id: string, run: Run, tool: string, args: unknown) {
    const rows = await this
      .query(sql`insert into tool_invocations(id, run_id, tool, arguments, attempts) values (${id}, ${run.id}, ${tool}, ${JSON.stringify(args)}::jsonb, 1)
      on conflict(id) do update set attempts = tool_invocations.attempts + case when tool_invocations.receipt is null then 1 else 0 end
      returning receipt, attempts`);
    return {
      receipt: rows[0].receipt as Receipt | null,
      attempts: rows[0].attempts as number,
    };
  }
  async completeInvocation(id: string, receipt: Receipt) {
    const rows = await this.query(
      sql`update tool_invocations set receipt = coalesce(receipt, ${JSON.stringify(receipt)}::jsonb), last_error = null where id = ${id} returning receipt`,
    );
    if (!rows[0]) throw new Error("Tool invocation was not recorded");
    return rows[0].receipt as Receipt;
  }
  async failInvocation(id: string, error: string) {
    await this.query(
      sql`update tool_invocations set last_error = ${error} where id = ${id} and receipt is null`,
    );
  }
  async invocations(id: string) {
    return this.query(
      sql`select id, tool, arguments, receipt, attempts, last_error as "lastError" from tool_invocations where run_id = ${id} order by created_at`,
    );
  }
  async saveEvaluation(report: unknown) {
    const id = crypto.randomUUID();
    await this.query(
      sql`insert into workflow_evaluations (id, report) values (${id}, ${JSON.stringify(report)}::jsonb)`,
    );
    return id;
  }
  async benchmarkPlan(id: string): Promise<BenchmarkPlan> {
    const rows = await this.query(sql`select report from workflow_evaluations
      where id = ${id} and report->>'kind' = 'benchmark-v1'`);
    if (!rows.length) throw new NotFoundError("Benchmark not found");
    return rows[0].report as BenchmarkPlan;
  }
  async benchmarks() {
    const rows = await this.query(sql`select report from workflow_evaluations
      where report->>'kind' = 'benchmark-v1' order by created_at desc limit 25`);
    return rows.map(row => row.report as BenchmarkPlan);
  }
  /** A batch, its source snapshots, and every job become visible atomically. */
  async createBenchmark(plan: BenchmarkPlan, runs: Run[]) {
    await this.query(sql`with batch as (
      insert into workflow_evaluations(id, report) values (${plan.id}, ${JSON.stringify(plan)}::jsonb)
      on conflict do nothing returning id
    ), created as (
      insert into workflow_runs(id, revision, state)
      select r->>'id', 0, r from jsonb_array_elements(${JSON.stringify(runs)}::jsonb) r
      where exists (select 1 from batch) returning id, state
    ), snapshots as (
      insert into run_case_snapshots(run_id, version, sources)
      select c.id, ${plan.corpusVersion}, coalesce((select jsonb_object_agg(tool, payload)
        from rcm_sources where case_id = c.state->>'scenarioId'), '{}'::jsonb) from created c
    ) insert into workflow_jobs(run_id, status, available_at)
      select c.id, 'queued', now() + ((c.state->>'benchmarkOrder')::integer * interval '1 millisecond')
      from created c`);
    const saved = await this.benchmarkPlan(plan.id);
    if (!sameBenchmarkOptions(saved.options, plan.options))
      throw new ConflictError("This request ID belongs to a different benchmark");
    return saved;
  }
  async benchmarkReport(id: string): Promise<BenchmarkReport> {
    const plan = await this.benchmarkPlan(id);
    const ids = JSON.stringify(plan.trials.map(t => t.runId));
    const rows = await this.query(sql`select r.state, r.revision, j.status as job_status, j.pause_requested,
      coalesce((select sum(attempts) from tool_invocations where run_id = r.id), 0)::integer as attempts
      from workflow_runs r left join workflow_jobs j on j.run_id = r.id
      where r.id in (select jsonb_array_elements_text(${ids}::jsonb))`);
    const results = plan.trials.map(trial => {
      const row = rows.find(r => (r.state as Run).id === trial.runId);
      if (!row) throw new Error("A benchmark trial is missing");
      return scoreTrial(trial, row.state as Run, Number(row.attempts), plan.options.pricing);
    });
    return { plan, results, analysis: summarizeBenchmark(plan, results),
      paused: rows.some(r => (r.state as Run).status === "ready" && (r.job_status === "paused" || r.pause_requested)) };
  }
  async controlBenchmark(id: string, action: "pause" | "resume") {
    const plan = await this.benchmarkPlan(id);
    const ids = JSON.stringify(plan.trials.map(t => t.runId));
    if (action === "pause") {
      await this.query(sql`update workflow_jobs set pause_requested = true,
        status = case when status = 'queued' then 'paused' else status end, updated_at = now()
        where run_id in (select jsonb_array_elements_text(${ids}::jsonb)) and status in ('queued', 'running')`);
    } else {
      await this.query(sql`update workflow_jobs set pause_requested = false,
        status = case when status = 'paused' then 'queued' else status end, updated_at = now()
        where run_id in (select jsonb_array_elements_text(${ids}::jsonb)) and status in ('paused', 'queued', 'running')`);
    }
  }
  close() {
    return this.disconnect();
  }
}
