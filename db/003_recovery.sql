ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS recoveries integer NOT NULL DEFAULT 0;
