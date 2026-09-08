ALTER TABLE resolution_logs
  ADD COLUMN IF NOT EXISTS resource_id TEXT;

CREATE INDEX IF NOT EXISTS idx_resolution_logs_resource_id_created_at
  ON resolution_logs (resource_id, created_at DESC);
