CREATE TABLE IF NOT EXISTS ai_provider_settings (
  provider TEXT PRIMARY KEY
    CHECK (provider IN ('gemini', 'openai', 'deepseek', 'mock')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  api_key TEXT CHECK (api_key IS NULL OR length(trim(api_key)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  base_url TEXT,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ai_provider_settings (provider, enabled, api_key, model, base_url, priority)
VALUES
  ('gemini', false, NULL, 'gemini-3.5-flash', NULL, 10),
  ('openai', false, NULL, 'gpt-5-mini', NULL, 20),
  ('deepseek', false, NULL, 'deepseek-chat', 'https://api.deepseek.com', 30),
  ('mock', false, NULL, 'deterministic-v1', NULL, 100)
ON CONFLICT (provider) DO NOTHING;
