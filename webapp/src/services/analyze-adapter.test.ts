import { describe, expect, it } from 'vitest';
import { adaptAnalyzeResponse } from './analyze-adapter';
import { buildSpecFromAutocallV1 } from './spec-builder';
import { UnderlyingAsset } from '../types/structured-product';

const REF = new Date('2026-01-01T00:00:00.000Z');

const U = (over: Partial<UnderlyingAsset> = {}): UnderlyingAsset => ({
  ticker: 'MC FP', name: 'LVMH', sector: 'Luxe', region: 'Europe',
  spotPrice: 685, currency: 'EUR', impliedVol3m: 0.28, dividendYield: 0.02,
  repoRate: 0.001, volatilityScore: 'MEDIUM', ...over,
});

/** A fake instrument corpus for `resolveInstrument`: known names -> instrument JSON. */
const CORPUS: Record<string, any> = {
  'lvmh': { code: 'MC FP', name: 'LVMH', assetClass: 'EQUITY', tags: ['Luxe'], metadata: { spotPrice: 685, impliedVol3m: 0.28, dividendYield: 0.02, currency: 'EUR', sector: 'Luxe' } },
  'totalenergies': { code: 'FP FP', name: 'TotalEnergies SE', assetClass: 'EQUITY', tags: [], metadata: { spotPrice: 62, impliedVol3m: 0.24, dividendYield: 0.05, currency: 'EUR' } },
  'bnp paribas': { code: 'BNP FP', name: 'BNP Paribas', assetClass: 'EQUITY', tags: [], metadata: { spotPrice: 60, impliedVol3m: 0.30, dividendYield: 0.06, currency: 'EUR' } },
  'crédit agricole': { code: 'ACA FP', name: 'Crédit Agricole SA', assetClass: 'EQUITY', tags: ['Banque'], metadata: { spotPrice: 14, impliedVol3m: 0.26, dividendYield: 0.06, currency: 'EUR' } },
};
const corpusResolver = async (name: string) => CORPUS[name.trim().toLowerCase()] || null;
const nullResolver = async () => null;

function autocallV1Extraction(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: 'autocall/v1', productFamily: 'ATHENA', productName: 'Athena LVMH 3Y',
    currency: 'EUR', issuer: { creditRating: 'A' }, notional: { denomination: 1000 },
    dates: { strikeDate: '2026-01-15', finalValuationDate: '2029-01-15' },
    underlying: { basketType: 'SINGLE', components: [{ name: 'LVMH', identifiers: { bloomberg: 'MC FP Equity' } }] },
    observation: { frequency: 'ANNUAL', numberOfObservations: 3, noCallPeriods: 1 },
    autocall: { enabled: true, triggerType: 'CONSTANT', initialTrigger: 1.0, stepPerPeriod: null, triggerSchedule: null },
    coupon: { rate: 0.08, memory: false },
    finalRedemption: { protectionType: 'CONDITIONAL_PDI', knockIn: { barrier: 0.6, observationStyle: 'EUROPEAN_AT_MATURITY', airbagLevel: null } },
    confidenceScore: 0.9, aiExplanation: 'Athena.',
    ...overrides,
  };
}

describe('buildSpecFromAutocallV1 (pure — pre-resolved underlyings)', () => {
  it('maps a fully-specified Athena envelope to a priceable spec', () => {
    const { spec } = buildSpecFromAutocallV1({ query: 'Athena LVMH 3 ans', extraction: autocallV1Extraction(), underlyings: [U()], referenceDate: REF });
    expect(spec.productTypeId).toBe('AUTOCALL_CLASSIC');
    expect(spec.commonParams.underlyings[0].ticker).toBe('MC FP');
    expect(spec.commonParams.maturityMonths).toBe(36);
    expect(spec.commonParams.observationFrequency).toBe('ANNUALLY');
    expect(spec.commonParams.nonCallMonths).toBe(12);
    expect(spec.specificParams).toMatchObject({ autocallBarrierPct: 100, pdiBarrierPct: 60, pdiType: 'EUROPEAN', memoryCoupon: false });
    expect(spec.targetToSolve).toBe('COUPON_RATE');
  });

  it('derives maturity from the observation count when no final valuation date is given', () => {
    const ex = autocallV1Extraction({ dates: { strikeDate: null, finalValuationDate: null }, observation: { frequency: 'QUARTERLY', numberOfObservations: 8, noCallPeriods: 2 } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, underlyings: [U()], referenceDate: REF });
    expect(spec.commonParams.maturityMonths).toBe(24);
    expect(spec.commonParams.nonCallMonths).toBe(6);
  });

  it('flags maturity as missing when neither a final date nor an observation count is present', () => {
    const ex = autocallV1Extraction({ dates: {}, observation: { frequency: 'ANNUAL' } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, underlyings: [U()], referenceDate: REF });
    expect(spec.commonParams.maturityMonths).toBeNull();
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'maturityMonths' }));
  });

  it('resolves a future strike date to a forward start', () => {
    const ex = autocallV1Extraction({ dates: { strikeDate: '2026-04-01', finalValuationDate: '2029-04-01' } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, underlyings: [U()], referenceDate: REF });
    expect(spec.commonParams.forwardStartMonths).toBe(3);
    expect(spec.commonParams.forwardStartDate).toBe('2026-04-01');
  });

  it('picks targetToSolve = COUPON_RATE when coupon.rate is null', () => {
    const ex = autocallV1Extraction({ coupon: { rate: null, memory: true } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, underlyings: [U()], referenceDate: REF });
    expect(spec.targetToSolve).toBe('COUPON_RATE');
    expect((spec.specificParams as any).memoryCoupon).toBe(true);
  });

  it('maps PHOENIX -> PHOENIX_MEMORY and a worst-of basket from the resolved underlyings', () => {
    const ex = autocallV1Extraction({
      productFamily: 'PHOENIX',
      underlying: { basketType: 'WORST_OF', components: [{ name: 'TotalEnergies' }, { name: 'BNP Paribas' }] },
      coupon: { rate: 0.08, memory: true, barrier: 0.6 },
    });
    const { spec } = buildSpecFromAutocallV1({ query: 'Phoenix worst-of', extraction: ex, underlyings: [U({ ticker: 'FP FP' }), U({ ticker: 'BNP FP' })], referenceDate: REF });
    expect(spec.productTypeId).toBe('PHOENIX_MEMORY');
    expect(spec.commonParams.basketType).toBe('WORST_OF');
    expect(spec.commonParams.underlyings.length).toBe(2);
  });

  it('tolerates barriers already expressed as percents (70 instead of 0.70)', () => {
    const ex = autocallV1Extraction({ finalRedemption: { knockIn: { barrier: 65 } }, autocall: { initialTrigger: 100 } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, underlyings: [U()], referenceDate: REF });
    expect((spec.specificParams as any).pdiBarrierPct).toBe(65);
    expect((spec.specificParams as any).autocallBarrierPct).toBe(100);
  });

  it('merges externalMissingFields and an underlyingMissingField', () => {
    const { spec } = buildSpecFromAutocallV1({
      query: 'q', extraction: autocallV1Extraction(), underlyings: [U()], referenceDate: REF,
      externalMissingFields: [{ field: 'coupon.rate', label: 'Coupon', message: 'non spécifié' }],
      underlyingMissingField: { field: 'underlying', label: 'Sous-jacent', message: 'absent' },
    });
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'coupon.rate' }));
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'underlying' }));
  });
});

describe('adaptAnalyzeResponse', () => {
  const wrap = (quote: any, pipeline = 'routed') => ({ success: true, pipeline, modelUsed: 'test', quotes: [quote] });

  it('resolves the underlying against the corpus and prices an autocall/v1 quote', async () => {
    const data = wrap({
      quoteId: 1, label: 'Athena LVMH', schemaVersion: 'autocall/v1',
      routing: { assetClass: 'EQUITY', productFamily: 'autocall', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.98 },
      extraction: autocallV1Extraction(), missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Athena LVMH 3 ans', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.commonParams.underlyings[0].ticker).toBe('MC FP');
    expect(q.spec?.commonParams.underlyings[0].spotPrice).toBe(685); // from corpus metadata, not placeholder
    expect(q.routing?.promptKey).toBe('equity-autocall');
  });

  it('keeps an underlying not in the corpus with placeholder market data, flagged', async () => {
    const data = wrap({
      quoteId: 1, label: 'Athena Crédit Agricole', schemaVersion: 'autocall/v1', routing: { assetClass: 'EQUITY' },
      extraction: autocallV1Extraction({ underlying: { basketType: 'SINGLE', components: [{ name: 'Société Foobar' }] } }),
      missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Athéna Société Foobar', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.commonParams.underlyings[0].name).toBe('Société Foobar');
    expect(q.spec?.commonParams.underlyings[0].spotPrice).toBe(100); // placeholder
    expect(q.spec?.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'underlying' }));
    expect(q.spec?.underlyingSelectionNote).toMatch(/introuvable/i);
  });

  it('resolves each component of a worst-of basket against the corpus', async () => {
    const data = wrap({
      quoteId: 1, label: 'Phoenix worst-of', schemaVersion: 'autocall/v1', routing: { assetClass: 'EQUITY' },
      extraction: autocallV1Extraction({
        productFamily: 'PHOENIX',
        underlying: { basketType: 'WORST_OF', components: [{ name: 'TotalEnergies' }, { name: 'BNP Paribas' }] },
      }),
      missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Phoenix Total / BNP', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.spec?.commonParams.underlyings.map((u) => u.ticker)).toEqual(['FP FP', 'BNP FP']);
    expect(q.spec?.commonParams.basketType).toBe('WORST_OF');
  });

  it('prices a generic/v1 quote through the legacy builder', async () => {
    const data = wrap({
      quoteId: 1, label: 'Autocall', schemaVersion: 'generic/v1', routing: { assetClass: 'EQUITY', promptKey: 'equity' },
      extraction: { schemaVersion: 'generic/v1', productTypeId: 'AUTOCALL_CLASSIC', maturityMonths: 36, underlyingQueryOrTicker: 'LVMH', targetToSolve: 'COUPON_RATE' },
      missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Autocall LVMH 3 ans', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.commonParams.maturityMonths).toBe(36);
    expect(q.spec?.commonParams.underlyings[0].ticker).toBe('MC FP');
  });

  it('degrades a rates/v1 quote to parse-only', async () => {
    const data = wrap({
      quoteId: 1, label: 'Range Accrual', schemaVersion: 'rates/v1', routing: { assetClass: 'RATES' },
      extraction: { schemaVersion: 'rates/v1', product_type: 'RANGE_ACCRUAL', index: 'EURIBOR_3M' }, missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Range accrual Euribor 3M', analyzeData: data, referenceDate: REF, resolveInstrument: nullResolver });
    expect(q.pricingAvailable).toBe(false);
    expect(q.spec).toBeUndefined();
    expect(q.richExtraction).toMatchObject({ product_type: 'RANGE_ACCRUAL' });
  });

  it('surfaces an asset-class correction as an assumedDefault on the spec', async () => {
    const data = wrap({
      quoteId: 1, label: 'Athena Crédit Agricole', schemaVersion: 'autocall/v1',
      routing: { assetClass: 'EQUITY', productFamily: 'autocall', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.7, assetClassCorrectedFrom: 'CREDIT' },
      extraction: autocallV1Extraction({ underlying: { basketType: 'SINGLE', components: [{ name: 'Crédit Agricole' }] } }),
      missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Poche Athéna sur Crédit Agricole', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.spec?.assumedDefaults[0]).toMatchObject({ param: "Classe d'actif", value: 'CREDIT → EQUITY' });
    expect(q.spec?.commonParams.underlyings[0].ticker).toBe('ACA FP'); // Crédit Agricole IS in the corpus here
  });

  it('passes a routing-only (pipeline: route) quote through without a spec', async () => {
    const data = wrap({
      quoteId: 1, label: 'Athena Crédit Agricole',
      routing: { assetClass: 'EQUITY', assetClassCorrectedFrom: 'CREDIT', productFamily: 'autocall', productFamilyRaw: 'athena', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.6 },
    }, 'route');
    const [q] = await adaptAnalyzeResponse({ query: 'Poche Athéna sur Crédit Agricole', analyzeData: data, referenceDate: REF, resolveInstrument: corpusResolver });
    expect(q.pricingAvailable).toBe(false);
    expect(q.spec).toBeUndefined();
    expect(q.routing?.assetClassCorrectedFrom).toBe('CREDIT');
    expect(q.degradationReason).toMatch(/routage seul/i);
  });

  it('works with no resolver (offline) — every underlying is synthetic', async () => {
    const data = wrap({
      quoteId: 1, label: 'Athena', schemaVersion: 'autocall/v1', routing: { assetClass: 'EQUITY' },
      extraction: autocallV1Extraction(), missingFields: [],
    });
    const [q] = await adaptAnalyzeResponse({ query: 'Athena LVMH', analyzeData: data, referenceDate: REF });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.commonParams.underlyings[0].name).toBe('LVMH');
    expect(q.spec?.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'underlying' }));
  });
});
