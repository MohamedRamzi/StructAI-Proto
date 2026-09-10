import { ExtractedProductSpec, SolverTargetVariable, UnderlyingAsset } from '../types/structured-product';
import { parseFlexibleDate, monthsBetween, toIsoDateString } from './date-utils';

/**
 * Loosely-typed shape of a parsed extraction (inference-service's LLM JSON
 * response) that buildExtractedProductSpec turns into a full
 * ExtractedProductSpec ready for pricing.
 */
export type RawExtractionJson = Record<string, any>;

type MissingField = { field: string; label: string; message: string };

interface CommonBuildInput {
  query: string;
  /**
   * Underlying(s), ALREADY resolved against the single instrument corpus
   * (inference-service semantic search) — see services/analyze-adapter.ts.
   * spec-builder does no instrument lookup of its own; it only assembles the
   * ExtractedProductSpec from the extraction + these underlyings.
   */
  underlyings: UnderlyingAsset[];
  /** A note about the underlying resolution (e.g. "not in the corpus", "placeholder market data"). */
  underlyingNote?: string | null;
  /** A missing-field entry to add when the underlying couldn't be resolved. */
  underlyingMissingField?: MissingField | null;
  /** e.g. "Ollama qwen3.6 (Local)" — adds a leading "Moteur LLM" entry to assumedDefaults. */
  engineDescription?: string;
  /** Fallback aiExplanation used when the extraction has none. */
  fallbackAiExplanation?: string;
  /** "Today" for converting an absolute forwardStartDate/strikeDate into a month count. Override for deterministic tests. */
  referenceDate?: Date;
  /** Missing-field flags from inference-service's POST /api/analyze (validation.py), merged into missingRequiredParams. */
  externalMissingFields?: MissingField[];
}

export interface BuildSpecInput extends CommonBuildInput {
  parsedJson: RawExtractionJson;
}

export interface BuildSpecOutput {
  spec: ExtractedProductSpec;
}

function mergeExternalMissing(list: any[], externalMissingFields?: MissingField[], underlyingMissingField?: MissingField | null): void {
  const has = (field: string) => list.some((p: any) => (typeof p === 'string' ? p : p.param) === field);
  for (const flag of externalMissingFields || []) {
    if (!has(flag.field)) list.push({ param: flag.field, label: flag.label, reason: flag.message });
  }
  if (underlyingMissingField && !has(underlyingMissingField.field)) {
    list.push({ param: underlyingMissingField.field, label: underlyingMissingField.label, reason: underlyingMissingField.message });
  }
}

/**
 * Builds a complete ExtractedProductSpec (ready to be priced by
 * priceStructuredProduct) from a raw parsed JSON extraction (the flat
 * `generic/v1` schema), using pre-resolved underlyings.
 */
export function buildExtractedProductSpec({
  query,
  parsedJson,
  underlyings,
  underlyingNote,
  underlyingMissingField,
  engineDescription,
  fallbackAiExplanation,
  referenceDate,
  externalMissingFields,
}: BuildSpecInput): BuildSpecOutput {
  const selectedUnderlying = underlyings[0];

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
  mergeExternalMissing(missingRequiredParams, externalMissingFields, underlyingMissingField);

  // Resolve forward-start: prefer an explicit ABSOLUTE date (forwardStartDate) over a
  // relative duration (forwardStartMonths). Date arithmetic against "today" is
  // deterministic and belongs here, not in the model.
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
      currency: parsedJson.currency || selectedUnderlying?.currency || 'EUR',
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
    underlyingSelectionNote: underlyingNote || parsedJson.underlyingSelectionNote || selectedUnderlying?.reasoningForRecommendation,
  };

  return { spec };
}

// ---------------------------------------------------------------------------
// autocall/v1 (the rich per-family envelope produced by inference-service's
// routed pipeline for equity autocalls) -> ExtractedProductSpec.
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

export interface BuildAutocallV1Input extends CommonBuildInput {
  /** The `autocall/v1` extraction object (quote.extraction from POST /api/analyze). */
  extraction: RawExtractionJson;
}

/**
 * Builds a priceable ExtractedProductSpec from an `autocall/v1` envelope, using
 * pre-resolved underlyings.
 */
export function buildSpecFromAutocallV1({
  query,
  extraction,
  underlyings,
  underlyingNote,
  underlyingMissingField,
  engineDescription,
  referenceDate,
  externalMissingFields,
}: BuildAutocallV1Input): BuildSpecOutput {
  const ex = extraction || {};
  const dates = ex.dates || {};
  const observation = ex.observation || {};
  const autocall = ex.autocall || {};
  const coupon = ex.coupon || {};
  const finalRedemption = ex.finalRedemption || {};
  const knockIn = finalRedemption.knockIn || {};

  const resolvedUnderlyings = underlyings.length > 0 ? underlyings : [];
  const primaryUnderlying = resolvedUnderlyings[0];

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

  // --- Missing fields (inference-service's autocall/v1 validator output + guards) ---
  const missingRequiredParams: any[] = [];
  mergeExternalMissing(missingRequiredParams, externalMissingFields, underlyingMissingField);
  if (maturityMonths === null && !missingRequiredParams.some((p) => p.param === 'maturityMonths' || p.param === 'dates.finalValuationDate')) {
    missingRequiredParams.push({
      param: 'maturityMonths',
      label: 'Maturité totale (mois)',
      reason: 'Ni date de constatation finale ni calendrier d\'observation exploitable dans la demande.',
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
      currency: ex.currency || primaryUnderlying?.currency || 'EUR',
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
    underlyingSelectionNote: underlyingNote || primaryUnderlying?.reasoningForRecommendation,
  };

  return { spec };
}
