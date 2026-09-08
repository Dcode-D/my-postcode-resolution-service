# Postcode Resolution Service

A Node.js and TypeScript API that accepts an address and phone number, identifies the country, resolves the most likely postal code, and returns a confidence score. Gemini can use Google Search grounding to verify results. Every resolution is audited in PostgreSQL.

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
CONFIDENCE_THRESHOLD=0.80
SANITIZE_ENABLED=true
```

Rebuild the API after changing the environment:

```bash
docker compose up -d --build
```

The Gemini provider uses Google Search grounding to infer the country and postal code from the address. A phone country code or landline area code may be used as a weak clue, but it is not treated as proof of a street-level location.

The provider uses minimal thinking, limits output size, and asks the model to use the minimum number of searches needed. Google Search grounding may incur Gemini API charges.

### Model-result cache

Successful high-confidence results are cached in memory using the complete rendered prompt, including the address and phone number. Simultaneous identical requests are combined into one model request.

```dotenv
MODEL_CACHE_TTL_SECONDS=86400
MODEL_CACHE_MAX_ENTRIES=1000
```

The default cache lifetime is 24 hours with a maximum of 1,000 entries. Set `MODEL_CACHE_TTL_SECONDS=0` to disable caching. The cache is cleared whenever the API process or container restarts.

### Custom prompt

Set `MODEL_PROMPT_TEMPLATE` to replace the built-in prompt. The supported placeholders are:

- `{{address}}`
- `{{phone}}`
- `{{detected_rules}}`

## API

### Resolve an address

`POST /v1/postcode/resolve`

```bash
curl -X POST http://localhost:3000/v1/postcode/resolve \
  -H 'content-type: application/json' \
  -d '{"resource_id":"shipment-123","address":"16 Lebuh Tenggiri 2, Seberang Jaya","phone":"0176710714","debug":true}'
```

Request body:

```json
{
  "resource_id": "shipment-123",
  "address": "16 Lebuh Tenggiri 2, Seberang Jaya",
  "phone": "0176710714",
  "debug": true
}
```

`resource_id` is a required caller-provided identifier of up to 128 characters. It is stored in `resolution_logs` for correlation only; it is not sent to Gemini and is not included in the resolution response.

The model determines the country, ISO alpha-2 country code, and postal code. Postal codes may contain letters, digits, spaces, and hyphens, so formats such as `SW1A 2AA` are supported.

Possible statuses:

- `SUCCESS`: a postal code was returned with confidence greater than or equal to `CONFIDENCE_THRESHOLD`.
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

The cost is an estimate based on configured list prices, not the final Gemini invoice. Free quotas, discounts, and service-tier pricing are not deducted. The defaults target `gemini-3.5-flash` Standard pricing:

```dotenv
GEMINI_INPUT_PRICE_PER_MILLION_USD=1.5
GEMINI_CACHED_INPUT_PRICE_PER_MILLION_USD=0.15
GEMINI_OUTPUT_PRICE_PER_MILLION_USD=9
GEMINI_SEARCH_PRICE_PER_THOUSAND_USD=14
```

Update these values whenever the model, service tier, or Gemini pricing changes.

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

- `src/app.ts`: Express routes, middleware, authentication, and error handling.
- `src/config.ts`: environment parsing and validation.
- `src/db/database.ts`: PostgreSQL queries and audit persistence.
- `src/lib/address.ts`: country-neutral address normalization and simple five-digit postcode detection.
- `src/lib/prompt.ts`: the default Gemini prompt and template rendering.
- `src/providers/`: the provider interface plus Gemini and deterministic mock implementations.
- `src/services/resolution-service.ts`: resolution orchestration, caching, confidence status, usage accounting, and audit logging.
- `migrations/`: ordered PostgreSQL schema migrations.
- `malaysia_postcode_references`: development reference table containing only a small seed dataset, not the complete Pos Malaysia database.
- `resolution_logs`: resolution audit records, provider usage, estimated cost, and error details.

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
