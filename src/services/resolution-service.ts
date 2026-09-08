import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { preprocessAddress } from '../lib/address.js';
import { DEFAULT_PROMPT, renderPrompt } from '../lib/prompt.js';
import type {
  ModelProvider,
  ModelProviderResult,
  ResolutionContext,
} from '../providers/model-provider.js';
import type {
  ModelDecision,
  ModelUsage,
  PostcodeReference,
  ResolutionRequest,
  ResolutionResponse,
  ResolutionUsage,
} from '../types.js';

interface CachedDecision {
  decision: ModelDecision;
  expiresAt: number;
}

function emptyModelUsage(): ModelUsage {
  return {
    prompt_tokens: 0,
    cached_prompt_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    tool_tokens: 0,
    total_tokens: 0,
    search_queries: 0,
  };
}

export interface ResolutionStore {
  findPostcode(postcode: string): Promise<PostcodeReference | null>;
  findPostcodeByRegion(state: string, city: string): Promise<PostcodeReference | null>;
  writeResolutionLog(input: {
    id: string;
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
  }): Promise<void>;
}

export class ResolutionService {
  private readonly decisionCache = new Map<string, CachedDecision>();
  private readonly inFlightDecisions = new Map<string, Promise<ModelProviderResult>>();

  constructor(
    private readonly database: ResolutionStore,
    private readonly provider: ModelProvider,
    private readonly config: Pick<
      AppConfig,
      | 'SANITIZE_ENABLED'
      | 'CONFIDENCE_THRESHOLD'
      | 'MODEL_PROMPT_TEMPLATE'
      | 'MODEL_CACHE_TTL_SECONDS'
      | 'MODEL_CACHE_MAX_ENTRIES'
      | 'GEMINI_INPUT_PRICE_PER_MILLION_USD'
      | 'GEMINI_CACHED_INPUT_PRICE_PER_MILLION_USD'
      | 'GEMINI_OUTPUT_PRICE_PER_MILLION_USD'
      | 'GEMINI_SEARCH_PRICE_PER_THOUSAND_USD'
    >,
  ) {}

  private buildUsage(usage: ModelUsage, cacheHit: boolean, latencyMs: number): ResolutionUsage {
    const uncachedPromptTokens = Math.max(0, usage.prompt_tokens - usage.cached_prompt_tokens);
    const estimatedListCost =
      (uncachedPromptTokens / 1_000_000) * this.config.GEMINI_INPUT_PRICE_PER_MILLION_USD +
      (usage.cached_prompt_tokens / 1_000_000) *
        this.config.GEMINI_CACHED_INPUT_PRICE_PER_MILLION_USD +
      ((usage.output_tokens + usage.thinking_tokens) / 1_000_000) *
        this.config.GEMINI_OUTPUT_PRICE_PER_MILLION_USD +
      (usage.search_queries / 1000) * this.config.GEMINI_SEARCH_PRICE_PER_THOUSAND_USD;
    return {
      provider: this.provider.name,
      model: this.provider.model,
      cache_hit: cacheHit,
      latency_ms: latencyMs,
      ...usage,
      estimated_list_cost_usd: Number(estimatedListCost.toFixed(8)),
      cost_is_estimate: true,
    };
  }

  private async resolveWithCache(
    context: ResolutionContext,
  ): Promise<{ result: ModelProviderResult; cacheHit: boolean }> {
    const key = createHash('sha256').update(context.prompt).digest('hex');
    const now = Date.now();
    const cached = this.decisionCache.get(key);
    if (cached && cached.expiresAt > now) {
      this.decisionCache.delete(key);
      this.decisionCache.set(key, cached);
      return {
        result: { decision: cached.decision, usage: emptyModelUsage() },
        cacheHit: true,
      };
    }
    if (cached) this.decisionCache.delete(key);

    const existingRequest = this.inFlightDecisions.get(key);
    if (existingRequest) {
      const result = await existingRequest;
      return {
        result: { decision: result.decision, usage: emptyModelUsage() },
        cacheHit: true,
      };
    }

    const request = this.provider.resolve(context);
    this.inFlightDecisions.set(key, request);
    try {
      const result = await request;
      const isReusable =
        result.decision.data.postcode !== '00000' &&
        result.decision.confidence_score >= this.config.CONFIDENCE_THRESHOLD;
      if (this.config.MODEL_CACHE_TTL_SECONDS > 0 && isReusable) {
        while (this.decisionCache.size >= this.config.MODEL_CACHE_MAX_ENTRIES) {
          const oldestKey = this.decisionCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          this.decisionCache.delete(oldestKey);
        }
        this.decisionCache.set(key, {
          decision: result.decision,
          expiresAt: now + this.config.MODEL_CACHE_TTL_SECONDS * 1000,
        });
      }
      return { result, cacheHit: false };
    } finally {
      this.inFlightDecisions.delete(key);
    }
  }

  async resolve(request: ResolutionRequest): Promise<ResolutionResponse> {
    const requestId = randomUUID();
    const address = preprocessAddress(request.address, this.config.SANITIZE_ENABLED);
    const modelStartedAt = Date.now();
    let responseUsage = this.buildUsage(emptyModelUsage(), false, 0);

    try {
      const promptTemplate = this.config.MODEL_PROMPT_TEMPLATE?.trim() || DEFAULT_PROMPT;
      const { result, cacheHit } = await this.resolveWithCache({
        address,
        phone: request.phone,
        prompt: renderPrompt(promptTemplate, address, request.phone),
      });
      const { decision } = result;
      responseUsage = this.buildUsage(result.usage, cacheHit, Date.now() - modelStartedAt);
      address.rules.push(`MODEL_CACHE_HIT:${cacheHit}`);
      const modelPostcodeReference =
        decision.data.country_code === 'MY' && /^\d{5}$/.test(decision.data.postcode)
          ? await this.database.findPostcode(decision.data.postcode)
          : null;
      const modelPostcodeVerified = Boolean(
        modelPostcodeReference &&
        modelPostcodeReference.state === decision.data.state &&
        modelPostcodeReference.city === decision.data.city,
      );
      address.rules.push(`MODEL_POSTCODE_REFERENCE_VALID:${modelPostcodeVerified}`);
      const hasResolvedPostcode = decision.data.postcode !== '00000';
      const response: ResolutionResponse = {
        status:
          hasResolvedPostcode && decision.confidence_score >= this.config.CONFIDENCE_THRESHOLD
            ? 'SUCCESS'
            : 'AMBIGUOUS',
        confidence_score: decision.confidence_score,
        data: decision.data,
        ...(request.debug
          ? {
              debug_info: {
                detected_rules: [...address.rules, ...decision.reasons],
                provider: this.provider.name,
                model: this.provider.model,
              },
            }
          : {}),
      };
      await this.database.writeResolutionLog({
        id: requestId,
        requestAddress: request.address,
        requestPhone: request.phone,
        sanitizedAddress: address.value,
        sanitizeEnabled: this.config.SANITIZE_ENABLED,
        provider: this.provider.name,
        model: this.provider.model,
        result: response,
        usage: responseUsage,
        rules: [...address.rules, ...decision.reasons],
      });
      return response;
    } catch (error) {
      if (responseUsage.latency_ms === 0) {
        responseUsage = this.buildUsage(emptyModelUsage(), false, Date.now() - modelStartedAt);
      }
      const response: ResolutionResponse = {
        status: 'FAILED',
        confidence_score: 0,
        data: null,
        ...(request.debug
          ? {
              debug_info: {
                detected_rules: address.rules,
                provider: this.provider.name,
                model: this.provider.model,
              },
            }
          : {}),
      };
      await this.database.writeResolutionLog({
        id: requestId,
        requestAddress: request.address,
        requestPhone: request.phone,
        sanitizedAddress: address.value,
        sanitizeEnabled: this.config.SANITIZE_ENABLED,
        provider: this.provider.name,
        model: this.provider.model,
        result: response,
        usage: responseUsage,
        rules: address.rules,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      return response;
    }
  }
}
