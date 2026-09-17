import { ExtractedProductSpec, PricingResult, AutocallSpecificParameters } from '../types/structured-product';

export interface TermsheetTemplate {
  id: string;
  name: string;
  issuerLogo: string;
  issuerName: string;
  templateFormat: 'MARKDOWN' | 'HTML';
  content: string;
}

export const DEFAULT_TERMSHEET_TEMPLATES: TermsheetTemplate[] = [
  {
    id: 'natixis_cib_standard',
    name: 'Natixis Corporate & Investment Banking (CIB)',
    issuerLogo: 'NATIXIS CIB',
    issuerName: 'Natixis Structured Issuance SA (Garant : Natixis SA)',
    templateFormat: 'MARKDOWN',
    content: `# NATIXIS CORPORATE & INVESTMENT BANKING - TERMSHEET

**Émetteur** : {{ISSUER_NAME}}
**Garant** : Natixis S.A. (Groupe BPCE - Notation Crédit: A+ / A1)
**Programme** : Euro Medium Term Note (EMTN)
**Code ISIN de la Tranche** : {{ISIN_CODE}}
**Nominal Unitaire** : {{DENOMINATION}} {{CURRENCY}}

---

### 1. Description Synthétique du Produit Structuré

Le produit **{{PRODUCT_NAME}}** est un titre de créance présentant un risque de perte en capital partielle ou totale en cours de vie et à l'échéance. Il a pour objectif de verser un coupon annuel conditionnel de **{{SOLVED_COUPON}} %** calculé sur la valeur nominale.

- **Sous-Jacent Référent** : {{UNDERLYING_NAME}} (Ticker Bloomberg : **{{UNDERLYING_TICKER}}**)
- **Cours de Référence Initial ($S_0$)** : {{SPOT_PRICE}} {{CURRENCY}}
- **Volatilité Implicite 3M** : {{IMPLIED_VOL}}
- **Type de Panier** : {{BASKET_TYPE}}

---

### 2. Calendrier & Mécanismes de Remboursement Natixis CIB

- **Durée de Vie Maximale** : {{MATURITY_MONTHS}} mois ({{MATURITY_YEARS}} ans)
- **Départ Différé (Forward Start)** : {{FORWARD_START}} mois
- **Fréquence de Constatation** : {{OBSERVATION_FREQ}}
- **Période de Non-Rappel Initial (Non-Call)** : {{NON_CALL}} mois
- **Seuil d'Autocall (Rappel Anticipé)** : {{AUTOCALL_BARRIER}} du cours initial
- **Seuil de Protection du Capital à l'Échéance (PDI)** : {{PDI_BARRIER}} (Type: {{PDI_TYPE}})

---

### 3. Métriques Quantitatives & Solvabilité du Coupon (Moteur StructAI)

| Indicateur Financier | Valeur Calculée |
| --- | --- |
| **Taux de Coupon Annuel Solvé** | **{{SOLVED_COUPON}} % p.a.** (Mémoire: {{MEMORY_COUPON}}) |
| **Valeur Théorique de Structuration (Fair Value)** | **{{FAIR_VALUE}} %** |
| **Spread de Refinancement Natixis (Funding Spread)** | {{FUNDING_SPREAD}} bps |
| **Probabilité Estimée de Rappel Anticipé** | {{AUTOCALL_PROB}} % |
| **Probabilité Estimée de Perte en Capital** | {{PDI_PROB}} % |

---

### 4. Cadre Réglementaire & Mentions Légales Natixis

{{DISCLAIMER}}
`,
  },
  {
    id: 'bnp_cib_standard',
    name: 'BNP Paribas CIB - Termsheet Institutionnelle',
    issuerLogo: 'BNP PARIBAS CIB',
    issuerName: 'BNP Paribas Arbitrage Issuance B.V.',
    templateFormat: 'MARKDOWN',
    content: `# TERM SHEET DÉFINITIF - {{PRODUCT_NAME}}

**Émetteur** : {{ISSUER_NAME}}
**Garant** : {{ISSUER_NAME}} (Notation Credit: {{ISSUER_RATING}})
**Code ISIN de la Tranche** : {{ISIN_CODE}}
**Montant Nominal Unitaire** : {{DENOMINATION}} {{CURRENCY}}

---

### 1. Caractéristiques du Sous-Jacent

- **Sous-jacent principal** : {{UNDERLYING_NAME}} (Ticker Bloomberg: **{{UNDERLYING_TICKER}}**)
- **Niveau de Référence Initial ($S_0$)** : {{SPOT_PRICE}} {{CURRENCY}}
- **Volatilité Implicite de Marché (3M)** : {{IMPLIED_VOL}}
- **Type de Panier** : {{BASKET_TYPE}}

---

### 2. Mécanisme de Payoff & Remboursement

- **Durée de Vie Maximale** : {{MATURITY_MONTHS}} mois ({{MATURITY_YEARS}} ans)
- **Départ Forward** : {{FORWARD_START}} mois
- **Fréquence d'Observation** : {{OBSERVATION_FREQ}}
- **Période Non-Call (NC)** : {{NON_CALL}} mois
- **Seuil de Rappel Anticipé (Autocall)** : {{AUTOCALL_BARRIER}} du Niveau Initial
- **Barrière de Protection du Capital (PDI)** : {{PDI_BARRIER}} (Type: {{PDI_TYPE}})

---

### 3. Conditions Financières Solvées par le Moteur IA & Quant

- **Cible de Structuration** : {{TARGET_SOLVED}}
- **Taux de Coupon Annuel Solvé** : **{{SOLVED_COUPON}} % p.a.** (Mémoire: {{MEMORY_COUPON}})
- **Valeur Théorique de la Structure (Fair Value)** : **{{FAIR_VALUE}} %**
- **Marge Émetteur Intégrée** : {{FUNDING_SPREAD}} bps
- **Probabilité Monte Carlo de Rappel Anticipé** : {{AUTOCALL_PROB}} %
- **Probabilité Monte Carlo de Perte en Capital (PDI)** : {{PDI_PROB}} %

---

### 4. Avertissement Légal & Risque

{{DISCLAIMER}}
`,
  },
  {
    id: 'sg_cib_phoenix',
    name: 'Société Générale CIB - Modèle Private Banking',
    issuerLogo: 'SOCIETE GENERALE CIB',
    issuerName: 'SG Issuer (Garantie Société Générale)',
    templateFormat: 'MARKDOWN',
    content: `# CONDICIONES DEFINITIVAS / TERMSHEET - {{PRODUCT_NAME}}

**Format de Distribution** : Banque Privée & Gestion de Fortune
**Émetteur** : {{ISSUER_NAME}}
**Devise** : {{CURRENCY}} | **Nominal** : {{DENOMINATION}} {{CURRENCY}}

---

### Résumé Exécutif de la Structure

Le produit **{{PRODUCT_NAME}}** offre un rendement conditionnel de **{{SOLVED_COUPON}} % par an**, payable {{OBSERVATION_FREQ}} si le sous-jacent **{{UNDERLYING_NAME}}** ({{UNDERLYING_TICKER}}) se situe au-dessus de la barrière de coupon de {{PDI_BARRIER}}.

- **Rappel Automatique (Autocall)** : Dès le {{NON_CALL}}ème mois, si {{UNDERLYING_TICKER}} >= {{AUTOCALL_BARRIER}}, le produit est remboursé à 100% + Coupons.
- **Protection du Capital** : Le capital est garanti à l'échéance de {{MATURITY_MONTHS}} mois tant que le sous-jacent ne chute pas de plus de {{PDI_BARRIER}}.

---

### Indicateurs Clés Quantitatifs

| Paramètre | Valeur Solvée |
| --- | --- |
| Coupon Solvé p.a. | **{{SOLVED_COUPON}} %** |
| Prix d'Émission | 100.00 % |
| Fair Value Quant | {{FAIR_VALUE}} % |
| Proba Rappel Avant Échéance | {{AUTOCALL_PROB}} % |
| Proba Perte Capital | {{PDI_PROB}} % |

---

### Mentions Obligatoires MIFID II

{{DISCLAIMER}}
`,
  },
  {
    id: 'kid_dici_standard',
    name: 'KID / DICI Réglementaire Européen (MIFID II)',
    issuerLogo: 'KID MIFID II',
    issuerName: 'Émetteur A+ Européen',
    templateFormat: 'MARKDOWN',
    content: `# DOCUMENT D'INFORMATIONS CLÉS (DIC / KID)

**Produit** : {{PRODUCT_NAME}} sur {{UNDERLYING_NAME}}
**ISIN** : {{ISIN_CODE}}
**Initié par** : {{ISSUER_NAME}}
**Date de Rédaction** : {{DATE_TODAY}}

---

### En quoi consiste ce produit ?

Ce produit est un instrument financier complexe de type **{{PRODUCT_FAMILY}}**. Il vise à verser un coupon périodique de **{{SOLVED_COUPON}} % p.a.** en contrepartie d'un risque de perte en capital si le sous-jacent baisse au-delà de la barrière de protection de {{PDI_BARRIER}}.

### Scénarios de Performance à l'Échéance ({{MATURITY_MONTHS}} mois)

1. **Scénario Favorable (Rappel Anticipé)** : Rendement annuel de {{SOLVED_COUPON}} % + Remboursement de 100% du nominal. (Probabilité estimée: {{AUTOCALL_PROB}} %).
2. **Scénario Modéré** : Préservation du capital (100% du nominal) si le sous-jacent clôture au-dessus de {{PDI_BARRIER}}.
3. **Scénario Défavorable** : Perte en capital proportionnelle à la baisse du sous-jacent. (Probabilité estimée: {{PDI_PROB}} %).

---

{{DISCLAIMER}}
`,
  },
];

/**
 * Replaces placeholders in template string with spec and pricing data
 */
export function renderTermsheetTemplate(
  templateContent: string,
  spec: ExtractedProductSpec,
  pricing: PricingResult,
  customIssuerName?: string,
  customDisclaimer?: string
): string {
  const u = spec.commonParams?.underlyings?.[0];
  const dateStr = new Date().toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const specific = (spec.specificParams || {}) as AutocallSpecificParameters;

  const solvedCouponVal = pricing.solvedTarget?.solvedValueNumber ?? 8.85;
  const fairValueVal = pricing.theoreticalValuePct ?? 100.0;
  const autocallProbVal = (pricing.autocallProbabilityPct ?? 0.784) * 100;
  const pdiProbVal = (pricing.pdiBreachProbabilityPct ?? 0.142) * 100;

  const replacements: Record<string, string> = {
    '{{PRODUCT_NAME}}': spec.productTypeName || 'Autocall Classic',
    '{{PRODUCT_TYPE}}': spec.productTypeId || 'AUTOCALL',
    '{{PRODUCT_FAMILY}}': spec.productFamily || 'YIELD_ENHANCEMENT',
    '{{ISSUER_NAME}}': customIssuerName || 'BNP Paribas Arbitrage Issuance B.V.',
    '{{ISSUER_RATING}}': spec.commonParams?.issuerCreditRating || 'A+',
    '{{ISIN_CODE}}': u?.isin || 'XS2394810293',
    '{{DENOMINATION}}': (spec.commonParams?.denomination || 1000).toLocaleString('fr-FR'),
    '{{CURRENCY}}': spec.commonParams?.currency || 'EUR',
    '{{UNDERLYING_NAME}}': u?.name || 'LVMH Moët Hennessy',
    '{{UNDERLYING_TICKER}}': u?.ticker || 'MC FP',
    '{{SPOT_PRICE}}': u?.spotPrice ? u.spotPrice.toFixed(2) : '685.40',
    '{{IMPLIED_VOL}}': u?.impliedVol3m ? `${(u.impliedVol3m * 100).toFixed(1)} %` : '28.5 %',
    '{{BASKET_TYPE}}': spec.commonParams?.basketType || 'SINGLE',
    '{{MATURITY_MONTHS}}': String(spec.commonParams?.maturityMonths || 36),
    '{{MATURITY_YEARS}}': ((spec.commonParams?.maturityMonths || 36) / 12).toFixed(1),
    '{{FORWARD_START}}': String(spec.commonParams?.forwardStartMonths || 0),
    '{{OBSERVATION_FREQ}}': spec.commonParams?.observationFrequency || 'QUARTERLY',
    '{{NON_CALL}}': String(spec.commonParams?.nonCallMonths || 12),
    '{{AUTOCALL_BARRIER}}': `${specific.autocallBarrierPct ?? 100} %`,
    '{{PDI_BARRIER}}': `${specific.pdiBarrierPct ?? 70} %`,
    '{{PDI_TYPE}}': specific.pdiType || 'EUROPEAN',
    '{{TARGET_SOLVED}}': spec.targetToSolve || 'COUPON_RATE',
    '{{SOLVED_COUPON}}': solvedCouponVal.toFixed(2),
    '{{MEMORY_COUPON}}': specific.memoryCoupon ? 'OUI (Mémoire)' : 'NON',
    '{{FAIR_VALUE}}': fairValueVal.toFixed(2),
    '{{FUNDING_SPREAD}}': String(spec.commonParams?.fundingSpreadBps || 45),
    '{{AUTOCALL_PROB}}': autocallProbVal.toFixed(1),
    '{{PDI_PROB}}': pdiProbVal.toFixed(1),
    '{{DATE_TODAY}}': dateStr,
    '{{DISCLAIMER}}':
      customDisclaimer ||
      `*Avertissement de Risque Institutionnel : Ce document est une simulation indicative générée par la plateforme StructAI. Il ne constitue ni une offre de souscription, ni un conseil en investissement au sens de la directive MIFID II. Les performances passées et les simulations Monte Carlo ne préjugent pas des résultats futurs.*`,
  };

  let rendered = templateContent;
  Object.entries(replacements).forEach(([key, val]) => {
    rendered = rendered.replaceAll(key, val);
  });

  return rendered;
}
