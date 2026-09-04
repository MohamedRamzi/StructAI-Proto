import { ProductCatalogEntry } from '../types/structured-product';

export const PRODUCT_CATALOG: ProductCatalogEntry[] = [
  // 1. RENDEMENT (Yield Enhancement)
  {
    id: 'AUTOCALL_CLASSIC',
    name: 'Autocall Classic (Phoenix / Athena)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Produit à remboursement anticipé conditionnel (Autocall) avec coupon périodique et barrière de protection du capital à maturité (PDI).',
    keyFeatures: ['Rappel anticipé trimestriel/semestriel', 'Barrière PDI à maturité (e.g. 70%)', 'Départ Forward possible', 'Option Coupon Mémoire'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'forwardStartMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'pdiBarrierPct', 'memoryCoupon', 'stepDownPctPerPeriod'],
    exampleNaturalLanguageQueries: [
      'solve le coupon pour un autocall avec départ forward dans 3 mois. Rappel trimestriel. NC 1y. PDI 70% sur MC FP',
      'solve le coupon pour un autocall avec départ forward dans 3 mois. Rappel trimestriel. NC 1y. PDI 70% sur un stock européen dans le secteur du luxe qui price bien'
    ],
    payoffFormulaSummary: 'Si Spot(t) >= AutocallBarrier(t), rappel à 100% + coupons. Sinon à maturité, si Spot(T) >= PDI, 100% capital + coupons, sinon Spot(T)/Spot(0).'
  },
  {
    id: 'PHOENIX_MEMORY',
    name: 'Phoenix Memory (Coupon Mémoire)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall avec barrière de coupon intermédiaire indépendante du rappel, avec mise en mémoire des coupons non versés.',
    keyFeatures: ['Barrière de coupon détachée (ex: 75%)', 'Mémoire des coupons', 'Barrière Autocall (ex: 100%)', 'Protection PDI (ex: 60%)'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'couponBarrierPct', 'pdiBarrierPct', 'memoryCoupon'],
    exampleNaturalLanguageQueries: [
      'Phoenix Memory 3y sur Euro Stoxx 50. Rappel semestriel 100%, coupon barrier 75% avec mémoire, PDI 60% european. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Chaque période si Spot > CouponBarrier, verse coupon + coupons en mémoire. Si Spot > AutocallBarrier, remboursement anticipé.'
  },
  {
    id: 'REVERSE_CONVERTIBLE',
    name: 'Reverse Convertible / High Yield Note',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Produit de rendement garanti avec risque de livraison d\'actions si le sous-jacent clôture sous le strike à maturité.',
    keyFeatures: ['Coupon garanti élevé', 'Strike à 100%', 'Conversion en sous-jacent si PDI franchie', 'Maturité courte (1y-2y)'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'currency'],
    specificParamsSchema: ['strikePct', 'protectionBarrierPct', 'guaranteedCouponPct'],
    exampleNaturalLanguageQueries: [
      'Reverse Convertible 1 an sur TotalEnergies FP. Coupon garanti 8.5% p.a., protection 65%. Solve la barrière de protection.'
    ],
    payoffFormulaSummary: 'Verse toujours le coupon garanti. À maturité : 100% cash si Spot >= Barrier, sinon livraison physique d\'actions au Strike.'
  },
  {
    id: 'ATHENA_AIRBAG',
    name: 'Athena Airbag (Autocall Airbag)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall muni d\'un mécanisme Airbag atténuant la perte en capital en cas de franchissement de la barrière PDI.',
    keyFeatures: ['Protection Airbag à maturité', 'Pertes calculées depuis le niveau Airbag (ex: 70%) et non depuis 100%'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'observationFrequency', 'nonCallMonths'],
    specificParamsSchema: ['autocallBarrierPct', 'airbagBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Autocall Airbag 5 ans sur L\'Oréal. Rappel annuel, Airbag 70%. Solve le coupon annuel.'
    ],
    payoffFormulaSummary: 'Si PDI 70% est franchie, le remboursement est Spot(T) / Airbag(70%) au lieu de Spot(T)/100%.'
  },
  {
    id: 'STEP_DOWN_AUTOCALL',
    name: 'Autocall Step-Down (Rappel Dégressif)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall dont la barrière de rappel diminue à chaque période d\'observation (ex: 100% -> 95% -> 90% -> 85%).',
    keyFeatures: ['Barrière de rappel dégressive', 'Facilite le rappel en marché baissier ou latéral'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'observationFrequency', 'nonCallMonths'],
    specificParamsSchema: ['initialAutocallBarrierPct', 'stepDownPctPerPeriod', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Autocall Step-down 4 ans sur Sanofi, rappel trimestriel -2% par trimestre à partir de NC 1y, PDI 65%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Barrière Autocall(t) = Max(80%, 100% - stepDown * t). Rembourse 100% + coupons dès franchissement.'
  },
  {
    id: 'TWIN_WIN_NOTE',
    name: 'Twin-Win Certificate',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Permet d\'obtenir la hausse du sous-jacent ET la valeur absolue de la baisse tant que la barrière PDI n\'est pas touchée.',
    keyFeatures: ['Participation à la hausse', 'Gain en cas de baisse modérée', 'Risque en capital sous la barrière'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'currency'],
    specificParamsSchema: ['lowerBarrierPct', 'upperCapPct'],
    exampleNaturalLanguageQueries: [
      'Twin-Win 3 ans sur ASML NA, barrière basse 60%. Solve la participation à la hausse.'
    ],
    payoffFormulaSummary: 'Si Spot(T) > Spot(0) -> 100% + Hausse. Si Barrier < Spot(T) < Spot(0) -> 100% + |Baisse|. Si Spot(T) < Barrier -> Spot(T)/Spot(0).'
  },

  // 2. PROTECTION DU CAPITAL (Capital Protection)
  {
    id: 'CAPITAL_GUARANTEED_NOTE',
    name: 'Capital Garanti 100% (Equity-Linked Note)',
    family: 'CAPITAL_PROTECTION',
    frenchDescription: 'Garantie intégrale du capital à la maturité associée à une participation à la hausse du sous-jacent.',
    keyFeatures: ['Garantie 100% du capital à maturité', 'Taux zéro / spreads d\'émission', 'Participation à la performance'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'currency', 'fundingSpreadBps'],
    specificParamsSchema: ['capitalProtectionLevelPct', 'participationRatePct', 'capLevelPct'],
    exampleNaturalLanguageQueries: [
      'Solve la participation pour une note Capital Garanti 100% à 5 ans sur Euro Stoxx 50 avec cap à 140%.'
    ],
    payoffFormulaSummary: 'Remboursement = 100% + Participation * Min(Cap, Max(0, Performance)).'
  },
  {
    id: 'CALLABLE_ACCUMULATOR_NOTE',
    name: 'Capital Protégé 90% avec Capped Call',
    family: 'CAPITAL_PROTECTION',
    frenchDescription: 'Protection partielle du capital (90% ou 95%) permettant de booster le taux de participation à la hausse.',
    keyFeatures: ['Protection 90% ou 95%', 'Participation boostée', 'Cap optionnel'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'currency'],
    specificParamsSchema: ['capitalProtectionLevelPct', 'participationRatePct'],
    exampleNaturalLanguageQueries: [
      'Note Capital Protégé 95% 4 ans sur Kering, solve le taux de participation.'
    ],
    payoffFormulaSummary: 'Remboursement = Max(95%, 100% + Participation * Perf).'
  },

  // 3. PARTICIPATION
  {
    id: 'OUTPERFORMANCE_BONUS',
    name: 'Bonus Certificate / Outperformance',
    family: 'PARTICIPATION',
    frenchDescription: 'Garantit un montant bonus à maturité si la barrière n\'a pas été désactivée, sinon participation directe 1:1 au sous-jacent.',
    keyFeatures: ['Niveau Bonus garanti conditionnel', 'Barrière désactivante (Barrier)'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'currency'],
    specificParamsSchema: ['bonusLevelPct', 'barrierLevelPct'],
    exampleNaturalLanguageQueries: [
      'Bonus Certificate 2 ans sur Hermès RMS FP, barrière 70%. Solve le niveau Bonus.'
    ],
    payoffFormulaSummary: 'Si barrière non franchie pendant la vie : Max(Bonus, Performance). Si franchie : Performance directe.'
  },

  // 4. CRÉDIT ET HYBRIDE
  {
    id: 'CREDIT_LINKED_NOTE',
    name: 'Credit Linked Note (CLN)',
    family: 'CREDIT_HYBRID',
    frenchDescription: 'Note dont le remboursement dépend de l\'absence d\'événement de crédit sur une entité de référence (ex: Banque, État, Entreprise).',
    keyFeatures: ['Spread de crédit additionnel', 'Événement de crédit (Faillite, Défaut)'],
    commonParamsSchema: ['maturityMonths', 'currency'],
    specificParamsSchema: ['referenceEntity', 'recoveryRatePct', 'creditEventTypes'],
    exampleNaturalLanguageQueries: [
      'CLN 5 ans sur entité de référence Deutsche Bank. Solve le coupon trimestriel p.a.'
    ],
    payoffFormulaSummary: 'Si aucun événement de crédit : 100% + coupons. Si événement de crédit : Taux de recouvrement (Recovery Rate).'
  },

  // CATALOG REPRESENTING 100+ STRUCTURED PRODUCT EXTENSIONS (Category taxonomy preview)
  {
    id: 'MULTI_BARRIER_AUTOCALL',
    name: 'Multi-Barrier Worst-Of Autocall',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall panier Worst-Of avec barrières distinctes pour chaque sous-jacent ou barrières multiniveaux.',
    keyFeatures: ['Panier Worst-Of', 'Multiples barrières de coupon & PDI'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency'],
    specificParamsSchema: ['autocallBarrierPct', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Autocall Worst-Of sur panier Luxe (MC FP, KER FP, RMS FP). Solve le coupon pour PDI 65%.'
    ],
    payoffFormulaSummary: 'Performance basée sur le pire sous-jacent du panier (Worst-Of).'
  },

  // 5. FAMILLE YETI PHOENIX AUTOCALL (9 VARIANTES INSTITUTIONNELLES AUTOCALL.MD)
  {
    id: 'AUTOCALL_PHOENIX_ASIAN_PDI',
    name: 'Phoenix Asian PDI (ID: 10449)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Structure auto-callable sur panier avec moyennation asiatique (Asian In / Out) et Put Down-and-In (PDI) in-fine. Coupons Phoenix versés en cas d\'autocall.',
    keyFeatures: ['Moyennation Asiatique (Asian In/Out)', 'Put Down-and-In (PDI) in-fine', 'Coupons Phoenix conditionnels'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'forwardStartMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'pdiBarrierPct', 'asianInObservationDatesCount', 'memoryCoupon'],
    exampleNaturalLanguageQueries: [
      'Phoenix Asian PDI 3 ans sur panier Luxe avec moyenne initiale 5 dates. Rappel semestriel 100%, PDI 65%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Performance basée sur la moyenne asiatique des prix. Si AsianPerf(t) >= AutocallBarrier, rappel 100% + Phoenix coupon. À maturité si AsianPerf(T) < PDI, perte en capital.'
  },
  {
    id: 'AUTOCALL_VANILLA',
    name: 'Vanilla Autocall (ID: 10488)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Structure auto-callable standard basée sur la performance d\'une seule action avec option Put Down-and-In in-fine.',
    keyFeatures: ['Mono-action', 'Rappel automatique périodique', 'Barrière PDI discrète à l\'échéance'],
    commonParamsSchema: ['underlyings', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'pdiBarrierPct', 'memoryCoupon'],
    exampleNaturalLanguageQueries: [
      'Vanilla Autocall 2 ans sur LVMH (MC FP). Rappel trimestriel 100%, PDI 70% européen. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Si Spot(t) >= AutocallBarrier, remboursement 100% + coupons. Sinon à maturité, 100% si Spot(T) >= PDI, sinon Spot(T)/Spot(0).'
  },
  {
    id: 'AUTOCALL_CALL_CUSTOM_BASKET',
    name: 'Call On Custom Basket (ID: 10627)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Produit basé sur la moins bonne performance (Worst-Of) d\'un panier sur-mesure, avec option digitale in-fine et taux garanti.',
    keyFeatures: ['Panier sur-mesure Worst-Of', 'Option digitale in-fine', 'Taux de rendement minimum garanti'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'pdiBarrierPct', 'guaranteedCouponPct', 'digitalPayoutPct'],
    exampleNaturalLanguageQueries: [
      'Call On Custom Basket 3 ans sur Worst-Of LVMH, Kering, Hermès. Taux garanti 3% p.a., digitale 10% si Worst-Of > 70%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Coupons garantis + bonus digital in-fine si la pire performance du panier sur-mesure dépasse le seuil fixé.'
  },
  {
    id: 'AUTOCALL_RANGE_ACCRUAL_MULTI',
    name: 'Multi Range-Accrual (ID: 10740)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall sur performances Worst-Of / Rainbow avec option PDI discrète et coupons Range-Accrual (prorata des jours dans un corridor).',
    keyFeatures: ['Coupons Range-Accrual au jour le jour', 'Performance Worst-Of ou Rainbow', 'PDI discrète in-fine'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'rangeAccrualLowerBarrierPct', 'rangeAccrualUpperBarrierPct', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Multi Range-Accrual 3 ans sur panier Euro Stoxx 50. Corridor 75%-115%, PDI 60%. Solve le coupon annuel.'
    ],
    payoffFormulaSummary: 'Coupon = CouponMax * (Nbr jours dans corridor [Lower, Upper] / Nbr total de jours). Rappel anticipé si Autocall franchi.'
  },
  {
    id: 'AUTOCALL_ASIAN_CAP_FLOOR',
    name: 'Capped/Floored Asian (ID: 10401)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Option asiatique avec barrière PDI discrète in-fine, intégrant des plafonds (Caps) et planchers (Floors) globaux et individuels sur panier.',
    keyFeatures: ['Moyennation asiatique', 'Cap et Floor individuels & globaux', 'PDI discrète'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'capPct', 'floorPct', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Capped Floored Asian Autocall 4 ans sur TotalEnergies & Sanofi. Cap 120%, Floor 80%, PDI 65%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Performances individuelles et globale bornées dans [Floor, Cap]. Remboursement 100% si PDI non franchie.'
  },
  {
    id: 'AUTOCALL_STRATEGIES',
    name: 'Strategies Yeti (ID: 10702)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Structure Autocall Worst-Of avec clause mémoire payée si la pire performance dépasse la barrière Yeti, coupons Phoenix et Put PDI asiatique.',
    keyFeatures: ['Barrière Yeti distincte', 'Coupons Phoenix', 'Put PDI sur performances asiatiques'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'yetiBarrierPct', 'pdiBarrierPct', 'memoryCoupon'],
    exampleNaturalLanguageQueries: [
      'Strategies Yeti Autocall 3 ans sur Worst-Of Luxe. Barrière Yeti 80%, Autocall 100%, PDI 65%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Si Worst-Of > YetiBarrier, détachement d\'un coupon Yeti à mémoire. Si Worst-Of > Autocall, rappel 100%.'
  },
  {
    id: 'AUTOCALL_STRATEGIES_DIGITS2',
    name: 'Strategies Digits (ID: 10756)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Variante de Strategies avec barrières digitalisées et lissage numérique à double corridor (dual multi-corridor digit smoothing).',
    keyFeatures: ['Barrières digitalisées', 'Lissage numérique dual-corridor', 'Atténuation des effets de bord'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'yetiBarrierPct', 'digitSmoothingBandPct', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Strategies Digits 3 ans sur panier bancaire. Lissage digital 2%, barrière Yeti 75%, PDI 60%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Paiement digital lissé autour des seuils de barrière pour éviter les effets de falaise à la constatation.'
  },
  {
    id: 'AUTOCALL_TARGET_COUPON_REDEMPTION',
    name: 'Target Coupon Redemption (ID: 10743)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Autocall sur performance Rainbow avec PDI in-fine. Le rappel anticipé se déclenche dès que la somme des coupons Yeti distribués atteint la cible.',
    keyFeatures: ['Cumul cible des coupons (Target Coupon)', 'Performance Rainbow', 'Rappel automatique sur cible atteinte'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'currency'],
    specificParamsSchema: ['targetCouponSumPct', 'yetiBarrierPct', 'pdiBarrierPct'],
    exampleNaturalLanguageQueries: [
      'Target Coupon Redemption 5 ans sur Rainbow 3 actions. Target cumulé 25%, PDI 60%. Solve le coupon trimestriel.'
    ],
    payoffFormulaSummary: 'Si Sum(CouponsDistribues) >= TargetCoupon, le produit est immédiatement rappelé par anticipation à 100%.'
  },
  {
    id: 'AUTOCALL_YETI_PHOENIX_STRATEGIES',
    name: 'Yeti Phoenix Strategies (ID: 10762)',
    family: 'YIELD_ENHANCEMENT',
    frenchDescription: 'Structure Autocall multi-actifs basée sur une fonction mathématique des performances du panier, combinant coupons Yeti mémoire et coupons Phoenix.',
    keyFeatures: ['Combinaison Yeti + Phoenix', 'Formules sur panier multi-actifs', 'Effet Zenith optionnel'],
    commonParamsSchema: ['underlyings', 'basketType', 'maturityMonths', 'observationFrequency', 'nonCallMonths', 'currency'],
    specificParamsSchema: ['autocallBarrierPct', 'yetiBarrierPct', 'starEffectBarrierPct', 'pdiBarrierPct', 'memoryCoupon'],
    exampleNaturalLanguageQueries: [
      'Yeti Phoenix Strategies 4 ans sur Basket 4 valeurs. Barrière Star-Effect 110%, Yeti 75%, PDI 60%. Solve le coupon.'
    ],
    payoffFormulaSummary: 'Combinaison dynamique des coupons Yeti à mémoire et Phoenix. Si Star-Effect > 110%, désactivation de la barrière PDI.'
  }
];
