import { describe, expect, it } from 'vitest';
import { resolutionLogQuerySchema, resolutionStatsQuerySchema } from '../src/types.js';

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

describe('resolutionStatsQuerySchema', () => {
  it('defaults to the latest 1000 logs', () => {
    expect(resolutionStatsQuerySchema.parse({})).toMatchObject({ limit: 1000 });
  });

  it('accepts a date range and custom sample limit', () => {
    const value = resolutionStatsQuerySchema.parse({
      limit: '5000',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-08T23:59:59Z',
    });
    expect(value.limit).toBe(5000);
    expect(value.from).toBeInstanceOf(Date);
    expect(value.to).toBeInstanceOf(Date);
  });

  it('rejects an inverted date range', () => {
    expect(() =>
      resolutionStatsQuerySchema.parse({
        from: '2026-09-08T00:00:00Z',
        to: '2026-09-07T00:00:00Z',
      }),
    ).toThrow();
  });
});
