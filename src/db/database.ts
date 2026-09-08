import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type {
  PostcodeReference,
  ResolutionLog,
  ResolutionLogQuery,
  ResolutionResponse,
  ResolutionStats,
  ResolutionStatsQuery,
  ResolutionUsage,
} from '../types.js';

export class Database {
  private readonly pool: Pool;

  constructor(config: Pick<AppConfig, 'DATABASE_URL'>) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
  }

  async healthcheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async findPostcode(postcode: string): Promise<PostcodeReference | null> {
    const result = await this.pool.query<PostcodeReference>(
      `SELECT postcode, state, city, district
       FROM malaysia_postcode_references WHERE postcode = $1 LIMIT 1`,
      [postcode],
    );
    return result.rows[0] ?? null;
  }

  async findPostcodeByRegion(state: string, city: string): Promise<PostcodeReference | null> {
    const result = await this.pool.query<PostcodeReference>(
      `SELECT postcode, state, city, district
       FROM malaysia_postcode_references
       WHERE upper(state) = upper($1) AND upper(city) = upper($2)
       ORDER BY postcode LIMIT 1`,
      [state, city],
    );
    return result.rows[0] ?? null;
  }

  async writeResolutionLog(input: {
    id: string;
    resourceId: string;
    requestAddress: string;
    requestPhone: string;
    sanitizedAddress: string;
    sanitizeEnabled: boolean;
    provider: string;
    model: string;
    result: ResolutionResponse;
    usage: ResolutionUsage;
    rules: string[];
    errorCode?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO resolution_logs
       (id, resource_id, request_address, request_phone, sanitized_address, sanitize_enabled, provider, model,
        status, confidence_score, result, detected_rules, cache_hit, latency_ms, prompt_tokens,
        cached_prompt_tokens, output_tokens, thinking_tokens, tool_tokens, total_tokens,
        search_queries, estimated_list_cost_usd, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        input.id,
        input.resourceId,
        input.requestAddress,
        input.requestPhone,
        input.sanitizedAddress,
        input.sanitizeEnabled,
        input.provider,
        input.model,
        input.result.status,
        input.result.confidence_score,
        JSON.stringify(input.result),
        JSON.stringify(input.rules),
        input.usage.cache_hit,
        input.usage.latency_ms,
        input.usage.prompt_tokens,
        input.usage.cached_prompt_tokens,
        input.usage.output_tokens,
        input.usage.thinking_tokens,
        input.usage.tool_tokens,
        input.usage.total_tokens,
        input.usage.search_queries,
        input.usage.estimated_list_cost_usd,
        input.errorCode ?? null,
      ],
    );
  }

  async listResolutionLogs(query: ResolutionLogQuery): Promise<ResolutionLog[]> {
    const values: Array<Date | number> = [];
    const conditions: string[] = [];
    if (query.from) {
      values.push(query.from);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (query.to) {
      values.push(query.to);
      conditions.push(`created_at <= $${values.length}`);
    }
    values.push(query.limit);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<ResolutionLog>(
      `SELECT id,
              resource_id AS "resourceId",
              request_address AS "requestAddress",
              request_phone AS "requestPhone",
              sanitized_address AS "sanitizedAddress",
              sanitize_enabled AS "sanitizeEnabled",
              provider,
              model,
              status,
              confidence_score AS "confidenceScore",
              result,
              detected_rules AS "detectedRules",
              cache_hit AS "cacheHit",
              latency_ms AS "latencyMs",
              prompt_tokens AS "promptTokens",
              cached_prompt_tokens AS "cachedPromptTokens",
              output_tokens AS "outputTokens",
              thinking_tokens AS "thinkingTokens",
              tool_tokens AS "toolTokens",
              total_tokens AS "totalTokens",
              search_queries AS "searchQueries",
              estimated_list_cost_usd AS "estimatedListCostUsd",
              error_code AS "errorCode",
              created_at AS "createdAt"
       FROM resolution_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  }

  async getResolutionStats(query: ResolutionStatsQuery): Promise<ResolutionStats> {
    const values: Array<Date | number> = [];
    const conditions: string[] = [];
    if (query.from) {
      values.push(query.from);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (query.to) {
      values.push(query.to);
      conditions.push(`created_at <= $${values.length}`);
    }
    values.push(query.limit);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<{
      total: string;
      successCount: string;
      ambiguousCount: string;
      failedCount: string;
      firstLogAt: Date | null;
      lastLogAt: Date | null;
    }>(
      `WITH selected_logs AS (
         SELECT status, created_at
         FROM resolution_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length}
       )
       SELECT count(*) AS total,
              count(*) FILTER (WHERE status = 'SUCCESS') AS "successCount",
              count(*) FILTER (WHERE status = 'AMBIGUOUS') AS "ambiguousCount",
              count(*) FILTER (WHERE status = 'FAILED') AS "failedCount",
              min(created_at) AS "firstLogAt",
              max(created_at) AS "lastLogAt"
       FROM selected_logs`,
      values,
    );
    const row = result.rows[0];
    const total = Number(row?.total ?? 0);
    const successCount = Number(row?.successCount ?? 0);
    const ambiguousCount = Number(row?.ambiguousCount ?? 0);
    const failedCount = Number(row?.failedCount ?? 0);
    const failureCount = ambiguousCount + failedCount;
    return {
      total,
      successCount,
      failureCount,
      ambiguousCount,
      failedCount,
      successRate: total ? successCount / total : 0,
      failureRate: total ? failureCount / total : 0,
      firstLogAt: row?.firstLogAt ?? null,
      lastLogAt: row?.lastLogAt ?? null,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
