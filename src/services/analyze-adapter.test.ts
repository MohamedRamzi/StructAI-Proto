import { describe, expect, it } from 'vitest';
import { adaptAnalyzeResponse } from './analyze-adapter';
import { buildSpecFromAutocallV1 } from './spec-builder';

const REF = new Date('2026-01-01T00:00:00.000Z');

function autocallV1Extraction(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: 'autocall/v1',
    productFamily: 'ATHENA',
    productName: 'Athena LVMH 3Y',
    currency: 'EUR',
    issuer: { creditRating: 'A' },
    notional: { denomination: 1000 },
    dates: { strikeDate: '2026-01-15', finalValuationDate: '2029-01-15' },
    underlying: { basketType: 'SINGLE', components: [{ name: 'LVMH', identifiers: { bloomberg: 'MC FP Equity' } }] },
    observation: { frequency: 'ANNUAL', numberOfObservations: 3, noCallPeriods: 1 },
    autocall: { enabled: true, triggerType: 'CONSTANT', initialTrigger: 1.0, stepPerPeriod: null, triggerSchedule: null },
    coupon: { rate: 0.08, memory: false },
    finalRedemption: { protectionType: 'CONDITIONAL_PDI', knockIn: { barrier: 0.6, observationStyle: 'EUROPEAN_AT_MATURITY', airbagLevel: null } },
    confidenceScore: 0.9,
    aiExplanation: 'Athena.',
    ...overrides,
  };
}

describe('buildSpecFromAutocallV1', () => {
  it('maps a fully-specified Athena envelope to a priceable spec', () => {
    const { spec } = buildSpecFromAutocallV1({ query: 'Athena LVMH 3 ans', extraction: autocallV1Extraction(), referenceDate: REF });

    expect(spec.productTypeId).toBe('AUTOCALL_CLASSIC');
    expect(spec.productFamily).toBe('YIELD_ENHANCEMENT');
    expect(spec.commonParams.underlyings[0].ticker).toBe('MC FP');
    expect(spec.commonParams.maturityMonths).toBe(36);       // strike 2026-01-15 -> final 2029-01-15
    expect(spec.commonParams.observationFrequency).toBe('ANNUALLY');
    expect(spec.commonParams.nonCallMonths).toBe(12);        // 1 no-call period * 12 months
    expect(spec.commonParams.currency).toBe('EUR');
    expect(spec.specificParams).toMatchObject({ autocallBarrierPct: 100, pdiBarrierPct: 60, pdiType: 'EUROPEAN', memoryCoupon: false });
    // Everything specified (coupon, barrier, trigger) -> nothing to invent, default target.
    expect(spec.targetToSolve).toBe('COUPON_RATE');
  });

  it('derives maturity from the observation count when no final valuation date is given', () => {
    const ex = autocallV1Extraction({ dates: { strikeDate: null, finalValuationDate: null }, observation: { frequency: 'QUARTERLY', numberOfObservations: 8, noCallPeriods: 2 } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, referenceDate: REF });
    expect(spec.commonParams.maturityMonths).toBe(24); // 8 * 3 months
    expect(spec.commonParams.nonCallMonths).toBe(6);   // 2 * 3 months
    expect(spec.commonParams.observationFrequency).toBe('QUARTERLY');
  });

  it('flags maturity as missing when neither a final date nor an observation count is present', () => {
    const ex = autocallV1Extraction({ dates: {}, observation: { frequency: 'ANNUAL' } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, referenceDate: REF });
    expect(spec.commonParams.maturityMonths).toBeNull();
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'maturityMonths' }));
  });

  it('resolves a future strike date to a forward start', () => {
    const ex = autocallV1Extraction({ dates: { strikeDate: '2026-04-01', finalValuationDate: '2029-04-01' } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, referenceDate: REF });
    expect(spec.commonParams.forwardStartMonths).toBe(3);
    expect(spec.commonParams.forwardStartDate).toBe('2026-04-01');
  });

  it('picks targetToSolve = COUPON_RATE when coupon.rate is null (nothing invented)', () => {
    const ex = autocallV1Extraction({ coupon: { rate: null, memory: true } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, referenceDate: REF });
    expect(spec.targetToSolve).toBe('COUPON_RATE');
    expect((spec.specificParams as any).memoryCoupon).toBe(true);
  });

  it('maps PHOENIX -> PHOENIX_MEMORY and a worst-of basket', () => {
    const ex = autocallV1Extraction({
      productFamily: 'PHOENIX',
      underlying: { basketType: 'WORST_OF', components: [{ name: 'TotalEnergies' }, { name: 'BNP Paribas' }] },
      coupon: { rate: 0.08, memory: true, barrier: 0.6 },
    });
    const { spec } = buildSpecFromAutocallV1({ query: 'Phoenix worst-of Total / BNP', extraction: ex, referenceDate: REF });
    expect(spec.productTypeId).toBe('PHOENIX_MEMORY');
    expect(spec.commonParams.basketType).toBe('WORST_OF');
    expect(spec.commonParams.underlyings.length).toBe(2);
  });

  it('maps a Barrier Reverse Convertible family to REVERSE_CONVERTIBLE', () => {
    const ex = autocallV1Extraction({ productFamily: 'BARRIER_REVERSE_CONVERTIBLE', autocall: { enabled: false, initialTrigger: null } });
    const { spec } = buildSpecFromAutocallV1({ query: 'BRC', extraction: ex, referenceDate: REF });
    expect(spec.productTypeId).toBe('REVERSE_CONVERTIBLE');
  });

  it('tolerates barriers already expressed as percents (70 instead of 0.70)', () => {
    const ex = autocallV1Extraction({ finalRedemption: { knockIn: { barrier: 65 } }, autocall: { initialTrigger: 100 } });
    const { spec } = buildSpecFromAutocallV1({ query: 'q', extraction: ex, referenceDate: REF });
    expect((spec.specificParams as any).pdiBarrierPct).toBe(65);
    expect((spec.specificParams as any).autocallBarrierPct).toBe(100);
  });

  it('keeps an underlying that is not in the DB instead of substituting another company', () => {
    // "Crédit Agricole" is not in STOCK_DATABASE. The old code fell back to
    // matching the whole client query and theme-matched TotalEnergies.
    const ex = autocallV1Extraction({
      productName: 'Athena Crédit Agricole',
      underlying: { basketType: 'SINGLE', components: [{ name: 'Crédit Agricole' }] },
    });
    const { spec } = buildSpecFromAutocallV1({
      query: 'DUO MIX 60/40 — poche garantie, poche Athéna sur Crédit Agricole, rendement cible 6% par an, dividende fixe 1,10€',
      extraction: ex,
      referenceDate: REF,
    });

    expect(spec.commonParams.underlyings[0].name).toBe('Crédit Agricole');
    expect(spec.commonParams.underlyings[0].name).not.toBe('TotalEnergies SE');
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'underlying' }));
    expect(spec.underlyingSelectionNote).toMatch(/introuvable/i);
  });

  it('merges inference-service missing-field flags into missingRequiredParams', () => {
    const { spec } = buildSpecFromAutocallV1({
      query: 'q',
      extraction: autocallV1Extraction(),
      referenceDate: REF,
      externalMissingFields: [{ field: 'coupon.rate', label: 'Coupon', message: 'Niveau de coupon non spécifié.' }],
    });
    expect(spec.missingRequiredParams).toContainEqual(expect.objectContaining({ param: 'coupon.rate' }));
  });
});

describe('adaptAnalyzeResponse', () => {
  it('prices an autocall/v1 quote and keeps its routing metadata', async () => {
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [{
        quoteId: 1, label: 'Athena LVMH', schemaVersion: 'autocall/v1',
        routing: { assetClass: 'EQUITY', productFamily: 'autocall', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.98 },
        extraction: autocallV1Extraction(),
        missingFields: [],
      }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Athena LVMH 3 ans', analyzeData, referenceDate: REF });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec).toBeDefined();
    expect(q.pricing).toBeDefined();
    expect(q.routing?.promptKey).toBe('equity-autocall');
    expect(q.schemaVersion).toBe('autocall/v1');
  });

  it('prices a generic/v1 quote through the legacy builder', async () => {
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [{
        quoteId: 1, label: 'Autocall', schemaVersion: 'generic/v1',
        routing: { assetClass: 'EQUITY', productFamily: null, promptKey: 'equity', scopePrecision: 2, routerConfidence: 0.9 },
        extraction: { schemaVersion: 'generic/v1', productTypeId: 'AUTOCALL_CLASSIC', maturityMonths: 36, underlyingQueryOrTicker: 'MC FP', targetToSolve: 'COUPON_RATE' },
        missingFields: [],
      }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Autocall LVMH 3 ans', analyzeData, referenceDate: REF });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.commonParams.maturityMonths).toBe(36);
  });

  it('degrades a rates/v1 quote to parse-only (pricingAvailable: false, structure kept)', async () => {
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [{
        quoteId: 1, label: 'Range Accrual Euribor', schemaVersion: 'rates/v1',
        routing: { assetClass: 'RATES', productFamily: 'range_accrual', promptKey: 'rates', scopePrecision: 2, routerConfidence: 0.9 },
        extraction: { schemaVersion: 'rates/v1', product_type: 'RANGE_ACCRUAL', index: 'EURIBOR_3M', coupon: 0.03 },
        missingFields: [],
      }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Range accrual Euribor 3M', analyzeData, referenceDate: REF });
    expect(q.pricingAvailable).toBe(false);
    expect(q.spec).toBeUndefined();
    expect(q.pricing).toBeUndefined();
    expect(q.richExtraction).toMatchObject({ product_type: 'RANGE_ACCRUAL' });
    expect(q.degradationReason).toMatch(/taux/i);
  });

  it('handles a heterogeneous bundle: one priceable + one parse-only', async () => {
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [
        { quoteId: 1, label: 'Phoenix', schemaVersion: 'autocall/v1', routing: null, extraction: autocallV1Extraction({ productFamily: 'PHOENIX' }), missingFields: [] },
        { quoteId: 2, label: 'TARF', schemaVersion: 'fx/v1', routing: null, extraction: { schemaVersion: 'fx/v1', product_type: 'TARF' }, missingFields: [] },
      ],
    };
    const quotes = await adaptAnalyzeResponse({ query: 'Phoenix + TARF', analyzeData, referenceDate: REF });
    expect(quotes.map((q) => q.pricingAvailable)).toEqual([true, false]);
    expect(quotes[0].spec?.productTypeId).toBe('PHOENIX_MEMORY');
    expect(quotes[1].richExtraction?.product_type).toBe('TARF');
  });

  it('surfaces an asset-class correction as an assumedDefault on the spec', async () => {
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [{
        quoteId: 1, label: 'Athena Crédit Agricole', schemaVersion: 'autocall/v1',
        routing: { assetClass: 'EQUITY', productFamily: 'autocall', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.7, assetClassCorrectedFrom: 'CREDIT' },
        extraction: autocallV1Extraction({ productName: 'Athena Crédit Agricole', underlying: { basketType: 'SINGLE', components: [{ name: 'Crédit Agricole' }] } }),
        missingFields: [],
      }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Poche Athéna sur Crédit Agricole', analyzeData, referenceDate: REF });
    expect(q.pricingAvailable).toBe(true);
    expect(q.spec?.assumedDefaults[0]).toMatchObject({ param: "Classe d'actif", value: 'CREDIT → EQUITY' });
  });

  it('passes a routing-only (pipeline: route) quote through without a spec', async () => {
    const analyzeData = {
      success: true, pipeline: 'route', modelUsed: 'test',
      quotes: [{
        quoteId: 1, label: 'Athena Crédit Agricole',
        routing: { assetClass: 'EQUITY', assetClassCorrectedFrom: 'CREDIT', productFamily: 'autocall', productFamilyRaw: 'athena', promptKey: 'equity-autocall', scopePrecision: 3, routerConfidence: 0.6 },
      }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Poche Athéna sur Crédit Agricole', analyzeData, referenceDate: REF });
    expect(q.pricingAvailable).toBe(false);
    expect(q.spec).toBeUndefined();
    expect(q.routing?.assetClassCorrectedFrom).toBe('CREDIT');
    expect(q.degradationReason).toMatch(/routage seul/i);
  });

  it('uses the vector-resolved underlying when the callback returns one', async () => {
    const tsla = { ticker: 'TSLA US', name: 'Tesla', sector: 'Auto', region: 'US', spotPrice: 250, currency: 'USD', impliedVol3m: 0.5, dividendYield: 0, repoRate: 0, volatilityScore: 'HIGH' as const };
    const analyzeData = {
      success: true, pipeline: 'routed', modelUsed: 'test',
      quotes: [{ quoteId: 1, label: 'Athena', schemaVersion: 'autocall/v1', routing: null, extraction: autocallV1Extraction(), missingFields: [] }],
    };
    const [q] = await adaptAnalyzeResponse({ query: 'Athena LVMH', analyzeData, referenceDate: REF, resolveVectorUnderlying: async () => tsla });
    expect(q.spec?.commonParams.underlyings[0].ticker).toBe('TSLA US');
  });
});
