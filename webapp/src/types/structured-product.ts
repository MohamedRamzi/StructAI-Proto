export type ProductFamily = 
  | 'YIELD_ENHANCEMENT'      // Rendement (Autocall, Phoenix, Reverse Convertible)
  | 'CAPITAL_PROTECTION'     // Capital Garanti / Protégé
  | 'PARTICIPATION'          // Participation / Outperformance
  | 'CREDIT_HYBRID'          // Crédit / Taux
  | 'LEVERAGE';              // Levier / Warrant / Turbo

export interface UnderlyingAsset {
  ticker: string;
  isin?: string;
  name: string;
  sector: string;
  region: string;
  spotPrice: number;
  currency: string;
  impliedVol3m: number;      // e.g. 0.28 = 28%
  dividendYield: number;     // e.g. 0.025 = 2.5%
  repoRate: number;
  volatilityScore: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXCELLENT_FOR_AUTOCALL'; // "price bien"
  reasoningForRecommendation?: string;
}

export type SolverTargetVariable = 
  | 'COUPON_RATE'            // Solve coupon % p.a.
  | 'STRIKE_LEVEL'           // Solve Strike %
  | 'PDI_BARRIER'            // Solve PDI / Put Down-and-In barrier %
  | 'CALL_BARRIER'           // Solve Autocall barrier %
  | 'CAPITAL_PROTECTION_PCT';// Solve protected capital %

export interface CommonProductParameters {
  underlyings: UnderlyingAsset[];
  basketType: 'SINGLE' | 'WORST_OF' | 'BEST_OF' | 'BASKET_AVERAGE';
  maturityMonths?: number | null;            // e.g. 36 (3 years) or null/undefined if unspecified
  forwardStartMonths: number;        // e.g. 3 (départ forward 3m) — always resolved to a month count for pricing, derived from forwardStartDate when the client gave an absolute date instead
  forwardStartDate?: string | null;  // ISO YYYY-MM-DD when the client specified an absolute forward-start / first-fixing date (e.g. "première fixation le 01/12/2026") rather than a relative duration
  observationFrequency: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
  nonCallMonths: number;             // e.g. 12 (NC 1y)
  currency: string;                  // EUR, USD, etc.
  denomination: number;              // 1000 EUR
  issuerCreditRating: string;        // AA-, A+, etc.
  fundingSpreadBps: number;          // e.g. 45 bps
}

export type ProductTypeId = 
  | 'AUTOCALL_CLASSIC'
  | 'PHOENIX_MEMORY'
  | 'REVERSE_CONVERTIBLE'
  | 'CAPITAL_PROTECTION'
  | 'ATHENA_AIRBAG'
  | 'STEP_DOWN_AUTOCALL'
  | 'TWIN_WIN_NOTE'
  | 'AUTOCALL_PHOENIX_ASIAN_PDI'
  | 'AUTOCALL_VANILLA'
  | 'AUTOCALL_CALL_CUSTOM_BASKET'
  | 'AUTOCALL_RANGE_ACCRUAL_MULTI'
  | 'AUTOCALL_ASIAN_CAP_FLOOR'
  | 'AUTOCALL_STRATEGIES'
  | 'AUTOCALL_STRATEGIES_DIGITS2'
  | 'AUTOCALL_TARGET_COUPON_REDEMPTION'
  | 'AUTOCALL_YETI_PHOENIX_STRATEGIES'
  | string;

export interface AutocallSpecificParameters {
  autocallBarrierPct: number;        // e.g. 100% (or step-down e.g. 100% -> 95% -> 90%)
  stepDownPctPerPeriod?: number;     // e.g. 2% stepdown per period
  pdiBarrierPct: number;             // e.g. 70% (Protection Downside Interactive / Put Down-and-In)
  pdiType: 'EUROPEAN' | 'AMERICAN' | 'DAILY'; // European = maturity only
  memoryCoupon: boolean;             // Coupon mémoire
  airbagProtectionPct?: number;      // e.g. Airbag at 70%
  lockInBarrierPct?: number;         // Lock-in level
}

export interface YetiPhoenixSpecificParameters {
  autocallBarrierPct?: number;        // Barrière Autocall
  yetiBarrierPct?: number;            // Barrière Yeti pour déclenchement coupon Yeti
  yetiBonusPct?: number;              // Coupon bonus Yeti garanti
  starEffectBarrierPct?: number;      // Barrière Star-Effect (désactive le Knock-In si franchie)
  asianInObservationDatesCount?: number; // Nombre de dates d'observation Asian In
  capPct?: number;                    // Plafond (Cap) de performance
  floorPct?: number;                  // Plancher (Floor) de performance
  targetCouponSumPct?: number;        // Seuil de somme de coupons pour Target Coupon Redemption
  rangeAccrualLowerBarrierPct?: number; // Seuil bas corridor Range Accrual
  rangeAccrualUpperBarrierPct?: number; // Seuil haut corridor Range Accrual
  zenithLeverageGearing?: number;     // Levier Zenith (gearing)
  memoryCoupon?: boolean;
  pdiBarrierPct?: number;
  pdiType?: 'EUROPEAN' | 'AMERICAN' | 'DAILY';
}

export interface ReverseConvertibleSpecificParameters {
  strikePct: number;                 // e.g. 100%
  guaranteedCouponPct: number;       // e.g. 8.5% p.a.
  protectionBarrierPct: number;      // e.g. 60%
}

export interface CapitalProtectedSpecificParameters {
  capitalProtectionLevelPct: number; // e.g. 100%
  participationRatePct: number;      // e.g. 80%
  capLevelPct?: number;              // Capped participation e.g. 130%
}

export interface CreditLinkedSpecificParameters {
  referenceEntity: string;           // e.g. Deutsche Bank, Air France
  recoveryRatePct: number;           // e.g. 40%
  creditEventTypes: string[];        // Bankruptcy, Failure to Pay, Restructuring
}

export interface ExtractedProductSpec {
  rawQuery: string;
  productTypeId: string;             // e.g. "AUTOCALL_CLASSIC", "PHOENIX_MEMORY"
  productTypeName: string;           // e.g. "Autocall Classic Forward Start"
  productFamily: ProductFamily;
  targetToSolve: SolverTargetVariable;
  
  commonParams: CommonProductParameters;
  specificParams: AutocallSpecificParameters | ReverseConvertibleSpecificParameters | CapitalProtectedSpecificParameters | CreditLinkedSpecificParameters | Record<string, any>;
  
  // Extraction metadata & AI Reasoning
  confidenceScore: number;           // 0 to 1
  extractedTokens: {
    phrase: string;
    parameterName: string;
    parsedValue: any;
  }[];
  missingRequiredParams: string[];
  assumedDefaults: {
    param: string;
    value: any;
    reason: string;
  }[];
  aiExplanation: string;
  underlyingSelectionNote?: string;
}

export interface PricingResult {
  solvedTarget: {
    variable: SolverTargetVariable;
    solvedValueNumber: number;      // e.g. 8.85% p.a. for coupon
    formattedValue: string;        // "8.85% p.a."
  };
  theoreticalValuePct: number;     // e.g. 100.0% (at par)
  autocallProbabilityPct: number;  // e.g. 78.4%
  expectedMaturityYears: number;   // e.g. 1.8 years
  pdiBreachProbabilityPct: number; // e.g. 14.2%
  sensitivities: {
    delta: number;
    vega: number;
    theta: number;
    rho: number;
  };
  payoffProfile: {
    spotLevelPct: number;          // 50% to 150%
    redemptionPct: number;         // 0% to 130%
    isAutocalled: boolean;
    isPdiBreached: boolean;
  }[];
  monteCarloPaths: {
    timeMonths: number[];
    paths: number[][];             // array of spot trajectories (% of initial spot)
  };
  sensitivityMatrix: {
    pdiBarrier: number;
    volatility: number;
    solvedCoupon: number;
  }[];
}

export interface ProductCatalogEntry {
  id: string;
  name: string;
  family: ProductFamily;
  frenchDescription: string;
  keyFeatures: string[];
  commonParamsSchema: string[];
  specificParamsSchema: string[];
  exampleNaturalLanguageQueries: string[];
  payoffFormulaSummary: string;
}
