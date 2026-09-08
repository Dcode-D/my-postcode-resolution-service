import { describe, expect, it } from 'vitest';
import { normalizeMalaysiaPhone, preprocessAddress } from '../src/lib/address.js';

describe('preprocessAddress', () => {
  it('normalizes whitespace without assuming a country or language', () => {
    const result = preprocessAddress('19, Jln 1F/KU11, Tmn Desa Baiduri, Off Jlan Iskandar', true);
    expect(result.value).toBe('19, Jln 1F/KU11, Tmn Desa Baiduri, Off Jlan Iskandar');
    expect(result.needPostalCode).toBe(true);
  });

  it('preserves source text when sanitize is disabled but still extracts entities', () => {
    const result = preprocessAddress('Jln Test, 42200 Kapar', false);
    expect(result.value).toBe('Jln Test, 42200 Kapar');
    expect(result.detectedPostcode).toBe('42200');
  });

  it('normalizes Malaysian phone numbers', () => {
    expect(normalizeMalaysiaPhone('017-671 0714')).toBe('+60176710714');
  });

  it('preserves international address text and skips Malaysia-specific rules', () => {
    const result = preprocessAddress('12 Jln Café, Łódź', true);

    expect(result.value).toBe('12 Jln Café, Łódź');
    expect(result.detectedPostcode).toBeUndefined();
  });
});
