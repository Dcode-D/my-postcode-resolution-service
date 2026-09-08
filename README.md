# Malaysia Postcode Resolution Service

API Node.js/TypeScript nhận `address` và `phone`, chuẩn hoá địa chỉ (có thể tắt), phát hiện postcode/zone code, dùng model provider để đánh giá và trả postcode cùng confidence. Mọi lần gọi đều được audit vào PostgreSQL.

## Khởi chạy ngay bằng Docker

Mặc định dùng provider `mock` quyết định được (không cần Gemini key), thích hợp để kiểm tra toàn bộ flow.

```bash
docker compose up --build
```

Migration `001_initial.sql` và development seed tự chạy trước khi API mở cổng. Gọi thử:

Các port host được cấu hình trong `.env`: `API_HOST_PORT` (mặc định `3000`) và `POSTGRES_HOST_PORT` (mặc định `5432`). `PORT` là port bên trong API container. Ví dụ đặt `API_HOST_PORT=8080` thì gọi API tại `http://localhost:8080`. Nếu chạy API bằng `npm run dev` ngoài Docker và đổi port PostgreSQL, cập nhật `DATABASE_URL` tương ứng.

Docker dùng named volume `postgres_data`, vì vậy `docker compose up --build`, `docker compose restart` và `docker compose down` không làm mất dữ liệu. Chỉ `docker compose down -v` hoặc xoá volume `postgres_data` mới xoá database. Migration runner ghi nhận migration đã chạy trong `schema_migrations`, nên chỉ áp dụng file SQL migration mới.

```bash
curl -X POST http://localhost:3000/v1/postcode/resolve \
  -H 'content-type: application/json' \
  -d '{"address":"19, Jln 1F/KU11, Tmn Desa Baiduri, Off Jlan Iskandar","phone":"0176710714","debug":true}'
```

Kết quả development seed cho ví dụ trên là `42200`, `KAPAR`, `SELANGOR`, confidence `0.95`. `debug_info` chỉ xuất hiện khi gửi `debug: true`, để không trả chi tiết nội bộ mặc định.

## Dùng Gemini

Tạo `.env` từ `.env.example`, sau đó đặt:

```dotenv
MODELS_DEFAULT_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash
CONFIDENCE_THRESHOLD=0.80
SANITIZE_ENABLED=true
```

Chạy lại `docker compose up --build`. Gemini provider dùng Google Search grounding để tự xác định country và postal code từ address; phone country/area code được dùng như một clue với confidence thấp hơn, không phải bằng chứng street-level. Việc search có thể phát sinh chi phí Grounding của Gemini API. `MODEL_PROMPT_TEMPLATE` có thể override prompt tích hợp; các placeholder hỗ trợ là `{{address}}`, `{{phone}}`, `{{detected_rules}}`.

Provider dùng minimal thinking, giới hạn output và cache kết quả theo toàn bộ prompt (address + phone) trong memory. Mặc định cache giữ tối đa `1000` kết quả trong `86400` giây; chỉnh bằng `MODEL_CACHE_MAX_ENTRIES` và `MODEL_CACHE_TTL_SECONDS`, hoặc đặt TTL `0` để tắt. Các request trùng nhau đang chạy cũng được gộp thành một Gemini call.

## API contract

`POST /v1/postcode/resolve`

```json
{
  "address": "19, Jln 1F/KU11, Tmn Desa Baiduri",
  "phone": "0176710714",
  "debug": true
}
```

Client chỉ cần gửi address và phone. Model tự tìm country, ISO country code và postal code; postcode validator hỗ trợ cả format chữ-số như `SW1A 2AA`.

- `SUCCESS`: model tìm được postcode và confidence >= `CONFIDENCE_THRESHOLD`.
- `AMBIGUOUS`: model không verify được postcode hoặc confidence dưới ngưỡng; client phải review/fallback.
- `FAILED`: provider hoặc persistence thất bại; API trả HTTP 502.

Response có `confidence_score`, `data` (địa chỉ, postcode, country và country code) và, nếu được yêu cầu, `debug_info.detected_rules`. Usage/cost không được đưa ra public response. `central_postcode` hiện bằng postcode được chọn, là điểm extension cho logistics fallback.

Usage được lưu riêng trong audit log: provider/model, cache hit, model latency, prompt/cached/output/thinking/tool/total tokens, số Google Search queries và `estimated_list_cost_usd`. Cost là estimate theo list price cấu hình, không phải invoice thực tế; free quota, discount và service tier chưa được trừ. Default rate hiện dành cho `gemini-3.5-flash` Standard: input `$1.50/M`, cached input `$0.15/M`, output + thinking `$9/M`, Search `$14/1000`. Khi đổi model, tier hoặc Google đổi giá, cập nhật các biến `GEMINI_*_PRICE_*` trong `.env`.

### Audit logs

`GET /v1/resolution-logs` trả 100 bản ghi mới nhất theo mặc định. Usage/cost được lưu cả trong result JSON và các column riêng để query/report. Vì logs chứa PII, endpoint chỉ được bật khi có `LOGS_API_KEY` (ít nhất 16 ký tự) trong `.env`; gọi bằng header `x-api-key` tương ứng.

```bash
curl 'http://localhost:3000/v1/resolution-logs?limit=100&from=2026-09-01T00:00:00Z&to=2026-09-07T23:59:59Z' \
  -H 'x-api-key: your-strong-logs-key'
```

`from` và `to` là ISO-8601, đều optional; `limit` từ 1–1000. Kết quả luôn sort `createdAt` giảm dần.

## Cấu trúc và dữ liệu tham chiếu

- `src/lib/address.ts`: sanitizer trung lập ngôn ngữ và detector postcode dạng 5 chữ số.
- `src/providers/`: interface chung; `GeminiProvider` và `MockProvider` độc lập, có thể thêm OpenAI/Anthropic mà không đổi route.
- `malaysia_postcode_references`: bảng nguồn đối soát. Seed chỉ là data phát triển, **không phải** toàn bộ cơ sở dữ liệu Pos Malaysia.
- `resolution_logs`: audit log input, phiên bản provider/model, data kết quả, confidence, rule, error code.

Trước production cần import nguồn Pos Malaysia có quyền sử dụng vào bảng reference, thêm version/source/coverage check cho dataset, mã hoá hay tokenise phone/address theo chính sách PDPA và cấu hình retention cho `resolution_logs`.

Gemini dùng SDK hiện hành `@google/genai`. Nếu provider trả `FAILED`, xem `docker compose logs api --tail=100`; log chỉ gồm model và lỗi Gemini, không gồm API key, address hoặc phone.

## Local development

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```

Các kiểm tra: `npm run check`.

## Sprint 1 plan (2 tuần)

**Mục tiêu:** MVP nội bộ chạy Docker, trả postcode Malaysia có trace/audit, Gemini có thể bật qua cấu hình.

| Nhóm việc                    | Deliverable                                                              | Tiêu chí hoàn thành                                             |
| ---------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Foundation (Ngày 1–2)        | Repo, TypeScript strict, Docker Compose, health check, CI cơ bản         | `docker compose up --build` chạy migration và `/health` trả 200 |
| Address pipeline (Ngày 3–4)  | Sanitize toggle, từ điển Malay, regex postcode, zone `KU<n>`             | Unit test các trường hợp Jln/Tmn/Kg/KU và tắt sanitize          |
| Reference & audit (Ngày 5–6) | PostgreSQL schema, migration runner, postcode lookup, resolution log     | Mỗi request có một row log, postcode input được đối soát DB     |
| Model integration (Ngày 7–8) | `ModelProvider`, Gemini JSON mode, prompt/config/threshold               | Có thể đổi mock/Gemini qua env, schema model bị validate        |
| API & quality (Ngày 9–10)    | Contract 3 trạng thái, error handling, redacted request log, README/demo | Test green; happy path và ambiguous/failed có tài liệu          |

**Ngoài Sprint 1 / đề xuất Sprint 2:** ingest toàn bộ dữ liệu Post Malaysia được cấp phép, mapping nhiều zone/state, cache/rate limit/API auth, evaluation dataset + human review queue, PII retention/encryption, metrics/tracing và CI/CD deploy.
