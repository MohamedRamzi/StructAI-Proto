import { buildExtractedProductSpec, buildSpecFromAutocallV1 } from './spec-builder';
import { priceStructuredProduct } from './quant-pricer';
import { ExtractedProductSpec, PricingResult, UnderlyingAsset } from '../types/structured-product';

/**
 * Turns one raw `/api/analyze` response (inference-service's routed pipeline)
 * into the quote bundles the main app / CLI work with, branching on each
 * quote's `schemaVersion`:
 *
 * - `autocall/v1`         -> buildSpecFromAutocallV1 -> Monte Carlo price   (pricingAvailable: true)
 * - `generic/v1` / absent -> buildExtractedProductSpec -> Monte Carlo price (pricingAvailable: true)
 * - anything else (rates/v1, fx/v1, credit/v1, ...) -> parsed structure kept
 *   as `richExtraction`, no local pricer yet                                (pricingAvailable: false)
 *
 * This is the single place that knows the schema-version -> builder mapping,
 * shared by server.ts's /api/parse-query and scripts/parse-query-cli.ts (same
 * rationale as spec-builder itself — the two used to diverge).
 */

export interface AnalyzeQuoteRouting {
  assetClass: string | null;
  productFamily: string | null;
  promptKey: string;
  scopePrecision: number;
  routerConfidence: number | null;
}

export interface AdaptedQuote {
  quoteId: number;
  label: string;
  schemaVersion: string;
  routing: AnalyzeQuoteRouting | null;
  pricingAvailable: boolean;
  /** Present when pricingAvailable. */
  spec?: ExtractedProductSpec;
  pricing?: PricingResult;
  underlyingMatches?: UnderlyingAsset[];
  /** Present when !pricingAvailable — the raw rich extraction, kept for display. */
  richExtraction?: Record<string, any>;
  /** Present when !pricingAvailable — why no price grid is shown. */
  degradationReason?: string;
  missingFields?: { field: string; label: string; message: string }[];
}

export interface AdaptAnalyzeOptions {
  query: string;
  /** The parsed JSON body of POST /api/analyze. */
  analyzeData: any;
  underlyingsDb?: UnderlyingAsset[];
  engineDescription?: string;
  referenceDate?: Date;
  /**
   * When provided, called per priceable quote with the best underlying hint;
   * a non-null result is used as the resolved underlying instead of the local
   * deterministic matcher (server.ts wires this to inference-service's real
   * semantic search when `useVectorSearchForUnderlying` is on).
   */
  resolveVectorUnderlying?: (hint: string) => Promise<UnderlyingAsset | null>;
}

const PRICEABLE_GENERIC = new Set(['', 'generic/v1', 'generic']);

const DEGRADATION_REASON: Record<string, string> = {
  'rates/v1': 'Produit de taux — structure extraite, pricing indisponible (aucun moteur de taux branché pour l\'instant).',
  'fx/v1': 'Produit de change — structure extraite, pricing indisponible (aucun moteur FX branché pour l\'instant).',
  'credit/v1': 'Produit de crédit — structure extraite, pricing indisponible (aucun moteur crédit branché pour l\'instant).',
};

function underlyingHintFor(schemaVersion: string, extraction: any, query: string): string {
  if (schemaVersion.startsWith('autocall')) {
    const c = extraction?.underlying?.components?.[0];
    return c?.name || c?.identifiers?.bloomberg || c?.ref || query;
  }
  return extraction?.underlyingQueryOrTicker || extraction?.underlyingSelectionNote || query;
}

export async function adaptAnalyzeResponse(opts: AdaptAnalyzeOptions): Promise<AdaptedQuote[]> {
  const { query, analyzeData, underlyingsDb, engineDescription, referenceDate, resolveVectorUnderlying } = opts;
  const rawQuotes: any[] = Array.isArray(analyzeData?.quotes) ? analyzeData.quotes : [];

  return Promise.all(rawQuotes.map(async (quote: any, index: number): Promise<AdaptedQuote> => {
    const quoteId = quote.quoteId ?? index + 1;
    const schemaVersion: string = (quote.schemaVersion || quote.extraction?.schemaVersion || 'generic/v1').toLowerCase();
    const routing: AnalyzeQuoteRouting | null = quote.routing || null;
    const extraction = quote.extraction || {};
    const missingFields = quote.missingFields;

    const isAutocallV1 = schemaVersion.startsWith('autocall');
    const isGeneric = PRICEABLE_GENERIC.has(schemaVersion);

    if (!isAutocallV1 && !isGeneric) {
      return {
        quoteId,
        label: quote.label || extraction.productName || extraction.product_type || `Cotation ${quoteId}`,
        schemaVersion,
        routing,
        pricingAvailable: false,
        richExtraction: extraction,
        degradationReason: DEGRADATION_REASON[schemaVersion]
          || `Famille non priçable (${schemaVersion}) — structure extraite, aucun moteur de pricing local disponible.`,
        missingFields,
      };
    }

    let vectorResolvedUnderlying: UnderlyingAsset | undefined;
    if (resolveVectorUnderlying) {
      const hit = await resolveVectorUnderlying(underlyingHintFor(schemaVersion, extraction, query));
      vectorResolvedUnderlying = hit || undefined;
    }

    const { spec, underlyingMatches } = isAutocallV1
      ? buildSpecFromAutocallV1({ query, extraction, underlyingsDb, engineDescription, referenceDate, externalMissingFields: missingFields, vectorResolvedUnderlying })
      : buildExtractedProductSpec({ query, parsedJson: extraction, underlyingsDb, engineDescription, referenceDate, externalMissingFields: missingFields, vectorResolvedUnderlying });

    return {
      quoteId,
      label: quote.label || spec.productTypeName || `Cotation ${quoteId}`,
      schemaVersion,
      routing,
      pricingAvailable: true,
      spec,
      pricing: priceStructuredProduct(spec),
      underlyingMatches,
      missingFields,
    };
  }));
}
