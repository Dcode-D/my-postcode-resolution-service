# Postcode Resolution Service

A Node.js and TypeScript API that accepts an address, phone number, and optional international calling code, resolves the most likely postal code, and returns a confidence score. Gemini can use Google Search grounding to verify results. Every resolution is audited in PostgreSQL.

## Quick start with Docker

The default provider is `mock`, which requires no Gemini API key and is useful for checking the application flow.

```bash
docker compose up --build
```

The API is available at `http://localhost:3000` by default. Check its health with:

```bash
curl http://localhost:3000/health
```

The container automatically runs all unapplied SQL migrations and the development seed before starting the API. Applied migrations are tracked in `schema_migrations`.

Host ports are configured through `.env`:

- `API_HOST_PORT` defaults to `3000`.
- `POSTGRES_HOST_PORT` defaults to `5432`.
- `PORT` is the port used inside the API container.

For example, setting `API_HOST_PORT=8080` exposes the API at `http://localhost:8080` while it can continue listening on port `3000` inside the container.

PostgreSQL uses the named volume `postgres_data`. `docker compose restart`, `docker compose down`, and rebuilding the containers do not remove this data. Running `docker compose down -v` deletes the database volume.

## Using Gemini

Copy `.env.example` to `.env`, then configure:

```dotenv
MODELS_DEFAULT_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash
SANITIZE_ENABLED=true
RESOLUTION_SETTINGS_CACHE_TTL_SECONDS=300
```

Rebuild the API after changing the environment:

```bash
docker compose up -d --build
```

The caller may supply an international calling code, such as `84` for Vietnam, which selects the country-specific prompt and confidence threshold. The Gemini provider uses Google Search grounding to resolve the postal code. A phone country code or landline area code may be used as a weak clue, but it is not treated as proof of a street-level location.

The provider uses minimal thinking, limits output size, and asks the model to use the minimum number of searches needed. Google Search grounding may incur Gemini API charges.

### Model-result cache

Successful high-confidence results are cached in memory using the requested country and complete rendered prompt, including the address and phone number. Simultaneous identical requests are combined into one model request.

```dotenv
MODEL_CACHE_TTL_SECONDS=86400
MODEL_CACHE_MAX_ENTRIES=1000
```

The default cache lifetime is 24 hours with a maximum of 1,000 entries. Set `MODEL_CACHE_TTL_SECONDS=0` to disable caching. The cache is cleared whenever the API process or container restarts.

### Country prompts and confidence thresholds

Prompts and minimum success thresholds are stored in `country_resolution_settings`. Migration `004_country_resolution_settings.sql` preserves the existing working prompt in the `DEFAULT` row. A request with a calling code first looks for that code and falls back to the unchanged default when no matching row exists. Requests without a calling code use `DEFAULT` directly.

The supported prompt placeholders are:

- `{{address}}`
- `{{phone}}`
- `{{country_code}}`
- `{{detected_rules}}`

For example, a country can reuse the default prompt with its own threshold:

```sql
INSERT INTO country_resolution_settings (country_code, prompt_template, confidence_threshold)
SELECT '84', prompt_template, 0.850
FROM country_resolution_settings
WHERE country_code = 'DEFAULT'
ON CONFLICT (country_code) DO UPDATE
SET prompt_template = EXCLUDED.prompt_template,
    confidence_threshold = EXCLUDED.confidence_threshold,
    updated_at = now();
```

You can update a prompt or threshold directly in PostgreSQL. Settings are cached in each API process for `RESOLUTION_SETTINGS_CACHE_TTL_SECONDS`, which defaults to 300 seconds, so changes take effect after at most five minutes. Restarting the API clears the cache. Keep the `DEFAULT` row so countries without an override can still be resolved.

## API

Interactive Swagger documentation is available while the service is running:

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

If `API_HOST_PORT` is changed, replace `3000` with that host port. Use Swagger UI's **Authorize** button to provide the `x-api-key` value required by the audit-log and statistics endpoints.

### Resolve an address

`POST /v1/postcode/resolve`

```bash
curl -X POST http://localhost:3000/v1/postcode/resolve \
  -H 'content-type: application/json' \
  -d '{"resource_id":"shipment-123","country_code":"60","address":"16 Lebuh Tenggiri 2, Seberang Jaya","phone":"0176710714","debug":true}'
```

Request body:

```json
{
  "resource_id": "shipment-123",
  "country_code": "60",
  "address": "16 Lebuh Tenggiri 2, Seberang Jaya",
  "phone": "0176710714",
  "debug": true
}
```

`resource_id` is an optional caller-provided identifier of up to 128 characters. When present, it is stored in `resolution_logs` for correlation only; it is not sent to Gemini and is not included in the resolution response.

The request `country_code` is an optional international calling code containing one to three digits without `+`, such as `84` for Vietnam or `60` for Malaysia. It selects the matching database settings. If it is omitted or has no matching row, the service uses `DEFAULT`.

The response `data.country_code` remains the model-determined ISO alpha-2 code, such as `VN` or `MY`. Postal codes may contain letters, digits, spaces, and hyphens, so formats such as `SW1A 2AA` are supported.

Possible statuses:

- `SUCCESS`: a postal code was returned with confidence greater than or equal to the selected database threshold.
- `AMBIGUOUS`: no postal code could be resolved, or confidence is below the threshold.
- `FAILED`: the provider or persistence operation failed; the API returns HTTP 502.

Example response:

```json
{
  "status": "SUCCESS",
  "confidence_score": 0.91,
  "data": {
    "address_line1": "16 LEBUH TENGGIRI 2",
    "district": "SEBERANG PERAI TENGAH",
    "city": "SEBERANG JAYA",
    "state": "PULAU PINANG",
    "postcode": "13700",
    "central_postcode": "13700",
    "country": "MALAYSIA",
    "country_code": "MY",
    "phone": "+60176710714"
  },
  "debug_info": {
    "detected_rules": [],
    "provider": "gemini",
    "model": "gemini-3.5-flash"
  }
}
```

`debug_info` is included only when the request contains `"debug": true`. Usage and cost information is never included in this public response.

### Audit logs

`GET /v1/resolution-logs`

The endpoint returns the newest 100 records by default. Because resolution logs contain personally identifiable information, this endpoint is enabled only when `LOGS_API_KEY` is set to a value of at least 16 characters.

```bash
curl 'http://localhost:3000/v1/resolution-logs?limit=100&from=2026-09-01T00:00:00Z&to=2026-09-07T23:59:59Z' \
  -H 'x-api-key: your-strong-logs-key'
```

Query parameters:

- `from`: optional ISO-8601 start time.
- `to`: optional ISO-8601 end time.
- `limit`: between 1 and 1,000; defaults to 100.

Results are ordered by `createdAt` in descending order.

Usage information is stored only in the audit log. Dedicated database columns record:

- Cache hit and model latency.
- Prompt, cached-prompt, output, thinking, tool, and total tokens.
- Google Search query count.
- Estimated list cost in USD.
- Requested international calling code, selected settings row, and the confidence threshold used.

The cost is an estimate based on prices in `model_pricing_settings`, not the final Gemini invoice. Free quotas, discounts, and service-tier pricing are not deducted. Migration `006_model_pricing_settings.sql` stores the current Gemini defaults and a zero-cost global fallback.

```sql
UPDATE model_pricing_settings
SET input_price_per_million_usd = 1.5,
    cached_input_price_per_million_usd = 0.15,
    output_price_per_million_usd = 9,
    search_price_per_thousand_usd = 14,
    updated_at = now()
WHERE provider = 'gemini' AND model = 'DEFAULT';
```

Pricing lookup prefers an exact provider/model row, then the provider's `DEFAULT` model row, and finally `DEFAULT`/`DEFAULT`. Rows are cached in each API process for `MODEL_PRICING_CACHE_TTL_SECONDS`, which defaults to one hour. Update the row whenever the model, service tier, or pricing changes; the new values take effect after the cache expires or the API restarts.

### Resolution statistics

`GET /v1/resolution-stats`

This endpoint uses the same `x-api-key` authentication as the audit-log endpoint. It calculates rates from the newest 1,000 matching logs by default.

```bash
curl 'http://localhost:3000/v1/resolution-stats?limit=1000&from=2026-09-01T00:00:00Z&to=2026-09-08T23:59:59Z' \
  -H 'x-api-key: your-strong-logs-key'
```

Example response:

```json
{
  "data": {
    "total": 1000,
    "success": { "count": 800, "rate": 0.8 },
    "failure": { "count": 200, "rate": 0.2 },
    "breakdown": {
      "ambiguous": 150,
      "failed": 50
    }
  },
  "meta": {
    "limit": 1000,
    "from": null,
    "to": null,
    "first_log_at": "2026-09-01T00:00:00.000Z",
    "last_log_at": "2026-09-08T23:59:59.000Z"
  }
}
```

`SUCCESS` is counted as success. `AMBIGUOUS` and `FAILED` are both counted as failure and are also returned as separate breakdown values. Rates are numbers from `0` through `1`.

Query parameters:

- `from`: optional ISO-8601 start time.
- `to`: optional ISO-8601 end time.
- `limit`: between 1 and 100,000; defaults to 1,000.

The time filters are applied first, followed by descending date order and the sample limit.

## Project structure

- `src/app.ts`: Express application setup and route wiring.
- `src/config.ts`: environment parsing and validation.
- `src/db/database.ts`: PostgreSQL queries and audit persistence.
- `src/docs/openapi.ts`: OpenAPI specification used by Swagger UI.
- `src/handlers/`: one request handler per API endpoint.
- `src/lib/address.ts`: country-neutral address normalization and simple five-digit postcode detection.
- `src/lib/prompt.ts`: the default Gemini prompt and template rendering.
- `src/middleware/`: log endpoint authentication and centralized request error handling.
- `src/providers/`: the provider interface plus Gemini and deterministic mock implementations.
- `src/services/resolution-service.ts`: resolution orchestration, caching, confidence status, usage accounting, and audit logging.
- `migrations/`: ordered PostgreSQL schema migrations.
- `malaysia_postcode_references`: development reference table containing only a small seed dataset, not the complete Pos Malaysia database.
- `resolution_logs`: resolution audit records, provider usage, estimated cost, and error details.
- `country_resolution_settings`: per-country prompt templates and confidence thresholds, including the default fallback.
- `model_pricing_settings`: model token and search prices used for persisted cost estimates.

## Local development

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```

Run all checks with:

```bash
npm run check
```

## Production considerations

Before production use:

- Import properly licensed postal-reference data where local validation is required.
- Add rate limiting and authentication to the public resolution endpoint.
- Define retention, encryption, or tokenization policies for addresses and phone numbers under applicable privacy laws.
- Keep `LOGS_API_KEY` secret and restrict access to audit endpoints.
- Review model and Google Search pricing configuration regularly.
- Add metrics, tracing, evaluation datasets, a human-review workflow, and CI/CD deployment.

Gemini uses the current `@google/genai` SDK. If the provider returns `FAILED`, inspect the API logs:

```bash
docker compose logs api --tail=100
```

Provider errors do not intentionally log the Gemini API key, address, phone number, or rendered prompt.
