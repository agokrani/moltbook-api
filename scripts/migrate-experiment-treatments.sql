-- Migration: Add experiment_treatments table
-- Run this on an existing database before starting a ranking-effect experiment
--
-- Usage:
--   docker exec moltbook-db psql -U moltbook moltbook -f /tmp/migrate.sql
--   (after copying this file into the container)
--
-- Or directly:
--   psql -U moltbook -d moltbook -f scripts/migrate-experiment-treatments.sql

CREATE TABLE IF NOT EXISTS experiment_treatments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_name VARCHAR(64) NOT NULL,
  experiment_mode VARCHAR(1) NOT NULL,        -- 'A' or 'B'
  run_id INTEGER,                             -- replication number (1, 2, 3, ...)
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  is_world_post BOOLEAN NOT NULL DEFAULT false,
  treatment VARCHAR(12) NOT NULL,             -- 'nudge_up', 'nudge_down', 'control'
  nudge_delay_minutes REAL,                   -- NULL for control
  nudge_applied_at TIMESTAMP WITH TIME ZONE,  -- when nudge vote was cast
  nudge_vote_id UUID,                         -- FK to votes.id, NULL for control
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id)
);

CREATE INDEX IF NOT EXISTS idx_exp_treatments_post ON experiment_treatments(post_id);
CREATE INDEX IF NOT EXISTS idx_exp_treatments_experiment ON experiment_treatments(experiment_name);
CREATE INDEX IF NOT EXISTS idx_exp_treatments_treatment ON experiment_treatments(treatment);
CREATE INDEX IF NOT EXISTS idx_exp_treatments_run ON experiment_treatments(run_id);

-- Migration for existing tables: add run_id column if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'experiment_treatments' AND column_name = 'run_id') THEN
    ALTER TABLE experiment_treatments ADD COLUMN run_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_exp_treatments_run ON experiment_treatments(run_id);
  END IF;
END $$;
