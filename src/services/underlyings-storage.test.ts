import { describe, expect, it } from 'vitest';
import { findUnderlyingMultiStrategy } from './underlyings-storage';
import { STOCK_DATABASE } from '../data/underlyings-db';

describe('findUnderlyingMultiStrategy', () => {
  it('resolves a company name alias to its Bloomberg ticker (Strategy 0: alias map)', () => {
    const result = findUnderlyingMultiStrategy('TotalEnergies');
    expect(result.autoSelected?.ticker).toBe('FP FP');
    expect(result.matches).toHaveLength(1);
  });

  it('resolves a direct Bloomberg ticker (Strategy 1)', () => {
    const result = findUnderlyingMultiStrategy('MC FP');
    expect(result.autoSelected?.ticker).toBe('MC FP');
  });

  it('resolves an ISIN code (Strategy 1)', () => {
    const lvmh = STOCK_DATABASE.find((a) => a.ticker === 'MC FP')!;
    const result = findUnderlyingMultiStrategy(lvmh.isin!);
    expect(result.autoSelected?.ticker).toBe('MC FP');
  });

  it('resolves a ticker embedded in a full natural language query', () => {
    const result = findUnderlyingMultiStrategy('Autocall 3 ans sur KER FP avec PDI 70%');
    expect(result.autoSelected?.ticker).toBe('KER FP');
  });

  it('falls back to theme/keyword scoring for vague qualitative queries (Strategy 3)', () => {
    const result = findUnderlyingMultiStrategy('un stock du secteur du luxe qui price bien');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.autoSelected?.sector.toLowerCase()).toContain('luxe');
  });

  it('returns the full database with the first entry selected for an empty query', () => {
    const result = findUnderlyingMultiStrategy('');
    expect(result.matches).toEqual(STOCK_DATABASE);
    expect(result.autoSelected).toBe(STOCK_DATABASE[0]);
  });

  it('restricts resolution to a custom database when provided', () => {
    const customDb = STOCK_DATABASE.filter((a) => a.ticker === 'TSLA US');
    const result = findUnderlyingMultiStrategy('MC FP', customDb);
    // MC FP is not in the restricted DB, so no direct match strategy applies;
    // it should still resolve within the provided (single-asset) database.
    expect(result.autoSelected?.ticker).toBe('TSLA US');
  });
});
