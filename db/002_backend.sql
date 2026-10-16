CREATE TABLE IF NOT EXISTS workflow_jobs (
  run_id text PRIMARY KEY REFERENCES workflow_runs(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  pause_requested boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_jobs_ready ON workflow_jobs(status, available_at);
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id text PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rcm_cases (
  id text PRIMARY KEY,
  family text NOT NULL,
  split text NOT NULL CHECK (split IN ('development', 'validation', 'test')),
  variant text NOT NULL,
  metadata jsonb NOT NULL,
  version integer NOT NULL
);
CREATE TABLE IF NOT EXISTS rcm_sources (
  case_id text NOT NULL REFERENCES rcm_cases(id),
  tool text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (case_id, tool)
);
CREATE TABLE IF NOT EXISTS evaluation_expectations (
  case_id text PRIMARY KEY REFERENCES rcm_cases(id),
  expected jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS run_case_snapshots (
  run_id text PRIMARY KEY REFERENCES workflow_runs(id),
  version integer NOT NULL,
  sources jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_invocations (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id),
  tool text NOT NULL,
  arguments jsonb NOT NULL,
  receipt jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_invocations_run ON tool_invocations(run_id);
CREATE TABLE IF NOT EXISTS synthetic_handoffs (
  run_id text PRIMARY KEY REFERENCES workflow_runs(id),
  claim_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
