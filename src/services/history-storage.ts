import { ExtractedProductSpec, PricingResult } from '../types/structured-product';

export interface AuditHistoryEntry {
  id: string;
  timestamp: string;
  rawQuery: string;
  productTypeName: string;
  underlyingTicker: string;
  underlyingName: string;
  solvedCouponPct: number;
  fairValuePct: number;
  autocallProbPct: number;
  pdiBreachProbPct: number;
  spec: ExtractedProductSpec;
  pricing: PricingResult;
  userOverridden?: boolean;
  provider?: string;
  modelName?: string;
}

const HISTORY_STORAGE_KEY = 'structai_historical_quotes_v1';

/**
 * Save a newly calculated quote spec & pricing to LocalStorage audit log
 */
export function saveQuoteToHistory(
  spec: ExtractedProductSpec,
  pricing: PricingResult,
  userOverridden = false,
  provider = 'gemini',
  modelName = 'gemini-3.6-flash'
): AuditHistoryEntry {
  const existing = getQuoteHistory();
  
  const underlying = spec.commonParams?.underlyings?.[0];
  const ticker = underlying?.ticker || 'MULTI';
  const name = underlying?.name || 'Sous-jacent';

  const solvedCoupon = pricing.solvedTarget?.solvedValueNumber || 0;
  const fairValue = pricing.theoreticalValuePct || 100;
  const autocallProb = (pricing.autocallProbabilityPct || 0) * 100;
  const pdiProb = (pricing.pdiBreachProbabilityPct || 0) * 100;

  const entry: AuditHistoryEntry = {
    id: `QUOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    rawQuery: spec.rawQuery || 'Demande personnalisée',
    productTypeName: spec.productTypeName || 'Produit Structuré',
    underlyingTicker: ticker,
    underlyingName: name,
    solvedCouponPct: solvedCoupon,
    fairValuePct: fairValue,
    autocallProbPct: autocallProb,
    pdiBreachProbPct: pdiProb,
    spec,
    pricing,
    userOverridden,
    provider,
    modelName,
  };

  const updated = [entry, ...existing].slice(0, 50); // Keep last 50 entries
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }

  return entry;
}

export const saveCalculationToHistory = saveQuoteToHistory;

/**
 * Get full history array from LocalStorage
 */
export function getQuoteHistory(): AuditHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return getSeedHistory();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return getSeedHistory();

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item: any) => ({
        id: item.id || `QUOTE-${Date.now()}`,
        timestamp: item.timestamp || new Date().toISOString(),
        rawQuery: item.rawQuery || item.queryText || 'Demande client',
        productTypeName: item.productTypeName || 'Produit Structuré',
        underlyingTicker: item.underlyingTicker || 'MULTI',
        underlyingName: item.underlyingName || 'Sous-jacent',
        solvedCouponPct: typeof item.solvedCouponPct === 'number' ? item.solvedCouponPct : 0,
        fairValuePct: typeof item.fairValuePct === 'number' ? item.fairValuePct : 100,
        autocallProbPct: typeof item.autocallProbPct === 'number' ? item.autocallProbPct : 0,
        pdiBreachProbPct: typeof item.pdiBreachProbPct === 'number' ? item.pdiBreachProbPct : 0,
        spec: item.spec || item.rawSpec || {},
        pricing: item.pricing || item.rawPricing || {},
        userOverridden: !!item.userOverridden,
        provider: item.provider || 'gemini',
        modelName: item.modelName || 'gemini-3.6-flash',
      }));
  } catch (err) {
    console.error('Failed to parse quote history from localStorage:', err);
    return getSeedHistory();
  }
}

export const getCalculationHistory = getQuoteHistory;

/**
 * Clear all audit logs
 */
export function clearQuoteHistory(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear quote history:', err);
  }
}

export const clearCalculationHistory = clearQuoteHistory;

/**
 * Pre-populate history with realistic institutional sample quotes for instant analytics
 */
function getSeedHistory(): AuditHistoryEntry[] {
  const now = Date.now();
  const dayMs = 86400000;

  return [
    {
      id: 'QUOTE-1001',
      timestamp: new Date(now - dayMs * 0.2).toISOString(),
      rawQuery: 'solve le coupon pour un autocall avec départ forward dans 3 mois sur MC FP',
      productTypeName: 'Autocall Classic Forward Start',
      underlyingTicker: 'MC FP',
      underlyingName: 'LVMH Moët Hennessy Louis Vuitton',
      solvedCouponPct: 8.85,
      fairValuePct: 100.0,
      autocallProbPct: 78.4,
      pdiBreachProbPct: 14.2,
      spec: {} as any,
      pricing: {} as any,
    },
    {
      id: 'QUOTE-1002',
      timestamp: new Date(now - dayMs * 0.8).toISOString(),
      rawQuery: 'Phoenix Memory 3 ans sur Kering (KER FP) PDI 60% coupon mémoire',
      productTypeName: 'Phoenix Memory',
      underlyingTicker: 'KER FP',
      underlyingName: 'Kering SA',
      solvedCouponPct: 11.40,
      fairValuePct: 99.8,
      autocallProbPct: 62.1,
      pdiBreachProbPct: 22.5,
      spec: {} as any,
      pricing: {} as any,
    },
    {
      id: 'QUOTE-1003',
      timestamp: new Date(now - dayMs * 1.5).toISOString(),
      rawQuery: 'Reverse Convertible 1 an sur TotalEnergies FP coupon garanti',
      productTypeName: 'Reverse Convertible',
      underlyingTicker: 'TTE FP',
      underlyingName: 'TotalEnergies SE',
      solvedCouponPct: 7.60,
      fairValuePct: 100.1,
      autocallProbPct: 0.0,
      pdiBreachProbPct: 9.8,
      spec: {} as any,
      pricing: {} as any,
    },
    {
      id: 'QUOTE-1004',
      timestamp: new Date(now - dayMs * 2.2).toISOString(),
      rawQuery: 'Autocall Airbag 5 ans sur L\'Oréal (OR FP) Airbag 70%',
      productTypeName: 'Autocall Airbag',
      underlyingTicker: 'OR FP',
      underlyingName: 'L\'Oréal SA',
      solvedCouponPct: 6.95,
      fairValuePct: 100.0,
      autocallProbPct: 84.0,
      pdiBreachProbPct: 8.1,
      spec: {} as any,
      pricing: {} as any,
    },
    {
      id: 'QUOTE-1005',
      timestamp: new Date(now - dayMs * 3.1).toISOString(),
      rawQuery: 'Phoenix Memory Euro Stoxx 50 3 ans PDI 60% coupon 7.5%',
      productTypeName: 'Phoenix Memory Index',
      underlyingTicker: 'SX5E',
      underlyingName: 'Euro Stoxx 50 Index',
      solvedCouponPct: 7.50,
      fairValuePct: 99.9,
      autocallProbPct: 71.0,
      pdiBreachProbPct: 11.0,
      spec: {} as any,
      pricing: {} as any,
    }
  ];
}
