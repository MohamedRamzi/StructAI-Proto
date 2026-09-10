import { buildExtractedProductSpec, buildSpecFromAutocallV1 } from './spec-builder';
import { priceStructuredProduct } from './quant-pricer';
import { instrumentToUnderlying, syntheticUnderlying } from './market-data';
import { ExtractedProductSpec, PricingResult, UnderlyingAsset } from '../types/structured-product';

/**
 * Turns one raw `/api/analyze` response (inference-service's routed pipeline)
 * into the quote bundles the main app / CLI work with:
 *
 * - branches on each quote's `schemaVersion`:
 *     `autocall/v1`         -> buildSpecFromAutocallV1  -> Monte Carlo price   (pricingAvailable: true)
 *     `generic/v1` / absent -> buildExtractedProductSpec -> Monte Carlo price  (pricingAvailable: true)
 *     anything else (rates/v1, fx/v1, ...) -> parsed structure only            (pricingAvailable: false)
 * - resolves every underlying against the SINGLE instrument corpus
 *   (inference-service semantic search, via `resolveInstrument`). No local
 *   instrument database, no keyword matcher. An underlying not in the corpus
 *   keeps its extracted name with placeholder market data, flagged.
 *
 * This is the single place that knows the schema-version -> builder mapping,
 * shared by server.ts's /api/parse-query and scripts/parse-query-cli.ts.
 */

export interface AnalyzeQuoteRouting {
  assetClass: string | null;
  productFamily: string | null;
  promptKey: string;
  scopePrecision: number;
  routerConfidence: number | null;
  assetClassCorrectedFrom?: string | null;
}

export interface AdaptedQuote {
  quoteId: number;
  label: string;
  schemaVersion: string;
  routing: AnalyzeQuoteRouting | null;
  pricingAvailable: boolean;
  spec?: ExtractedProductSpec;
  pricing?: PricingResult;
  underlyingMatches?: UnderlyingAsset[];
  richExtraction?: Record<string, any>;
  degradationReason?: string;
  missingFields?: { field: string; label: string; message: string }[];
}

export interface AdaptAnalyzeOptions {
  query: string;
  /** The parsed JSON body of POST /api/analyze. */
  analyzeData: any;
  engineDescription?: string;
  referenceDate?: Date;
  /**
   * Resolves one underlying name against inference-service's instrument corpus.
   * Returns the raw instrument JSON (a `/api/instruments/search` result) or null
   * when nothing matches / the service is unreachable. Omitted only in tests and
   * offline tooling — every quote then gets a synthetic underlying.
   */
  resolveInstrument?: (name: string, assetClass: string | null) => Promise<any | null>;
}

const PRICEABLE_GENERIC = new Set(['', 'generic/v1', 'generic']);

const DEGRADATION_REASON: Record<string, string> = {
  'rates/v1': 'Produit de taux — structure extraite, pricing indisponible (aucun moteur de taux branché pour l\'instant).',
  'fx/v1': 'Produit de change — structure extraite, pricing indisponible (aucun moteur FX branché pour l\'instant).',
  'credit/v1': 'Produit de crédit — structure extraite, pricing indisponible (aucun moteur crédit branché pour l\'instant).',
};

/** The underlying name(s) the extraction gave, in resolution order. */
function underlyingNames(schemaVersion: string, extraction: any, query: string): string[] {
  if (schemaVersion.startsWith('autocall')) {
    const components: any[] = Array.isArray(extraction?.underlying?.components) ? extraction.underlying.components : [];
    const names = components
      .map((c) => c?.name || c?.identifiers?.bloomberg || c?.ref || '')
      .map((s: string) => String(s).trim())
      .filter(Boolean);
    if (names.length) return names;
  }
  const single = extraction?.underlyingQueryOrTicker || extraction?.underlying?.components?.[0]?.name || '';
  return single ? [String(single).trim()] : [query.trim()];
}

interface ResolvedUnderlyings {
  underlyings: UnderlyingAsset[];
  note: string | null;
  missingField: { field: string; label: string; message: string } | null;
}

async function resolveUnderlyings(
  names: string[],
  assetClass: string | null,
  currency: string,
  resolveInstrument: AdaptAnalyzeOptions['resolveInstrument'],
): Promise<ResolvedUnderlyings> {
  const notFound: string[] = [];
  let anyPlaceholder = false;

  const underlyings = await Promise.all(
    names.map(async (name) => {
      const inst = resolveInstrument ? await resolveInstrument(name, assetClass) : null;
      const r = inst ? instrumentToUnderlying(inst, currency) : syntheticUnderlying(name, currency);
      if (r.instrumentNotFound && name) notFound.push(name);
      if (r.marketDataIsPlaceholder) anyPlaceholder = true;
      return r.underlying;
    }),
  );

  let note: string | null = null;
  let missingField: ResolvedUnderlyings['missingField'] = null;

  if (notFound.length > 0) {
    const list = notFound.map((n) => `« ${n} »`).join(', ');
    note = `⚠️ ${list} introuvable(s) dans la base d'instruments — pricing sur données de marché indicatives.`;
    missingField = {
      field: 'underlying',
      label: 'Sous-jacent',
      message: `${list} absent(s) de la base d'instruments. Ajoutez l'instrument depuis l'admin d'inference-service (onglet Instruments).`,
    };
  } else if (anyPlaceholder) {
    note = 'Données de marché partielles (spot/vol en placeholder) — prix indicatif en attendant le service de données de marché.';
  }

  return { underlyings, note, missingField };
}

export async function adaptAnalyzeResponse(opts: AdaptAnalyzeOptions): Promise<AdaptedQuote[]> {
  const { query, analyzeData, engineDescription, referenceDate, resolveInstrument } = opts;
  const rawQuotes: any[] = Array.isArray(analyzeData?.quotes) ? analyzeData.quotes : [];

  return Promise.all(rawQuotes.map(async (quote: any, index: number): Promise<AdaptedQuote> => {
    const quoteId = quote.quoteId ?? index + 1;
    const routing: AnalyzeQuoteRouting | null = quote.routing || null;
    const missingFields = quote.missingFields;

    // Routing-only response (pipeline: "route") — no extraction to build a spec from.
    if (!quote.extraction) {
      return {
        quoteId,
        label: quote.label || `Cotation ${quoteId}`,
        schemaVersion: 'route',
        routing,
        pricingAvailable: false,
        degradationReason: "Routage seul (pipeline « route ») — classe d'actif et pré-prompt sélectionnés, pas d'extraction.",
        missingFields,
      };
    }

    const schemaVersion: string = (quote.schemaVersion || quote.extraction?.schemaVersion || 'generic/v1').toLowerCase();
    const extraction = quote.extraction || {};

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

    const currency = extraction.currency || 'EUR';
    const { underlyings, note, missingField } = await resolveUnderlyings(
      underlyingNames(schemaVersion, extraction, query),
      routing?.assetClass ?? null,
      currency,
      resolveInstrument,
    );

    const { spec } = isAutocallV1
      ? buildSpecFromAutocallV1({ query, extraction, underlyings, underlyingNote: note, underlyingMissingField: missingField, engineDescription, referenceDate, externalMissingFields: missingFields })
      : buildExtractedProductSpec({ query, parsedJson: extraction, underlyings, underlyingNote: note, underlyingMissingField: missingField, engineDescription, referenceDate, externalMissingFields: missingFields });

    if (routing?.assetClassCorrectedFrom) {
      spec.assumedDefaults.unshift({
        param: "Classe d'actif",
        value: `${routing.assetClassCorrectedFrom} → ${routing.assetClass}`,
        reason: "Le routeur avait classé la demande dans une classe d'actif incohérente avec la famille de produit détectée — corrigé automatiquement.",
      });
    }

    return {
      quoteId,
      label: quote.label || spec.productTypeName || `Cotation ${quoteId}`,
      schemaVersion,
      routing,
      pricingAvailable: true,
      spec,
      pricing: priceStructuredProduct(spec),
      underlyingMatches: underlyings,
      missingFields,
    };
  }));
}
