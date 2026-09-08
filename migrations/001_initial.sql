CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS malaysia_postcode_references (
  postcode CHAR(5) NOT NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (postcode, state, city)
);

CREATE INDEX IF NOT EXISTS idx_postcode_reference_postcode
  ON malaysia_postcode_references (postcode);

CREATE TABLE IF NOT EXISTS resolution_logs (
  id UUID PRIMARY KEY,
  request_address TEXT NOT NULL,
  request_phone TEXT NOT NULL,
  sanitized_address TEXT NOT NULL,
  sanitize_enabled BOOLEAN NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'AMBIGUOUS', 'FAILED')),
  confidence_score NUMERIC(3, 2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  result JSONB NOT NULL,
  detected_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_logs_created_at ON resolution_logs (created_at DESC);
