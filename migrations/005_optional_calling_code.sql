ALTER TABLE country_resolution_settings
  DROP CONSTRAINT IF EXISTS country_resolution_settings_country_code_check;

ALTER TABLE country_resolution_settings
  ADD CONSTRAINT country_resolution_settings_country_code_check
  CHECK (
    country_code = 'DEFAULT'
    OR country_code ~ '^[1-9][0-9]{0,2}$'
  );

ALTER TABLE resolution_logs
  ALTER COLUMN request_country_code TYPE TEXT
  USING trim(request_country_code);
