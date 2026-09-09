import { describe, expect, it } from 'vitest';
import { buildExtractedProductSpec } from './spec-builder';
import { STOCK_DATABASE } from '../data/underlyings-db';

describe('buildExtractedProductSpec', () => {
  it('builds a full spec from a minimal parsed extraction, applying documented defaults', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall 3 ans sur LVMH',
      parsedJson: { productTypeId: 'AUTOCALL_CLASSIC', maturityMonths: 36, underlyingQueryOrTicker: 'MC FP' },
    });

    expect(spec.commonParams.maturityMonths).toBe(36);
    expect(spec.commonParams.forwardStartMonths).toBe(3); // default when unspecified
    expect(spec.commonParams.nonCallMonths).toBe(12); // default when unspecified
    expect(spec.commonParams.currency).toBe('EUR');
    expect(spec.specificParams).toMatchObject({ autocallBarrierPct: 100, pdiBarrierPct: 70, memoryCoupon: true });
    expect(spec.commonParams.underlyings[0].ticker).toBe('MC FP');
  });

  it('flags maturityMonths as missing and records it in assumedDefaults when absent', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall PDI 70% sur LVMH',
      parsedJson: { underlyingQueryOrTicker: 'MC FP' },
    });

    expect(spec.commonParams.maturityMonths).toBeNull();
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'maturityMonths' }));
    expect(spec.assumedDefaults[0]).toMatchObject({ param: 'Maturité', value: 'Non spécifiée (Unspecified)' });
  });

  it('does not duplicate the missing maturityMonths entry if the LLM already reported it', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall sur LVMH',
      parsedJson: {
        underlyingQueryOrTicker: 'MC FP',
        missingRequiredParams: [{ param: 'maturityMonths', label: 'Maturité', reason: 'Not specified' }],
      },
    });

    expect(spec.missingRequiredParams).toHaveLength(1);
  });

  it('prepends a "Moteur LLM" assumedDefault entry when an engineDescription is given', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'Autocall 3 ans sur LVMH',
      parsedJson: { maturityMonths: 36, underlyingQueryOrTicker: 'MC FP' },
      engineDescription: 'Ollama qwen3.6 (Local)',
    });

    expect(spec.assumedDefaults[0]).toMatchObject({ param: 'Moteur LLM', value: 'Ollama qwen3.6 (Local)' });
  });

  it('uses fallbackAiExplanation only when the parsed JSON has none', () => {
    const withExplanation = buildExtractedProductSpec({
      query: 'q',
      parsedJson: { aiExplanation: 'Explication du modèle' },
      fallbackAiExplanation: 'Explication par défaut',
    });
    expect(withExplanation.spec.aiExplanation).toBe('Explication du modèle');

    const withoutExplanation = buildExtractedProductSpec({
      query: 'q',
      parsedJson: {},
      fallbackAiExplanation: 'Explication par défaut',
    });
    expect(withoutExplanation.spec.aiExplanation).toBe('Explication par défaut');
  });

  it('restricts underlying resolution to a custom underlyingsDb when provided', () => {
    const restrictedDb = STOCK_DATABASE.filter((a) => a.ticker === 'TSLA US');
    const { spec, underlyingMatches } = buildExtractedProductSpec({
      query: 'Autocall sur LVMH 3 ans', // would normally resolve to MC FP
      parsedJson: { maturityMonths: 36, underlyingQueryOrTicker: 'MC FP' },
      underlyingsDb: restrictedDb,
    });

    expect(spec.commonParams.underlyings[0].ticker).toBe('TSLA US');
    expect(underlyingMatches.length).toBeGreaterThan(0);
  });

  it('uses vectorResolvedUnderlying directly, bypassing the local ticker matcher entirely', () => {
    const vectorPick = STOCK_DATABASE.find((a) => a.ticker === 'TSLA US')!;
    const { spec, underlyingMatches } = buildExtractedProductSpec({
      query: 'Autocall sur LVMH 3 ans', // the LLM/local matcher would normally resolve MC FP
      parsedJson: { maturityMonths: 36, underlyingQueryOrTicker: 'MC FP' },
      vectorResolvedUnderlying: vectorPick,
    });

    expect(spec.commonParams.underlyings[0].ticker).toBe('TSLA US');
    expect(underlyingMatches).toEqual([vectorPick]);
    expect(spec.underlyingSelectionNote).toMatch(/recherche vectorielle/i);
  });

  it('rounds down / rejects non-positive or non-numeric maturityMonths to null', () => {
    const { spec } = buildExtractedProductSpec({
      query: 'q',
      parsedJson: { maturityMonths: -5, underlyingQueryOrTicker: 'MC FP' },
    });
    expect(spec.commonParams.maturityMonths).toBeNull();
  });

  describe('forwardStartDate (absolute forward-start date)', () => {
    it('resolves forwardStartMonths from an ISO forwardStartDate, overriding any raw forwardStartMonths guess', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'Autocall LVMH première fixation le 01/12/2026',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartDate: '2026-12-01', forwardStartMonths: 99 },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });

      expect(spec.commonParams.forwardStartMonths).toBe(6);
      expect(spec.commonParams.forwardStartDate).toBe('2026-12-01');
    });

    it('normalizes a French DD/MM/YYYY forwardStartDate to ISO in the resolved spec', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'Autocall LVMH première fixation le 01/12/2026',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartDate: '01/12/2026' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });

      expect(spec.commonParams.forwardStartMonths).toBe(6);
      expect(spec.commonParams.forwardStartDate).toBe('2026-12-01');
    });

    it('falls back to the relative forwardStartMonths when no forwardStartDate is given', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'Autocall LVMH fwd 4m',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartMonths: 4 },
      });

      expect(spec.commonParams.forwardStartMonths).toBe(4);
      expect(spec.commonParams.forwardStartDate).toBeNull();
    });

    it('ignores an unparseable forwardStartDate and falls back to the default forwardStartMonths', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartDate: 'pas une date' },
      });

      expect(spec.commonParams.forwardStartMonths).toBe(3); // documented default
      expect(spec.commonParams.forwardStartDate).toBeNull();
    });

    it('clamps forwardStartMonths to 0 when the absolute date is in the past relative to referenceDate', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartDate: '2026-01-01' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });

      expect(spec.commonParams.forwardStartMonths).toBe(0);
    });

    it('records a traceability entry in assumedDefaults when forwardStartDate is resolved', () => {
      const { spec } = buildExtractedProductSpec({
        query: 'q',
        parsedJson: { underlyingQueryOrTicker: 'MC FP', forwardStartDate: '2026-12-01' },
        referenceDate: new Date('2026-06-01T00:00:00.000Z'),
      });

      expect(spec.assumedDefaults).toContainEqual(
        expect.objectContaining({ param: 'Départ Forward (calculé depuis date absolue)' })
      );
    });
  });
});
