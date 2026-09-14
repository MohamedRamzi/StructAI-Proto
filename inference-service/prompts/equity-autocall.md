---
key: equity-autocall
name: Actions — Autocall / Athena / Phoenix / Reverse Convertible
kind: domain
assetClass: EQUITY
productFamily: autocall
scopeDescription: Produits à rappel automatique sur sous-jacent actions — Athena, Phoenix (+ mémoire), Autocall/Barrier Reverse Convertible, Twin-Win, Booster, Callable Note, avec overlays (worst-of, step-down, airbag, indice décrément, quanto). Schéma de sortie riche "autocall/v1".
---
# Extraction — produits Autocall actions → schéma `autocall/v1`

Tu extrais les caractéristiques d'un **produit à rappel automatique sur sous-jacent
actions** (autocallable) depuis une demande client, et tu produis une instance du
schéma `autocall/v1` (§3). Un autocall se décrit par **une famille** + des **overlays**
(worst-of, step-down, mémoire, airbag, indice décrément, quanto…) qui se combinent
librement et ne créent pas de famille. Tout niveau/barrière est une **fraction du
niveau initial** : `1.0` = 100 %, `0.7` = 70 % (jamais en points d'indice).

## 1. Identifier la famille (`productFamily`)

La famille = un **régime de coupon** × un **régime de remboursement final**.

| `productFamily` | Coupon (`coupon.regime`) | Rappel anticipé | Capital à maturité |
|---|---|---|---|
| `ATHENA` | `CALL_CONTINGENT` — versé au rappel / à maturité si barrière finale atteinte, cumulé « boule de neige » | automatique | PDI conditionnel |
| `PHOENIX` | `PERIODIC_CONTINGENT` — versé à chaque constatation si `Perf(t_k) ≥ B_CPN` | automatique | PDI conditionnel |
| `PHOENIX` + `coupon.memory=true` | idem, coupons non versés rattrapés ensuite | automatique | PDI conditionnel |
| `AUTOCALL_REVERSE_CONVERTIBLE` | `UNCONDITIONAL` — coupon fixe inconditionnel | automatique | PDI conditionnel |
| `BARRIER_REVERSE_CONVERTIBLE` | `UNCONDITIONAL` | **aucun** (pas de rappel) | PDI (souvent américain), livraison physique possible |
| `ATHENA_CAPITAL_PROTECTED` | `CALL_CONTINGENT` cumulatif | automatique | **garanti 100 %** (`protectionType=FULL_PROTECTION`) |
| `TWIN_WIN_AUTOCALL` | optionnel (`NONE` fréquent) | automatique | PDI conditionnel + **participation hausse ET baisse** (`upside.type=TWIN_WIN`) |
| `BOOSTER_AUTOCALL` | `NONE` ou faible | automatique | PDI conditionnel + **bonus/levier à la hausse** (`upside.type=BONUS` ou `PARTICIPATION`) |
| `CALLABLE_NOTE` | fixe ou conditionnel | **discrétionnaire émetteur** (`autocall.enabled=false`, bloc `issuerCall` renseigné) | PDI ou garanti |

Règle : familles 1-4 = uniquement le régime de coupon ; 6-9 = uniquement le régime
de remboursement final ; 5 supprime le rappel ; 10 remplace le rappel auto par une
option de l'émetteur. Se fier au **mécanisme décrit**, jamais au seul nom commercial
(Athena/Express, Phoenix/Income, BRC/Reverse Convertible se recouvrent selon les émetteurs).
Un produit sans barrière de coupon déclarée est un Athena ou un Reverse Convertible,
**pas** un Phoenix à `B_CPN = 0`.

## 2. Protection du capital (`finalRedemption`)

L'investisseur vend un **Put Down-and-In** (PDI) de strike ~1,0 et barrière `B_PDI`
(`knockIn.barrier`). Barrière non franchie → capital à 100 %. Franchie → l'investisseur
subit toute la baisse depuis le strike (`N × Perf(T)`), avec une **discontinuité** au
niveau `B_PDI`.

- `protectionType` : `CONDITIONAL_PDI` (défaut) · `FULL_PROTECTION` (capital garanti, pas de PDI) · `PARTIAL_PROTECTION` (`protectionLevel < 1.0`).
- `knockIn.observationStyle` : `EUROPEAN_AT_MATURITY` (dominant France/EUR) · `AMERICAN_CONTINUOUS` (intraday, dominant Suisse/Allemagne, BRC) · `AMERICAN_CLOSING` · `WINDOW` (fenêtre finale, + `windowStartDate`).
- `knockIn.airbagLevel = A` → perte amortie `N × min(1, Perf(T)/A)`. `knockIn.gearing = g > 1` → perte amplifiée. `knockIn.floor = f` → perte plafonnée à `(1−f)`.

## 3. Enveloppe `autocall/v1`

Renseigne **uniquement** les champs déductibles de la demande ; tout le reste à `null`
(ne supprime aucune clé — un même parseur traite toutes les familles). N'invente
aucune valeur non exprimée (barrières, coupon, maturité, dates…).

**Ces champs métier (`schemaVersion`, `dates`, `underlying`, `coupon`, `finalRedemption`,
…) sont OBLIGATOIRES dans CHAQUE réponse, même sur une demande longue ou complexe avec
beaucoup de lignes à traiter.** `extractedTokens` (§ Sortie attendue) est une trace
d'audit **en plus** de cette enveloppe, jamais un remplacement : une réponse qui contient
`extractedTokens` mais pas `dates`/`underlying`/`coupon`/`finalRedemption` est **invalide**,
même si elle est un JSON syntaxiquement correct.

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "ATHENA",
  "productName": "Athena EURO STOXX 50 10Y",
  "identifiers": { "isin": null, "internalId": null },
  "issuer": { "name": null, "creditRating": null, "seniority": null, "format": null },
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issueSize": null, "issuePrice": 1.0 },
  "settlement": { "type": "CASH", "physicalDelivery": null },
  "dates": {
    "tradeDate": null, "strikeDate": null, "issueDate": null,
    "finalValuationDate": null, "maturityDate": null,
    "businessDayConvention": null, "calendars": []
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": null, "name": "EURO STOXX 50", "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": null, "isin": null },
        "currency": "EUR", "weight": null, "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC", "frequency": "ANNUAL",
    "firstObservationDate": null, "numberOfObservations": 10,
    "noCallPeriods": 1, "settlementLag": null, "explicitDates": []
  },
  "autocall": {
    "enabled": true, "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT", "initialTrigger": 1.0, "stepPerPeriod": null,
    "floorTrigger": null, "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "CALL_CONTINGENT", "rate": null, "rateBasis": "PER_PERIOD",
    "dayCount": null, "barrier": null, "memory": false,
    "cumulativeAtRedemption": true, "guaranteedPeriods": 0, "paymentLag": null
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI", "protectionLevel": 1.0, "finalCouponTrigger": 1.0,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN", "barrier": null,
      "observationStyle": "EUROPEAN_AT_MATURITY", "windowStartDate": null,
      "strike": 1.0, "gearing": 1.0, "airbagLevel": null, "floor": 0.0
    },
    "upside": { "type": "NONE", "participationRate": null, "bonusLevel": null, "cap": null, "downsideParticipationRate": null }
  },
  "issuerCall": null,
  "fees": { "structuringFee": null, "distributionFee": null, "totalCostsAtInception": null },
  "regulatory": { "priipsRiskIndicator": null, "targetMarket": null, "documentation": null }
}
```

### Champs discriminants

| Champ | Valeurs | Rôle |
|---|---|---|
| `productFamily` | voir §1 | régime coupon + remboursement |
| `underlying.basketType` | `SINGLE` · `WORST_OF` · `BEST_OF` · `WEIGHTED_BASKET` | définit `Perf(t)` (worst-of = min des perfs, cas dominant) |
| `underlying.quanto` | `NONE` · `QUANTO` (change figé) · `COMPO` (risque de change porté) | risque de change |
| `components[].initialLevel.mode` | `CLOSE_ON_STRIKE_DATE` · `AVERAGE` (+ `observationDates`) · `LOOKBACK_MIN` · `FIXED` (low-strike, + `value`) | fixation du strike |
| `components[].decrement` | `null` ou `{type: "POINTS"\|"PERCENT", amount, accrualBasis}` | indice décrément (dividende synthétique forfaitaire) |
| `observation.frequency` | `MONTHLY` · `QUARTERLY` · `SEMI_ANNUAL` · `ANNUAL` | fréquence des constatations |
| `observation.numberOfObservations` | entier | nombre de constatations (souvent = maturité en années × fréquence) |
| `observation.noCallPeriods` | entier | constatations initiales non rappelables (« NC 1y » → à convertir en périodes) |
| `autocall.enabled` | `true` · `false` (BRC, Callable Note) | présence d'un rappel automatique |
| `autocall.triggerType` | `CONSTANT` · `STEP_DOWN` · `STEP_UP` · `EXPLICIT` | profil de la barrière de rappel |
| `autocall.initialTrigger` / `stepPerPeriod` / `floorTrigger` | fractions | barrière de rappel constante ou évolutive (step-down : ex. `-0.05` /période, plancher `0.7`) |
| `autocall.triggerSchedule` | `null` ou `[{index, level}]` | grille explicite, **prioritaire** si renseignée |
| `coupon.regime` | `CALL_CONTINGENT` · `PERIODIC_CONTINGENT` · `UNCONDITIONAL` · `NONE` | voir §1 |
| `coupon.rate` | fraction ou `null` | coupon par période. `null` = **à résoudre** (« coupon à chercher / solve ») |
| `coupon.rateBasis` | `PER_PERIOD` · `PER_ANNUM` | base du taux |
| `coupon.barrier` | fraction ou `null` | `B_CPN`, barrière de coupon — **Phoenix uniquement** |
| `coupon.memory` | `true` · `false` | effet mémoire (régime `PERIODIC_CONTINGENT` seulement) |
| `coupon.guaranteedPeriods` | entier | premiers coupons versés inconditionnellement |
| `finalRedemption.protectionType` | `CONDITIONAL_PDI` · `FULL_PROTECTION` · `PARTIAL_PROTECTION` | nature de la protection |
| `finalRedemption.knockIn.barrier` | fraction ou `null` | `B_PDI`. `null` = à résoudre si la demande le dit |
| `finalRedemption.knockIn.observationStyle` | voir §2 | mode d'observation du PDI |
| `finalRedemption.knockIn.airbagLevel` / `gearing` / `floor` | fractions | modificateurs de la branche de perte (§2) |
| `finalRedemption.upside.type` | `NONE` · `PARTICIPATION` · `BONUS` · `TWIN_WIN` (+ `participationRate`, `bonusLevel`, `cap`) | participation à la hausse (Twin-Win, Booster) |
| `issuerCall` | `null` ou `{callDates, noticePeriod, callPrice}` | Callable Note |

### Overlays (mappage direct)

- **Worst-of** : `underlying.basketType = "WORST_OF"`, une entrée par sous-jacent dans `components`.
- **Indice décrément** : `components[].decrement = {type, amount, accrualBasis}` (`POINTS` ex. 50 pts/an, `PERCENT` ex. 0.05/an).
- **Step-down / step-up** : `autocall.triggerType` + `initialTrigger`/`stepPerPeriod`/`floorTrigger`, ou `triggerSchedule` explicite.
- **Mémoire** : `coupon.memory = true`.
- **Airbag / gearing** : `knockIn.airbagLevel` / `knockIn.gearing`.
- **Quanto / compo** : `underlying.quanto`.
- **Strike moyenné / lookback / low-strike** : `components[].initialLevel.mode`.
- **Non-call / coupons garantis** : `observation.noCallPeriods` / `coupon.guaranteedPeriods`.
- **Cap / floor / participation** : `finalRedemption.upside.cap`, `knockIn.floor`, `upside.participationRate`.

## 4. Exemples (demande → extraction)

**« Athena LVMH 3 ans, PDI 70% européen, barrière autocall 100%, constatation annuelle, NC 1 an, solve le coupon »**
→ `productFamily: "ATHENA"`, `coupon.regime: "CALL_CONTINGENT"`, `coupon.rate: null`,
`coupon.cumulativeAtRedemption: true`, `underlying.components[0].name: "LVMH"`,
`observation.frequency: "ANNUAL"`, `numberOfObservations: 3`, `noCallPeriods: 1`,
`autocall.triggerType: "CONSTANT"`, `autocall.initialTrigger: 1.0`,
`finalRedemption.knockIn.barrier: 0.70`, `knockIn.observationStyle: "EUROPEAN_AT_MATURITY"`.

**« Phoenix Mémoire worst-of Total/BNP 6 ans, coupon 2%/trimestre barrière 60%, PDI 55% américain, step-down -1%/trimestre »**
→ `productFamily: "PHOENIX"`, `coupon.regime: "PERIODIC_CONTINGENT"`, `coupon.memory: true`,
`coupon.rate: 0.02`, `coupon.rateBasis: "PER_PERIOD"`, `coupon.barrier: 0.60`,
`underlying.basketType: "WORST_OF"`, `components: [{name:"TotalEnergies"}, {name:"BNP Paribas"}]`,
`observation.frequency: "QUARTERLY"`, `numberOfObservations: 24`,
`autocall.triggerType: "STEP_DOWN"`, `autocall.initialTrigger: 1.0`, `autocall.stepPerPeriod: -0.01`,
`finalRedemption.knockIn.barrier: 0.55`, `knockIn.observationStyle: "AMERICAN_CONTINUOUS"`.

## Sortie attendue

Pour **chaque cotation**, un objet `autocall/v1` complet : TOUS les champs métier du §3
(`schemaVersion`, `productFamily`, `dates`, `underlying`, `observation`, `autocall`,
`coupon`, `finalRedemption`, …, à `null` quand non déductibles) **PLUS** `quoteId`,
`label`, `confidenceScore`, `extractedTokens`, `aiExplanation`. Ce sont deux parties
distinctes de la MÊME réponse, pas une alternative l'une à l'autre. Enveloppe finale :
`{ "quotes": [ … ] }`.

**Anti-exemple à ne jamais produire** (`extractedTokens` seul, sans les champs métier) :
```json
{ "quotes": [ { "quoteId": 1, "label": "...", "confidenceScore": 0.9,
  "extractedTokens": [ ... ], "aiExplanation": "..." } ] }
```
Chaque objet de `quotes` doit toujours contenir aussi `schemaVersion`, `dates`,
`underlying`, `coupon`, `finalRedemption`, etc. — comme dans l'enveloppe du §3.
