import { describe, expect, it } from 'vitest';
import { CachedModelProviderSelector } from '../src/providers/index.js';
import type { ProviderSelectorConfig } from '../src/providers/selection/provider-selector-helper.js';
import type { AiProviderSettings } from '../src/types.js';

const pricing = {
  inputPricePerMillionUsd: 1.5,
  cachedInputPricePerMillionUsd: 0.15,
  outputPricePerMillionUsd: 9,
  searchPricePerThousandUsd: 14,
};

const config: ProviderSelectorConfig = {
  NODE_ENV: 'test',
  MODELS_DEFAULT_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'test-gemini-api-key',
  GEMINI_MODEL: 'gemini-3.5-flash',
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: 'gpt-5-mini',
  OPENAI_BASE_URL: undefined,
  DEEPSEEK_API_KEY: undefined,
  DEEPSEEK_MODEL: 'deepseek-chat',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  PROVIDER_CONFIG_CACHE_TTL_SECONDS: 300,
};

describe('CachedModelProviderSelector', () => {
  it('loads model pricing together with the enabled provider setting', async () => {
    const settings: AiProviderSettings = {
      provider: 'gemini',
      enabled: true,
      apiKey: null,
      model: 'gemini-3.5-flash',
      baseUrl: null,
      priority: 10,
      pricing,
    };
    const selector = new CachedModelProviderSelector(
      { listProviderSettings: async () => [settings] },
      config,
    );

    const [selection] = await selector.getProviders();

    expect(selection?.provider.model).toBe(settings.model);
    expect(selection?.pricing).toEqual(pricing);
  });
});
