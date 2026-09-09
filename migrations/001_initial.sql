CREATE TABLE resolution_logs (
  id UUID PRIMARY KEY,
  resource_id TEXT,
  request_country_code TEXT,
  settings_country_code TEXT,
  confidence_threshold NUMERIC(4, 3)
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  request_address TEXT NOT NULL,
  request_phone TEXT NOT NULL,
  sanitized_address TEXT NOT NULL,
  sanitize_enabled BOOLEAN NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'AMBIGUOUS', 'FAILED')),
  confidence_score NUMERIC(4, 3) NOT NULL
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  result JSONB NOT NULL,
  detected_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  cached_prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_prompt_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  thinking_tokens INTEGER NOT NULL DEFAULT 0 CHECK (thinking_tokens >= 0),
  tool_tokens INTEGER NOT NULL DEFAULT 0 CHECK (tool_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  search_queries INTEGER NOT NULL DEFAULT 0 CHECK (search_queries >= 0),
  estimated_list_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0
    CHECK (estimated_list_cost_usd >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_resolution_logs_created_at
  ON resolution_logs (created_at DESC);
CREATE INDEX idx_resolution_logs_estimated_cost
  ON resolution_logs (estimated_list_cost_usd DESC);
CREATE INDEX idx_resolution_logs_resource_id_created_at
  ON resolution_logs (resource_id, created_at DESC);
CREATE INDEX idx_resolution_logs_request_country_created_at
  ON resolution_logs (request_country_code, created_at DESC);

CREATE TABLE country_resolution_settings (
  country_code TEXT PRIMARY KEY,
  prompt_template TEXT NOT NULL CHECK (length(trim(prompt_template)) > 0),
  confidence_threshold NUMERIC(4, 3) NOT NULL
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT country_resolution_settings_country_code_check
    CHECK (country_code = 'DEFAULT' OR country_code ~ '^[1-9][0-9]{0,2}$')
);

INSERT INTO country_resolution_settings (country_code, prompt_template, confidence_threshold)
VALUES
  (
    'DEFAULT',
    $prompt$Find the correct postal code and country for this address.

Use the minimum number of Google searches needed, normally one focused query, to identify the country and postal code from matching street and locality evidence. Treat the phone's country or landline area code as a useful clue, but never as proof of a street-level location.

Always return the most plausible result when one exists and use confidence_score to show uncertainty. A strong direct match should score highly; a result inferred from partial address or phone evidence should score lower. Use postcode and central_postcode "00000", country "UNKNOWN", and country_code "ZZ" only when no plausible result can be found.

Set central_postcode equal to postcode. Normalize the phone to E.164 when possible. Use empty strings for unknown location fields and give short, factual reasons.

Address: {{address}}
Phone: {{phone}}
Detected hints: {{detected_rules}}$prompt$,
    0.800
  ),
  (
    '60',
    $prompt$Find the correct Malaysian postal code for this address.

The requested international calling code is +60, which is a strong country-level clue for Malaysia, but validate it against the address and phone evidence. If the evidence clearly identifies another country, return that country instead of forcing a Malaysian result.

When web search is available, use the minimum number of searches needed, normally one focused query using the exact street and locality. Malaysian postcodes contain exactly five digits. Verify that the postcode matches the street, city or town, and state. A business name or phone number may be used as an additional search clue, but a phone number alone is not proof of a street-level location.

Always return the most plausible result when one exists and use confidence_score to express uncertainty. Give high confidence only when reliable evidence directly matches the street and locality. Use lower confidence for results inferred from partial address, locality, or phone evidence. Use postcode and central_postcode "00000", country "UNKNOWN", and country_code "ZZ" only when no plausible result can be found.

For a Malaysian result, return country "MALAYSIA" and country_code "MY". Set central_postcode equal to postcode. Normalize Malaysian phone numbers to E.164 with the +60 prefix when possible. Use empty strings for unknown location fields and provide short, factual reasons.

Address: {{address}}
Phone: {{phone}}
Requested calling code: {{country_code}}
Detected hints: {{detected_rules}}$prompt$,
    0.800
  );

CREATE TABLE ai_provider_settings (
  provider TEXT PRIMARY KEY
    CHECK (provider IN ('gemini', 'openai', 'deepseek', 'mock')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  api_key TEXT CHECK (api_key IS NULL OR length(trim(api_key)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  base_url TEXT,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  input_price_per_million_usd NUMERIC(18, 8) NOT NULL DEFAULT 0
    CHECK (input_price_per_million_usd >= 0),
  cached_input_price_per_million_usd NUMERIC(18, 8) NOT NULL DEFAULT 0
    CHECK (cached_input_price_per_million_usd >= 0),
  output_price_per_million_usd NUMERIC(18, 8) NOT NULL DEFAULT 0
    CHECK (output_price_per_million_usd >= 0),
  search_price_per_thousand_usd NUMERIC(18, 8) NOT NULL DEFAULT 0
    CHECK (search_price_per_thousand_usd >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ai_provider_settings (
  provider,
  enabled,
  api_key,
  model,
  base_url,
  priority,
  input_price_per_million_usd,
  cached_input_price_per_million_usd,
  output_price_per_million_usd,
  search_price_per_thousand_usd
)
VALUES
  ('gemini', false, NULL, 'gemini-3.5-flash', NULL, 10, 1.5, 0.15, 9, 14),
  ('openai', false, NULL, 'gpt-5-mini', NULL, 20, 0.25, 0.025, 2, 10),
  ('deepseek', false, NULL, 'deepseek-chat', 'https://api.deepseek.com', 30, 0.27, 0.07, 1.10, 0),
  ('mock', false, NULL, 'deterministic-v1', NULL, 100, 0, 0, 0, 0);
