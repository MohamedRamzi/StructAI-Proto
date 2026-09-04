import { describe, expect, it } from 'vitest';
import { detectMissingFields } from './validation.js';

describe('detectMissingFields', () => {
  it('flags maturityMonths as missing when null, undefined, or empty', () => {
    expect(detectMissingFields({ maturityMonths: null, underlyingQueryOrTicker: 'MC FP', targetToSolve: 'COUPON_RATE' }))
      .toContainEqual(expect.objectContaining({ field: 'maturityMonths' }));
    expect(detectMissingFields({ underlyingQueryOrTicker: 'MC FP', targetToSolve: 'COUPON_RATE' }))
      .toContainEqual(expect.objectContaining({ field: 'maturityMonths' }));
  });

  it('does not flag maturityMonths when a valid number (including 0) is present', () => {
    const flags = detectMissingFields({ maturityMonths: 36, underlyingQueryOrTicker: 'MC FP', targetToSolve: 'COUPON_RATE' });
    expect(flags.find((f) => f.field === 'maturityMonths')).toBeUndefined();
  });

  it('flags a missing underlying', () => {
    const flags = detectMissingFields({ maturityMonths: 36, underlyingQueryOrTicker: '', targetToSolve: 'COUPON_RATE' });
    expect(flags).toContainEqual(expect.objectContaining({ field: 'underlyingQueryOrTicker' }));
  });

  it('flags a missing target-to-solve variable', () => {
    const flags = detectMissingFields({ maturityMonths: 36, underlyingQueryOrTicker: 'MC FP' });
    expect(flags).toContainEqual(expect.objectContaining({ field: 'targetToSolve' }));
  });

  it('flags a missing PDI barrier for barrier-dependent products (e.g. Autocall)', () => {
    const flags = detectMissingFields({
      productTypeId: 'AUTOCALL_CLASSIC',
      maturityMonths: 36,
      underlyingQueryOrTicker: 'MC FP',
      targetToSolve: 'COUPON_RATE',
    });
    expect(flags).toContainEqual(expect.objectContaining({ field: 'pdiBarrierPct' }));
  });

  it('does not flag a missing PDI barrier for products that do not need one', () => {
    const flags = detectMissingFields({
      productTypeId: 'CAPITAL_PROTECTED_NOTE',
      maturityMonths: 36,
      underlyingQueryOrTicker: 'MC FP',
      targetToSolve: 'COUPON_RATE',
    });
    expect(flags.find((f) => f.field === 'pdiBarrierPct')).toBeUndefined();
  });

  it('returns no flags for a fully specified extraction', () => {
    const flags = detectMissingFields({
      productTypeId: 'AUTOCALL_CLASSIC',
      maturityMonths: 36,
      underlyingQueryOrTicker: 'MC FP',
      targetToSolve: 'COUPON_RATE',
      pdiBarrierPct: 70,
    });
    expect(flags).toHaveLength(0);
  });
});
