import { UnderlyingAsset } from '../types/structured-product';

/**
 * Interim market data.
 *
 * Underlyings now come from a single source — inference-service's instrument
 * corpus (the semantic-search base). That corpus carries identity (code, name,
 * tags) and, in each instrument's free-form `metadata`, whatever quantitative
 * fields have been entered. Real, live market data (spot, vol surface,
 * dividends, repo) will come from a dedicated market-data service later; until
 * then we take what's in `metadata` and fill the rest with placeholders,
 * flagging every spec built that way as "prix indicatif".
 */
export const PLACEHOLDER_MARKET_DATA = {
  spotPrice: 100,
  impliedVol3m: 0.25,
  dividendYield: 0.02,
  repoRate: 0.001,
} as const;

export interface ResolvedUnderlying {
  underlying: UnderlyingAsset;
  /** spot and/or vol came from PLACEHOLDER_MARKET_DATA, not real data. */
  marketDataIsPlaceholder: boolean;
  /** the instrument itself was not found in the corpus (fully synthetic). */
  instrumentNotFound: boolean;
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Maps an inference-service instrument (a `/api/instruments/search` result:
 * { code, name, assetClass, description, tags, metadata, score }) to an
 * UnderlyingAsset — quantitative fields from `metadata` when present, else
 * placeholders.
 */
export function instrumentToUnderlying(instrument: any, currency = 'EUR'): ResolvedUnderlying {
  const meta = instrument?.metadata || {};
  const spot = num(meta.spotPrice);
  const vol = num(meta.impliedVol3m);
  const div = num(meta.dividendYield);
  const repo = num(meta.repoRate);
  const marketDataIsPlaceholder = spot === null || vol === null;

  const name = instrument?.name || instrument?.code || 'Sous-jacent';
  const tags = Array.isArray(instrument?.tags) ? instrument.tags : [];

  return {
    underlying: {
      ticker: instrument?.code || instrument?.ticker || String(name).toUpperCase().slice(0, 16),
      isin: meta.isin || undefined,
      name,
      sector: meta.sector || tags.join(', ') || 'Non renseigné',
      region: meta.region || 'Non renseigné',
      spotPrice: spot ?? PLACEHOLDER_MARKET_DATA.spotPrice,
      currency: meta.currency || currency || 'EUR',
      impliedVol3m: vol ?? PLACEHOLDER_MARKET_DATA.impliedVol3m,
      dividendYield: div ?? PLACEHOLDER_MARKET_DATA.dividendYield,
      repoRate: repo ?? PLACEHOLDER_MARKET_DATA.repoRate,
      volatilityScore: meta.volatilityScore || 'MEDIUM',
      reasoningForRecommendation:
        instrument?.description ||
        meta.reasoningForRecommendation ||
        (marketDataIsPlaceholder
          ? `« ${name} » — données de marché partielles dans la base (spot/vol en placeholder).`
          : undefined),
    },
    marketDataIsPlaceholder,
    instrumentNotFound: false,
  };
}

/**
 * An underlying the extraction named but that isn't in the instrument corpus:
 * keep the name, everything else is a placeholder, and it's flagged.
 */
export function syntheticUnderlying(name: string, currency = 'EUR'): ResolvedUnderlying {
  const clean = (name || '').trim() || 'Sous-jacent inconnu';
  return {
    underlying: {
      ticker: clean.toUpperCase().slice(0, 16),
      name: clean,
      sector: 'Non renseigné',
      region: 'Non renseigné',
      spotPrice: PLACEHOLDER_MARKET_DATA.spotPrice,
      currency: currency || 'EUR',
      impliedVol3m: PLACEHOLDER_MARKET_DATA.impliedVol3m,
      dividendYield: PLACEHOLDER_MARKET_DATA.dividendYield,
      repoRate: PLACEHOLDER_MARKET_DATA.repoRate,
      volatilityScore: 'MEDIUM',
      reasoningForRecommendation:
        `« ${clean} » introuvable dans la base d'instruments — ajoutez-le depuis l'admin d'inference-service ` +
        `(onglet Instruments) pour un pricing réaliste. Données de marché indicatives.`,
    },
    marketDataIsPlaceholder: true,
    instrumentNotFound: true,
  };
}
