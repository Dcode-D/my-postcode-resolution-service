import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { toResolutionResponseInput } from '../mappers/resolution-response-mapper.js';
import { resolutionResponseSchema } from '../types.js';
import type {
  AiProviderName,
  AiProviderSettings,
  CountryResolutionSettings,
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

  async getResolutionSettings(countryCode: string): Promise<CountryResolutionSettings | null> {
    const result = await this.pool.query<{
      countryCode: string;
      promptTemplate: string;
      confidenceThreshold: string | number;
    }>(
      `SELECT country_code AS "countryCode",
              prompt_template AS "promptTemplate",
              confidence_threshold AS "confidenceThreshold"
       FROM country_resolution_settings
       WHERE country_code IN ($1, 'DEFAULT')
       ORDER BY (country_code = $1) DESC
       LIMIT 1`,
      [countryCode],
    );
    const row = result.rows[0];
    return row
      ? {
          countryCode: row.countryCode,
          promptTemplate: row.promptTemplate,
          confidenceThreshold: Number(row.confidenceThreshold),
        }
      : null;
  }

  async listProviderSettings(): Promise<AiProviderSettings[]> {
    const result = await this.pool.query<{
      provider: AiProviderName;
      enabled: boolean;
      apiKey: string | null;
      model: string;
      baseUrl: string | null;
      priority: number;
      inputPricePerMillionUsd: string | number;
      cachedInputPricePerMillionUsd: string | number;
      outputPricePerMillionUsd: string | number;
      searchPricePerThousandUsd: string | number;
    }>(
      `SELECT provider,
              enabled,
              api_key AS "apiKey",
              model,
              base_url AS "baseUrl",
              priority,
              input_price_per_million_usd AS "inputPricePerMillionUsd",
              cached_input_price_per_million_usd AS "cachedInputPricePerMillionUsd",
              output_price_per_million_usd AS "outputPricePerMillionUsd",
              search_price_per_thousand_usd AS "searchPricePerThousandUsd"
       FROM ai_provider_settings
       ORDER BY priority ASC, updated_at DESC, provider ASC`,
    );
    return result.rows.map(
      ({
        inputPricePerMillionUsd,
        cachedInputPricePerMillionUsd,
        outputPricePerMillionUsd,
        searchPricePerThousandUsd,
        ...settings
      }) => ({
        ...settings,
        pricing: {
          inputPricePerMillionUsd: Number(inputPricePerMillionUsd),
          cachedInputPricePerMillionUsd: Number(cachedInputPricePerMillionUsd),
          outputPricePerMillionUsd: Number(outputPricePerMillionUsd),
          searchPricePerThousandUsd: Number(searchPricePerThousandUsd),
        },
      }),
    );
  }

  async writeResolutionLog(input: {
    id: string;
    resourceId?: string;
    requestCountryCode?: string;
    settingsCountryCode?: string;
    confidenceThreshold?: number;
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
       (id, resource_id, request_country_code, settings_country_code, confidence_threshold,
        request_address, request_phone, sanitized_address, sanitize_enabled, provider, model,
        status, confidence_score, result, detected_rules, cache_hit, latency_ms, prompt_tokens,
        cached_prompt_tokens, output_tokens, thinking_tokens, tool_tokens, total_tokens,
        search_queries, estimated_list_cost_usd, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
               $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
      [
        input.id,
        input.resourceId ?? null,
        input.requestCountryCode ?? null,
        input.settingsCountryCode ?? null,
        input.confidenceThreshold ?? null,
        input.requestAddress,
        input.requestPhone,
        input.sanitizedAddress,
        input.sanitizeEnabled,
        input.provider,
        input.model,
        input.result.status,
        input.result.confidenceScore,
        JSON.stringify(toResolutionResponseInput(input.result)),
        JSON.stringify(input.rules),
        input.usage.cacheHit,
        input.usage.latencyMs,
        input.usage.promptTokens,
        input.usage.cachedPromptTokens,
        input.usage.outputTokens,
        input.usage.thinkingTokens,
        input.usage.toolTokens,
        input.usage.totalTokens,
        input.usage.searchQueries,
        input.usage.estimatedListCostUsd,
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
    const result = await this.pool.query<Omit<ResolutionLog, 'result'> & { result: unknown }>(
      `SELECT id,
              resource_id AS "resourceId",
              request_country_code AS "requestCountryCode",
              settings_country_code AS "settingsCountryCode",
              confidence_threshold AS "confidenceThreshold",
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
    return result.rows.map((row) => ({
      ...row,
      result: resolutionResponseSchema.parse(row.result),
    }));
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
