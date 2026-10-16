CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS workflow_evaluations (
  id text PRIMARY KEY,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
