import { STOCK_DATABASE, findUnderlyingByTickerOrQuery } from '../data/underlyings-db';
import { ExtractedProductSpec, UnderlyingAsset } from '../types/structured-product';
import { parseFlexibleDate, monthsBetween, toIsoDateString } from './date-utils';

/**
 * Loosely-typed shape of a parsed extraction (inference-service's LLM JSON
 * response) that buildExtractedProductSpec turns into a full
 * ExtractedProductSpec ready for pricing.
 */
export type RawExtractionJson = Record<string, any>;

export interface BuildSpecInput {
  query: string;
  parsedJson: RawExtractionJson;
  /** Restrict underlying resolution to this database instead of the global default. */
  underlyingsDb?: UnderlyingAsset[];
  /** e.g. "Ollama qwen3.6 (Local)" — adds a leading "Moteur LLM" entry to assumedDefaults. */
  engineDescription?: string;
  /** Fallback aiExplanation used when parsedJson has none. */
  fallbackAiExplanation?: string;
  /** "Today" used to convert an absolute forwardStartDate into forwardStartMonths. Defaults to `new Date()`; override for deterministic tests. */
  referenceDate?: Date;
  /** Missing-field flags from inference-service's POST /api/analyze (see inference-service/app/services/validation.py), merged into missingRequiredParams. */
  externalMissingFields?: { field: string; label: string; message: string }[];
  /**
   * When set, used directly as the resolved underlying instead of running the
   * local deterministic matcher (findUnderlyingByTickerOrQuery) — the caller
   * (server.ts's /api/parse-query, when `useVectorSearchForUnderlying` is on)
   * has already resolved it via inference-service's real semantic search
   * (embeddings + ChromaDB) against the LLM-extracted underlyingQueryOrTicker.
   */
  vectorResolvedUnderlying?: UnderlyingAsset;
}

export interface BuildSpecOutput {
  spec: ExtractedProductSpec;
  underlyingMatches: UnderlyingAsset[];
}

/**
 * Builds a complete ExtractedProductSpec (ready to be priced by
 * priceStructuredProduct) from a raw parsed JSON extraction, resolving the
 * underlying asset and computing missing-params / assumed-defaults metadata.
 *
 * This is the single source of truth for that construction, shared by the
 * Gemini + local-LLM API endpoints in server.ts and by the CLI tool
 * (scripts/parse-query-cli.ts), which previously each re-implemented it with
 * small, easy-to-miss divergences.
 */
export function buildExtractedProductSpec({
  query,
  parsedJson,
  underlyingsDb,
  engineDescription,
  fallbackAiExplanation,
  referenceDate,
  externalMissingFields,
  vectorResolvedUnderlying,
}: BuildSpecInput): BuildSpecOutput {
  // Resolve the underlying: try the ticker/theme hint extracted by the parser first,
  // then retry against the full raw query if that only fell back to the DB default.
  // Skipped entirely when the caller already resolved it via real semantic search
  // (vectorResolvedUnderlying) — that result wins outright, no local re-matching.
  let underlyingResult = findUnderlyingByTickerOrQuery(parsedJson.underlyingQueryOrTicker || query || '', underlyingsDb);
  const fallbackDb = (underlyingsDb && underlyingsDb.length > 0) ? underlyingsDb : STOCK_DATABASE;

  if (!vectorResolvedUnderlying && (!underlyingResult.autoSelected || (underlyingResult.autoSelected === fallbackDb[0] && fallbackDb.length > 1))) {
    const fullQueryMatch = findUnderlyingByTickerOrQuery(query, underlyingsDb);
    if (fullQueryMatch.autoSelected && fullQueryMatch.autoSelected !== fallbackDb[0]) {
      underlyingResult = fullQueryMatch;
    }
  }
  const selectedUnderlying = vectorResolvedUnderlying || underlyingResult.autoSelected || fallbackDb[0] || STOCK_DATABASE[0];

  const parsedMaturity = (parsedJson.maturityMonths !== undefined && parsedJson.maturityMonths !== null && !isNaN(Number(parsedJson.maturityMonths)) && Number(parsedJson.maturityMonths) > 0)
    ? Number(parsedJson.maturityMonths)
    : null;

  const missingRequiredParams: any[] = Array.isArray(parsedJson.missingRequiredParams) ? [...parsedJson.missingRequiredParams] : [];
  if (parsedMaturity === null && !missingRequiredParams.some((p: any) => (typeof p === 'string' ? p : p.param) === 'maturityMonths')) {
    missingRequiredParams.push({
      param: 'maturityMonths',
      label: 'Maturité totale (mois)',
      reason: 'Maturité non spécifiée dans la demande client (À préciser / Unspecified)',
    });
  }

  // Merge in inference-service's own missing-field detection (validation.py there
  // covers more than just maturity — e.g. missing underlying, missing target-to-solve,
  // missing barrier for barrier-dependent products), deduped against what's already
  // flagged above so the same field isn't listed twice.
  if (Array.isArray(externalMissingFields)) {
    for (const flag of externalMissingFields) {
      if (!missingRequiredParams.some((p: any) => (typeof p === 'string' ? p : p.param) === flag.field)) {
        missingRequiredParams.push({ param: flag.field, label: flag.label, reason: flag.message });
      }
    }
  }

  // Resolve forward-start: prefer an explicit ABSOLUTE date (forwardStartDate, e.g. from
  // "première fixation le 01/12/2026") over a relative duration (forwardStartMonths, e.g.
  // "fwd 3m"). The LLM reports the date verbatim (normalized to ISO) rather
  // than computing the month count itself — date arithmetic against "today" is deterministic
  // and belongs here, not in the model.
  const rawForwardStartDate = typeof parsedJson.forwardStartDate === 'string' ? parsedJson.forwardStartDate.trim() : '';
  const parsedForwardStartDate = rawForwardStartDate ? parseFlexibleDate(rawForwardStartDate) : null;

  let forwardStartMonths: number;
  let forwardStartDateIso: string | null = null;
  if (parsedForwardStartDate) {
    forwardStartMonths = monthsBetween(referenceDate || new Date(), parsedForwardStartDate);
    forwardStartDateIso = toIsoDateString(parsedForwardStartDate);
  } else {
    forwardStartMonths = (parsedJson.forwardStartMonths !== undefined && parsedJson.forwardStartMonths !== null && !isNaN(Number(parsedJson.forwardStartMonths)))
      ? Number(parsedJson.forwardStartMonths)
      : 3;
  }

  const assumedDefaults: { param: string; value: any; reason: string }[] = [];
  if (engineDescription) {
    assumedDefaults.push({ param: 'Moteur LLM', value: engineDescription, reason: 'Modèle IA exécuté pour la structuration' });
  }
  assumedDefaults.push(
    parsedMaturity !== null
      ? { param: 'Maturité', value: `${parsedMaturity} mois`, reason: 'Durée extraite de la demande' }
      : { param: 'Maturité', value: 'Non spécifiée (Unspecified)', reason: 'À préciser par l\'utilisateur' }
  );
  if (forwardStartDateIso) {
    assumedDefaults.push({
      param: 'Départ Forward (calculé depuis date absolue)',
      value: `${forwardStartMonths} mois (première fixation le ${rawForwardStartDate})`,
      reason: 'Date de départ forward / première fixation explicite détectée dans la demande, convertie en mois à partir de la date du jour.',
    });
  }
  assumedDefaults.push({ param: 'Barrière de rappel', value: `${parsedJson.autocallBarrierPct ?? 100}%`, reason: 'Rappel au niveau initial (100%)' });
  assumedDefaults.push({ param: 'Spread de financement', value: '45 bps', reason: 'Rating émetteur A+' });

  const spec: ExtractedProductSpec = {
    rawQuery: query || 'Demande client',
    productTypeId: parsedJson.productTypeId || 'AUTOCALL_CLASSIC',
    productTypeName: parsedJson.productTypeName || 'Autocall Classic',
    productFamily: (parsedJson.productFamily as any) || 'YIELD_ENHANCEMENT',
    targetToSolve: (parsedJson.targetToSolve as any) || 'COUPON_RATE',
    commonParams: {
      underlyings: [selectedUnderlying],
      basketType: 'SINGLE',
      maturityMonths: parsedMaturity,
      forwardStartMonths,
      forwardStartDate: forwardStartDateIso,
      observationFrequency: (parsedJson.observationFrequency as any) || 'QUARTERLY',
      nonCallMonths: parsedJson.nonCallMonths !== undefined ? Number(parsedJson.nonCallMonths) : 12,
      currency: parsedJson.currency || 'EUR',
      denomination: 1000,
      issuerCreditRating: 'A+',
      fundingSpreadBps: 45,
    },
    specificParams: {
      autocallBarrierPct: parsedJson.autocallBarrierPct !== undefined ? Number(parsedJson.autocallBarrierPct) : 100,
      pdiBarrierPct: parsedJson.pdiBarrierPct !== undefined ? Number(parsedJson.pdiBarrierPct) : 70,
      pdiType: 'EUROPEAN',
      memoryCoupon: parsedJson.memoryCoupon !== undefined ? Boolean(parsedJson.memoryCoupon) : true,
    },
    confidenceScore: parsedJson.confidenceScore ? Number(parsedJson.confidenceScore) : 0.95,
    extractedTokens: Array.isArray(parsedJson.extractedTokens) ? parsedJson.extractedTokens : [],
    missingRequiredParams,
    assumedDefaults,
    aiExplanation: parsedJson.aiExplanation || fallbackAiExplanation || 'Produit structuré Autocall avec départ différé de 3 mois et protection à maturité.',
    underlyingSelectionNote: vectorResolvedUnderlying
      ? `Sous-jacent résolu via recherche vectorielle (embeddings) sur "${parsedJson.underlyingQueryOrTicker || query}".`
      : parsedJson.underlyingSelectionNote || selectedUnderlying.reasoningForRecommendation,
  };

  return { spec, underlyingMatches: vectorResolvedUnderlying ? [vectorResolvedUnderlying] : underlyingResult.matches };
}
