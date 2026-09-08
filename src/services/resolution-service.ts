import { createHash, randomUUID } from 'node:crypto';
import NodeCache from 'node-cache';
import type { AppConfig } from '../config.js';
import { preprocessAddress } from '../lib/address.js';
import { renderPrompt } from '../lib/prompt.js';
import type {
  ModelProvider,
  ModelProviderResult,
  ResolutionContext,
} from '../providers/model-provider.js';
import type {
  CountryResolutionSettings,
  ModelDecision,
  ModelPricingSettings,
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
  getResolutionSettings(countryCode: string): Promise<CountryResolutionSettings | null>;
  getModelPricing(provider: string, model: string): Promise<ModelPricingSettings | null>;
  writeResolutionLog(input: {
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
  }): Promise<void>;
}

export class ResolutionService {
  private readonly decisionCache = new Map<string, CachedDecision>();
  private readonly inFlightDecisions = new Map<string, Promise<ModelProviderResult>>();
  private readonly resolutionSettingsCache: NodeCache;
  private readonly inFlightSettings = new Map<string, Promise<CountryResolutionSettings>>();
  private readonly modelPricingCache: NodeCache;
  private readonly inFlightPricing = new Map<string, Promise<ModelPricingSettings>>();

  constructor(
    private readonly database: ResolutionStore,
    private readonly provider: ModelProvider,
    private readonly config: Pick<
      AppConfig,
      | 'SANITIZE_ENABLED'
      | 'RESOLUTION_SETTINGS_CACHE_TTL_SECONDS'
      | 'MODEL_PRICING_CACHE_TTL_SECONDS'
      | 'MODEL_CACHE_TTL_SECONDS'
      | 'MODEL_CACHE_MAX_ENTRIES'
    >,
  ) {
    this.resolutionSettingsCache = new NodeCache({
      stdTTL: config.RESOLUTION_SETTINGS_CACHE_TTL_SECONDS,
      checkperiod: Math.min(config.RESOLUTION_SETTINGS_CACHE_TTL_SECONDS, 120),
      useClones: false,
    });
    this.modelPricingCache = new NodeCache({
      stdTTL: config.MODEL_PRICING_CACHE_TTL_SECONDS,
      checkperiod: Math.min(config.MODEL_PRICING_CACHE_TTL_SECONDS, 600),
      useClones: false,
    });
  }

  private async getResolutionSettings(countryCode: string): Promise<CountryResolutionSettings> {
    const cached = this.resolutionSettingsCache.get<CountryResolutionSettings>(countryCode);
    if (cached) return cached;

    const inFlight = this.inFlightSettings.get(countryCode);
    if (inFlight) return inFlight;

    const request = this.database.getResolutionSettings(countryCode).then((settings) => {
      if (!settings) {
        throw new Error('No country resolution settings or DEFAULT fallback are configured');
      }
      this.resolutionSettingsCache.set(countryCode, settings);
      return settings;
    });
    this.inFlightSettings.set(countryCode, request);
    try {
      return await request;
    } finally {
      this.inFlightSettings.delete(countryCode);
    }
  }

  private async getModelPricing(): Promise<ModelPricingSettings> {
    const key = `${this.provider.name}\0${this.provider.model}`;
    const cached = this.modelPricingCache.get<ModelPricingSettings>(key);
    if (cached) return cached;

    const inFlight = this.inFlightPricing.get(key);
    if (inFlight) return inFlight;

    const request = this.database
      .getModelPricing(this.provider.name, this.provider.model)
      .then((pricing) => {
        if (!pricing) throw new Error('No model pricing settings are configured');
        this.modelPricingCache.set(key, pricing);
        return pricing;
      });
    this.inFlightPricing.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlightPricing.delete(key);
    }
  }

  private buildUsage(
    usage: ModelUsage,
    cacheHit: boolean,
    latencyMs: number,
    pricing: ModelPricingSettings,
  ): ResolutionUsage {
    const uncachedPromptTokens = Math.max(0, usage.prompt_tokens - usage.cached_prompt_tokens);
    const estimatedListCost =
      (uncachedPromptTokens / 1_000_000) * pricing.inputPricePerMillionUsd +
      (usage.cached_prompt_tokens / 1_000_000) *
        pricing.cachedInputPricePerMillionUsd +
      ((usage.output_tokens + usage.thinking_tokens) / 1_000_000) *
        pricing.outputPricePerMillionUsd +
      (usage.search_queries / 1000) * pricing.searchPricePerThousandUsd;
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
    confidenceThreshold: number,
  ): Promise<{ result: ModelProviderResult; cacheHit: boolean }> {
    const key = createHash('sha256')
      .update(context.countryCode ?? 'DEFAULT')
      .update('\0')
      .update(context.prompt)
      .digest('hex');
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
        result.decision.confidence_score >= confidenceThreshold;
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
    address.rules.push(`REQUEST_COUNTRY_CODE:${request.country_code ?? 'NONE'}`);
    const requestStartedAt = Date.now();
    let responseUsage: ResolutionUsage = {
      provider: this.provider.name,
      model: this.provider.model,
      cache_hit: false,
      latency_ms: 0,
      ...emptyModelUsage(),
      estimated_list_cost_usd: 0,
      cost_is_estimate: true,
    };
    let resolutionSettings: CountryResolutionSettings | undefined;

    try {
      const [selectedResolutionSettings, pricingSettings] = await Promise.all([
        this.getResolutionSettings(request.country_code ?? 'DEFAULT'),
        this.getModelPricing(),
      ]);
      resolutionSettings = selectedResolutionSettings;
      address.rules.push(`SETTINGS_COUNTRY_CODE:${resolutionSettings.countryCode}`);
      address.rules.push(`CONFIDENCE_THRESHOLD:${resolutionSettings.confidenceThreshold}`);
      address.rules.push(`PRICING_SETTINGS:${pricingSettings.provider}/${pricingSettings.model}`);
      const modelStartedAt = Date.now();
      const { result, cacheHit } = await this.resolveWithCache(
        {
          address,
          phone: request.phone,
          countryCode: request.country_code,
          prompt: renderPrompt(
            resolutionSettings.promptTemplate,
            address,
            request.phone,
            request.country_code,
          ),
        },
        resolutionSettings.confidenceThreshold,
      );
      const { decision } = result;
      responseUsage = this.buildUsage(
        result.usage,
        cacheHit,
        Date.now() - modelStartedAt,
        pricingSettings,
      );
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
          hasResolvedPostcode &&
          decision.confidence_score >= resolutionSettings.confidenceThreshold
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
        resourceId: request.resource_id,
        requestCountryCode: request.country_code,
        settingsCountryCode: resolutionSettings.countryCode,
        confidenceThreshold: resolutionSettings.confidenceThreshold,
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
        responseUsage = { ...responseUsage, latency_ms: Date.now() - requestStartedAt };
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
        resourceId: request.resource_id,
        requestCountryCode: request.country_code,
        settingsCountryCode: resolutionSettings?.countryCode,
        confidenceThreshold: resolutionSettings?.confidenceThreshold,
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
