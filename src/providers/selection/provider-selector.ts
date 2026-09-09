import NodeCache from 'node-cache';
import type { AiProviderSettings } from '../../types.js';
import {
  createProviderSelection,
  getEnvironmentFallback,
  type ProviderSelectorConfig,
  type SelectedModelProvider,
  withEnvironmentApiKey,
} from './provider-selector-helper.js';
import { AI_PROVIDER_NAMES } from '../core/provider-names.js';

export type { ProviderConfigSource, SelectedModelProvider } from './provider-selector-helper.js';

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

const CACHE_KEY = 'active-provider-chain';

export class CachedModelProviderSelector implements ModelProviderSelector {
  private readonly cache: NodeCache;
  private inFlight?: Promise<SelectedModelProvider[]>;
  private generation = 0;

  constructor(
    private readonly database: ProviderSettingsStore,
    private readonly config: ProviderSelectorConfig,
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
        ? databaseSettings.map((value) => withEnvironmentApiKey(value, this.config))
        : [getEnvironmentFallback(this.config)];

    const providers = settings
      .filter(
        (value) =>
          !(this.config.NODE_ENV === 'production' && value.provider === AI_PROVIDER_NAMES.MOCK),
      )
      .map(createProviderSelection)
      .filter((value): value is SelectedModelProvider => value !== null);

    if (providers.length === 0) throw new NoProviderConfiguredError();
    return providers;
  }
}
