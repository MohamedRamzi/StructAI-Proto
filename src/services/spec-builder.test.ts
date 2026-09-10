import { describe, expect, it } from 'vitest';
import { buildExtractedProductSpec } from './spec-builder';
import { UnderlyingAsset } from '../types/structured-product';

const U = (over: Partial<UnderlyingAsset> = {}): UnderlyingAsset => ({
  ticker: 'MC FP',
  name: 'LVMH',
  sector: 'Luxe',
  region: 'Europe',
  spotPrice: 685,
  currency: 'EUR',
  impliedVol3m: 0.28,
  dividendYield: 0.02,
  repoRate: 0.001,
  volatilityScore: 'MEDIUM',
  ...over,
});

describe('buildExtractedProductSpec', () => {
  it('builds a full spec from a minimal parsed extraction, applying documented defaults', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall 3 ans sur LVMH',
      parsedJson: { productTypeId: 'AUTOCALL_CLASSIC', maturityMonths: 36 },
      underlyings: [U()],
    });

    expect(spec.commonParams.maturityMonths).toBe(36);
    expect(spec.commonParams.forwardStartMonths).toBe(3);
    expect(spec.commonParams.nonCallMonths).toBe(12);
    expect(spec.commonParams.currency).toBe('EUR');
    expect(spec.specificParams).toMatchObject({ autocallBarrierPct: 100, pdiBarrierPct: 70, memoryCoupon: true });
    expect(spec.commonParams.underlyings[0].ticker).toBe('MC FP');
  });

  it('flags maturityMonths as missing and records it in assumedDefaults when absent', () => {
    const { spec } = buildExtractedProductSpec({ query: 'Autocall PDI 70% sur LVMH', parsedJson: {}, underlyings: [U()] });
    expect(spec.commonParams.maturityMonths).toBeNull();
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'maturityMonths' }));
    expect(spec.assumedDefaults[0]).toMatchObject({ param: 'Maturité', value: 'Non spécifiée (Unspecified)' });
  });

  it('does not duplicate the missing maturityMonths entry if the LLM already reported it', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall sur LVMH',
      parsedJson: { missingRequiredParams: [{ param: 'maturityMonths', label: 'Maturité', reason: 'Not specified' }] },
      underlyings: [U()],
    });
    expect(spec.missingRequiredParams).toHaveLength(1);
  });

  it('prepends a "Moteur LLM" assumedDefault entry when an engineDescription is given', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall 3 ans sur LVMH',
      parsedJson: { maturityMonths: 36 },
      underlyings: [U()],
      engineDescription: 'Ollama qwen3.6 (Local)',
    });
    expect(spec.assumedDefaults[0]).toMatchObject({ param: 'Moteur LLM', value: 'Ollama qwen3.6 (Local)' });
  });

  it('uses fallbackAiExplanation only when the parsed JSON has none', () => {
    const withEx = buildExtractedProductSpec({ query: 'q', parsedJson: { aiExplanation: 'Explication du modèle' }, underlyings: [U()], fallbackAiExplanation: 'défaut' });
    expect(withEx.spec.aiExplanation).toBe('Explication du modèle');
    const withoutEx = buildExtractedProductSpec({ query: 'q', parsedJson: {}, underlyings: [U()], fallbackAiExplanation: 'défaut' });
    expect(withoutEx.spec.aiExplanation).toBe('défaut');
  });

  it('places the pre-resolved underlyings into the spec verbatim', () => {
    const tsla = U({ ticker: 'TSLA US', name: 'Tesla' });
    const { spec } = buildExtractedProductSpec({ query: 'Autocall sur Tesla 3 ans', parsedJson: { maturityMonths: 36 }, underlyings: [tsla] });
    expect(spec.commonParams.underlyings[0].ticker).toBe('TSLA US');
  });

  it('surfaces an underlyingNote / underlyingMissingField from the resolver', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall sur Crédit Agricole',
      parsedJson: { maturityMonths: 36 },
      underlyings: [U({ ticker: 'CRÉDIT AGRICOLE', name: 'Crédit Agricole' })],
      underlyingNote: '⚠️ « Crédit Agricole » introuvable dans la base d\'instruments.',
      underlyingMissingField: { field: 'underlying', label: 'Sous-jacent', message: 'absent de la base' },
    });
    expect(spec.underlyingSelectionNote).toMatch(/introuvable/i);
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'underlying' }));
  });

  it('rejects non-positive or non-numeric maturityMonths to null', () => {
    const { spec } = buildExtractedProductSpec({ query: 'q', parsedJson: { maturityMonths: -5 }, underlyings: [U()] });
    expect(spec.commonParams.maturityMonths).toBeNull();
  });

  describe('forwardStartDate (absolute forward-start date)', () => {
    it('resolves forwardStartMonths from an ISO forwardStartDate, overriding any raw forwardStartMonths guess', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q', underlyings: [U()],
        parsedJson: { forwardStartDate: '2026-12-01', forwardStartMonths: 99 },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });
      expect(spec.commonParams.forwardStartMonths).toBe(6);
      expect(spec.commonParams.forwardStartDate).toBe('2026-12-01');
    });

    it('normalizes a French DD/MM/YYYY forwardStartDate to ISO', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q', underlyings: [U()],
        parsedJson: { forwardStartDate: '01/12/2026' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });
      expect(spec.commonParams.forwardStartMonths).toBe(6);
      expect(spec.commonParams.forwardStartDate).toBe('2026-12-01');
    });

    it('falls back to the relative forwardStartMonths when no forwardStartDate is given', () => {
      const { spec } = buildExtractedProductSpec({ query: 'q', underlyings: [U()], parsedJson: { forwardStartMonths: 4 } });
      expect(spec.commonParams.forwardStartMonths).toBe(4);
      expect(spec.commonParams.forwardStartDate).toBeNull();
    });

    it('ignores an unparseable forwardStartDate and falls back to the default', () => {
      const { spec } = buildExtractedProductSpec({ query: 'q', underlyings: [U()], parsedJson: { forwardStartDate: 'pas une date' } });
      expect(spec.commonParams.forwardStartMonths).toBe(3);
      expect(spec.commonParams.forwardStartDate).toBeNull();
    });

    it('clamps forwardStartMonths to 0 when the absolute date is in the past', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q', underlyings: [U()],
        parsedJson: { forwardStartDate: '2026-01-01' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });
      expect(spec.commonParams.forwardStartMonths).toBe(0);
    });

    it('records a traceability entry in assumedDefaults when forwardStartDate is resolved', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q', underlyings: [U()],
        parsedJson: { forwardStartDate: '2026-12-01' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });
      expect(spec.assumedDefaults).toContainEqual(expect.objectContaining({ param: 'Départ Forward (calculé depuis date absolue)' }));
    });
  });
});
