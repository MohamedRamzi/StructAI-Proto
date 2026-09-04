/**
 * Flags fields the LLM failed to extract from a client request, so callers
 * (the main StructAI app's UI) can surface "please clarify X" to the user
 * instead of silently defaulting or guessing a value — e.g. "absence de
 * maturité dans la requête".
 */

export interface MissingFieldFlag {
  field: string;
  label: string;
  message: string;
}

/** Loosely-typed shape of one quote's raw LLM extraction. */
export type RawExtraction = Record<string, any>;

/** Product families/types whose payoff depends on a PDI (protection) barrier. */
const BARRIER_DEPENDENT_PRODUCT_IDS = new Set([
  'AUTOCALL_CLASSIC',
  'PHOENIX_MEMORY',
  'AUTOCALL_AIRBAG',
  'REVERSE_CONVERTIBLE',
]);

export function detectMissingFields(extraction: RawExtraction): MissingFieldFlag[] {
  const flags: MissingFieldFlag[] = [];

  if (extraction.maturityMonths === undefined || extraction.maturityMonths === null || extraction.maturityMonths === '') {
    flags.push({
      field: 'maturityMonths',
      label: 'Maturité totale (mois)',
      message: 'Maturité non spécifiée dans la demande client.',
    });
  }

  if (!extraction.underlyingQueryOrTicker || String(extraction.underlyingQueryOrTicker).trim() === '') {
    flags.push({
      field: 'underlyingQueryOrTicker',
      label: 'Sous-jacent',
      message: "Aucun sous-jacent (ticker, nom d'entreprise ou thématique) identifiable dans la demande client.",
    });
  }

  if (!extraction.targetToSolve || String(extraction.targetToSolve).trim() === '') {
    flags.push({
      field: 'targetToSolve',
      label: 'Variable à résoudre',
      message: "Aucune variable cible (coupon, barrière, strike...) à résoudre n'a été identifiée dans la demande.",
    });
  }

  const productTypeId = String(extraction.productTypeId || '').toUpperCase();
  const needsBarrier = BARRIER_DEPENDENT_PRODUCT_IDS.has(productTypeId);
  if (needsBarrier && (extraction.pdiBarrierPct === undefined || extraction.pdiBarrierPct === null || extraction.pdiBarrierPct === '')) {
    flags.push({
      field: 'pdiBarrierPct',
      label: 'Barrière PDI / Protection (%)',
      message: `Barrière de protection (PDI) non spécifiée pour ce type de produit (${productTypeId || 'inconnu'}).`,
    });
  }

  return flags;
}
