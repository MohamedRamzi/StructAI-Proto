import { describe, expect, it } from 'vitest';
import { searchUnderlyingsByVector } from './vector-db';

describe('searchUnderlyingsByVector', () => {
  it('returns a default top-N slice with a fixed score for an empty query', () => {
    const results = searchUnderlyingsByVector('', 3);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.score === 0.8)).toBe(true);
  });

  it('respects the limit parameter', () => {
    const results = searchUnderlyingsByVector('luxe', 2);
    expect(results).toHaveLength(2);
  });

  it('ranks results by descending cosine similarity score', () => {
    const results = searchUnderlyingsByVector('luxe haute volatilité coupon', 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('surfaces the distinctive energy/high-dividend underlying for an energy query', () => {
    const results = searchUnderlyingsByVector('énergie pétrole fort dividende', 3);
    expect(results[0].underlying.ticker).toBe('FP FP');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('surfaces a luxury underlying for a luxury/high-volatility query', () => {
    const results = searchUnderlyingsByVector('luxe haute volatilité qui price bien', 3);
    expect(['MC FP', 'KER FP', 'MONC IM']).toContain(results[0].underlying.ticker);
  });

  it('surfaces a defensive/low-volatility underlying for a defensive query', () => {
    const results = searchUnderlyingsByVector('profil défensif faible volatilité stable', 4);
    expect(['RMS FP', 'OR FP', 'SAN FP', 'SX5E Index']).toContain(results[0].underlying.ticker);
  });

  it('returns 0 similarity (not an artificially inflated floor) for a completely unrelated query', () => {
    const results = searchUnderlyingsByVector('xyzzy plugh unrelated gibberish query', 10);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it('always returns a non-empty matchedConcepts array', () => {
    const results = searchUnderlyingsByVector('luxe', 5);
    for (const r of results) {
      expect(r.matchedConcepts.length).toBeGreaterThan(0);
    }
  });
});
