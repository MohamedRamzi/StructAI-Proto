import { STOCK_DATABASE, findUnderlyingByTickerOrQuery } from '../data/underlyings-db';
import { isPreciseUnderlyingMatch } from './underlyings-storage';
import { ExtractedProductSpec, SolverTargetVariable, UnderlyingAsset } from '../types/structured-product';
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

// ---------------------------------------------------------------------------
// autocall/v1 (the rich per-family envelope produced by inference-service's
// routed pipeline for equity autocalls — Athena / Phoenix / Reverse
// Convertible & co.) -> ExtractedProductSpec, so the existing Monte Carlo
// engine (quant-pricer.ts) can price it unchanged.
//
// Only the fields the pricer and the workbench form actually consume are
// mapped; the full rich structure is kept separately (server.ts attaches it
// as `richExtraction`) for display and future pricers.
// ---------------------------------------------------------------------------

/** autocall/v1 `productFamily` -> (our ProductTypeId, human name, is-capital-protected). */
const AUTOCALL_V1_FAMILY_MAP: Record<string, { typeId: string; name: string; capitalProtected?: boolean }> = {
  ATHENA: { typeId: 'AUTOCALL_CLASSIC', name: 'Athena (Autocall à capital conditionnel)' },
  PHOENIX: { typeId: 'PHOENIX_MEMORY', name: 'Phoenix' },
  AUTOCALL_REVERSE_CONVERTIBLE: { typeId: 'REVERSE_CONVERTIBLE', name: 'Autocall Reverse Convertible' },
  BARRIER_REVERSE_CONVERTIBLE: { typeId: 'REVERSE_CONVERTIBLE', name: 'Barrier Reverse Convertible' },
  ATHENA_CAPITAL_PROTECTED: { typeId: 'CAPITAL_PROTECTION', name: 'Athena à capital protégé', capitalProtected: true },
  TWIN_WIN_AUTOCALL: { typeId: 'TWIN_WIN_NOTE', name: 'Twin-Win Autocall' },
  BOOSTER_AUTOCALL: { typeId: 'AUTOCALL_CLASSIC', name: 'Booster Autocall' },
  CALLABLE_NOTE: { typeId: 'AUTOCALL_CLASSIC', name: 'Callable Note' },
};

const OBS_FREQUENCY_MAP: Record<string, 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY'> = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMI_ANNUAL: 'SEMI_ANNUALLY',
  SEMI_ANNUALLY: 'SEMI_ANNUALLY',
  ANNUAL: 'ANNUALLY',
  ANNUALLY: 'ANNUALLY',
};

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUALLY: 2, ANNUALLY: 1 };

/** A ratio in autocall/v1 is a fraction (0.7 = 70%). Tolerate a model that
 * already emitted a percent (70) — anything > 1.5 is taken as already-percent. */
function ratioToPct(value: any): number | null {
  if (value === null || value === undefined || value === '' || isNaN(Number(value))) return null;
  const n = Number(value);
  return n <= 1.5 && n >= -1.5 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

/** An underlying the extraction named but that isn't in the instruments DB:
 * keep the name, use neutral placeholder market data, and make the gap obvious
 * (a real price needs the instrument added or the vector search used). */
function syntheticUnderlying(name: string, currency: string): UnderlyingAsset {
  return {
    ticker: name.trim().toUpperCase().slice(0, 16) || 'INCONNU',
    name: name.trim() || 'Sous-jacent inconnu',
    sector: 'Non renseigné',
    region: 'Non renseigné',
    spotPrice: 100,
    currency: currency || 'EUR',
    impliedVol3m: 0.25,
    dividendYield: 0.02,
    repoRate: 0.001,
    volatilityScore: 'MEDIUM',
    reasoningForRecommendation:
      `« ${name.trim()} » absent de la base d'instruments — données de marché indicatives (spot 100, vol 25 %). ` +
      `Ajoutez l'instrument (onglet Instruments) ou activez la recherche vectorielle pour un pricing réaliste.`,
  };
}

function firstComponentHint(underlying: any, query: string): string {
  const c = Array.isArray(underlying?.components) ? underlying.components[0] : null;
  return (
    c?.name ||
    c?.identifiers?.bloomberg ||
    c?.identifiers?.isin ||
    c?.ref ||
    (typeof underlying === 'string' ? underlying : '') ||
    query ||
    ''
  );
}

export interface BuildAutocallV1Input {
  query: string;
  /** The `autocall/v1` extraction object (quote.extraction from POST /api/analyze). */
  extraction: RawExtractionJson;
  underlyingsDb?: UnderlyingAsset[];
  engineDescription?: string;
  referenceDate?: Date;
  externalMissingFields?: { field: string; label: string; message: string }[];
  vectorResolvedUnderlying?: UnderlyingAsset;
}

/**
 * Builds a priceable ExtractedProductSpec from an `autocall/v1` envelope.
 * Mirrors buildExtractedProductSpec's contract (same output shape, same
 * underlying-resolution + missing-field-merge behaviour) so callers can treat
 * the two interchangeably once they've branched on schemaVersion.
 */
export function buildSpecFromAutocallV1({
  query,
  extraction,
  underlyingsDb,
  engineDescription,
  referenceDate,
  externalMissingFields,
  vectorResolvedUnderlying,
}: BuildAutocallV1Input): BuildSpecOutput {
  const ex = extraction || {};
  const dates = ex.dates || {};
  const observation = ex.observation || {};
  const autocall = ex.autocall || {};
  const coupon = ex.coupon || {};
  const finalRedemption = ex.finalRedemption || {};
  const knockIn = finalRedemption.knockIn || {};

  // --- Underlying(s) ---
  // autocall/v1 gives a concrete underlying NAME (underlying.components[].name),
  // never a vague theme. So resolve on the name ONLY — no fall back to matching
  // the whole client query (a long proposal full of "rendement"/"dividende"
  // wording would theme-match an unrelated stock). If the name isn't in the
  // instruments DB, keep the extracted name with placeholder market data and
  // flag it, rather than silently substituting another company.
  const components: any[] = Array.isArray(ex.underlying?.components) ? ex.underlying.components : [];
  const currency = ex.currency || 'EUR';
  const unresolvedNames: string[] = [];

  const resolveComponent = (name: string): UnderlyingAsset => {
    if (!name.trim()) return syntheticUnderlying('Sous-jacent non spécifié', currency);
    const res = findUnderlyingByTickerOrQuery(name, underlyingsDb);
    if (res.autoSelected && isPreciseUnderlyingMatch(res)) return res.autoSelected;
    unresolvedNames.push(name.trim());
    return syntheticUnderlying(name.trim(), currency);
  };

  const hint = firstComponentHint(ex.underlying, query);
  let resolvedUnderlyings: UnderlyingAsset[];
  if (vectorResolvedUnderlying) {
    resolvedUnderlyings = [vectorResolvedUnderlying];
  } else if (components.length > 1) {
    resolvedUnderlyings = components.map((c) => resolveComponent(c?.name || c?.identifiers?.bloomberg || c?.ref || ''));
  } else {
    resolvedUnderlyings = [resolveComponent(hint)];
  }
  const primaryUnderlying = resolvedUnderlyings[0];
  const underlyingResult = findUnderlyingByTickerOrQuery(hint, underlyingsDb); // kept for underlyingMatches (suggestions list)

  const basketTypeMap: Record<string, ExtractedProductSpec['commonParams']['basketType']> = {
    SINGLE: 'SINGLE', WORST_OF: 'WORST_OF', BEST_OF: 'BEST_OF', WEIGHTED_BASKET: 'BASKET_AVERAGE',
  };
  const basketType = basketTypeMap[String(ex.underlying?.basketType || '').toUpperCase()]
    || (resolvedUnderlyings.length > 1 ? 'WORST_OF' : 'SINGLE');

  // --- Frequency / observation schedule ---
  const frequency = OBS_FREQUENCY_MAP[String(observation.frequency || '').toUpperCase()] || 'QUARTERLY';
  const periodsPerYear = PERIODS_PER_YEAR[frequency];
  const monthsPerPeriod = 12 / periodsPerYear;

  // --- Maturity: prefer explicit final valuation date, else derive from the observation count. ---
  const refDate = referenceDate || new Date();
  const strikeDate = typeof dates.strikeDate === 'string' ? parseFlexibleDate(dates.strikeDate) : null;
  const finalValuationDate = typeof dates.finalValuationDate === 'string' ? parseFlexibleDate(dates.finalValuationDate) : null;

  let maturityMonths: number | null = null;
  if (finalValuationDate) {
    maturityMonths = monthsBetween(strikeDate || refDate, finalValuationDate);
  } else if (observation.numberOfObservations && Number(observation.numberOfObservations) > 0) {
    maturityMonths = Math.round(Number(observation.numberOfObservations) * monthsPerPeriod);
  }
  if (maturityMonths !== null && maturityMonths <= 0) maturityMonths = null;

  // --- Forward start: a strike date in the future relative to "today". ---
  let forwardStartMonths = 0;
  let forwardStartDateIso: string | null = null;
  if (strikeDate) {
    const fwd = monthsBetween(refDate, strikeDate);
    if (fwd > 0) {
      forwardStartMonths = fwd;
      forwardStartDateIso = toIsoDateString(strikeDate);
    }
  }

  const noCallPeriods = observation.noCallPeriods !== undefined && observation.noCallPeriods !== null
    ? Number(observation.noCallPeriods)
    : 0;
  const nonCallMonths = Math.round(noCallPeriods * monthsPerPeriod);

  // --- Family / product type ---
  const familyKey = String(ex.productFamily || '').toUpperCase();
  const familyInfo = AUTOCALL_V1_FAMILY_MAP[familyKey] || { typeId: 'AUTOCALL_CLASSIC', name: 'Autocall' };
  let productTypeId = familyInfo.typeId;
  if (productTypeId === 'AUTOCALL_CLASSIC' && knockIn.airbagLevel !== null && knockIn.airbagLevel !== undefined) {
    productTypeId = 'ATHENA_AIRBAG';
  }
  if (productTypeId === 'AUTOCALL_CLASSIC' && String(autocall.triggerType || '').toUpperCase() === 'STEP_DOWN') {
    productTypeId = 'STEP_DOWN_AUTOCALL';
  }

  // --- Barriers / target ---
  const scheduleFirst = Array.isArray(autocall.triggerSchedule) && autocall.triggerSchedule.length > 0
    ? autocall.triggerSchedule[0]?.level
    : null;
  const autocallBarrierPct = ratioToPct(autocall.initialTrigger ?? scheduleFirst) ?? 100;
  const stepDownPctPerPeriod = autocall.stepPerPeriod !== null && autocall.stepPerPeriod !== undefined
    ? Math.abs(ratioToPct(autocall.stepPerPeriod) ?? 0)
    : undefined;
  const pdiBarrierPct = ratioToPct(knockIn.barrier) ?? 70;

  const pdiTypeMap: Record<string, 'EUROPEAN' | 'AMERICAN' | 'DAILY'> = {
    EUROPEAN_AT_MATURITY: 'EUROPEAN', AMERICAN_CONTINUOUS: 'AMERICAN', AMERICAN_CLOSING: 'AMERICAN', WINDOW: 'DAILY',
  };
  const pdiType = pdiTypeMap[String(knockIn.observationStyle || '').toUpperCase()] || 'EUROPEAN';

  const couponRatePresent = coupon.rate !== null && coupon.rate !== undefined && !isNaN(Number(coupon.rate));
  let targetToSolve: SolverTargetVariable;
  if (!couponRatePresent) targetToSolve = 'COUPON_RATE';
  else if (ratioToPct(knockIn.barrier) === null) targetToSolve = 'PDI_BARRIER';
  else if (ratioToPct(autocall.initialTrigger ?? scheduleFirst) === null) targetToSolve = 'CALL_BARRIER';
  else targetToSolve = 'COUPON_RATE';

  // --- Missing fields (inference-service's autocall/v1 validator output + maturity guard) ---
  const missingRequiredParams: any[] = [];
  if (Array.isArray(externalMissingFields)) {
    for (const flag of externalMissingFields) {
      missingRequiredParams.push({ param: flag.field, label: flag.label, reason: flag.message });
    }
  }
  if (maturityMonths === null && !missingRequiredParams.some((p) => p.param === 'maturityMonths' || p.param === 'dates.finalValuationDate')) {
    missingRequiredParams.push({
      param: 'maturityMonths',
      label: 'Maturité totale (mois)',
      reason: 'Ni date de constatation finale ni calendrier d\'observation exploitable dans la demande.',
    });
  }
  if (!vectorResolvedUnderlying && unresolvedNames.length > 0) {
    missingRequiredParams.push({
      param: 'underlying',
      label: 'Sous-jacent',
      reason: `${unresolvedNames.map((n) => `« ${n} »`).join(', ')} absent(s) de la base d'instruments — pricing sur données indicatives. `
        + `Ajoutez l'instrument (onglet Instruments) ou activez la recherche vectorielle.`,
    });
  }

  const assumedDefaults: { param: string; value: any; reason: string }[] = [];
  if (engineDescription) {
    assumedDefaults.push({ param: 'Moteur LLM', value: engineDescription, reason: 'Modèle IA exécuté pour la structuration' });
  }
  assumedDefaults.push({ param: 'Schéma', value: 'autocall/v1', reason: 'Extraction produite par le pré-prompt actions/autocall (schéma riche)' });
  assumedDefaults.push(
    maturityMonths !== null
      ? { param: 'Maturité', value: `${maturityMonths} mois`, reason: finalValuationDate ? 'Déduite de la date de constatation finale' : 'Déduite du nombre de constatations et de la fréquence' }
      : { param: 'Maturité', value: 'Non spécifiée (Unspecified)', reason: 'À préciser par l\'utilisateur' }
  );
  if (forwardStartDateIso) {
    assumedDefaults.push({ param: 'Départ Forward', value: `${forwardStartMonths} mois (strike date ${forwardStartDateIso})`, reason: 'Strike date future détectée dans la demande' });
  }
  assumedDefaults.push({ param: 'Spread de financement', value: '45 bps', reason: `Rating émetteur ${ex.issuer?.creditRating || 'A+'} (hypothèse)` });

  const spec: ExtractedProductSpec = {
    rawQuery: query || ex.productName || 'Demande client',
    productTypeId,
    productTypeName: ex.productName || familyInfo.name,
    productFamily: familyInfo.capitalProtected ? 'CAPITAL_PROTECTION' : 'YIELD_ENHANCEMENT',
    targetToSolve,
    commonParams: {
      underlyings: resolvedUnderlyings,
      basketType,
      maturityMonths,
      forwardStartMonths,
      forwardStartDate: forwardStartDateIso,
      observationFrequency: frequency,
      nonCallMonths,
      currency: ex.currency || primaryUnderlying.currency || 'EUR',
      denomination: Number(ex.notional?.denomination) > 0 ? Number(ex.notional.denomination) : 1000,
      issuerCreditRating: ex.issuer?.creditRating || 'A+',
      fundingSpreadBps: 45,
    },
    specificParams: {
      autocallBarrierPct,
      ...(stepDownPctPerPeriod !== undefined ? { stepDownPctPerPeriod } : {}),
      pdiBarrierPct,
      pdiType,
      memoryCoupon: Boolean(coupon.memory),
      ...(knockIn.airbagLevel !== null && knockIn.airbagLevel !== undefined ? { airbagProtectionPct: ratioToPct(knockIn.airbagLevel) ?? undefined } : {}),
      ...(couponRatePresent ? { couponRatePct: ratioToPct(coupon.rate) ?? undefined } : {}),
    },
    confidenceScore: ex.confidenceScore ? Number(ex.confidenceScore) : 0.9,
    extractedTokens: Array.isArray(ex.extractedTokens) ? ex.extractedTokens : [],
    missingRequiredParams,
    assumedDefaults,
    aiExplanation: ex.aiExplanation || 'Produit à rappel automatique sur sous-jacent actions (schéma autocall/v1).',
    underlyingSelectionNote: vectorResolvedUnderlying
      ? `Sous-jacent résolu via recherche vectorielle (embeddings) sur "${hint}".`
      : unresolvedNames.length > 0
        ? `⚠️ ${unresolvedNames.map((n) => `« ${n} »`).join(', ')} introuvable(s) dans la base d'instruments — pricing sur données de marché indicatives.`
        : primaryUnderlying.reasoningForRecommendation,
  };

  return { spec, underlyingMatches: vectorResolvedUnderlying ? [vectorResolvedUnderlying] : underlyingResult.matches };
}
