import { describe, expect, it } from 'vitest';
import type { ModelProvider, ModelProviderSelector } from '../src/providers/index.js';
import { ResolutionService, type ResolutionStore } from '../src/services/resolution-service.js';

const logs: Array<Parameters<ResolutionStore['writeResolutionLog']>[0]> = [];
const testUsage = {
  promptTokens: 100,
  cachedPromptTokens: 10,
  outputTokens: 20,
  thinkingTokens: 5,
  toolTokens: 30,
  totalTokens: 155,
  searchQueries: 1,
};
const pricing = {
  provider: 'test',
  model: 'DEFAULT',
  inputPricePerMillionUsd: 1.5,
  cachedInputPricePerMillionUsd: 0.15,
  outputPricePerMillionUsd: 9,
  searchPricePerThousandUsd: 14,
};
const provider: ModelProvider = {
  name: 'test',
  model: 'test-v1',
  resolve: async () => ({
    decision: {
      confidenceScore: 0.92,
      data: {
        addressLine1: '16 LEBUH TENGGIRI 2',
        district: 'SEBERANG PERAI TENGAH',
        city: 'SEBERANG JAYA',
        state: 'PULAU PINANG',
        postcode: '13700',
        centralPostcode: '13700',
        country: 'MALAYSIA',
        countryCode: 'MY',
        phone: '+60176710714',
      },
      reasons: ['Verified by search.'],
    },
    usage: testUsage,
  }),
};
const selectProvider = (selectedProvider: ModelProvider): ModelProviderSelector => ({
  getProviders: async () => [
    {
      provider: selectedProvider,
      fingerprint: `${selectedProvider.name}/${selectedProvider.model}`,
      source: 'environment',
    },
  ],
});
const store: ResolutionStore = {
  getModelPricing: async () => pricing,
  getResolutionSettings: async (countryCode) => ({
    countryCode: countryCode === '60' ? '60' : 'DEFAULT',
    promptTemplate:
      'Country: {{country_code}} Address: {{address}} Phone: {{phone}} Hints: {{detected_rules}}',
    confidenceThreshold: 0.8,
  }),
  writeResolutionLog: async (input) => void logs.push(input),
};

describe('ResolutionService', () => {
  it('accepts a high-confidence model result', async () => {
    const service = new ResolutionService(store, selectProvider(provider), {
      SANITIZE_ENABLED: true,
      RESOLUTION_SETTINGS_CACHE_TTL_SECONDS: 300,
      MODEL_PRICING_CACHE_TTL_SECONDS: 3600,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
    });
    const result = await service.resolve({
      resourceId: 'shipment-my-001',
      countryCode: '60',
      address: '16 No, 16 Lebuh Tenggiri 2 Seberang Jaya',
      phone: '0176710714',
      debug: true,
    });
    expect(result.status).toBe('SUCCESS');
    expect(result.confidenceScore).toBe(0.92);
    expect(result.data?.postcode).toBe('13700');
    expect(result.data?.countryCode).toBe('MY');
    expect(logs.at(-1)?.resourceId).toBe('shipment-my-001');
    expect(result).not.toHaveProperty('usage');
    expect(logs.at(-1)?.usage).toMatchObject({
      promptTokens: 100,
      searchQueries: 1,
      estimatedListCostUsd: 0.0143615,
      costIsEstimate: true,
    });
    expect(logs).not.toHaveLength(0);
  });

  it('accepts a high-confidence international result', async () => {
    const internationalProvider: ModelProvider = {
      name: 'test',
      model: 'test-v1',
      resolve: async () => ({
        decision: {
          confidenceScore: 0.91,
          data: {
            addressLine1: '10 DOWNING STREET',
            district: 'WESTMINSTER',
            city: 'LONDON',
            state: 'ENGLAND',
            postcode: 'SW1A 2AA',
            centralPostcode: 'SW1A 2AA',
            country: 'UNITED KINGDOM',
            countryCode: 'GB',
            phone: '+442079250918',
          },
          reasons: ['Verified by search.'],
        },
        usage: testUsage,
      }),
    };
    const service = new ResolutionService(store, selectProvider(internationalProvider), {
      SANITIZE_ENABLED: true,
      RESOLUTION_SETTINGS_CACHE_TTL_SECONDS: 300,
      MODEL_PRICING_CACHE_TTL_SECONDS: 3600,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
    });

    const result = await service.resolve({
      resourceId: 'shipment-gb-001',
      countryCode: '44',
      address: '10 Downing Street, London',
      phone: '+44 20 7925 0918',
      debug: true,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.countryCode).toBe('GB');
    expect(result.data?.postcode).toBe('SW1A 2AA');
  });

  it('reuses an identical address and phone without another model call', async () => {
    let calls = 0;
    const countingProvider: ModelProvider = {
      ...provider,
      resolve: async (context) => {
        calls += 1;
        return provider.resolve(context);
      },
    };
    const service = new ResolutionService(store, selectProvider(countingProvider), {
      SANITIZE_ENABLED: true,
      RESOLUTION_SETTINGS_CACHE_TTL_SECONDS: 300,
      MODEL_PRICING_CACHE_TTL_SECONDS: 3600,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
    });
    const request = {
      resourceId: 'shipment-cache-001',
      countryCode: '60',
      address: '16 No, 16 Lebuh Tenggiri 2 Seberang Jaya',
      phone: '0176710714',
      debug: true,
    } as const;

    const first = await service.resolve(request);
    const second = await service.resolve({ ...request, resourceId: 'shipment-cache-002' });

    expect(calls).toBe(1);
    expect(logs.at(-1)?.resourceId).toBe('shipment-cache-002');
    expect(first.debugInfo?.detectedRules).toContain('MODEL_CACHE_HIT:false');
    expect(second.debugInfo?.detectedRules).toContain('MODEL_CACHE_HIT:true');
    expect(second).not.toHaveProperty('usage');
    expect(logs.at(-1)?.usage).toMatchObject({
      cacheHit: true,
      promptTokens: 0,
      totalTokens: 0,
      searchQueries: 0,
      estimatedListCostUsd: 0,
    });
  });

  it('falls through provider errors but stops on a valid low-confidence response', async () => {
    let secondCalls = 0;
    let thirdCalls = 0;
    const failingProvider: ModelProvider = {
      name: 'first',
      model: 'first-v1',
      resolve: async () => {
        throw new Error('provider unavailable');
      },
    };
    const ambiguousProvider: ModelProvider = {
      name: 'second',
      model: 'second-v1',
      resolve: async (context) => {
        secondCalls += 1;
        const result = await provider.resolve(context);
        return {
          ...result,
          decision: { ...result.decision, confidenceScore: 0.4 },
        };
      },
    };
    const unusedProvider: ModelProvider = {
      ...provider,
      name: 'third',
      model: 'third-v1',
      resolve: async (context) => {
        thirdCalls += 1;
        return provider.resolve(context);
      },
    };
    const selector: ModelProviderSelector = {
      getProviders: async () =>
        [failingProvider, ambiguousProvider, unusedProvider].map((selectedProvider) => ({
          provider: selectedProvider,
          fingerprint: `${selectedProvider.name}/${selectedProvider.model}`,
          source: 'database' as const,
        })),
    };
    const service = new ResolutionService(store, selector, {
      SANITIZE_ENABLED: true,
      RESOLUTION_SETTINGS_CACHE_TTL_SECONDS: 300,
      MODEL_PRICING_CACHE_TTL_SECONDS: 3600,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
    });

    const result = await service.resolve({
      countryCode: '60',
      address: '16 No, 16 Lebuh Tenggiri 2 Seberang Jaya',
      phone: '0176710714',
      debug: true,
    });

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.debugInfo?.provider).toBe('second');
    expect(secondCalls).toBe(1);
    expect(thirdCalls).toBe(0);
  });
});
