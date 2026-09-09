import { randomUUID } from 'node:crypto';
import NodeCache from 'node-cache';
import type { AppConfig } from '../config.js';
import { DEFAULT_NOT_FOUND_POSTCODE } from '../constants/postcode.js';
import { preprocessAddress } from '../lib/address.js';
import { renderPrompt } from '../lib/prompt.js';
import type {
  ModelProvider,
  ModelProviderResult,
  ModelProviderSelector,
  ResolutionContext,
} from '../providers/index.js';
import type {
  CountryResolutionSettings,
  ModelDecision,
  ModelPricingSettings,
  ResolutionRequest,
  ResolutionResponse,
  ResolutionUsage,
} from '../types.js';
import { createResolutionCacheKey } from './helpers/resolution-cache-key.js';
import { buildResolutionUsage, emptyModelUsage } from './helpers/resolution-usage.js';
import {
  type ProviderChainDependencies,
  tryProvidersSequentially,
} from './helpers/provider-chain.js';

export interface ReloadConfigurationResult {
  reloadedAt: string;
  providers: Array<{ provider: string; model: string; source: string }>;
}

export interface ResolutionStore {
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
        config.MODEL_CACHE_TTL_SECONDS > 0 ? Math.min(config.MODEL_CACHE_TTL_SECONDS, 120) : 0,
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
    const request = this.database.getModelPricing(provider.name, provider.model).then((pricing) => {
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

  private async resolveWithCache(
    provider: ModelProvider,
    context: ResolutionContext,
    confidenceThreshold: number,
  ): Promise<{ result: ModelProviderResult; cacheHit: boolean }> {
    const key = createResolutionCacheKey(provider, context);
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
        result.decision.data.postcode !== DEFAULT_NOT_FOUND_POSTCODE &&
        result.decision.confidenceScore >= confidenceThreshold;
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

  async reloadConfiguration(): Promise<ReloadConfigurationResult> {
    this.configurationGeneration += 1;
    this.resolutionSettingsCache.flushAll();
    this.modelPricingCache.flushAll();
    this.inFlightSettings.clear();
    this.inFlightPricing.clear();
    const selections = await this.providerSelector.getProviders(true);
    return {
      reloadedAt: new Date().toISOString(),
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
    address.rules.push(`REQUEST_COUNTRY_CODE:${request.countryCode ?? 'NONE'}`);
    const requestStartedAt = Date.now();
    let responseUsage: ResolutionUsage = {
      provider: 'unavailable',
      model: 'unavailable',
      cacheHit: false,
      latencyMs: 0,
      ...emptyModelUsage(),
      estimatedListCostUsd: 0,
      costIsEstimate: true,
    };
    let resolutionSettings: CountryResolutionSettings | undefined;
    let activeProvider: ModelProvider | undefined;
    const getCommonLogProperties = () => ({
      id: requestId,
      resourceId: request.resourceId,
      requestCountryCode: request.countryCode,
      settingsCountryCode: resolutionSettings?.countryCode,
      confidenceThreshold: resolutionSettings?.confidenceThreshold,
      requestAddress: request.address,
      requestPhone: request.phone,
      sanitizedAddress: address.value,
      sanitizeEnabled: this.config.SANITIZE_ENABLED,
      provider: activeProvider?.name ?? 'unavailable',
      model: activeProvider?.model ?? 'unavailable',
    });

    try {
      resolutionSettings = await this.getResolutionSettings(request.countryCode ?? 'DEFAULT');
      const confidenceThreshold = resolutionSettings.confidenceThreshold;
      address.rules.push(`SETTINGS_COUNTRY_CODE:${resolutionSettings.countryCode}`);
      address.rules.push(`CONFIDENCE_THRESHOLD:${confidenceThreshold}`);
      const modelStartedAt = Date.now();
      const providerContext: ResolutionContext = {
        address,
        phone: request.phone,
        countryCode: request.countryCode,
        prompt: renderPrompt(
          resolutionSettings.promptTemplate,
          address,
          request.phone,
          request.countryCode,
        ),
      };
      const attemptedFingerprints = new Set<string>();
      const selections = await this.providerSelector.getProviders();
      const providerChainDependencies = {
        attemptedFingerprints,
        getPricing: (provider) => this.getModelPricing(provider),
        resolve: (provider) =>
          this.resolveWithCache(provider, providerContext, confidenceThreshold),
        injectRule: (rule) => address.rules.push(rule),
      } satisfies ProviderChainDependencies;
      const attempt = await tryProvidersSequentially({
        selections,
        dependencies: providerChainDependencies,
      });
      activeProvider = attempt.lastProvider;

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
      responseUsage = buildResolutionUsage(
        activeProvider,
        result.usage,
        cacheHit,
        Date.now() - modelStartedAt,
        pricingSettings,
      );
      address.rules.push(`MODEL_CACHE_HIT:${cacheHit}`);
      const hasResolvedPostcode = decision.data.postcode !== DEFAULT_NOT_FOUND_POSTCODE;
      const response: ResolutionResponse = {
        status:
          hasResolvedPostcode && decision.confidenceScore >= confidenceThreshold
            ? 'SUCCESS'
            : 'AMBIGUOUS',
        confidenceScore: decision.confidenceScore,
        data: decision.data,
        ...(request.debug
          ? {
              debugInfo: {
                detectedRules: [...address.rules, ...decision.reasons],
                provider: activeProvider.name,
                model: activeProvider.model,
              },
            }
          : {}),
      };
      await this.database.writeResolutionLog({
        ...getCommonLogProperties(),
        result: response,
        usage: responseUsage,
        rules: [...address.rules, ...decision.reasons],
      });
      return response;
    } catch (error) {
      if (responseUsage.latencyMs === 0) {
        responseUsage = { ...responseUsage, latencyMs: Date.now() - requestStartedAt };
      }
      const response: ResolutionResponse = {
        status: 'FAILED',
        confidenceScore: 0,
        data: null,
        ...(request.debug
          ? {
              debugInfo: {
                detectedRules: address.rules,
                provider: activeProvider?.name ?? 'unavailable',
                model: activeProvider?.model ?? 'unavailable',
              },
            }
          : {}),
      };
      await this.database.writeResolutionLog({
        ...getCommonLogProperties(),
        result: response,
        usage: responseUsage,
        rules: address.rules,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      return response;
    }
  }
}
