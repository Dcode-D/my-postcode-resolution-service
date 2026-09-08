import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '../src/providers/model-provider.js';
import { ResolutionService, type ResolutionStore } from '../src/services/resolution-service.js';

const logs: Array<Parameters<ResolutionStore['writeResolutionLog']>[0]> = [];
const testUsage = {
  prompt_tokens: 100,
  cached_prompt_tokens: 10,
  output_tokens: 20,
  thinking_tokens: 5,
  tool_tokens: 30,
  total_tokens: 155,
  search_queries: 1,
};
const pricing = {
  GEMINI_INPUT_PRICE_PER_MILLION_USD: 1.5,
  GEMINI_CACHED_INPUT_PRICE_PER_MILLION_USD: 0.15,
  GEMINI_OUTPUT_PRICE_PER_MILLION_USD: 9,
  GEMINI_SEARCH_PRICE_PER_THOUSAND_USD: 14,
};
const provider: ModelProvider = {
  name: 'test',
  model: 'test-v1',
  resolve: async () => ({
    decision: {
      confidence_score: 0.92,
      data: {
        address_line1: '16 LEBUH TENGGIRI 2',
        district: 'SEBERANG PERAI TENGAH',
        city: 'SEBERANG JAYA',
        state: 'PULAU PINANG',
        postcode: '13700',
        central_postcode: '13700',
        country: 'MALAYSIA',
        country_code: 'MY',
        phone: '+60176710714',
      },
      reasons: ['Verified by search.'],
    },
    usage: testUsage,
  }),
};
const store: ResolutionStore = {
  findPostcode: async (postcode) =>
    postcode === '13700'
      ? {
          postcode: '13700',
          state: 'PULAU PINANG',
          city: 'SEBERANG JAYA',
          district: 'SEBERANG PERAI TENGAH',
        }
      : null,
  findPostcodeByRegion: async () => ({
    postcode: '42200',
    state: 'SELANGOR',
    city: 'KAPAR',
    district: 'KLANG',
  }),
  writeResolutionLog: async (input) => void logs.push(input),
};

describe('ResolutionService', () => {
  it('accepts a high-confidence model result and audits local verification', async () => {
    const service = new ResolutionService(store, provider, {
      SANITIZE_ENABLED: true,
      CONFIDENCE_THRESHOLD: 0.8,
      MODEL_PROMPT_TEMPLATE: undefined,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
      ...pricing,
    });
    const result = await service.resolve({
      resource_id: 'shipment-my-001',
      address: '16 No, 16 Lebuh Tenggiri 2 Seberang Jaya',
      phone: '0176710714',
      debug: true,
    });
    expect(result.status).toBe('SUCCESS');
    expect(result.confidence_score).toBe(0.92);
    expect(result.data?.postcode).toBe('13700');
    expect(result.data?.country_code).toBe('MY');
    expect(logs.at(-1)?.resourceId).toBe('shipment-my-001');
    expect(result).not.toHaveProperty('usage');
    expect(logs.at(-1)?.usage).toMatchObject({
      prompt_tokens: 100,
      search_queries: 1,
      estimated_list_cost_usd: 0.0143615,
      cost_is_estimate: true,
    });
    expect(result.debug_info?.detected_rules).toContain('MODEL_POSTCODE_REFERENCE_VALID:true');
    expect(logs).not.toHaveLength(0);
  });

  it('accepts a high-confidence international result without a local reference row', async () => {
    const internationalProvider: ModelProvider = {
      name: 'test',
      model: 'test-v1',
      resolve: async () => ({
        decision: {
          confidence_score: 0.91,
          data: {
            address_line1: '10 DOWNING STREET',
            district: 'WESTMINSTER',
            city: 'LONDON',
            state: 'ENGLAND',
            postcode: 'SW1A 2AA',
            central_postcode: 'SW1A 2AA',
            country: 'UNITED KINGDOM',
            country_code: 'GB',
            phone: '+442079250918',
          },
          reasons: ['Verified by search.'],
        },
        usage: testUsage,
      }),
    };
    const service = new ResolutionService(store, internationalProvider, {
      SANITIZE_ENABLED: true,
      CONFIDENCE_THRESHOLD: 0.8,
      MODEL_PROMPT_TEMPLATE: undefined,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
      ...pricing,
    });

    const result = await service.resolve({
      resource_id: 'shipment-gb-001',
      address: '10 Downing Street, London',
      phone: '+44 20 7925 0918',
      debug: true,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.country_code).toBe('GB');
    expect(result.data?.postcode).toBe('SW1A 2AA');
    expect(result.debug_info?.detected_rules).toContain('MODEL_POSTCODE_REFERENCE_VALID:false');
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
    const service = new ResolutionService(store, countingProvider, {
      SANITIZE_ENABLED: true,
      CONFIDENCE_THRESHOLD: 0.8,
      MODEL_PROMPT_TEMPLATE: undefined,
      MODEL_CACHE_TTL_SECONDS: 86400,
      MODEL_CACHE_MAX_ENTRIES: 1000,
      ...pricing,
    });
    const request = {
      resource_id: 'shipment-cache-001',
      address: '16 No, 16 Lebuh Tenggiri 2 Seberang Jaya',
      phone: '0176710714',
      debug: true,
    } as const;

    const first = await service.resolve(request);
    const second = await service.resolve({ ...request, resource_id: 'shipment-cache-002' });

    expect(calls).toBe(1);
    expect(logs.at(-1)?.resourceId).toBe('shipment-cache-002');
    expect(first.debug_info?.detected_rules).toContain('MODEL_CACHE_HIT:false');
    expect(second.debug_info?.detected_rules).toContain('MODEL_CACHE_HIT:true');
    expect(second).not.toHaveProperty('usage');
    expect(logs.at(-1)?.usage).toMatchObject({
      cache_hit: true,
      prompt_tokens: 0,
      total_tokens: 0,
      search_queries: 0,
      estimated_list_cost_usd: 0,
    });
  });
});
