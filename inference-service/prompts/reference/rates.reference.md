---
key: rates
name: Taux & FX — TARF / TARN / Range Accrual / CMS / Swaps
kind: domain
assetClass: RATES
productFamily:
scopeDescription: Produits structurés de taux et de change — TARF/TARN, Range Accrual (simple et dual), Formosa, Autocall taux, CMS Spread (steepener/flattener), Snowball, PRDC, FX Linked Note, IRS structuré (cap/floor/collar). Schéma de sortie riche par type de produit.
---
# Typologies de Produits Structurés Taux / FX

> **⚠️ ARCHIVE — non chargé par le service.** Base du pré-prompt d'extraction
> `rates`, désormais réduit à sa version compacte dans
> `inference-service/prompts/rates.md` (le seul fichier seedé — `prompts/reference/`
> n'est pas parcouru). Gardé comme référence métier ; le `key:` du frontmatter est sans effet.

## Introduction

Les produits structurés **Taux et FX** couvrent un large spectre de solutions de couverture et d'investissement. Ils intègrent des optionnalités sur les taux d'intérêt (fixes, variables, CMS) et/ou sur les paires de devises. Ces produits sont principalement distribués à des entreprises (couverture de change ou de taux), des investisseurs institutionnels et des banques privées. Leur complexité varie d'une simple option de change à des structures accumulatives multi-barrières.

---

## 1. TARF — Target Accrual Redemption Forward

### Description

Le **TARF** (Target Accrual Redemption Forward) est un produit de couverture de change (FX) ou de taux structuré autour d'un mécanisme d'**accumulation de gains**. Le produit se termine automatiquement (**knock-out**) lorsque le gain cumulé du client atteint une cible prédéfinie (**Target**). C'est l'un des produits FX structurés les plus utilisés pour les entreprises exportatrices/importatrices.

**Caractéristiques principales :**

- **Sous-jacent :** Paire de devises (ex : EUR/USD, USD/CNH) ou taux
- **Maturité :** 1 à 3 ans, avec observations périodiques (hebdomadaires, mensuelles)
- **Target (Cible) :** Gain cumulé maximum autorisé (ex : 200 pips, 2%)
- **Strike Forward :** Prix d'exercice amélioré par rapport au forward vanille
- **Levier (Leverage) :** Multiplicateur appliqué en cas de fixing défavorable (ex : ×2)
- **Knock-Out :** Le produit expire dès que le Target est atteint
- **Risque client :** Illimité en cas de fixing très défavorable avec levier

**Flux à chaque date de fixing :**

| Scénario | Condition | Flux |
|---|---|---|
| Favorable (gain) | Fixing ≥ Strike (pour exportateur) | Client vend devise à Strike amélioré ; gain = (Fixing - Strike) × Notionnel |
| Défavorable (perte) | Fixing < Strike | Client vend devise à Strike × Levier (exposition augmentée) |
| Knock-Out | Gain cumulé ≥ Target | Produit terminé automatiquement ; aucun flux ultérieur |
| Maturité atteinte | Target non atteint | Dernière date de fixing réglée normalement |

**Risques :**
- Perte potentiellement illimitée si levier élevé et marché très défavorable
- Produit asymétrique : gain plafonné, perte non plafonnée

### Template JSON

```json
{
  "product_type": "TARF",
  "variant": "Classic",
  "underlying": {
    "type": "FX",
    "pair": "EUR/USD",
    "bloomberg_ticker": "EURUSD Curncy"
  },
  "trade_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "currency_sold": "EUR",
  "currency_bought": "USD",
  "notional_per_period": 1000000,
  "observation_frequency": "Monthly",
  "strike_pct_of_forward": 101.5,
  "strike": 1.0850,
  "target": {
    "type": "PipAccrual",
    "value": 0.0200,
    "currency": "USD"
  },
  "leverage": {
    "unfavorable_multiplier": 2,
    "applies_when": "Fixing < Strike"
  },
  "knock_out": {
    "type": "TargetReached",
    "trigger": "CumulativeGain >= Target"
  },
  "premium": 0.0
}
```

---

## 2. TARN — Target Accrual Redemption Note

### Description

Le **TARN** est la version **obligataire** du TARF. Il s'agit d'une note (titre de créance) dont la durée de vie est déterminée par l'accumulation d'un **coupon cible**. Le produit verse des coupons périodiques, souvent liés à un taux (CMS, Euribor) ou à un fixing FX, et se rembourse au pair dès que le coupon cumulé atteint la cible. Produit prisé par les investisseurs cherchant un rendement élevé à durée incertaine.

**Caractéristiques principales :**

- **Sous-jacent :** Taux CMS, Euribor, ou fixing FX
- **Maturité maximale :** 5 à 15 ans (mais peut être très courte si la cible est vite atteinte)
- **Coupon :** Élevé lorsque la condition est favorable, souvent nul ou réduit sinon
- **Target :** Somme cumulée de coupons déclenchant le remboursement anticipé au pair
- **Garantie capital :** 100% (remboursement au pair à l'extinction ou à maturité)
- **Risque principal :** Durée incertaine ; si le taux est défavorable, pas de coupon versé

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Coupon versé | Condition favorable (ex : CMS10 ≤ seuil) | Coupon_n versé ; ajouté au cumul |
| Coupon nul | Condition défavorable | Aucun coupon ; cumul inchangé |
| Remboursement anticipé | Coupon cumulé ≥ Target | 100% nominal remboursé ; produit terminé |
| À maturité maximale | Target non atteint | 100% nominal remboursé |

### Template JSON

```json
{
  "product_type": "TARN",
  "variant": "Classic",
  "underlying": {
    "type": "InterestRate",
    "index": "CMS10Y EUR",
    "bloomberg_ticker": "EUSA10 Curncy"
  },
  "issue_date": "YYYY-MM-DD",
  "max_maturity_date": "YYYY-MM-DD",
  "max_maturity_years": 10,
  "currency": "EUR",
  "nominal": 10000000,
  "observation_frequency": "Annual",
  "coupon": {
    "type": "Conditional",
    "rate_if_favorable_pa_pct": 8.0,
    "rate_if_unfavorable_pa_pct": 0.0,
    "condition": "CMS10Y <= 5.0"
  },
  "target": {
    "type": "CouponAccrual",
    "value_pct": 40.0,
    "description": "Remboursement anticipé quand coupons cumulés >= 40% du nominal"
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  }
}
```

---

## 3. Range Accrual

### Description

Le **Range Accrual** (ou Accrual Swap / Range Note) est un produit dont le coupon s'accumule **jour par jour** uniquement lorsque le taux de référence (ou le fixing FX) se trouve à l'intérieur d'une **plage prédéfinie** (range). En dehors de cette plage, aucun coupon n'est capitalisé. Plus le sous-jacent reste dans la plage, plus le coupon versé est élevé.

**Caractéristiques principales :**

- **Sous-jacent :** Euribor 3M/6M, CMS 2Y/10Y, ou paire FX
- **Range (Plage) :** [Borne basse, Borne haute] définis en valeur absolue ou en spread
- **Coupon :** Taux annuel × (nombre de jours dans le range / nombre total de jours de la période)
- **Maturité :** 1 à 10 ans, observations quotidiennes (business days)
- **Capital :** Souvent garanti à 100% (sous forme de note)
- **Usage :** Investisseur pariant sur la stabilité d'un taux ou d'une devise

**Formule du coupon :**

```
Coupon_période = Taux × (Jours_dans_range / Jours_totaux_période) × Notionnel
```

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Chaque jour ouvré (in range) | Borne_basse ≤ Taux_ref ≤ Borne_haute | +1 jour accrué |
| Chaque jour ouvré (out of range) | Taux_ref < Borne_basse ou > Borne_haute | 0 jour accrué |
| Date de paiement coupon | Fin de période | Coupon = Taux × (Jours_in / Jours_total) × Notionnel |
| À maturité | — | Remboursement 100% nominal |

### Template JSON

```json
{
  "product_type": "RangeAccrual",
  "variant": "Classic",
  "underlying": {
    "type": "InterestRate",
    "index": "EURIBOR 3M",
    "bloomberg_ticker": "EUR003M Index"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 5,
  "currency": "EUR",
  "nominal": 10000000,
  "coupon_frequency": "Quarterly",
  "accrual": {
    "observation_frequency": "Daily",
    "range": {
      "lower_bound_pct": 0.0,
      "upper_bound_pct": 4.0
    },
    "coupon_rate_pa_pct": 7.5,
    "day_count": "Act/360"
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  },
  "guarantee": true
}
```

---

## 4. Dual Range Accrual

### Description

Le **Dual Range Accrual** est une extension du Range Accrual dans laquelle le coupon s'accumule uniquement lorsque **deux sous-jacents simultanément** se trouvent dans leur plage respective. Cette double condition réduit la probabilité d'accrual et permet d'offrir un coupon théorique plus élevé. Très utilisé sur des structures combinant un taux court et un taux long (ou un taux et un FX).

**Caractéristiques principales :**

- **Sous-jacents :** 2 taux ou 1 taux + 1 FX (ex : CMS10Y et CMS2Y, ou Euribor et EUR/USD)
- **Double Range :** Chaque sous-jacent a sa propre plage [Borne basse, Borne haute]
- **Condition d'accrual :** Les DEUX sous-jacents doivent être dans leur range simultanément
- **Coupon :** Plus élevé que le Range Accrual simple (en compensation de la double condition)
- **Capital :** Généralement garanti

**Formule du coupon :**

```
Coupon = Taux × (Jours [S1 in range ET S2 in range] / Jours_totaux) × Notionnel
```

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Jour accrué | S1 dans range_1 ET S2 dans range_2 | +1 jour accrué |
| Jour non accrué | Au moins un sous-jacent hors range | 0 jour accrué |
| Date de paiement | Fin de période | Coupon = Taux × (Jours_in / Jours_total) × Notionnel |
| À maturité | — | Remboursement 100% nominal |

### Template JSON

```json
{
  "product_type": "DualRangeAccrual",
  "variant": "Classic",
  "underlyings": [
    {
      "id": "S1",
      "type": "InterestRate",
      "index": "CMS10Y EUR",
      "bloomberg_ticker": "EUSA10 Curncy",
      "range": {
        "lower_bound_pct": 2.0,
        "upper_bound_pct": 5.0
      }
    },
    {
      "id": "S2",
      "type": "InterestRate",
      "index": "CMS2Y EUR",
      "bloomberg_ticker": "EUSA2 Curncy",
      "range": {
        "lower_bound_pct": 0.5,
        "upper_bound_pct": 3.5
      }
    }
  ],
  "accrual_condition": "S1_in_range AND S2_in_range",
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 7,
  "currency": "EUR",
  "nominal": 10000000,
  "coupon_frequency": "Quarterly",
  "accrual": {
    "observation_frequency": "Daily",
    "coupon_rate_pa_pct": 10.0,
    "day_count": "Act/360"
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  },
  "guarantee": true
}
```

---

## 5. Formosa Bond (Reverse Dual Currency Note)

### Description

Le **Formosa Bond** est une obligation émise à Taiwan (marché Formosa), libellée en devises étrangères (souvent USD), et distribuée principalement aux investisseurs institutionnels taïwanais. Ces obligations intègrent généralement une optionnalité sur le taux de change **TWD/USD** ou sont liées à un **CMS** ou à un **Range Accrual**. L'émetteur (souvent une grande banque) se refinance à coût attractif en intégrant un risque structuré pour l'investisseur.

**Caractéristiques principales :**

- **Devise d'émission :** USD (ou EUR), vendue à des investisseurs TWD
- **Coupon :** Élevé (attractif pour l'investisseur taïwanais), souvent fixe les premières années puis variable
- **Optionnalité fréquente :** Range Accrual sur CMS, ou coupon conditionnel USD/TWD
- **Callable :** L'émetteur peut rembourser par anticipation (embedded call)
- **Maturité :** Longue (10 à 30 ans), mais souvent callée rapidement
- **Remboursement :** 100% du nominal en devise d'émission
- **Risque change :** Supporté par l'investisseur (conversion TWD → USD à l'investissement)

**Flux typiques :**

| Événement | Condition | Flux |
|---|---|---|
| Coupons phase 1 (fixe) | Années 1 à N | Coupon fixe élevé (ex : 5% en USD) |
| Coupons phase 2 (variable) | Après phase fixe | Coupon conditionnel (ex : Range Accrual sur CMS) |
| Call émetteur | À discrétion de l'émetteur (dates prévues) | Remboursement 100% nominal USD |
| À maturité | Si non callée | Remboursement 100% nominal USD |

### Template JSON

```json
{
  "product_type": "FormosaBond",
  "variant": "RangeAccrual_Callable",
  "issuer": "Major Bank",
  "market": "Taiwan (Formosa)",
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 30,
  "currency": "USD",
  "nominal": 50000000,
  "coupon_schedule": [
    {
      "phase": 1,
      "type": "Fixed",
      "years": "1-5",
      "rate_pa_pct": 5.0
    },
    {
      "phase": 2,
      "type": "RangeAccrual",
      "years": "6-30",
      "underlying": "CMS10Y USD",
      "range": {
        "lower_bound_pct": 1.0,
        "upper_bound_pct": 6.0
      },
      "coupon_rate_pa_pct": 8.0
    }
  ],
  "callable": {
    "enabled": true,
    "first_call_date": "YYYY-MM-DD",
    "call_frequency": "Annual",
    "call_price_pct": 100
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100,
    "currency": "USD"
  },
  "fx_risk_for_investor": "TWD/USD (non hedged by issuer)"
}
```

---

## 6. Autocall Taux (Rate Autocall)

### Description

L'**Autocall Taux** est la transposition du mécanisme autocall (rappel anticipé automatique) dans l'univers des taux d'intérêt. Le remboursement anticipé est déclenché lorsqu'un taux de référence (CMS, Euribor, spread de courbe) dépasse ou reste sous un seuil défini. Souvent structuré comme un **CMS Steepener Autocall** (pari sur la pente de la courbe des taux).

**Caractéristiques principales :**

- **Sous-jacent :** CMS10Y, CMS2Y, spread CMS10Y - CMS2Y
- **Barrière Autocall :** Niveau ou spread de taux déclenchant le rappel
- **Coupon :** Fixe (élevé) ou flottant, versé jusqu'au rappel
- **Barrière de protection :** Souvent absente (capital garanti) ou conditionnelle sur un niveau de taux
- **Maturité maximale :** 5 à 15 ans
- **Usage :** Investisseur avec vue directionnelle sur les taux ou la courbe

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Rappel anticipé | CMS10Y ≥ Barrière (ex : 3%) | 100% nominal + coupon de la période |
| Coupon versé (sans rappel) | Condition non atteinte | Coupon fixe ou flottant versé |
| À maturité | Barrière jamais atteinte | 100% nominal + dernier coupon |

### Template JSON

```json
{
  "product_type": "RateAutocall",
  "variant": "CMSSteepener",
  "underlying": {
    "type": "RateSpread",
    "long_rate": "CMS10Y EUR",
    "short_rate": "CMS2Y EUR",
    "bloomberg_long": "EUSA10 Curncy",
    "bloomberg_short": "EUSA2 Curncy",
    "spread_definition": "CMS10Y - CMS2Y"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 10,
  "currency": "EUR",
  "nominal": 10000000,
  "observation_frequency": "Annual",
  "autocall": {
    "trigger": "Spread >= 0.50%",
    "barrier_pct_spread": 0.50,
    "coupon_pa_pct": 6.0
  },
  "coupon_if_no_autocall": {
    "type": "Fixed",
    "rate_pa_pct": 2.5
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  },
  "guarantee": true
}
```

---

## 7. CMS Spread Steepener / Flattener

### Description

Le **CMS Spread** est un produit structuré dont le coupon est **directement lié à l'écart (spread) entre deux taux CMS** de maturités différentes (ex : CMS10Y - CMS2Y). Le **Steepener** parie sur un élargissement de la courbe (spread qui augmente), le **Flattener** sur une compression. Ces produits sont émis sous forme de swaps ou de notes.

**Caractéristiques principales :**

- **Sous-jacent :** Spread CMS (ex : CMS10Y - CMS2Y)
- **Coupon Steepener :** Max(0, Levier × (CMS10Y - CMS2Y) - Spread fixe)
- **Coupon Flattener :** Max(0, Levier × (CMS2Y - CMS10Y) + Spread fixe)
- **Floor :** Coupon minimum = 0% (pas de coupon négatif pour l'investisseur)
- **Cap :** Coupon maximum souvent plafonné (ex : 10%)
- **Maturité :** 5 à 30 ans
- **Capital :** Souvent garanti dans la version note

**Formule du coupon Steepener :**

```
Coupon_n = Max(0%, Min(Cap, Levier × (CMS10Y_n - CMS2Y_n) - Spread_fixe))
```

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Coupon élevé | Spread CMS s'élargit | Coupon = Levier × Spread - Marge |
| Coupon nul | Spread CMS nul ou négatif | 0% (floor) |
| À maturité | — | Remboursement 100% nominal |

### Template JSON

```json
{
  "product_type": "CMSSpread",
  "variant": "Steepener",
  "underlying": {
    "type": "RateSpread",
    "long_rate": "CMS10Y EUR",
    "short_rate": "CMS2Y EUR",
    "bloomberg_long": "EUSA10 Curncy",
    "bloomberg_short": "EUSA2 Curncy"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 10,
  "currency": "EUR",
  "nominal": 10000000,
  "coupon_frequency": "Annual",
  "coupon_formula": {
    "type": "CMSSpreadLinked",
    "leverage": 5,
    "fixed_spread_pct": 0.50,
    "floor_pct": 0.0,
    "cap_pct": 10.0,
    "formula": "Max(0%, Min(10%, 5 × (CMS10Y - CMS2Y) - 0.50%))"
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  },
  "guarantee": true
}
```

---

## 8. Snowball (Accrual cumulatif sur taux)

### Description

Le **Snowball** est un produit structuré à coupon cumulatif : chaque coupon dépend du coupon de la période précédente plus (ou moins) un spread conditionnel. L'effet "boule de neige" signifie que si les conditions sont favorables en début de vie, le coupon devient rapidement très élevé. À l'inverse, si les conditions deviennent défavorables, le coupon peut s'éroder jusqu'à zéro (ou un plancher).

**Caractéristiques principales :**

- **Sous-jacent :** CMS10Y, Euribor, ou autre taux de référence
- **Formule :** Coupon_n = Max(0, Coupon_{n-1} + Spread - Levier × Taux_ref)
- **Effet cumulatif :** Le coupon de chaque période dépend du coupon précédent
- **Floor :** 0% (le coupon ne peut pas être négatif)
- **Capital :** Généralement remboursé à 100%
- **Risque :** Si le taux monte, le coupon peut être réduit à zéro et rester nul

**Formule :**

```
Coupon_n = Max(0%, Coupon_{n-1} + Spread_fixe - Levier × CMS_n)
```

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Coupon croissant | Taux_ref stable ou baissier | Coupon_n > Coupon_{n-1} |
| Coupon stable | Hausse modérée du taux | Coupon_n ≈ Coupon_{n-1} |
| Coupon réduit / nul | Forte hausse du taux | Coupon_n = Max(0, Coupon_{n-1} - ε) |
| À maturité | — | 100% nominal |

### Template JSON

```json
{
  "product_type": "Snowball",
  "variant": "CMS_Accrual",
  "underlying": {
    "type": "InterestRate",
    "index": "CMS10Y EUR",
    "bloomberg_ticker": "EUSA10 Curncy"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 15,
  "currency": "EUR",
  "nominal": 10000000,
  "coupon_frequency": "Annual",
  "coupon_formula": {
    "type": "Snowball",
    "initial_coupon_pa_pct": 5.0,
    "fixed_spread_pa_pct": 1.0,
    "leverage": 1.0,
    "reference_rate": "CMS10Y",
    "floor_pct": 0.0,
    "cap_pct": null,
    "formula": "Max(0%, Coupon_{n-1} + 1.0% - 1.0 × CMS10Y_n)"
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100
  },
  "guarantee": true
}
```

---

## 9. Power Reverse Dual Currency (PRDC)

### Description

Le **PRDC** (Power Reverse Dual Currency) est un produit structuré complexe émis principalement sur le marché japonais (Uridashi). L'investisseur reçoit des coupons en **devise étrangère** (souvent USD ou AUD) convertis en JPY, avec un **levier** sur le taux de change. Ces produits ont une très longue maturité et intègrent généralement une option call de l'émetteur. Très sensibles au taux de change USD/JPY et aux taux d'intérêt.

**Caractéristiques principales :**

- **Investisseur :** Japonais (actifs en JPY, cherche rendement en devise)
- **Devise coupon :** USD ou AUD (convertis en JPY)
- **Coupon :** Levier × (Taux_USD - Taux_JPY) × (FX_initial / FX_courant) — simplifié
- **Call émetteur :** Fréquent (bermudéen), dès que le produit devient défavorable à l'émetteur
- **Risque principal :** Appréciation du JPY (baisse de USD/JPY) → coupon effondré
- **Maturité :** 20 à 30 ans (mais souvent callé en 3-5 ans)

**Flux :**

| Événement | Condition | Flux |
|---|---|---|
| Coupon versé | USD/JPY ≥ seuil | Coupon élevé en JPY |
| Coupon réduit | USD/JPY < seuil | Coupon faible ou nul |
| Call émetteur | Conditions favorables à l'émetteur | Remboursement 100% nominal JPY |
| À maturité | Non callé | Remboursement 100% nominal JPY |

### Template JSON

```json
{
  "product_type": "PRDC",
  "variant": "Classic",
  "market": "Japan (Uridashi)",
  "underlying": {
    "fx_pair": "USD/JPY",
    "bloomberg_ticker": "USDJPY Curncy",
    "domestic_rate": "JPY OIS",
    "foreign_rate": "USD OIS"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 30,
  "currency": "JPY",
  "nominal": 1000000000,
  "coupon_frequency": "Annual",
  "coupon_formula": {
    "type": "DualCurrency",
    "formula": "Max(0%, Leverage × ForeignRate × (FX_initial / FX_current))",
    "leverage": 1.0,
    "fx_initial": null,
    "floor_pct": 0.0
  },
  "callable": {
    "enabled": true,
    "type": "Bermudan",
    "first_call_date": "YYYY-MM-DD",
    "call_frequency": "Annual",
    "call_price_pct": 100
  },
  "capital_protection": {
    "type": "Full",
    "guaranteed_redemption_pct": 100,
    "currency": "JPY"
  }
}
```

---

## 10. FX Linked Note (Note liée au FX)

### Description

La **FX Linked Note** est une obligation structurée dont le remboursement du capital et/ou le coupon sont **indexés sur une paire de devises**. Elle peut être utilisée comme outil de couverture ou comme produit de rendement. Deux variantes principales :

- **FX Linked Capital Note :** Le capital est remboursé dans une devise alternative si le change dépasse un seuil (proche d'un Dual Currency Deposit)
- **FX Linked Coupon Note :** Le coupon dépend de la performance ou du niveau FX

**Caractéristiques principales :**

- **Sous-jacent :** Paire de devises (EUR/USD, USD/CNH, etc.)
- **Strike FX :** Niveau du taux de change de référence
- **Risque change :** Le capital peut être remboursé en devise étrangère si le FX dépasse le strike
- **Coupon :** Attractif (prime de risque de change)
- **Usage :** Investisseur prêt à recevoir une devise étrangère en cas de mouvement adverse

**Flux (variante Capital Linked) :**

| Événement | Condition | Flux |
|---|---|---|
| Coupon périodique | — | Coupon fixe élevé dans la devise de base |
| Remboursement à maturité (favorable) | FX ≤ Strike | 100% nominal en devise de base |
| Remboursement à maturité (défavorable) | FX > Strike | 100% nominal converti en devise étrangère au Strike |

### Template JSON

```json
{
  "product_type": "FXLinkedNote",
  "variant": "DualCurrencyDeposit",
  "underlying": {
    "type": "FX",
    "pair": "EUR/USD",
    "bloomberg_ticker": "EURUSD Curncy"
  },
  "issue_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 1,
  "base_currency": "EUR",
  "alternative_currency": "USD",
  "nominal": 1000000,
  "coupon": {
    "type": "Fixed",
    "rate_pa_pct": 6.5
  },
  "redemption": {
    "type": "FXLinked",
    "strike_fx": 1.0900,
    "condition": "EURUSD > Strike at maturity",
    "if_favorable": {
      "currency": "EUR",
      "amount_pct": 100
    },
    "if_unfavorable": {
      "currency": "USD",
      "amount": "Nominal_EUR × Strike_FX"
    }
  },
  "guarantee": false
}
```

---

## 11. Interest Rate Swap Structuré (IRS avec cap/floor/collar)

### Description

Les **IRS Structurés** sont des swaps de taux enrichis d'optionnalités : **cap** (plafond sur le taux flottant payé), **floor** (plancher sur le taux flottant reçu), ou **collar** (combinaison cap + floor). Utilisés principalement par les entreprises et collectivités pour transformer et optimiser leur profil de taux.

**Variantes principales :**

- **Cap :** Protection contre la hausse des taux (acheteur d'un caplet à chaque période)
- **Floor :** Protection contre la baisse des taux (plancher de revenu)
- **Collar :** Cap + Floor simultanés (coût réduit, range de taux garanti)
- **Swaption :** Option d'entrer dans un swap à une date future

**Flux (Collar) :**

| Événement | Condition | Flux |
|---|---|---|
| Taux flottant dans le collar | Floor ≤ Euribor ≤ Cap | Échange au taux Euribor du marché |
| Taux > Cap | Euribor > Cap | Le payeur fixe paie au maximum le Cap |
| Taux < Floor | Euribor < Floor | Le receveur fixe reçoit au minimum le Floor |

### Template JSON

```json
{
  "product_type": "IRS_Structured",
  "variant": "Collar",
  "trade_date": "YYYY-MM-DD",
  "start_date": "YYYY-MM-DD",
  "maturity_date": "YYYY-MM-DD",
  "maturity_years": 5,
  "currency": "EUR",
  "nominal": 20000000,
  "fixed_leg": {
    "rate_pa_pct": 3.0,
    "frequency": "Annual",
    "day_count": "30/360"
  },
  "floating_leg": {
    "index": "EURIBOR 6M",
    "bloomberg_ticker": "EUR006M Index",
    "frequency": "Semi-Annual",
    "day_count": "Act/360",
    "spread_bps": 0
  },
  "optionality": {
    "type": "Collar",
    "cap_strike_pct": 5.0,
    "floor_strike_pct": 1.0,
    "cap_premium": 0.0,
    "floor_premium": 0.0
  },
  "direction": "PayFixed_ReceiveFloat"
}
```

---

## Synthèse comparative

| Produit | Sous-jacent | Mécanisme clé | Coupon | Capital garanti | Usage principal |
|---|---|---|---|---|---|
| **TARF** | FX | Accumulation de gain → KO automatique | Implicite (FX amélioré) | Non | Couverture change entreprise |
| **TARN** | Taux / FX | Accumulation coupon → remboursement anticipé | Élevé / conditionnel | Oui | Investissement rendement |
| **Range Accrual** | Taux / FX | Accrual journalier si dans la plage | Proportionnel au temps in-range | Oui | Pari stabilité taux |
| **Dual Range Accrual** | 2 Taux / Taux+FX | Double condition simultanée | Plus élevé que simple RA | Oui | Pari corrélation / stabilité |
| **Formosa Bond** | Taux + FX (TWD) | Note callable + range accrual | Fixe puis variable | Oui (en USD) | Investissement institutionnel TW |
| **Autocall Taux** | CMS / Spread | Rappel si taux/spread ≥ barrière | Fixe jusqu'au rappel | Oui | Vue directionnelle taux |
| **CMS Spread** | Spread CMS | Coupon = f(spread de courbe) | Variable (levier sur spread) | Oui | Pari sur pente de courbe |
| **Snowball** | CMS / Euribor | Coupon cumulatif croissant | Cumulatif | Oui | Rendement haussier si taux bas |
| **PRDC** | USD/JPY + Taux | Coupon FX-linked, callable | Variable (FX-linked) | Oui (JPY) | Investissement JPY → USD yield |
| **FX Linked Note** | FX | Capital remboursé en devise alt. | Fixe élevé | Conditionnelle | Rendement + risque FX |
| **IRS Structuré** | Taux | Swap + cap/floor/collar | Flottant encadré | N/A (swap) | Couverture taux entreprise |

---

## Glossaire

| Terme | Définition |
|---|---|
| **CMS** | Constant Maturity Swap — taux swap à maturité fixe (ex : CMS10Y = taux du swap 10 ans) |
| **Euribor** | Euro Interbank Offered Rate — taux de référence monétaire européen (3M, 6M) |
| **Target / Cible** | Gain ou coupon cumulé déclenchant l'extinction anticipée du produit |
| **Knock-Out** | Barrière désactivante — le produit s'éteint automatiquement quand la condition est atteinte |
| **Range / Plage** | Intervalle [borne basse, borne haute] dans lequel le sous-jacent doit se trouver pour accruer |
| **Accrual** | Accumulation quotidienne du coupon en fonction du nombre de jours dans la plage |
| **Leverage (Levier)** | Multiplicateur appliqué à un taux ou un écart pour amplifier le coupon ou l'exposition |
| **Spread de courbe** | Écart entre deux taux de maturités différentes (ex : CMS10Y - CMS2Y) |
| **Steepener** | Pari sur un élargissement du spread de courbe (courbe qui se pentifie) |
| **Flattener** | Pari sur une compression du spread de courbe (courbe qui s'aplatit) |
| **Callable** | Option de remboursement anticipé à la discrétion de l'émetteur |
| **Bermudan** | Option exerçable à des dates discrètes prédéfinies (entre européen et américain) |
| **PRDC** | Power Reverse Dual Currency — note japonaise à coupon FX-linked avec levier |
| **Formosa** | Obligation émise sur le marché obligataire de Taiwan |
| **Floor** | Option garantissant un taux minimum (plancher) |
| **Cap** | Option garantissant un taux maximum (plafond) |
| **Collar** | Combinaison cap + floor encadrant le taux dans une fourchette |
| **Swaption** | Option donnant le droit d'entrer dans un swap à une date future |
| **Worst-of** | Performance calculée sur le sous-jacent le moins performant d'un panier |
| **TWD** | Dollar Taïwanais — devise locale pour les Formosa Bonds |
---

## Sortie attendue

Pour **chaque cotation**, produisez une instance du **template JSON du type de produit
identifié** ci-dessus (`schemaVersion: "rates/v1"`, plus le champ `product_type` du template).
Ne renseignez que les champs déductibles de la demande, laissez les autres à `null`.
N'inventez aucun paramètre non exprimé. Ajoutez à chaque cotation `quoteId`, `label`,
`confidenceScore`, `extractedTokens`, `aiExplanation`. Enveloppe finale : `{ "quotes": [ … ] }`.
