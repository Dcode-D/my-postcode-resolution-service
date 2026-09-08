import { describe, expect, it } from 'vitest';
import { resolutionLogQuerySchema } from '../src/types.js';

describe('resolution log query validation', () => {
  it('defaults to the 100 most recent records', () => {
    expect(resolutionLogQuerySchema.parse({})).toMatchObject({ limit: 100 });
  });

  it('accepts a bounded ISO-8601 time range', () => {
    const value = resolutionLogQuerySchema.parse({
      limit: '50',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-07T00:00:00Z',
    });
    expect(value.limit).toBe(50);
    expect(value.from?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rejects an inverted time range', () => {
    expect(() =>
      resolutionLogQuerySchema.parse({ from: '2026-09-08T00:00:00Z', to: '2026-09-07T00:00:00Z' }),
    ).toThrow('from must be before or equal to to');
  });
});
