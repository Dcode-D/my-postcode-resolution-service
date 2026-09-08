import { describe, expect, it } from 'vitest';
import { resolvedAddressSchema, resolutionRequestSchema } from '../src/types.js';

describe('country-aware API schemas', () => {
  it('does not require the caller to know the country', () => {
    expect(
      resolutionRequestSchema.parse({
        resource_id: 'shipment-123',
        address: 'Sample address',
        phone: '123456',
      }),
    ).toEqual({
      resource_id: 'shipment-123',
      address: 'Sample address',
      phone: '123456',
      debug: false,
    });
  });

  it('requires a resource id for audit logging', () => {
    expect(() =>
      resolutionRequestSchema.parse({ address: 'Sample address', phone: '123456' }),
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

    expect(result.country_code).toBe('GB');
    expect(result.postcode).toBe('SW1A 2AA');
  });
});
