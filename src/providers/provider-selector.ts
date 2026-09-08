import { createHash } from 'node:crypto';
import NodeCache from 'node-cache';
import type { AppConfig } from '../config.js';
import type { AiProviderName, AiProviderSettings } from '../types.js';
import { DeepSeekProvider } from './deepseek-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import type { ModelProvider } from './model-provider.js';
import { MockProvider } from './mock-provider.js';
import { OpenAIProvider } from './openai-provider.js';

export type ProviderConfigSource = 'database' | 'environment';

export interface SelectedModelProvider {
  provider: ModelProvider;
  fingerprint: string;
  source: ProviderConfigSource;
}

export interface ModelProviderSelector {
  getProviders(forceRefresh?: boolean): Promise<SelectedModelProvider[]>;
}

export interface ProviderSettingsStore {
  listEnabledProviderSettings(): Promise<AiProviderSettings[]>;
}

export class NoProviderConfiguredError extends Error {
  constructor() {
    super('No usable AI provider is configured');
    this.name = 'NoProviderConfiguredError';
  }
}

type SelectorConfig = Pick<
  AppConfig,
  | 'NODE_ENV'
  | 'MODELS_DEFAULT_PROVIDER'
  | 'GEMINI_API_KEY'
  | 'GEMINI_MODEL'
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL'
  | 'OPENAI_BASE_URL'
  | 'DEEPSEEK_API_KEY'
  | 'DEEPSEEK_MODEL'
  | 'DEEPSEEK_BASE_URL'
  | 'PROVIDER_CONFIG_CACHE_TTL_SECONDS'
>;

interface ResolvedProviderSettings extends AiProviderSettings {
  source: ProviderConfigSource;
}

const CACHE_KEY = 'active-provider-chain';

export class CachedModelProviderSelector implements ModelProviderSelector {
  private readonly cache: NodeCache;
  private inFlight?: Promise<SelectedModelProvider[]>;
  private generation = 0;

  constructor(
    private readonly database: ProviderSettingsStore,
    private readonly config: SelectorConfig,
  ) {
    this.cache = new NodeCache({
      stdTTL: config.PROVIDER_CONFIG_CACHE_TTL_SECONDS,
      checkperiod: Math.min(config.PROVIDER_CONFIG_CACHE_TTL_SECONDS, 120),
      useClones: false,
    });
  }

  async getProviders(forceRefresh = false): Promise<SelectedModelProvider[]> {
    if (forceRefresh) {
      this.generation += 1;
      this.cache.del(CACHE_KEY);
      this.inFlight = undefined;
    } else {
      const cached = this.cache.get<SelectedModelProvider[]>(CACHE_KEY);
      if (cached) return cached;
      if (this.inFlight) return this.inFlight;
    }

    const requestGeneration = this.generation;
    const request = this.loadProviders();
    this.inFlight = request;
    try {
      const providers = await request;
      if (requestGeneration === this.generation) this.cache.set(CACHE_KEY, providers);
      return providers;
    } finally {
      if (this.inFlight === request) this.inFlight = undefined;
    }
  }

  private async loadProviders(): Promise<SelectedModelProvider[]> {
    const databaseSettings = await this.database.listEnabledProviderSettings();
    const settings =
      databaseSettings.length > 0
        ? databaseSettings.map((value) => this.withEnvironmentKey(value, 'database'))
        : [this.environmentFallback()];

    const providers = settings
      .filter((value) => !(this.config.NODE_ENV === 'production' && value.provider === 'mock'))
      .map((value) => this.createSelection(value))
      .filter((value): value is SelectedModelProvider => value !== null);

    if (providers.length === 0) throw new NoProviderConfiguredError();
    return providers;
  }

  private withEnvironmentKey(
    settings: AiProviderSettings,
    source: ProviderConfigSource,
  ): ResolvedProviderSettings {
    return {
      ...settings,
      apiKey: settings.apiKey ?? this.environmentApiKey(settings.provider),
      source,
    };
  }

  private environmentFallback(): ResolvedProviderSettings {
    const provider = this.config.MODELS_DEFAULT_PROVIDER;
    switch (provider) {
      case 'gemini':
        return {
          provider,
          apiKey: this.config.GEMINI_API_KEY ?? null,
          model: this.config.GEMINI_MODEL,
          baseUrl: null,
          priority: 0,
          source: 'environment',
        };
      case 'openai':
        return {
          provider,
          apiKey: this.config.OPENAI_API_KEY ?? null,
          model: this.config.OPENAI_MODEL,
          baseUrl: this.config.OPENAI_BASE_URL ?? null,
          priority: 0,
          source: 'environment',
        };
      case 'deepseek':
        return {
          provider,
          apiKey: this.config.DEEPSEEK_API_KEY ?? null,
          model: this.config.DEEPSEEK_MODEL,
          baseUrl: this.config.DEEPSEEK_BASE_URL,
          priority: 0,
          source: 'environment',
        };
      case 'mock':
        return {
          provider,
          apiKey: null,
          model: 'deterministic-v1',
          baseUrl: null,
          priority: 0,
          source: 'environment',
        };
    }
  }

  private environmentApiKey(provider: AiProviderName): string | null {
    switch (provider) {
      case 'gemini':
        return this.config.GEMINI_API_KEY ?? null;
      case 'openai':
        return this.config.OPENAI_API_KEY ?? null;
      case 'deepseek':
        return this.config.DEEPSEEK_API_KEY ?? null;
      case 'mock':
        return null;
    }
  }

  private createSelection(settings: ResolvedProviderSettings): SelectedModelProvider | null {
    let provider: ModelProvider;
    switch (settings.provider) {
      case 'gemini':
        if (!settings.apiKey) return null;
        provider = new GeminiProvider(settings.apiKey, settings.model);
        break;
      case 'openai':
        if (!settings.apiKey) return null;
        provider = new OpenAIProvider(
          settings.apiKey,
          settings.model,
          settings.baseUrl ?? undefined,
        );
        break;
      case 'deepseek':
        if (!settings.apiKey) return null;
        provider = new DeepSeekProvider(
          settings.apiKey,
          settings.model,
          settings.baseUrl ?? undefined,
        );
        break;
      case 'mock':
        provider = new MockProvider();
        break;
    }

    return {
      provider,
      source: settings.source,
      fingerprint: createHash('sha256')
        .update(settings.provider)
        .update('\0')
        .update(settings.model)
        .update('\0')
        .update(settings.baseUrl ?? '')
        .update('\0')
        .update(settings.apiKey ?? '')
        .digest('hex'),
    };
  }
}
