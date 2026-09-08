CREATE TABLE IF NOT EXISTS model_pricing_settings (
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  input_price_per_million_usd NUMERIC(18, 8) NOT NULL
    CHECK (input_price_per_million_usd >= 0),
  cached_input_price_per_million_usd NUMERIC(18, 8) NOT NULL
    CHECK (cached_input_price_per_million_usd >= 0),
  output_price_per_million_usd NUMERIC(18, 8) NOT NULL
    CHECK (output_price_per_million_usd >= 0),
  search_price_per_thousand_usd NUMERIC(18, 8) NOT NULL
    CHECK (search_price_per_thousand_usd >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);

INSERT INTO model_pricing_settings (
  provider,
  model,
  input_price_per_million_usd,
  cached_input_price_per_million_usd,
  output_price_per_million_usd,
  search_price_per_thousand_usd
)
VALUES
  ('DEFAULT', 'DEFAULT', 0, 0, 0, 0),
  ('gemini', 'DEFAULT', 1.5, 0.15, 9, 14)
ON CONFLICT (provider, model) DO NOTHING;
