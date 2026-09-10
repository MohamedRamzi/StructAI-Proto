---
key: rates
name: Taux & FX — TARF / TARN / Range Accrual / CMS / Swaps
kind: domain
assetClass: RATES
productFamily:
scopeDescription: Produits structurés de taux et de change — TARF/TARN, Range Accrual (simple et dual), Formosa, Autocall taux, CMS Spread (steepener/flattener), Snowball, PRDC, FX Linked Note, IRS structuré (cap/floor/collar). Schéma de sortie riche par type de produit.
---
# Extraction — produits structurés Taux / FX → schéma `rates/v1`

Tu extrais les caractéristiques d'un **produit structuré de taux ou de change** depuis
une demande client et tu produis un objet `rates/v1` : `schemaVersion: "rates/v1"` +
un champ `product_type` (voir §1) + les champs métier propres à ce type. Ne renseigne
que les champs déductibles de la demande, laisse les autres à `null`, n'invente aucun
paramètre non exprimé (barrières, coupon, target, maturité, dates…). Niveaux de taux
en **pourcentage** (`4.0` = 4 %), sauf indication contraire du client.

## 1. Identifier le `product_type`

| `product_type` | Sous-jacent | Mécanisme déclencheur | Indices verbaux |
|---|---|---|---|
| `TARF` | paire FX (parfois taux) | accumulation de gain → **knock-out** quand le gain cumulé atteint la `target` ; `leverage` si fixing défavorable | « target redemption forward », « TARF », « accumulateur avec cible », « levier ×2 sous le strike » |
| `TARN` | taux ou FX | accumulation de **coupon** → remboursement anticipé quand le coupon cumulé atteint la `target` ; capital généralement garanti | « TARN », « target redemption note » |
| `RangeAccrual` | Euribor, CMS, ou FX | coupon accru **jour par jour** tant que le taux reste dans `[lower, upper]` ; capital souvent garanti | « range accrual », « accrual swap », « coupon au prorata des jours dans la plage », « corridor » |
| `DualRangeAccrual` | 2 taux, ou taux + FX | accrual conditionné à **deux** plages simultanées | « dual range », « double condition » |
| `Formosa` | taux + FX (souvent TWD) | note **callable** + range accrual ; coupon fixe puis variable | « formosa », « obligation Taiwan » |
| `RateAutocall` | CMS ou spread CMS | **rappel** si le taux/spread ≥ barrière ; coupon fixe jusqu'au rappel ; capital garanti | « autocall de taux », « rappel si CMS10Y ≥ … » |
| `CMSSpread` | spread CMS (ex. CMS10Y − CMS2Y) | coupon = `leverage × (spread − fixed_spread)`, encadré par `floor`/`cap` | « steepener », « flattener », « pari sur la pente de courbe », « CMS spread » |
| `Snowball` | CMS ou Euribor | coupon **cumulatif croissant** (coupon de la période = coupon précédent + marge − taux de référence) | « snowball », « boule de neige de taux » |
| `PRDC` | USD/JPY + taux | coupon **FX-linked** avec levier, note callable, capital en JPY | « PRDC », « power reverse dual currency » |
| `FXLinkedNote` | paire FX | coupon fixe élevé ; capital remboursé dans une **devise alternative** si barrière FX franchie | « dual currency deposit », « FX linked note », « dépôt bi-devise » |
| `IRS_Structured` | taux (Euribor / CMS) | swap fixe ↔ flottant + optionnalité `cap` / `floor` / `collar` / `swaption` | « swap avec cap », « collar de taux », « IRS structuré », « swaption » |

Si la demande décrit un mécanisme sans nom explicite, choisis le `product_type` d'après
le **mécanisme déclencheur** (colonne 3), pas d'après un mot-clé isolé.

## 2. Enveloppe commune

Tous les types partagent :

```json
{
  "schemaVersion": "rates/v1",
  "product_type": "RangeAccrual",
  "variant": null,
  "underlying": {
    "type": "InterestRate | FX | RateSpread",
    "index": "EURIBOR 3M",            // taux simple
    "pair": null,                      // FX : "EUR/USD"
    "long_rate": null, "short_rate": null,  // RateSpread : "CMS10Y EUR" / "CMS2Y EUR"
    "bloomberg_ticker": null
  },
  "trade_date": null, "issue_date": null, "start_date": null,
  "maturity_date": null, "maturity_years": null,
  "currency": "EUR",
  "nominal": null, "notional_per_period": null,
  "observation_frequency": null,     // "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annual"
  "coupon_frequency": null,
  "capital_protection": { "type": null, "guaranteed_redemption_pct": null },  // "Full" | "Partial" | "None"
  "guarantee": null
}
```

## 3. Champs propres à chaque type (en plus de l'enveloppe)

- **TARF / TARN** : `currency_sold`, `currency_bought`, `strike`, `strike_pct_of_forward`,
  `target: { type: "PipAccrual"|"CouponAccrual"|"CountAccrual", value, currency }`,
  `leverage: { unfavorable_multiplier, applies_when }`,
  `knock_out: { type, trigger }`, `premium`.
- **RangeAccrual** : `accrual: { observation_frequency, range: { lower_bound_pct, upper_bound_pct }, coupon_rate_pa_pct, day_count }`.
- **DualRangeAccrual** : `accrual.range_1`, `accrual.range_2` (chacun `{ index, lower_bound_pct, upper_bound_pct }`), `accrual.condition` (`"BOTH"`).
- **RateAutocall** : `autocall: { trigger, barrier_pct_spread | barrier_pct, coupon_pa_pct }`, `coupon_if_no_autocall: { type, rate_pa_pct }`.
- **CMSSpread** : `coupon_formula: { type: "CMSSpreadLinked", leverage, fixed_spread_pct, floor_pct, cap_pct, formula }`.
- **Snowball** : `coupon_formula: { type: "Snowball", initial_coupon_pct, add_on_pct, reference_rate, floor_pct }`.
- **PRDC** : `coupon_formula: { type: "FXLinked", fx_pair, leverage, strike_fx, floor_pct }`, `callable: { style: "Bermudan", call_dates }`.
- **FXLinkedNote** : `fx_barrier`, `alternative_redemption_currency`, `fixed_coupon_pa_pct`, `conversion_rule`.
- **IRS_Structured** : `fixed_leg: { rate_pa_pct, frequency, day_count }`,
  `floating_leg: { index, frequency, day_count, spread_bps }`,
  `optionality: { type: "Cap"|"Floor"|"Collar"|"Swaption", cap_pct, floor_pct, strike_pct, expiry }`,
  `payer` (`"Client"` = le client paie le fixe).

## 4. Exemples

**« TARF EUR/USD 18 mois, strike 1.08, target 6% en USD, levier ×2 sous le strike, fixings mensuels, notionnel 1M€/mois »**
→ `product_type: "TARF"`, `underlying: { type:"FX", pair:"EUR/USD" }`, `maturity_years: 1.5`,
`currency_sold:"EUR"`, `currency_bought:"USD"`, `strike: 1.08`, `notional_per_period: 1000000`,
`observation_frequency:"Monthly"`, `target: { type:"PipAccrual", value: 0.06, currency:"USD" }`,
`leverage: { unfavorable_multiplier: 2, applies_when:"Fixing < Strike" }`.

**« Range accrual Euribor 3M, 2 ans, coupon 3% p.a. payé au prorata des jours où l'Euribor est dans [0%, 3%], capital garanti »**
→ `product_type: "RangeAccrual"`, `underlying: { type:"InterestRate", index:"EURIBOR 3M" }`,
`maturity_years: 2`, `accrual: { observation_frequency:"Daily", range:{ lower_bound_pct: 0.0, upper_bound_pct: 3.0 }, coupon_rate_pa_pct: 3.0 }`,
`capital_protection: { type:"Full", guaranteed_redemption_pct: 100 }`, `guarantee: true`.

## Sortie attendue

Pour **chaque cotation**, un objet `rates/v1` du `product_type` identifié, avec
`quoteId`, `label`, `confidenceScore`, `extractedTokens`, `aiExplanation` en plus des
champs métier. Enveloppe finale : `{ "quotes": [ … ] }`.
