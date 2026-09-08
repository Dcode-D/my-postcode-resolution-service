CREATE TABLE IF NOT EXISTS country_resolution_settings (
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

Use the minimum number of Google searches needed—normally one focused query—to identify the country and postal code from matching street and locality evidence. Treat the phone's country or landline area code as a useful clue, but never as proof of a street-level location.

Always return the most plausible result when one exists and use confidence_score to show uncertainty. A strong direct match should score highly; a result inferred from partial address or phone evidence should score lower. Use postcode and central_postcode "00000", country "UNKNOWN", and country_code "ZZ" only when no plausible result can be found.

Set central_postcode equal to postcode. Normalize the phone to E.164 when possible. Use empty strings for unknown location fields and give short, factual reasons.

Address: {{address}}
Phone: {{phone}}
Detected hints: {{detected_rules}}$prompt$,
    0.800
  )
ON CONFLICT (country_code) DO NOTHING;

ALTER TABLE resolution_logs
  ADD COLUMN IF NOT EXISTS request_country_code TEXT,
  ADD COLUMN IF NOT EXISTS settings_country_code TEXT,
  ADD COLUMN IF NOT EXISTS confidence_threshold NUMERIC(4, 3);

CREATE INDEX IF NOT EXISTS idx_resolution_logs_request_country_created_at
  ON resolution_logs (request_country_code, created_at DESC);
