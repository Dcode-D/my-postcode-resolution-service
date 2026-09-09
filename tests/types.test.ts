import { describe, expect, it } from 'vitest';
import { toResolutionResponseInput } from '../src/mappers/resolution-response-mapper.js';
import {
  modelDecisionSchema,
  resolvedAddressSchema,
  resolutionRequestSchema,
  resolutionResponseSchema,
} from '../src/types.js';

describe('country-aware API schemas', () => {
  it('accepts an optional international calling code', () => {
    expect(
      resolutionRequestSchema.parse({
        resource_id: 'shipment-123',
        country_code: '84',
        address: 'Sample address',
        phone: '123456',
      }),
    ).toEqual({
      resourceId: 'shipment-123',
      countryCode: '84',
      address: 'Sample address',
      phone: '123456',
      debug: false,
    });
  });

  it('allows resource id and country code to be omitted', () => {
    expect(resolutionRequestSchema.parse({ address: 'Sample address', phone: '123456' })).toEqual({
      address: 'Sample address',
      phone: '123456',
      debug: false,
    });
  });

  it('rejects a calling code that contains a plus sign', () => {
    expect(() =>
      resolutionRequestSchema.parse({
        country_code: '+84',
        address: 'Sample address',
        phone: '123456',
      }),
    ).toThrow();
  });

  it('accepts non-Malaysian postal-code formats', () => {
    const result = resolvedAddressSchema.parse({
      address_line1: '10 Downing Street',
      district: 'Westminster',
      city: 'London',
      state: 'England',
      postcode: 'SW1A 2AA',
      central_postcode: 'SW1A 2AA',
      country: 'UNITED KINGDOM',
      country_code: 'gb',
      phone: '+442079250918',
    });

    expect(result).toMatchObject({
      addressLine1: '10 Downing Street',
      centralPostcode: 'SW1A 2AA',
      countryCode: 'GB',
    });
    expect(result.postcode).toBe('SW1A 2AA');
  });

  it('maps model decisions and API responses to camelCase internally', () => {
    const data = {
      address_line1: '10 Downing Street',
      district: 'Westminster',
      city: 'London',
      state: 'England',
      postcode: 'SW1A 2AA',
      central_postcode: 'SW1A 2AA',
      country: 'United Kingdom',
      country_code: 'GB',
      phone: '+442079250918',
    };
    const decision = modelDecisionSchema.parse({
      confidence_score: 0.95,
      data,
      reasons: ['Verified'],
    });
    const response = resolutionResponseSchema.parse({
      status: 'SUCCESS',
      confidence_score: decision.confidenceScore,
      data,
      debug_info: { detected_rules: ['VERIFIED'], provider: 'test', model: 'test-v1' },
    });

    expect(decision.data.addressLine1).toBe('10 Downing Street');
    expect(response.debugInfo?.detectedRules).toEqual(['VERIFIED']);
    expect(toResolutionResponseInput(response)).toMatchObject({
      confidence_score: 0.95,
      data: { address_line1: '10 Downing Street', country_code: 'GB' },
      debug_info: { detected_rules: ['VERIFIED'] },
    });
  });
});
