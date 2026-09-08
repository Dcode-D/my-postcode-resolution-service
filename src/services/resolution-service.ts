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
  ModelProviderSelector,
  SelectedModelProvider,
} from '../providers/provider-selector.js';
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

interface ProviderChainOutcome {
  provider: ModelProvider;
  pricingSettings: ModelPricingSettings;
  resolved: { result: ModelProviderResult; cacheHit: boolean };
}

interface ProviderChainAttempt {
  outcome?: ProviderChainOutcome;
  lastProvider?: ModelProvider;
  lastError?: unknown;
}

export interface ReloadConfigurationResult {
  reloaded_at: string;
  providers: Array<{ provider: string; model: string; source: string }>;
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
  private readonly decisionCache: NodeCache;
  private readonly inFlightDecisions: NodeCache;
  private readonly resolutionSettingsCache: NodeCache;
  private readonly inFlightSettings = new Map<string, Promise<CountryResolutionSettings>>();
  private readonly modelPricingCache: NodeCache;
  private readonly inFlightPricing = new Map<string, Promise<ModelPricingSettings>>();
  private configurationGeneration = 0;

  constructor(
    private readonly database: ResolutionStore,
    private readonly providerSelector: ModelProviderSelector,
    private readonly config: Pick<
      AppConfig,
      | 'SANITIZE_ENABLED'
      | 'RESOLUTION_SETTINGS_CACHE_TTL_SECONDS'
      | 'MODEL_PRICING_CACHE_TTL_SECONDS'
      | 'MODEL_CACHE_TTL_SECONDS'
      | 'MODEL_CACHE_MAX_ENTRIES'
    >,
  ) {
    this.decisionCache = new NodeCache({
      stdTTL: config.MODEL_CACHE_TTL_SECONDS,
      checkperiod:
        config.MODEL_CACHE_TTL_SECONDS > 0
          ? Math.min(config.MODEL_CACHE_TTL_SECONDS, 120)
          : 0,
      useClones: false,
    });
    this.inFlightDecisions = new NodeCache({
      stdTTL: 0,
      checkperiod: 0,
      useClones: false,
    });
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

    const requestGeneration = this.configurationGeneration;
    const request = this.database.getResolutionSettings(countryCode).then((settings) => {
      if (!settings) {
        throw new Error('No country resolution settings or DEFAULT fallback are configured');
      }
      if (requestGeneration === this.configurationGeneration) {
        this.resolutionSettingsCache.set(countryCode, settings);
      }
      return settings;
    });
    this.inFlightSettings.set(countryCode, request);
    try {
      return await request;
    } finally {
      if (this.inFlightSettings.get(countryCode) === request) {
        this.inFlightSettings.delete(countryCode);
      }
    }
  }

  private async getModelPricing(provider: ModelProvider): Promise<ModelPricingSettings> {
    const key = `${provider.name}\0${provider.model}`;
    const cached = this.modelPricingCache.get<ModelPricingSettings>(key);
    if (cached) return cached;

    const inFlight = this.inFlightPricing.get(key);
    if (inFlight) return inFlight;

    const requestGeneration = this.configurationGeneration;
    const request = this.database
      .getModelPricing(provider.name, provider.model)
      .then((pricing) => {
        if (!pricing) throw new Error('No model pricing settings are configured');
        if (requestGeneration === this.configurationGeneration) {
          this.modelPricingCache.set(key, pricing);
        }
        return pricing;
      });
    this.inFlightPricing.set(key, request);
    try {
      return await request;
    } finally {
      if (this.inFlightPricing.get(key) === request) {
        this.inFlightPricing.delete(key);
      }
    }
  }

  private buildUsage(
    provider: ModelProvider,
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
      provider: provider.name,
      model: provider.model,
      cache_hit: cacheHit,
      latency_ms: latencyMs,
      ...usage,
      estimated_list_cost_usd: Number(estimatedListCost.toFixed(8)),
      cost_is_estimate: true,
    };
  }

  private async resolveWithCache(
    provider: ModelProvider,
    context: ResolutionContext,
    confidenceThreshold: number,
  ): Promise<{ result: ModelProviderResult; cacheHit: boolean }> {
    const key = createHash('sha256')
      .update(provider.name)
      .update('\0')
      .update(provider.model)
      .update('\0')
      .update(context.countryCode ?? 'DEFAULT')
      .update('\0')
      .update(context.prompt)
      .digest('hex');
    const cached = this.decisionCache.get<ModelDecision>(key);
    if (cached) {
      return {
        result: { decision: cached, usage: emptyModelUsage() },
        cacheHit: true,
      };
    }

    const existingRequest = this.inFlightDecisions.get<Promise<ModelProviderResult>>(key);
    if (existingRequest) {
      const result = await existingRequest;
      return {
        result: { decision: result.decision, usage: emptyModelUsage() },
        cacheHit: true,
      };
    }

    const request = provider.resolve(context);
    this.inFlightDecisions.set(key, request);
    try {
      const result = await request;
      const isReusable =
        result.decision.data.postcode !== '00000' &&
        result.decision.confidence_score >= confidenceThreshold;
      if (this.config.MODEL_CACHE_TTL_SECONDS > 0 && isReusable) {
        while (this.decisionCache.keys().length >= this.config.MODEL_CACHE_MAX_ENTRIES) {
          const oldestKey = this.decisionCache.keys()[0];
          if (!oldestKey) break;
          this.decisionCache.del(oldestKey);
        }
        this.decisionCache.set(key, result.decision);
      }
      return { result, cacheHit: false };
    } finally {
      if (this.inFlightDecisions.get<Promise<ModelProviderResult>>(key) === request) {
        this.inFlightDecisions.del(key);
      }
    }
  }

  private async tryProviders(
    selections: SelectedModelProvider[],
    attemptedFingerprints: Set<string>,
    context: ResolutionContext,
    confidenceThreshold: number,
    rules: string[],
  ): Promise<ProviderChainAttempt> {
    let lastProvider: ModelProvider | undefined;
    let lastError: unknown;

    for (const selection of selections) {
      if (attemptedFingerprints.has(selection.fingerprint)) continue;
      attemptedFingerprints.add(selection.fingerprint);
      lastProvider = selection.provider;
      rules.push(`PROVIDER_ATTEMPT:${lastProvider.name}/${lastProvider.model}`);
      rules.push(`PROVIDER_CONFIG_SOURCE:${selection.source}`);

      try {
        const pricingSettings = await this.getModelPricing(lastProvider);
        rules.push(`PRICING_SETTINGS:${pricingSettings.provider}/${pricingSettings.model}`);
        const resolved = await this.resolveWithCache(
          lastProvider,
          context,
          confidenceThreshold,
        );
        rules.push(`PROVIDER_RESPONDED:${lastProvider.name}/${lastProvider.model}`);
        return {
          outcome: { provider: lastProvider, pricingSettings, resolved },
          lastProvider,
        };
      } catch (error) {
        lastError = error;
        rules.push(`PROVIDER_ATTEMPT_FAILED:${lastProvider.name}/${lastProvider.model}`);
      }
    }

    return { lastProvider, lastError };
  }

  async reloadConfiguration(): Promise<ReloadConfigurationResult> {
    this.configurationGeneration += 1;
    this.resolutionSettingsCache.flushAll();
    this.modelPricingCache.flushAll();
    this.inFlightSettings.clear();
    this.inFlightPricing.clear();
    const selections = await this.providerSelector.getProviders(true);
    return {
      reloaded_at: new Date().toISOString(),
      providers: selections.map(({ provider, source }) => ({
        provider: provider.name,
        model: provider.model,
        source,
      })),
    };
  }

  async resolve(request: ResolutionRequest): Promise<ResolutionResponse> {
    const requestId = randomUUID();
    const address = preprocessAddress(request.address, this.config.SANITIZE_ENABLED);
    address.rules.push(`REQUEST_COUNTRY_CODE:${request.country_code ?? 'NONE'}`);
    const requestStartedAt = Date.now();
    let responseUsage: ResolutionUsage = {
      provider: 'unavailable',
      model: 'unavailable',
      cache_hit: false,
      latency_ms: 0,
      ...emptyModelUsage(),
      estimated_list_cost_usd: 0,
      cost_is_estimate: true,
    };
    let resolutionSettings: CountryResolutionSettings | undefined;
    let activeProvider: ModelProvider | undefined;

    try {
      resolutionSettings = await this.getResolutionSettings(request.country_code ?? 'DEFAULT');
      address.rules.push(`SETTINGS_COUNTRY_CODE:${resolutionSettings.countryCode}`);
      address.rules.push(`CONFIDENCE_THRESHOLD:${resolutionSettings.confidenceThreshold}`);
      const modelStartedAt = Date.now();
      const providerContext: ResolutionContext = {
        address,
        phone: request.phone,
        countryCode: request.country_code,
        prompt: renderPrompt(
          resolutionSettings.promptTemplate,
          address,
          request.phone,
          request.country_code,
        ),
      };
      const attemptedFingerprints = new Set<string>();
      const selections = await this.providerSelector.getProviders();
      let attempt = await this.tryProviders(
        selections,
        attemptedFingerprints,
        providerContext,
        resolutionSettings.confidenceThreshold,
        address.rules,
      );
      activeProvider = attempt.lastProvider;

      if (!attempt.outcome) {
        let refreshedSelections: SelectedModelProvider[];
        try {
          refreshedSelections = await this.providerSelector.getProviders(true);
        } catch (reloadError) {
          throw attempt.lastError ?? reloadError;
        }
        const untriedSelections = refreshedSelections.filter(
          (selection) => !attemptedFingerprints.has(selection.fingerprint),
        );
        address.rules.push(
          `PROVIDER_CONFIG_RELOADED:${untriedSelections.length > 0 ? 'CHANGED' : 'UNCHANGED'}`,
        );
        if (untriedSelections.length > 0) {
          attempt = await this.tryProviders(
            untriedSelections,
            attemptedFingerprints,
            providerContext,
            resolutionSettings.confidenceThreshold,
            address.rules,
          );
          activeProvider = attempt.lastProvider;
        }
      }

      if (!attempt.outcome) {
        throw attempt.lastError ?? new Error('No configured AI provider returned a valid response');
      }

      const { provider: respondingProvider, pricingSettings, resolved } = attempt.outcome;
      activeProvider = respondingProvider;
      responseUsage = {
        ...responseUsage,
        provider: activeProvider.name,
        model: activeProvider.model,
      };
      const { result, cacheHit } = resolved;
      const { decision } = result;
      responseUsage = this.buildUsage(
        activeProvider,
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
                provider: activeProvider.name,
                model: activeProvider.model,
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
        provider: activeProvider.name,
        model: activeProvider.model,
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
                provider: activeProvider?.name ?? 'unavailable',
                model: activeProvider?.model ?? 'unavailable',
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
        provider: activeProvider?.name ?? 'unavailable',
        model: activeProvider?.model ?? 'unavailable',
        result: response,
        usage: responseUsage,
        rules: address.rules,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      return response;
    }
  }
}
