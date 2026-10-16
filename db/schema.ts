import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";
import type { Run } from "../packages/core/domain.js";
export const workflowRuns = pgTable("workflow_runs", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  state: jsonb("state").$type<Run>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
});
export const workflowEvaluations = pgTable("workflow_evaluations", {
  id: text("id").primaryKey(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// SQL migrations are authoritative; these definitions document the persisted entities.
export const workflowJobs = pgTable("workflow_jobs", {
  runId: text("run_id")
    .primaryKey()
    .references(() => workflowRuns.id),
  status: text("status").notNull(),
  pauseRequested: boolean("pause_requested").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  recoveries: integer("recoveries").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const rcmCases = pgTable("rcm_cases", {
  id: text("id").primaryKey(),
  family: text("family").notNull(),
  split: text("split").notNull(),
  variant: text("variant").notNull(),
  metadata: jsonb("metadata").notNull(),
  version: integer("version").notNull(),
});
export const rcmSources = pgTable(
  "rcm_sources",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => rcmCases.id),
    tool: text("tool").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.tool] })],
);
export const runCaseSnapshots = pgTable("run_case_snapshots", {
  runId: text("run_id")
    .primaryKey()
    .references(() => workflowRuns.id),
  version: integer("version").notNull(),
  sources: jsonb("sources").notNull(),
});
export const toolInvocations = pgTable("tool_invocations", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => workflowRuns.id),
  tool: text("tool").notNull(),
  arguments: jsonb("arguments").notNull(),
  receipt: jsonb("receipt"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const evaluationExpectations = pgTable("evaluation_expectations", {
  caseId: text("case_id")
    .primaryKey()
    .references(() => rcmCases.id),
  expected: jsonb("expected").notNull(),
});
export const syntheticHandoffs = pgTable("synthetic_handoffs", {
  runId: text("run_id")
    .primaryKey()
    .references(() => workflowRuns.id),
  claimId: text("claim_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  lastSeen: timestamp("last_seen", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
