---
key: equity-autocall
name: Actions — Autocall / Athena / Phoenix / Reverse Convertible
kind: domain
assetClass: EQUITY
productFamily: autocall
scopeDescription: Produits à rappel automatique sur sous-jacent actions — Athena, Phoenix (+ mémoire), Autocall/Barrier Reverse Convertible, Twin-Win, Booster, Callable Note, avec overlays (worst-of, step-down, airbag, indice décrément, quanto). Schéma de sortie riche "autocall/v1".
---
# Typologies de produits Autocall — référence produit et templates JSON

> **⚠️ ARCHIVE — non chargé par le service.** Ce document complet a servi de base
> au pré-prompt d'extraction `equity-autocall`, désormais réduit à sa version
> compacte dans `inference-service/prompts/equity-autocall.md` (le seul fichier
> effectivement seedé — `prompts/reference/` n'est pas parcouru). Gardé ici comme
> référence métier ; le `key:` du frontmatter ci-dessus est sans effet.

> **Objet du document.** Décrire, famille par famille, les produits structurés à rappel
> automatique (*autocallables*) sur sous-jacent actions : caractéristiques contractuelles,
> mécanique des flux, formules de payoff, et template JSON permettant d'instancier chaque produit.
> **Usage prévu :** contexte de référence pour un LLM (génération, classification, extraction
> ou validation de termes de produits structurés).
> **Schéma JSON de référence :** `autocall/v1` (§4).

---

## 0. Mode d'emploi et principe de classification

Un autocall n'est pas un produit unique mais une **combinatoire**. Trois niveaux de description
doivent être distingués et ne jamais être confondus :

1. **La famille** = un *régime de coupon* × un *régime de remboursement final*.
   C'est ce que le marché nomme Athena, Phoenix, Reverse Convertible, Twin-Win, etc. (§5).
2. **Les paramètres** = maturité, fréquence, niveaux de barrières, taux de coupon (§4).
3. **Les variantes transverses (« overlays »)** = worst-of, step-down, effet mémoire, airbag,
   indice décrément, quanto, strike moyenné… Elles se combinent librement avec la quasi-totalité
   des familles et **ne créent pas de nouvelle famille** (§6).

Conséquence pratique : un produit réel se décrit par `productFamily` + les overlays activés dans
les blocs correspondants. Un « Phoenix Mémoire Worst-of Step-Down sur indices décrément » est
un `PHOENIX` avec `coupon.memory = true`, `underlying.basketType = "WORST_OF"`,
`autocall.triggerType = "STEP_DOWN"` et un bloc `decrement` sur chaque composante.

---

## 1. Conventions de notation

Toutes les formules du document utilisent la notation suivante. Les niveaux et barrières sont
exprimés en **fraction du niveau initial** (`1.00` = 100 %), jamais en points d'indice.

| Symbole | Champ JSON | Définition |
|---|---|---|
| `N` | `notional.denomination` | Nominal (valeur nominale unitaire), ex. 1 000 EUR |
| `S_i(0)` | `underlying.components[i].initialLevel` | Niveau initial (strike) du sous-jacent *i*, constaté à la date de strike |
| `S_i(t)` | — | Niveau du sous-jacent *i* à la date *t* |
| `Perf_i(t)` | — | `S_i(t) / S_i(0)` — performance relative du sous-jacent *i* |
| `Perf(t)` | — | Performance de référence du panier (voir ci-dessous) |
| `t_1 … t_n` | `observation.*` | Dates de constatation, ordonnées ; `n` = nombre de constatations |
| `T` | `dates.finalValuationDate` | Date de constatation finale, `T = t_n` |
| `k` | — | Indice de la constatation courante, `k ∈ [1, n]` |
| `B_AC(k)` | `autocall.triggerSchedule[k]` | Barrière de rappel automatique à la date `t_k` |
| `B_CPN` | `coupon.barrier.level` | Barrière de coupon (Phoenix uniquement) |
| `B_PDI` | `finalRedemption.knockIn.barrier` | Barrière de protection du capital (barrière du put down-and-in) |
| `c` | `coupon.rate` | Coupon par période, en fraction du nominal |
| `PR` | `finalRedemption.upside.participationRate` | Taux de participation à la hausse |
| `A` | `finalRedemption.knockIn.airbagLevel` | Niveau airbag (amortisseur de perte) |

**Performance de référence du panier** — déterminée par `underlying.basketType` :

```
SINGLE           : Perf(t) = Perf_1(t)
WORST_OF         : Perf(t) = min over i of Perf_i(t)          <- cas dominant du marché
BEST_OF          : Perf(t) = max over i of Perf_i(t)
WEIGHTED_BASKET  : Perf(t) = sum over i of ( w_i * Perf_i(t) ),  sum of w_i = 1
```

**Convention de date de paiement** — un flux constaté à `t_k` est réglé à `t_k + settlementLag`
(typiquement 5 à 10 jours ouvrés). Les formules ci-dessous donnent le montant, pas la date de règlement.

---

## 2. Anatomie d'un autocall — les six briques

Tout produit décrit dans ce document se ramène à ces six briques. Une famille se définit
entièrement par la façon dont elle paramètre les briques 3, 4 et 5.

### 2.1 Brique 1 — Sous-jacent et niveau initial

- **Nature** : indice actions large (EURO STOXX 50, S&P 500, CAC 40), **indice décrément**
  (voir §6.2, dominant sur le marché retail EUR), action unique, ETF, ou panier.
- **Structure de panier** : `SINGLE` ou, très majoritairement pour les produits à haut coupon,
  `WORST_OF` sur 2 à 5 sous-jacents. Le worst-of est le principal levier de rendement : il augmente
  fortement la valeur du put vendu par l'investisseur, donc le coupon affiché.
- **Niveau initial (strike)** : cours de clôture officiel à la date de strike. Variantes :
  moyennage sur plusieurs dates (`AVERAGE`), strike rétrospectif au minimum observé (`LOOKBACK_MIN`),
  ou strike décoté (`FIXED` à 0,90 par exemple, dit *low strike*).
- **Cours de référence** : cours de clôture officiel ; pour les barrières américaines, cours
  intraday ou clôture selon le terme.

### 2.2 Brique 2 — Calendrier de constatation

- **Maturité contractuelle** : 2 à 12 ans (elle n'est qu'un *maximum* : la maturité effective est
  incertaine, c'est le trait caractéristique de la famille).
- **Fréquence** : annuelle, semestrielle, trimestrielle, mensuelle. Plus la fréquence est élevée,
  plus le rappel est probable tôt et plus le coupon périodique est faible.
- **Période de non-rappel (*lock-out* / *no-call*)** : les premières dates ne sont pas rappelables.
  Utilisée pour garantir une durée de vie minimale et un rendement minimal.
- **Décalage de règlement** : 5 à 10 jours ouvrés après constatation.

### 2.3 Brique 3 — Le rappel automatique (*autocall trigger*)

À chaque date de constatation rappelable, si `Perf(t_k) >= B_AC(k)`, le produit est **remboursé
par anticipation** au pair augmenté du coupon dû, et **s'éteint définitivement**. Le déclenchement
est automatique et contractuel : ni l'émetteur ni l'investisseur n'ont d'option discrétionnaire
(sauf famille `CALLABLE_NOTE`, §5.10).

- **Observation** : européenne, à la date de constatation uniquement (`EUROPEAN_ON_DATE`).
  Les barrières de rappel américaines/continues sont rares.
- **Profil de barrière** (`triggerType`) :
  - `CONSTANT` — niveau fixe, typiquement 1,00 (100 % du strike) ;
  - `STEP_DOWN` — barrière dégressive, ex. 1,00 puis −0,05/an avec plancher à 0,70 : le rappel
    devient de plus en plus probable, ce qui raccourcit la durée de vie attendue ;
  - `STEP_UP` — barrière croissante (rare, allonge la durée de vie et augmente le coupon) ;
  - `EXPLICIT` — grille date par date.

### 2.4 Brique 4 — Le coupon

Quatre régimes, qui déterminent la famille :

| Régime (`coupon.regime`) | Condition de versement | Familles |
|---|---|---|
| `CALL_CONTINGENT` | Versé **uniquement** en cas de rappel ou à maturité si la barrière finale est atteinte ; cumulé sur toutes les périodes écoulées (effet « boule de neige ») | Athena et dérivées |
| `PERIODIC_CONTINGENT` | Versé à chaque constatation si `Perf(t_k) >= B_CPN`, indépendamment du rappel | Phoenix |
| `UNCONDITIONAL` | Versé à chaque constatation tant que le produit vit, sans condition de marché | Reverse Convertible (ARC, BRC) |
| `NONE` | Pas de coupon ; le rendement passe par la participation ou le bonus à maturité | Twin-Win, Booster/Bonus |

**Effet mémoire** (`coupon.memory`) : overlay applicable au régime `PERIODIC_CONTINGENT`. Les
coupons non versés ne sont pas perdus mais mémorisés ; ils sont rattrapés intégralement à la
première constatation ultérieure au-dessus de `B_CPN` (§6.3).

### 2.5 Brique 5 — La protection du capital à maturité (le PDI)

C'est le cœur du risque. L'investisseur est **vendeur d'un put à barrière activante à la baisse**
(*Put Down-and-In*, abrégé **PDI**), de strike généralement 1,00 et de barrière `B_PDI`.

- Tant que la barrière n'est pas franchie, le put reste inactif : le capital est remboursé à 100 %.
- Si la barrière est franchie, le put s'active et l'investisseur subit **la totalité de la baisse
  depuis le strike** (et non depuis la barrière) : remboursement `N × Perf(T)`.
- La prime de ce put est ce qui **finance le coupon**. Plus `B_PDI` est basse, moins le put vaut,
  plus le coupon est faible. Il n'y a pas de rendement gratuit : le coupon est le prix du risque vendu.

**Mode d'observation de la barrière** (`knockIn.observationStyle`), déterminant pour le risque :

| Mode | Description | Marché typique |
|---|---|---|
| `EUROPEAN_AT_MATURITY` | Observée **uniquement** à la constatation finale. Une baisse intermédiaire sous la barrière est sans effet si le sous-jacent remonte. | France / retail EUR — dominant |
| `AMERICAN_CONTINUOUS` | Observée en continu (intraday) pendant toute la vie du produit. Beaucoup plus risquée. | Suisse / Allemagne (BRC) |
| `AMERICAN_CLOSING` | Observée sur les cours de clôture quotidiens. | Intermédiaire |
| `WINDOW` | Observée en continu sur une fenêtre finale (ex. dernière année). | Variante |

**Discontinuité** : sauf overlay airbag, le payoff présente un saut au niveau `B_PDI`. Avec
`B_PDI = 0,60`, une performance finale de 60,01 % rembourse `N`, une performance de 59,99 %
rembourse `0,5999 × N`. Cette falaise est le risque le plus mal compris de ces produits.

**Alternatives à la protection conditionnelle** :
- `FULL_PROTECTION` — capital garanti à 100 % à maturité, pas de PDI (§5.6) ;
- `PARTIAL_PROTECTION` — capital garanti à un niveau `protectionLevel < 1,00` (ex. 0,90) ;
- overlay **airbag** — perte amortie au lieu d'être linéaire (§5.7).

### 2.6 Brique 6 — Le risque de crédit émetteur

Le produit est une **dette senior de l'émetteur** (format EMTN, certificat, ou dépôt structuré).
Toutes les protections décrites sont des promesses contractuelles de l'émetteur : en cas de défaut
ou de résolution bancaire (*bail-in*), le capital « garanti » ne l'est plus. Ce risque doit figurer
dans toute description complète et n'est jamais couvert par le payoff.

### 2.7 Décomposition optionnelle (vision structureur)

Un autocall classique se réplique par :

```
Autocall = Obligation zéro-coupon émetteur (valeur actuelle du nominal)
         + panier d'options digitales à barrière (les coupons et les rappels)
         - Put Down-and-In de strike 1,00 et de barrière B_PDI   [vendu par l'investisseur]
```

Sensibilités structurelles pour l'investisseur (utiles pour expliquer le niveau de coupon affiché) :

| Facteur | Effet d'une hausse du facteur sur le coupon offert | Raison |
|---|---|---|
| Volatilité implicite | ↑ | Le put vendu vaut plus cher |
| Skew (pente de la volatilité à la baisse) | ↑ | Le PDI est très sensible au skew |
| Dividendes anticipés | ↑ | Baisse du forward, put plus cher |
| Corrélation entre sous-jacents (worst-of) | ↓ | Une corrélation faible renchérit le worst-of, donc le coupon |
| Nombre de sous-jacents (worst-of) | ↑ | Dispersion accrue |
| Spread de financement de l'émetteur | ↑ | Financement moins cher pour l'investisseur |
| Niveau de la barrière `B_PDI` | ↑ | Plus de risque vendu |

### 2.8 Risques à mentionner systématiquement

1. **Risque de perte en capital** au-delà de la barrière, sans amortissement (sauf airbag).
2. **Risque de non-versement du coupon** (régimes conditionnels).
3. **Risque de durée incertaine** : rappel immédiat en marché haussier (risque de réinvestissement),
   immobilisation jusqu'à la maturité maximale en marché baissier (« risque d'allongement »).
4. **Rendement plafonné** : l'investisseur ne participe pas à la hausse au-delà des coupons
   (sauf familles Twin-Win et Booster).
5. **Absence de dividendes** : l'investisseur n'y a jamais droit ; sur indice décrément ils sont
   forfaitisés et retranchés (§6.2).
6. **Risque de crédit émetteur** (§2.6).
7. **Risque de liquidité** : marché secondaire assuré par le seul émetteur, avec fourchette.

---

## 3. Carte des familles

| # | Famille (`productFamily`) | Coupon | Rappel anticipé | Capital à maturité | Participation à la hausse |
|---|---|---|---|---|---|
| 01 | `ATHENA` | Conditionnel au rappel, cumulatif | Automatique | PDI conditionnel | Non |
| 02 | `PHOENIX` | Périodique conditionnel (`B_CPN`) | Automatique | PDI conditionnel | Non |
| 03 | `PHOENIX` + `memory` | Périodique conditionnel avec rattrapage | Automatique | PDI conditionnel | Non |
| 04 | `AUTOCALL_REVERSE_CONVERTIBLE` | Fixe, inconditionnel | Automatique | PDI conditionnel | Non |
| 05 | `BARRIER_REVERSE_CONVERTIBLE` | Fixe, inconditionnel | **Aucun** | PDI, souvent américain, livraison physique possible | Non |
| 06 | `ATHENA_CAPITAL_PROTECTED` | Conditionnel au rappel, cumulatif | Automatique | **Garanti à 100 %** | Non |
| 07 | `ATHENA` + `airbag` | Conditionnel au rappel, cumulatif | Automatique | PDI avec perte amortie | Non |
| 08 | `TWIN_WIN_AUTOCALL` | Optionnel | Automatique | PDI conditionnel | **Oui, hausse et baisse** |
| 09 | `BOOSTER_AUTOCALL` | Aucun ou faible | Automatique | PDI conditionnel | **Oui, avec bonus/levier** |
| 10 | `CALLABLE_NOTE` | Fixe ou conditionnel | **Discrétionnaire (émetteur)** | PDI ou garanti | Non |

Lecture : les familles 01 à 04 se distinguent **uniquement** par le régime de coupon ; les familles
06 à 09 se distinguent **uniquement** par le régime de remboursement final ; la famille 05 supprime
le rappel ; la famille 10 remplace le rappel automatique par une option de l'émetteur.

---

## 4. L'enveloppe JSON commune (`autocall/v1`)

Tous les templates de la §5 sont des instances de cette enveloppe. Un bloc non pertinent pour une
famille est laissé à `null` plutôt que supprimé, afin qu'un même parseur traite toutes les familles.

### 4.1 Enveloppe complète, tous blocs renseignés

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "ATHENA",
  "productName": "Athena EURO STOXX 50 Decrement 10Y",
  "identifiers": {
    "isin": "XS0000000000",
    "internalId": "AC-2026-0001"
  },
  "issuer": {
    "name": "Banque Emettrice SA",
    "creditRating": "A",
    "seniority": "SENIOR_PREFERRED",
    "format": "EMTN"
  },
  "currency": "EUR",
  "notional": {
    "denomination": 1000.0,
    "issueSize": 20000000.0,
    "issuePrice": 1.0
  },
  "settlement": {
    "type": "CASH",
    "physicalDelivery": null
  },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2036-09-22",
    "maturityDate": "2036-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": "SX5EDEC",
        "name": "EURO STOXX 50 Decrement 50 Points",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SX5ED50P Index", "isin": null },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": {
          "mode": "CLOSE_ON_STRIKE_DATE",
          "value": null,
          "observationDates": []
        },
        "decrement": {
          "type": "POINTS",
          "amount": 50.0,
          "accrualBasis": "ACT/365"
        }
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "ANNUAL",
    "firstObservationDate": "2027-09-22",
    "numberOfObservations": 10,
    "noCallPeriods": 1,
    "settlementLag": "10B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "STEP_DOWN",
    "initialTrigger": 1.0,
    "stepPerPeriod": -0.05,
    "floorTrigger": 0.7,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "CALL_CONTINGENT",
    "rate": 0.08,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": true,
    "guaranteedPeriods": 0,
    "paymentLag": "10B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": 1.0,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.6,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null,
  "fees": {
    "structuringFee": 0.005,
    "distributionFee": 0.02,
    "totalCostsAtInception": 0.025
  },
  "regulatory": {
    "priipsRiskIndicator": 6,
    "targetMarket": "RETAIL_MASS",
    "documentation": "KID_PRIIPS"
  }
}
```

### 4.2 Dictionnaire des champs discriminants

| Champ | Valeurs admises | Rôle |
|---|---|---|
| `productFamily` | `ATHENA`, `PHOENIX`, `AUTOCALL_REVERSE_CONVERTIBLE`, `BARRIER_REVERSE_CONVERTIBLE`, `ATHENA_CAPITAL_PROTECTED`, `TWIN_WIN_AUTOCALL`, `BOOSTER_AUTOCALL`, `CALLABLE_NOTE` | Détermine le régime de coupon et de remboursement |
| `underlying.basketType` | `SINGLE`, `WORST_OF`, `BEST_OF`, `WEIGHTED_BASKET` | Définit `Perf(t)` (§1) |
| `underlying.quanto` | `NONE`, `QUANTO`, `COMPO` | Traitement du risque de change |
| `initialLevel.mode` | `CLOSE_ON_STRIKE_DATE`, `AVERAGE`, `LOOKBACK_MIN`, `FIXED` | Mode de fixation du strike |
| `decrement` | `null` ou `{type: POINTS\|PERCENT, amount, accrualBasis}` | Dividende synthétique forfaitaire (§6.2) |
| `autocall.enabled` | `true`, `false` | `false` pour `BARRIER_REVERSE_CONVERTIBLE` |
| `autocall.triggerType` | `CONSTANT`, `STEP_DOWN`, `STEP_UP`, `EXPLICIT` | Profil de la barrière de rappel |
| `autocall.triggerSchedule` | `null` ou `[{"index": k, "level": x}]` | Grille explicite ; prioritaire sur `initialTrigger`/`stepPerPeriod` si renseignée |
| `coupon.regime` | `CALL_CONTINGENT`, `PERIODIC_CONTINGENT`, `UNCONDITIONAL`, `NONE` | Voir §2.4 |
| `coupon.rateBasis` | `PER_PERIOD`, `PER_ANNUM` | `PER_PERIOD` : `c` est le montant par constatation ; `PER_ANNUM` : à proratiser par la fréquence |
| `coupon.memory` | `true`, `false` | Rattrapage des coupons non versés (§6.3) |
| `coupon.cumulativeAtRedemption` | `true`, `false` | `true` = coupon de rappel égal à `k × c` (effet boule de neige) |
| `finalRedemption.protectionType` | `CONDITIONAL_PDI`, `FULL_PROTECTION`, `PARTIAL_PROTECTION` | Nature de la protection |
| `finalRedemption.finalCouponTrigger` | Nombre ou `null` | Barrière de coupon à maturité, souvent distincte de `B_AC` |
| `knockIn.observationStyle` | `EUROPEAN_AT_MATURITY`, `AMERICAN_CONTINUOUS`, `AMERICAN_CLOSING`, `WINDOW` | Mode d'observation de `B_PDI` (§2.5) |
| `knockIn.gearing` | Nombre (défaut `1.0`) | Levier appliqué à la perte (`> 1` = perte amplifiée) |
| `knockIn.airbagLevel` | `null` ou nombre | Niveau de renormalisation de la perte (§5.7) |
| `upside.type` | `NONE`, `PARTICIPATION`, `BONUS`, `TWIN_WIN` | Régime de participation à la hausse |
| `issuerCall` | `null` ou `{callDates, noticePeriod, callPrice}` | Option de remboursement discrétionnaire de l'émetteur (§5.10) |

### 4.3 Convention des templates de la §5

Pour rester lisibles, les templates par famille **omettent** les blocs administratifs communs
(`identifiers`, `issuer`, `settlement`, `fees`, `regulatory`) et ne conservent que le bloc produit.
Ils sont sinon complets et directement instanciables en y réinjectant l'enveloppe de §4.1.

---

## 5. Les dix familles

### 5.1 — Athena

**`productFamily` :** `ATHENA`
**Aussi appelé :** autocall à coupon de rappel, coupon « boule de neige » (*snowball coupon*),
Express Certificate / Express Zertifikat (marché allemand), autocall « tout ou rien ».

#### Description

Famille de référence du marché retail européen. L'investisseur ne perçoit **aucun flux
intermédiaire** : le coupon n'est versé qu'au moment du remboursement, par anticipation ou à
maturité, et il est alors **cumulé sur toutes les périodes écoulées** (`k × c`). Le produit se
comporte donc comme une obligation à coupon zéro conditionnelle, dont le rendement est capturé
d'un bloc au premier franchissement à la hausse de la barrière de rappel.

En contrepartie de ce rendement, l'investisseur vend un put down-and-in : si à maturité le
sous-jacent est sous la barrière de protection, il subit intégralement la baisse depuis le strike.
Le profil est **asymétrique et plafonné** : gain borné à `n × c`, perte bornée seulement par zéro.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `CALL_CONTINGENT`, cumulatif |
| Coupon intermédiaire | Aucun |
| Barrière de coupon `B_CPN` | Sans objet (le coupon suit la barrière de rappel) |
| Barrière de rappel `B_AC` | 100 % du strike, `CONSTANT` ou `STEP_DOWN` |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (50–70 %) |
| Observation de `B_PDI` | Européenne à maturité (marché EUR) |
| Participation à la hausse | Aucune |
| Maturité | 6 à 12 ans, constatations annuelles ou semestrielles |

#### Flux

1. **Date de strike** — constatation de `S_i(0)`. Aucun flux.
2. **Constatations `t_1` à `t_{n-1}`** — si `Perf(t_k) >= B_AC(k)` : versement de
   `N × (1 + k × c)` et extinction du produit. Sinon : **aucun flux**, le produit continue.
3. **Constatation finale `T`** — trois branches exclusives :
   - `Perf(T) >= B_AC(n)` → `N × (1 + n × c)` : capital et tous les coupons ;
   - `B_PDI <= Perf(T) < B_AC(n)` → `N` : capital seul, aucun coupon (« scénario blanc ») ;
   - `Perf(T) < B_PDI` → `N × Perf(T)` : perte identique à celle du sous-jacent.

#### Payoff

```
Pour k = 1 .. n-1 :
    si Perf(t_k) >= B_AC(k)  ->  Flux = N * (1 + k * c)  ;  FIN

À maturité (k = n), si non rappelé :
    si   Perf(T) >= B_AC(n)   ->  Flux = N * (1 + n * c)
    sinon si Perf(T) >= B_PDI ->  Flux = N
    sinon                     ->  Flux = N * Perf(T)
```

Variante fréquente : `finalCouponTrigger` distinct de `B_AC(n)` — le coupon final est versé dès
que `Perf(T)` dépasse un seuil plus bas (ex. 80 %) que la barrière de rappel.

#### Exemple chiffré

`N = 1 000 EUR`, `c = 8 % par an`, `B_AC = 100 %` constante, `B_PDI = 60 %`, `n = 10` annuel.

| Scénario | Trajectoire | Flux perçus | Rendement |
|---|---|---|---|
| Rappel en année 2 | 92 % en t1, 104 % en t2 | 1 160 EUR en t2 | +16 % en 2 ans |
| Rappel en année 7 | < 100 % de t1 à t6, 101 % en t7 | 1 560 EUR en t7 | +56 % en 7 ans |
| Scénario blanc | jamais ≥ 100 %, 75 % à maturité | 1 000 EUR en T | 0 % en 10 ans |
| Scénario de perte | 45 % à maturité | 450 EUR en T | −55 % en 10 ans |

#### Paramètres de marché indicatifs

Ordres de grandeur constatés sur le marché retail EUR, à titre illustratif uniquement :
coupon 5 % à 10 % par an sur indice décrément mono-sous-jacent, 8 % à 14 % en worst-of ;
`B_PDI` de 50 % à 70 % ; maturité 8 à 12 ans ; step-down de 0 à −5 %/an.

#### Points d'attention

- Le **scénario blanc** (capital rendu sans aucun coupon après 10 ans) est le scénario médian
  le plus sous-estimé : il représente une perte réelle importante en valeur actualisée.
- Le rappel très précoce crée un **risque de réinvestissement** : le rendement annualisé est
  attractif, mais sur une durée subie.
- Le coupon `k × c` est **linéaire, non capitalisé**.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "ATHENA",
  "productName": "Athena 10Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2036-09-22",
    "maturityDate": "2036-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "EURO STOXX 50",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SX5E Index", "isin": "EU0009658145" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "ANNUAL",
    "firstObservationDate": "2027-09-22",
    "numberOfObservations": 10,
    "noCallPeriods": 0,
    "settlementLag": "10B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.0,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "CALL_CONTINGENT",
    "rate": 0.08,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": true,
    "guaranteedPeriods": 0,
    "paymentLag": "10B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": 1.0,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.6,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.2 — Phoenix

**`productFamily` :** `PHOENIX`
**Aussi appelé :** autocall à coupon conditionnel périodique, autocall de rendement (*income autocall*),
Phoenix Autocallable.

#### Description

Le Phoenix dissocie **deux barrières** là où l'Athena n'en avait qu'une :

- une **barrière de coupon** `B_CPN`, basse (typiquement 50 % à 70 %), qui conditionne le versement
  d'un coupon **à chaque date de constatation** ;
- une **barrière de rappel** `B_AC`, haute (typiquement 100 %), qui déclenche le remboursement anticipé.

Le produit distribue donc un revenu régulier même en marché baissier, tant que le sous-jacent reste
au-dessus d'un seuil bas. C'est le profil de « rendement » par excellence, préféré à l'Athena par les
investisseurs recherchant des flux périodiques plutôt qu'un gain terminal.

Le coupon périodique du Phoenix est mécaniquement **inférieur** au coupon cumulé d'un Athena de
mêmes barrières : la probabilité de versement est bien plus élevée, donc le prix de chaque coupon
digital aussi.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `PERIODIC_CONTINGENT` |
| Coupon intermédiaire | Oui, à chaque constatation si `Perf(t_k) >= B_CPN` |
| Barrière de coupon `B_CPN` | 50 % à 70 %, souvent égale à `B_PDI` |
| Barrière de rappel `B_AC` | 100 %, `CONSTANT` ou `STEP_DOWN` ; toujours `B_AC >= B_CPN` |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (50–70 %) |
| Participation à la hausse | Aucune |
| Maturité | 3 à 10 ans, constatations trimestrielles ou semestrielles |

#### Flux

1. **Date de strike** — constatation de `S_i(0)`.
2. **Constatations `t_1` à `t_{n-1}`**, dans cet ordre :
   - si `Perf(t_k) >= B_CPN` : versement du coupon `N × c` ;
   - si `Perf(t_k) >= B_AC(k)` : versement complémentaire de `N` et **extinction** du produit.
   - Les deux conditions sont indépendantes : un rappel s'accompagne toujours d'un coupon puisque
     `B_AC >= B_CPN`.
3. **Constatation finale `T`**, si non rappelé :
   - coupon `N × c` si `Perf(T) >= B_CPN` ;
   - capital : `N` si `Perf(T) >= B_PDI`, sinon `N × Perf(T)`.

#### Payoff

```
Pour k = 1 .. n :
    Coupon(k) = N * c   si Perf(t_k) >= B_CPN   sinon 0
    si k < n et Perf(t_k) >= B_AC(k)  ->  Flux = N + Coupon(k)  ;  FIN

À maturité (k = n), si non rappelé :
    si   Perf(T) >= B_PDI  ->  Flux = N + Coupon(n)
    sinon                  ->  Flux = N * Perf(T) + Coupon(n)
```

Note : lorsque `B_CPN = B_PDI`, le coupon final et la protection du capital sont déclenchés par la
même condition, ce qui simplifie la commercialisation mais concentre le risque sur un seul seuil.

#### Exemple chiffré

`N = 1 000 EUR`, `c = 2 % par trimestre`, `B_CPN = 60 %`, `B_AC = 100 %`, `B_PDI = 60 %`.

| Constatation | `Perf(t_k)` | Coupon | Rappel |
|---|---|---|---|
| t1 | 72 % | 20 EUR | non |
| t2 | 58 % | 0 EUR (perdu, sans effet mémoire) | non |
| t3 | 88 % | 20 EUR | non |
| t4 | 104 % | 20 EUR | **oui** → 1 000 EUR de capital |

Total perçu : 1 060 EUR sur un an.

#### Paramètres de marché indicatifs

Coupon 5 % à 9 % par an sur mono-sous-jacent, 8 % à 15 % en worst-of sur actions ;
`B_CPN` 50–70 % ; `B_PDI` 50–65 % ; maturité 3 à 8 ans ; fréquence trimestrielle dominante.

#### Points d'attention

- Ne pas confondre `B_CPN` (coupon) et `B_PDI` (capital) : elles sont souvent égales mais
  juridiquement distinctes et observées différemment (`B_CPN` est toujours européenne à la date).
- Sans effet mémoire, un coupon manqué est **définitivement perdu** (voir §5.3).
- La fréquence élevée des constatations raccourcit fortement la durée de vie attendue.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "PHOENIX",
  "productName": "Phoenix Worst-of 6Y quarterly",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2032-09-22",
    "maturityDate": "2032-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "WORST_OF",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "EURO STOXX 50",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SX5E Index", "isin": "EU0009658145" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      },
      {
        "ref": "UND2",
        "name": "S&P 500",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SPX Index", "isin": "US78378X1072" },
        "currency": "USD",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "QUARTERLY",
    "firstObservationDate": "2026-12-22",
    "numberOfObservations": 24,
    "noCallPeriods": 4,
    "settlementLag": "5B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.0,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "PERIODIC_CONTINGENT",
    "rate": 0.02,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": { "level": 0.6, "observationStyle": "EUROPEAN_ON_DATE" },
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 0,
    "paymentLag": "5B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.6,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.3 — Phoenix Mémoire

**`productFamily` :** `PHOENIX` avec `coupon.memory = true`
**Aussi appelé :** Phoenix Memory, autocall à coupon mémoire, *snowball memory coupon*.

#### Description

Variante la plus répandue du Phoenix. Les coupons non versés (constatations sous `B_CPN`) ne sont
pas perdus mais **mémorisés** ; à la première constatation ultérieure au-dessus de `B_CPN`,
l'investisseur reçoit d'un bloc le coupon courant **et tous les coupons mémorisés**. Le produit
devient donc « rattrapable » : le rendement total ne dépend plus du chemin, mais uniquement de la
dernière constatation au-dessus de `B_CPN`.

Si la toute dernière constatation est au-dessus de `B_CPN`, l'investisseur perçoit
**l'intégralité** des `n × c` coupons, quelle qu'ait été la trajectoire intermédiaire. À l'inverse,
tous les coupons mémorisés sont définitivement perdus si aucune constatation ultérieure ne
repasse au-dessus de la barrière.

#### Caractéristiques

Identiques au Phoenix (§5.2), avec :

| Caractéristique | Valeur |
|---|---|
| Effet mémoire | `coupon.memory = true` |
| Coupon versé en `t_k` | `(k − P) × c × N` où `P` est l'indice de la dernière constatation payée |
| Coupon maximal cumulable | `n × c` |
| Impact sur le prix | Coupon facial inférieur d'environ 5 à 15 % à celui d'un Phoenix sans mémoire, à barrières égales |

#### Flux

1. Initialisation : `P = 0` (aucun coupon versé).
2. À chaque constatation `t_k` :
   - si `Perf(t_k) >= B_CPN` : versement de `(k − P) × c × N`, puis `P ← k` ;
   - sinon : aucun versement, `P` inchangé (les `k − P` coupons restent mémorisés).
3. Rappel et remboursement final : identiques au Phoenix.

#### Payoff

```
P = 0
Pour k = 1 .. n :
    si Perf(t_k) >= B_CPN :
        Coupon(k) = (k - P) * c * N
        P = k
    sinon :
        Coupon(k) = 0
    si k < n et Perf(t_k) >= B_AC(k)  ->  Flux = N + Coupon(k)  ;  FIN

À maturité (k = n), si non rappelé :
    si   Perf(T) >= B_PDI  ->  Flux = N + Coupon(n)
    sinon                  ->  Flux = N * Perf(T) + Coupon(n)
```

#### Exemple chiffré

Mêmes paramètres qu'en §5.2 (`c = 2 %` par trimestre, `B_CPN = 60 %`), avec effet mémoire :

| Constatation | `Perf(t_k)` | Coupons mémorisés avant | Coupon versé |
|---|---|---|---|
| t1 | 72 % | 0 | 20 EUR |
| t2 | 58 % | 0 | 0 EUR (1 coupon mémorisé) |
| t3 | 55 % | 1 | 0 EUR (2 coupons mémorisés) |
| t4 | 88 % | 2 | **60 EUR** (rattrapage de t2, t3 + coupon t4) |
| t5 | 104 % | 0 | 20 EUR + rappel de 1 000 EUR |

#### Points d'attention

- La mémoire porte **uniquement sur le coupon**, jamais sur la protection du capital.
- Bien préciser dans les termes si le coupon mémorisé est versé lors d'un rappel (cas standard)
  et à maturité en cas de franchissement de `B_PDI` (variable selon les émetteurs).

#### Template JSON

Le template est celui du §5.2, dans lequel le bloc `coupon` devient :

```json
{
  "coupon": {
    "regime": "PERIODIC_CONTINGENT",
    "rate": 0.02,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": { "level": 0.6, "observationStyle": "EUROPEAN_ON_DATE" },
    "memory": true,
    "memoryScope": "ALL_MISSED_SINCE_INCEPTION",
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 0,
    "paymentLag": "5B"
  }
}
```

---

### 5.4 — Autocall Reverse Convertible (ARC)

**`productFamily` :** `AUTOCALL_REVERSE_CONVERTIBLE`
**Aussi appelé :** autocall à coupon garanti, *Autocallable Barrier Reverse Convertible*,
Express Bonus (variantes de place).

#### Description

Le coupon est **inconditionnel** : il est versé à chaque date de constatation tant que le produit
est vivant, quel que soit le niveau du sous-jacent. Il n'existe donc **aucune barrière de coupon**.
La seule condition de marché porte sur le remboursement du capital à maturité (PDI) et sur le
rappel anticipé.

C'est la structure la plus lisible pour l'investisseur : un revenu certain (sous réserve du risque
émetteur), une durée incertaine, un capital risqué. Le coupon y est mécaniquement plus faible qu'un
Phoenix de mêmes barrières, puisque le vendeur n'y adosse aucune condition.

Le rappel anticipé étant certain de survenir dès que le sous-jacent repasse au-dessus de `B_AC`,
la durée de vie effective est généralement courte.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `UNCONDITIONAL` |
| Barrière de coupon | **Aucune** (`coupon.barrier = null`) |
| Barrière de rappel `B_AC` | 100 % du strike, souvent `CONSTANT` |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (55–75 %) |
| Observation de `B_PDI` | Européenne à maturité, ou américaine continue selon la place |
| Sous-jacent typique | Action unique ou worst-of de 2–3 actions |
| Maturité | 1 à 3 ans, constatations trimestrielles |

#### Flux

1. **Date de strike** — constatation de `S_i(0)`.
2. **Constatations `t_1` à `t_{n-1}`** — versement systématique de `N × c`. Si
   `Perf(t_k) >= B_AC(k)`, versement complémentaire de `N` et extinction.
3. **Constatation finale `T`**, si non rappelé — versement de `N × c`, puis `N` si
   `Perf(T) >= B_PDI`, sinon `N × Perf(T)`.

#### Payoff

```
Pour k = 1 .. n :
    Coupon(k) = N * c                                 [inconditionnel]
    si k < n et Perf(t_k) >= B_AC(k)  ->  Flux = N + Coupon(k)  ;  FIN

À maturité (k = n), si non rappelé :
    si   Perf(T) >= B_PDI  ->  Flux = N + Coupon(n)
    sinon                  ->  Flux = N * Perf(T) + Coupon(n)
```

#### Points d'attention

- « Coupon garanti » ne signifie pas « capital garanti » : la confusion est la principale source de
  contentieux commercial sur cette famille.
- Le coupon cesse dès le rappel ; le rendement total peut être très inférieur au coupon annualisé
  affiché si le rappel intervient à la première date.
- Variante `guaranteedPeriods > 0` : les `m` premiers coupons sont inconditionnels et les suivants
  conditionnels — hybride ARC/Phoenix.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "AUTOCALL_REVERSE_CONVERTIBLE",
  "productName": "Autocall Reverse Convertible 2Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2028-09-22",
    "maturityDate": "2028-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "WORST_OF",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "TotalEnergies SE",
        "assetClass": "EQUITY_SINGLE_NAME",
        "identifiers": { "bloomberg": "TTE FP Equity", "isin": "FR0000120271" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      },
      {
        "ref": "UND2",
        "name": "Sanofi SA",
        "assetClass": "EQUITY_SINGLE_NAME",
        "identifiers": { "bloomberg": "SAN FP Equity", "isin": "FR0000120578" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "QUARTERLY",
    "firstObservationDate": "2026-12-22",
    "numberOfObservations": 8,
    "noCallPeriods": 2,
    "settlementLag": "5B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.0,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "UNCONDITIONAL",
    "rate": 0.0225,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 8,
    "paymentLag": "5B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.65,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.5 — Barrier Reverse Convertible (BRC)

**`productFamily` :** `BARRIER_REVERSE_CONVERTIBLE`
**Aussi appelé :** obligation convertible inversée à barrière, BRC, *Discount-plus*.
Sans barrière (`knockIn.barrier = 1.0`), il s'agit du Reverse Convertible simple.

#### Description

Structure **non rappelable** : elle sert de référence pour comprendre par différence tout le reste
de la typologie. Coupon fixe inconditionnel, maturité certaine, et à l'échéance un put vendu par
l'investisseur. C'est le format historique et dominant du marché suisse et allemand.

Deux traits la distinguent nettement des familles précédentes :

- la **barrière est le plus souvent américaine continue** : elle est surveillée sur toute la vie du
  produit, y compris en intraday. Un seul franchissement, même brièvement, active définitivement le
  put — même si le sous-jacent remonte ensuite au-dessus de la barrière ;
- le **règlement peut être physique** : en cas de barrière touchée et de performance finale
  inférieure au strike, l'investisseur reçoit un nombre d'actions égal au ratio de conversion
  `N / S(0)` (arrondi, avec soulte en espèces) plutôt qu'un montant en numéraire.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `UNCONDITIONAL` |
| Rappel anticipé | **Aucun** (`autocall.enabled = false`) |
| Maturité | **Certaine**, 6 mois à 2 ans |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (55–80 %) |
| Observation de `B_PDI` | `AMERICAN_CONTINUOUS` typiquement |
| Règlement | Numéraire ou **livraison physique** du sous-jacent le moins performant |
| Sous-jacent typique | Worst-of de 2 à 4 actions |

#### Flux

1. **Date de strike** — constatation de `S_i(0)` et du ratio de conversion `N / S_i(0)`.
2. **Chaque date de coupon** — versement inconditionnel de `N × c`. Aucun rappel possible.
3. **Pendant toute la vie du produit** — surveillance continue de la barrière : si
   `min over t of Perf(t) < B_PDI`, l'événement de knock-in est enregistré définitivement.
4. **À maturité** :
   - knock-in non survenu → `N` ;
   - knock-in survenu et `Perf(T) >= 1` → `N` ;
   - knock-in survenu et `Perf(T) < 1` → `N × Perf(T)` en numéraire, **ou** livraison de
     `N / S_worst(0)` actions du sous-jacent le moins performant.

#### Payoff

```
KI = 1 si il existe t dans [strikeDate, T] tel que Perf(t) < B_PDI, sinon 0
     (observation continue ; en observation européenne, remplacer par la seule date T)

Coupons : N * c à chaque date de paiement, inconditionnellement.

À maturité :
    si KI = 0 ou Perf(T) >= 1  ->  Flux = N
    sinon
        règlement espèces  ->  Flux = N * Perf(T)
        règlement physique ->  livraison de floor(N / S_worst(0)) actions + soulte
```

#### Points d'attention

- La barrière américaine est **beaucoup plus risquée** qu'une barrière européenne de même niveau :
  à volatilité et niveau identiques, la probabilité de franchissement est nettement supérieure.
- Le passage d'un BRC à un ARC (§5.4) consiste uniquement à activer `autocall.enabled = true`.
- La livraison physique transfère un risque post-échéance : l'investisseur se retrouve porteur des
  actions, avec leur risque de marché ultérieur.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "BARRIER_REVERSE_CONVERTIBLE",
  "productName": "BRC Worst-of 18M",
  "currency": "CHF",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "settlement": {
    "type": "PHYSICAL_OR_CASH",
    "physicalDelivery": {
      "deliverable": "WORST_PERFORMING_COMPONENT",
      "conversionRatioMode": "NOTIONAL_DIVIDED_BY_INITIAL_LEVEL",
      "fractionalSettlement": "CASH"
    }
  },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2028-03-22",
    "maturityDate": "2028-04-05",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["ZUR"]
  },
  "underlying": {
    "basketType": "WORST_OF",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "Nestle SA",
        "assetClass": "EQUITY_SINGLE_NAME",
        "identifiers": { "bloomberg": "NESN SW Equity", "isin": "CH0038863350" },
        "currency": "CHF",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      },
      {
        "ref": "UND2",
        "name": "Novartis AG",
        "assetClass": "EQUITY_SINGLE_NAME",
        "identifiers": { "bloomberg": "NOVN SW Equity", "isin": "CH0012005267" },
        "currency": "CHF",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "QUARTERLY",
    "firstObservationDate": "2026-12-22",
    "numberOfObservations": 6,
    "noCallPeriods": 0,
    "settlementLag": "5B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": false,
    "observationStyle": null,
    "triggerType": null,
    "initialTrigger": null,
    "stepPerPeriod": null,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": null
  },
  "coupon": {
    "regime": "UNCONDITIONAL",
    "rate": 0.0175,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 6,
    "paymentLag": "5B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.65,
      "observationStyle": "AMERICAN_CONTINUOUS",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.6 — Athena à capital protégé

**`productFamily` :** `ATHENA_CAPITAL_PROTECTED`
**Aussi appelé :** autocall à capital garanti, autocall sécurisé, *protected autocall*,
*capital protected express*.

#### Description

Le PDI est supprimé : à maturité, l'investisseur récupère **au minimum 100 % du nominal** (ou
`protectionLevel` en protection partielle), quel que soit le niveau du sous-jacent. Le seul aléa
porte sur le **rendement**, jamais sur le capital — sous réserve du risque de crédit émetteur, qui
reste entier et devient le risque dominant du produit.

Le financement du coupon ne venant plus de la vente d'un put, le coupon est nettement plus faible
et fortement dépendant du niveau des taux d'intérêt : ces produits ne redeviennent structurables
avec des coupons attractifs qu'en régime de taux élevés.

Variantes fréquentes : protection partielle (`PARTIAL_PROTECTION` à 90 %), barrière de rappel
relevée (105 % ou 110 %) pour financer un coupon plus élevé, ou maturité allongée.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `CALL_CONTINGENT` cumulatif, ou `PERIODIC_CONTINGENT` |
| Barrière de rappel `B_AC` | 100 % à 110 % |
| Protection du capital | `FULL_PROTECTION` à 100 % (ou `PARTIAL_PROTECTION`) |
| `knockIn` | **`null`** — aucun put vendu |
| Participation à la hausse | Aucune, ou faible participation en variante |
| Maturité | 5 à 12 ans |
| Risque dominant | Crédit émetteur et coût d'opportunité |

#### Flux

1. **Date de strike** — constatation de `S_i(0)`.
2. **Constatations `t_1` à `t_{n-1}`** — si `Perf(t_k) >= B_AC(k)` : versement de
   `N × (1 + k × c)` et extinction. Sinon aucun flux.
3. **Constatation finale `T`** — `N × (1 + n × c)` si `Perf(T) >= B_AC(n)`, sinon **`N`**.
   Il n'existe pas de troisième branche : la perte en capital est impossible.

#### Payoff

```
Pour k = 1 .. n-1 :
    si Perf(t_k) >= B_AC(k)  ->  Flux = N * (1 + k * c)  ;  FIN

À maturité (k = n), si non rappelé :
    si   Perf(T) >= B_AC(n)  ->  Flux = N * (1 + n * c)
    sinon                    ->  Flux = N * protectionLevel      [= N si protection totale]
```

#### Points d'attention

- Le pire scénario est le remboursement du seul nominal après 10 ans : **perte réelle** en pouvoir
  d'achat et coût d'opportunité, souvent présenté à tort comme un « scénario neutre ».
- La garantie est une promesse de l'émetteur, pas un dépôt garanti.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "ATHENA_CAPITAL_PROTECTED",
  "productName": "Athena Capital Protege 8Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2034-09-22",
    "maturityDate": "2034-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "CAC 40",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "CAC Index", "isin": "FR0003500008" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "ANNUAL",
    "firstObservationDate": "2028-09-22",
    "numberOfObservations": 7,
    "noCallPeriods": 1,
    "settlementLag": "10B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.0,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_ACCRUED_COUPON"
  },
  "coupon": {
    "regime": "CALL_CONTINGENT",
    "rate": 0.045,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": true,
    "guaranteedPeriods": 0,
    "paymentLag": "10B"
  },
  "finalRedemption": {
    "protectionType": "FULL_PROTECTION",
    "protectionLevel": 1.0,
    "finalCouponTrigger": 1.0,
    "knockIn": null,
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.7 — Athena Airbag

**`productFamily` :** `ATHENA` (ou `PHOENIX`) avec `finalRedemption.knockIn.airbagLevel` renseigné
**Aussi appelé :** autocall airbag, autocall à perte amortie, *cushioned autocall*, *low-strike autocall*.

#### Description

L'airbag supprime la **discontinuité** du payoff au niveau de la barrière. Dans une structure
classique, franchir la barrière de 60 % fait passer le remboursement de 100 % à 59,99 % du nominal :
une falaise de 40 points. Avec un airbag calé sur la barrière, le remboursement décroît
**continûment** à partir de la barrière : à 59,99 % de performance, l'investisseur récupère encore
99,98 % du nominal.

Mécaniquement, l'investisseur ne vend plus un put de strike 100 % à barrière activante, mais un put
de strike `A` (le niveau airbag) pour une quantité `N / A`. La perte est renormalisée par rapport à
`A` au lieu du strike initial, ce qui la rend **toujours inférieure ou égale** à celle du produit
classique — au prix d'un coupon plus faible de l'ordre de 10 à 25 %.

Attention à la nuance : la pente de la perte sous la barrière est plus forte que 1 (`1 / A`, soit
1,67 pour un airbag à 60 %), mais elle part de 100 % du nominal et non de `A`.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| `knockIn.airbagLevel` | `A`, généralement égal à `B_PDI` (ex. 0,60) |
| Remboursement final si `Perf(T) < B_PDI` | `N × min(1, Perf(T) / A)` au lieu de `N × Perf(T)` |
| Discontinuité au niveau de la barrière | **Aucune** si `A = B_PDI` |
| Perte maximale | 100 % du nominal (à `Perf(T) = 0`) |
| Coût | Coupon réduit de 10 % à 25 % par rapport à la version sans airbag |

#### Payoff

```
Rappel anticipé et coupons : identiques à l'Athena (§5.1) ou au Phoenix (§5.2).

À maturité, si non rappelé :
    si   Perf(T) >= B_AC(n)   ->  Flux = N * (1 + n * c)
    sinon si Perf(T) >= B_PDI ->  Flux = N
    sinon                     ->  Flux = N * min(1, Perf(T) / A)      [A = airbagLevel]
```

Comparaison à `B_PDI = A = 0,60` :

| `Perf(T)` | Sans airbag | Avec airbag |
|---|---|---|
| 60,0 % | 1 000 EUR | 1 000 EUR |
| 59,9 % | 599 EUR | 998 EUR |
| 50 % | 500 EUR | 833 EUR |
| 30 % | 300 EUR | 500 EUR |
| 0 % | 0 EUR | 0 EUR |

#### Points d'attention

- Variante **`gearing > 1`** (« levier baissier ») : à l'inverse de l'airbag, elle *amplifie* la
  perte (`N × (1 − gearing × (1 − Perf(T)))`) pour financer un coupon plus élevé. Ne pas confondre
  les deux blocs.
- Un *low-strike* (strike fixé à 0,80 au lieu du cours de clôture) produit un effet voisin mais par
  un mécanisme différent : il décale l'ensemble des barrières, alors que l'airbag n'agit que sur la
  branche de perte.

#### Template JSON

Le template est celui du §5.1, dans lequel le bloc `finalRedemption` devient :

```json
{
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": 1.0,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.6,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": 0.6,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  }
}
```

---

### 5.8 — Twin-Win Autocall

**`productFamily` :** `TWIN_WIN_AUTOCALL`
**Aussi appelé :** double gagnant, *Twin Win Certificate*, autocall à performance absolue.

#### Description

Seule famille où une **baisse modérée du sous-jacent devient une source de gain**. Si la barrière
n'est pas franchie, la performance négative est transformée en performance positive de même valeur
absolue : une baisse finale de −25 % produit un remboursement de 125 % du nominal. La hausse est,
elle, rémunérée normalement par participation.

Le profil est donc en **V** entre la barrière et le strike : maximum de gain aux deux extrémités de
la zone protégée, minimum de gain au niveau du strike. Sous la barrière, le mécanisme s'annule et
l'investisseur retrouve la perte linéaire classique.

Structuration : long call de strike 1,00 + long put down-and-out de strike 1,00 et barrière `B_PDI`
+ short put down-and-in de même barrière. La branche « gain sur la baisse » est achetée, ce qui rend
la structure coûteuse ; elle est donc généralement dépourvue de coupon, ou associée à une barrière
plus haute, ou plafonnée par un `cap`.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `NONE` le plus souvent, parfois `PERIODIC_CONTINGENT` |
| Barrière de rappel `B_AC` | 100 %, la performance étant capturée au rappel |
| `upside.type` | `TWIN_WIN` |
| `participationRate` (`PR`) | Participation à la hausse, 100 % typiquement, parfois plafonnée |
| `downsideParticipationRate` | Participation à la baisse convertie en gain, 100 % typiquement |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (60–75 %) |
| Observation de `B_PDI` | Européenne à maturité, ou américaine continue (fréquent) |

#### Flux

1. **Date de strike** — constatation de `S_i(0)`.
2. **Constatations `t_1` à `t_{n-1}`** — si `Perf(t_k) >= B_AC(k)`, remboursement au pair majoré
   de la performance (ou d'un coupon forfaitaire selon les termes), et extinction.
3. **Constatation finale `T`** — trois régimes :
   - hausse : participation classique ;
   - baisse contenue au-dessus de la barrière : la baisse est **retournée en gain** ;
   - baisse au-delà de la barrière : perte linéaire, l'effet twin-win disparaît totalement.

#### Payoff

```
Rappel anticipé : si Perf(t_k) >= B_AC(k)  ->  Flux = N * (1 + PR * (Perf(t_k) - 1))  ;  FIN

À maturité, si non rappelé :
    si   Perf(T) >= 1                     ->  Flux = N * (1 + PR * (Perf(T) - 1))
    sinon si Perf(T) >= B_PDI             ->  Flux = N * (1 + PR_down * (1 - Perf(T)))
    sinon                                 ->  Flux = N * Perf(T)

avec cap éventuel : Flux = min(Flux, N * cap)
```

Exemple avec `B_PDI = 0,65`, `PR = PR_down = 1,00` :

| `Perf(T)` | Remboursement |
|---|---|
| 120 % | 1 200 EUR |
| 100 % | 1 000 EUR |
| 80 % | 1 200 EUR |
| 66 % | 1 340 EUR |
| 64 % | 640 EUR |

#### Points d'attention

- La discontinuité au niveau de la barrière est **maximale** de toutes les familles : on passe d'un
  gain élevé (134 %) à une perte importante (64 %) pour deux points de performance.
- Le twin-win est très sensible au mode d'observation de la barrière : en américaine continue, le
  bénéfice de la branche baissière est souvent perdu très tôt dans la vie du produit.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "TWIN_WIN_AUTOCALL",
  "productName": "Twin-Win Autocall 5Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2031-09-22",
    "maturityDate": "2031-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "EURO STOXX 50",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SX5E Index", "isin": "EU0009658145" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "ANNUAL",
    "firstObservationDate": "2028-09-22",
    "numberOfObservations": 4,
    "noCallPeriods": 1,
    "settlementLag": "10B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.0,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_PERFORMANCE"
  },
  "coupon": {
    "regime": "NONE",
    "rate": null,
    "rateBasis": null,
    "dayCount": null,
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 0,
    "paymentLag": null
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.65,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "TWIN_WIN",
      "participationRate": 1.0,
      "bonusLevel": null,
      "cap": 1.5,
      "downsideParticipationRate": 1.0
    }
  },
  "issuerCall": null
}
```

---

### 5.9 — Booster / Bonus Autocall

**`productFamily` :** `BOOSTER_AUTOCALL`
**Aussi appelé :** autocall à participation, Bonus Certificate autocallable, *outperformance autocall*,
Booster à barrière.

#### Description

Famille orientée **croissance** plutôt que rendement : il n'y a pas de coupon, mais une
participation à la hausse, éventuellement supérieure à 100 % (le « levier » du booster), et/ou un
niveau de bonus minimal garanti tant que la barrière tient.

Deux variantes se distinguent par `upside.type` :

- **`BONUS`** — tant que la barrière n'est pas franchie, l'investisseur reçoit **au minimum** un
  niveau de bonus (ex. 130 % du nominal), et davantage si le sous-jacent a fait mieux :
  `N × max(bonusLevel, Perf(T))`. Le bonus joue le rôle d'un plancher de performance.
- **`PARTICIPATION`** — participation avec levier à la hausse au-delà du strike, souvent plafonnée :
  `N × (1 + PR × max(0, Perf(T) − 1))` avec `PR` de 1,3 à 2,0 et un `cap`.

Le financement vient de l'abandon des dividendes et de la vente du même put down-and-in que dans
les autres familles.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Régime de coupon | `NONE` |
| `upside.type` | `BONUS` ou `PARTICIPATION` |
| `participationRate` (`PR`) | 1,0 à 2,0 |
| `bonusLevel` | 1,15 à 1,40 (variante `BONUS`) |
| `cap` | Fréquent, 1,3 à 1,8 |
| Barrière de rappel `B_AC` | Souvent supérieure à 100 % (110 %–130 %), voire absente |
| Protection du capital | Conditionnelle, PDI à `B_PDI` (60–75 %) |
| Maturité | 3 à 6 ans |

#### Payoff

```
Rappel anticipé : si Perf(t_k) >= B_AC(k)  ->  Flux = N * max(bonusLevel, Perf(t_k))  ;  FIN

À maturité, si non rappelé :
  variante BONUS :
    si   Perf(T) >= B_PDI  ->  Flux = min( N * max(bonusLevel, Perf(T)), N * cap )
    sinon                  ->  Flux = N * Perf(T)

  variante PARTICIPATION :
    si   Perf(T) >= B_PDI  ->  Flux = min( N * (1 + PR * max(0, Perf(T) - 1)), N * cap )
    sinon                  ->  Flux = N * Perf(T)
```

#### Points d'attention

- Si la barrière est franchie, le bonus **disparaît intégralement** : le produit se comporte alors
  comme une simple exposition au sous-jacent (sans dividendes).
- Le `cap` doit toujours être explicité : un booster à levier 2 plafonné à 140 % ne surperforme le
  sous-jacent qu'entre 100 % et 120 %.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "BOOSTER_AUTOCALL",
  "productName": "Bonus Autocall 4Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2030-09-22",
    "maturityDate": "2030-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "SINGLE",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "DAX",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "DAX Index", "isin": "DE0008469008" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "ANNUAL",
    "firstObservationDate": "2028-09-22",
    "numberOfObservations": 3,
    "noCallPeriods": 1,
    "settlementLag": "10B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": true,
    "observationStyle": "EUROPEAN_ON_DATE",
    "triggerType": "CONSTANT",
    "initialTrigger": 1.15,
    "stepPerPeriod": 0.0,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": "PAR_PLUS_PERFORMANCE"
  },
  "coupon": {
    "regime": "NONE",
    "rate": null,
    "rateBasis": null,
    "dayCount": null,
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 0,
    "paymentLag": null
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.7,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "BONUS",
      "participationRate": 1.0,
      "bonusLevel": 1.28,
      "cap": 1.6,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": null
}
```

---

### 5.10 — Callable Note

**`productFamily` :** `CALLABLE_NOTE`
**Aussi appelé :** note rappelable, *issuer callable note*, Callable BRC, autocall discrétionnaire.

#### Description

Le rappel n'est plus **automatique** mais **discrétionnaire** : l'émetteur décide, à chacune des
dates de rappel prévues, de rembourser ou non le produit, moyennant un préavis. Il n'existe donc
aucune barrière de rappel — c'est la différence structurelle décisive avec toutes les familles
précédentes.

L'investisseur est vendeur d'une **option bermudienne** à l'émetteur, qui l'exercera par définition
au moment le moins favorable à l'investisseur. En contrepartie, le coupon offert est supérieur à
celui d'un autocall comparable. Cette option supprime toute lisibilité de la durée de vie du
produit : elle ne dépend plus d'une règle observable mais de la politique de l'émetteur.

#### Caractéristiques

| Caractéristique | Valeur |
|---|---|
| Rappel | Discrétionnaire, aux dates de `issuerCall.callDates` |
| Barrière de rappel | **Aucune** (`autocall.enabled = false`) |
| Préavis | 5 à 30 jours calendaires |
| Prix de rappel | Pair + coupon couru (`callPrice = 1.0`) |
| Régime de coupon | `UNCONDITIONAL` ou `PERIODIC_CONTINGENT` |
| Protection du capital | PDI conditionnel ou protection totale selon la structure |
| Valorisation | Option bermudienne — modèle Least-Squares Monte-Carlo ou arbre |

#### Payoff

```
Coupons : selon le régime déclaré (inconditionnel ou conditionnel à B_CPN).

Pour chaque date de rappel d de issuerCall.callDates :
    si l'émetteur exerce  ->  Flux = N * callPrice + coupon couru  ;  FIN

À maturité, si non rappelé : remboursement selon protectionType,
    soit  N si Perf(T) >= B_PDI, sinon N * Perf(T)   (protection conditionnelle)
    soit  N * protectionLevel                        (protection totale ou partielle)
```

#### Points d'attention

- Ne jamais présenter un `CALLABLE_NOTE` comme un autocall : la condition de rappel n'est pas
  observable par l'investisseur et ne peut pas être simulée sans hypothèse sur le comportement de
  l'émetteur (convention usuelle : exercice optimal en valeur).
- Le surcroît de coupon est la prime de l'option bermudienne cédée.

#### Template JSON

```json
{
  "schemaVersion": "autocall/v1",
  "productFamily": "CALLABLE_NOTE",
  "productName": "Callable Note 5Y",
  "currency": "EUR",
  "notional": { "denomination": 1000.0, "issuePrice": 1.0 },
  "dates": {
    "tradeDate": "2026-09-15",
    "strikeDate": "2026-09-22",
    "issueDate": "2026-10-06",
    "finalValuationDate": "2031-09-22",
    "maturityDate": "2031-10-06",
    "businessDayConvention": "MODIFIED_FOLLOWING",
    "calendars": ["TARGET"]
  },
  "underlying": {
    "basketType": "WORST_OF",
    "quanto": "NONE",
    "components": [
      {
        "ref": "UND1",
        "name": "EURO STOXX 50",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "SX5E Index", "isin": "EU0009658145" },
        "currency": "EUR",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      },
      {
        "ref": "UND2",
        "name": "FTSE 100",
        "assetClass": "EQUITY_INDEX",
        "identifiers": { "bloomberg": "UKX Index", "isin": "GB0001383545" },
        "currency": "GBP",
        "weight": null,
        "referencePrice": "OFFICIAL_CLOSE",
        "initialLevel": { "mode": "CLOSE_ON_STRIKE_DATE", "value": null, "observationDates": [] },
        "decrement": null
      }
    ]
  },
  "observation": {
    "generation": "PERIODIC",
    "frequency": "QUARTERLY",
    "firstObservationDate": "2026-12-22",
    "numberOfObservations": 20,
    "noCallPeriods": 4,
    "settlementLag": "5B",
    "explicitDates": []
  },
  "autocall": {
    "enabled": false,
    "observationStyle": null,
    "triggerType": null,
    "initialTrigger": null,
    "stepPerPeriod": null,
    "floorTrigger": null,
    "triggerSchedule": null,
    "redemptionAmount": null
  },
  "coupon": {
    "regime": "UNCONDITIONAL",
    "rate": 0.0175,
    "rateBasis": "PER_PERIOD",
    "dayCount": "30/360",
    "barrier": null,
    "memory": false,
    "cumulativeAtRedemption": false,
    "guaranteedPeriods": 20,
    "paymentLag": "5B"
  },
  "finalRedemption": {
    "protectionType": "CONDITIONAL_PDI",
    "protectionLevel": 1.0,
    "finalCouponTrigger": null,
    "knockIn": {
      "instrument": "PUT_DOWN_AND_IN",
      "barrier": 0.6,
      "observationStyle": "EUROPEAN_AT_MATURITY",
      "windowStartDate": null,
      "strike": 1.0,
      "gearing": 1.0,
      "airbagLevel": null,
      "floor": 0.0
    },
    "upside": {
      "type": "NONE",
      "participationRate": null,
      "bonusLevel": null,
      "cap": null,
      "downsideParticipationRate": null
    }
  },
  "issuerCall": {
    "style": "BERMUDAN",
    "callDates": "ALL_OBSERVATION_DATES_AFTER_NO_CALL_PERIOD",
    "noticePeriodCalendarDays": 10,
    "callPrice": 1.0,
    "includesAccruedCoupon": true
  }
}
```

---

## 6. Variantes transverses (overlays)

Ces mécanismes ne constituent pas des familles : ils se combinent avec la plupart des familles de
la §5 et se traduisent par un champ ou un bloc du schéma. C'est la combinaison
`famille + overlays` qui décrit un produit réel.

### 6.1 Worst-of (`underlying.basketType = "WORST_OF"`)

La performance de référence est celle du **moins performant** des sous-jacents, à chaque date de
constatation et à maturité. C'est le levier de rendement le plus puissant du marché : il multiplie
la probabilité qu'au moins un sous-jacent franchisse la barrière.

- Effet sur le coupon : **fortement haussier** (+30 % à +150 % selon le nombre de sous-jacents et
  leur corrélation).
- Effet sur le risque : le risque n'est pas diversifié mais **concentré** — l'investisseur est
  exposé au pire des sous-jacents, pas à leur moyenne. Ajouter un sous-jacent augmente le risque.
- Le coupon augmente quand la **corrélation baisse** (dispersion plus forte, worst-of plus bas).
- Variantes : `BEST_OF` (rare, coûteux), `WEIGHTED_BASKET` (panier moyenné, beaucoup moins risqué,
  donc coupon plus faible), *rainbow* (pondérations attribuées ex-post selon le classement).

```json
{
  "underlying": {
    "basketType": "WORST_OF",
    "components": [
      { "ref": "UND1", "name": "EURO STOXX 50", "weight": null },
      { "ref": "UND2", "name": "S&P 500", "weight": null },
      { "ref": "UND3", "name": "Nikkei 225", "weight": null }
    ]
  }
}
```

### 6.2 Indice décrément (`components[].decrement`)

Indice construit à partir d'un indice de rendement total duquel est retranché un **dividende
synthétique forfaitaire**, exprimé soit en points d'indice fixes par an (`POINTS`, ex. 50 points),
soit en pourcentage annuel (`PERCENT`, ex. 5 % par an), prélevé au prorata temporis.

- **Raison d'être** : l'émetteur n'a plus de risque dividende à couvrir, ce qui lui permet d'offrir
  des barrières plus basses et des coupons plus élevés. C'est le support dominant des Athena et
  Phoenix distribués en France.
- **Effet pour l'investisseur** : la performance de l'indice décrément est structurellement
  inférieure à celle de l'indice prix classique. Si les dividendes réels sont inférieurs au
  décrément, l'investisseur subit un **frein mécanique** à la performance ; ce frein réduit la
  probabilité de rappel et augmente celle de franchir la barrière.
- Point de vigilance : un décrément en points fixes devient proportionnellement de plus en plus
  lourd quand l'indice baisse.

```json
{
  "decrement": {
    "type": "POINTS",
    "amount": 50.0,
    "accrualBasis": "ACT/365"
  }
}
```

Variante en pourcentage :

```json
{
  "decrement": {
    "type": "PERCENT",
    "amount": 0.05,
    "accrualBasis": "ACT/365"
  }
}
```

### 6.3 Effet mémoire (`coupon.memory`)

Rattrapage des coupons non versés lors de la première constatation ultérieure au-dessus de
`B_CPN`. Applicable au régime `PERIODIC_CONTINGENT` uniquement. Détail et formule en §5.3.
Effet sur le coupon facial : **baissier** (−5 % à −15 %).

### 6.4 Step-down / step-up (`autocall.triggerType`)

Barrière de rappel évolutive dans le temps.

- **Step-down** : la barrière décroît de période en période (ex. −5 %/an à partir de 100 %, plancher
  à 70 %). Le rappel devient de plus en plus probable, la durée de vie attendue se raccourcit, et le
  coupon facial baisse. Très répandu.
- **Step-up** : la barrière croît. Le produit vit plus longtemps, le coupon facial est plus élevé.
- Un plancher (`floorTrigger`) est presque toujours prévu.

```json
{
  "autocall": {
    "triggerType": "STEP_DOWN",
    "initialTrigger": 1.0,
    "stepPerPeriod": -0.05,
    "floorTrigger": 0.7,
    "triggerSchedule": null
  }
}
```

Grille explicite équivalente, prioritaire si renseignée :

```json
{
  "autocall": {
    "triggerType": "EXPLICIT",
    "triggerSchedule": [
      { "index": 1, "level": 1.0 },
      { "index": 2, "level": 0.95 },
      { "index": 3, "level": 0.9 },
      { "index": 4, "level": 0.85 },
      { "index": 5, "level": 0.8 },
      { "index": 6, "level": 0.75 },
      { "index": 7, "level": 0.7 }
    ]
  }
}
```

### 6.5 Airbag et gearing (`knockIn.airbagLevel`, `knockIn.gearing`)

Deux modificateurs **opposés** de la branche de perte, à ne jamais confondre :

| Champ | Payoff sous la barrière | Effet |
|---|---|---|
| `airbagLevel = A` | `N × min(1, Perf(T) / A)` | Perte **amortie**, coupon réduit |
| `gearing = g > 1` | `N × max(0, 1 − g × (1 − Perf(T)))` | Perte **amplifiée**, coupon augmenté |
| `floor = f` | `max(f × N, ...)` | Perte plafonnée à `(1 − f)` du nominal |

Détail en §5.7.

### 6.6 Quanto et compo (`underlying.quanto`)

Traitement du risque de change lorsque le sous-jacent n'est pas libellé dans la devise du produit :

- **`NONE`** — sous-jacent et produit dans la même devise ;
- **`QUANTO`** — taux de change figé à 1 : la performance en devise étrangère est appliquée telle
  quelle au nominal en devise du produit. L'investisseur ne supporte aucun risque de change ; le
  coût de cette protection (l'ajustement quanto, fonction de la corrélation spot/change et de la
  volatilité du change) est prélevé sur le coupon ;
- **`COMPO`** — la performance est convertie au taux de change courant : l'investisseur supporte
  intégralement le risque de change, qui s'ajoute au risque actions.

```json
{ "underlying": { "quanto": "QUANTO" } }
```

### 6.7 Modes de fixation du strike (`initialLevel.mode`)

| Mode | Description | Effet |
|---|---|---|
| `CLOSE_ON_STRIKE_DATE` | Clôture du jour de strike | Standard |
| `AVERAGE` | Moyenne des clôtures sur plusieurs dates | Réduit le risque de point d'entrée, réduit le coupon |
| `LOOKBACK_MIN` | Minimum observé sur une période initiale | Strike favorable, coûteux, coupon nettement réduit |
| `FIXED` | Strike fixé à un niveau décoté (ex. 0,90 — *low strike*) | Décale toutes les barrières vers le bas, très défensif |

```json
{
  "initialLevel": {
    "mode": "AVERAGE",
    "value": null,
    "observationDates": ["2026-09-22", "2026-10-22", "2026-11-22"]
  }
}
```

### 6.8 Période de non-rappel et coupons garantis

- `observation.noCallPeriods = m` : les `m` premières constatations ne sont pas rappelables. Garantit
  une durée de vie minimale, donc un rendement minimal en scénario haussier.
- `coupon.guaranteedPeriods = m` : les `m` premiers coupons sont versés inconditionnellement, les
  suivants redevenant conditionnels. Hybride entre l'ARC et le Phoenix.

```json
{
  "observation": { "noCallPeriods": 4 },
  "coupon": { "guaranteedPeriods": 2 }
}
```

### 6.9 Mode d'observation de la barrière de protection

Overlay le plus déterminant pour le risque réel, détaillé en §2.5. Rappel des valeurs :
`EUROPEAN_AT_MATURITY` (dominant en France), `AMERICAN_CONTINUOUS` (dominant en Suisse/Allemagne),
`AMERICAN_CLOSING`, `WINDOW`.

```json
{
  "knockIn": {
    "observationStyle": "WINDOW",
    "windowStartDate": "2030-09-22"
  }
}
```

### 6.10 Cap, floor et participation

- `upside.cap` : plafonne le remboursement total (ex. `1.6` = 160 % du nominal).
- `knockIn.floor` : plancher de remboursement en cas de perte (ex. `0.2` = 20 % du nominal minimum).
- `upside.participationRate` : levier appliqué à la hausse au-delà du strike.

---

## 7. Algorithme d'évaluation d'un chemin

Pseudo-code unique couvrant toutes les familles du document à partir d'une instance JSON du schéma
`autocall/v1`. Il permet de vérifier qu'une instance est complète et non ambiguë.

```
ENTREE : produit (instance autocall/v1), chemin S_i(t) pour toutes les dates utiles
SORTIE : liste de flux (date, montant)

flux = []
P = 0                          # indice de la dernière constatation ayant payé un coupon
KI = faux                      # évènement de knock-in (barrières américaines)

# --- 1. Niveaux initiaux ---
pour chaque composante i :
    S_i(0) = fixer_strike(initialLevel.mode)

# --- 2. Knock-in américain, si applicable ---
si knockIn.observationStyle commence par "AMERICAN" ou vaut "WINDOW" :
    KI = ( il existe t dans la fenêtre d'observation tel que Perf(t) < knockIn.barrier )

# --- 3. Boucle sur les constatations ---
pour k = 1 .. n :
    perf = Perf(t_k)                      # selon basketType, §1
    B_AC_k = barriere_rappel(k)           # CONSTANT / STEP_DOWN / STEP_UP / EXPLICIT

    # 3a. Coupon
    selon coupon.regime :
        UNCONDITIONAL        : cpn = N * c
        PERIODIC_CONTINGENT  : si perf >= B_CPN :
                                   cpn = (memory ? (k - P) : 1) * N * c ; P = k
                               sinon : cpn = 0
        CALL_CONTINGENT      : cpn = 0        # traité au moment du remboursement
        NONE                 : cpn = 0
    si k <= coupon.guaranteedPeriods : cpn = N * c
    si cpn > 0 : ajouter (t_k + paymentLag, cpn) à flux

    # 3b. Rappel anticipé
    si k < n et autocall.enabled et k > observation.noCallPeriods et perf >= B_AC_k :
        selon coupon.regime :
            CALL_CONTINGENT : montant = N * (1 + k * c)          # cumulatif
            autre           : montant = N
        si upside.type dans {TWIN_WIN, BONUS, PARTICIPATION} et
           autocall.redemptionAmount = "PAR_PLUS_PERFORMANCE" :
            montant = N * payoff_hausse(perf)
        ajouter (t_k + settlementLag, montant) à flux
        RETOURNER flux                                            # produit éteint

# --- 4. Remboursement final (produit non rappelé) ---
perf = Perf(T)
selon finalRedemption.protectionType :

    FULL_PROTECTION | PARTIAL_PROTECTION :
        si perf >= finalCouponTrigger et coupon.regime = CALL_CONTINGENT :
            montant = N * (1 + n * c)
        sinon :
            montant = N * protectionLevel

    CONDITIONAL_PDI :
        si knockIn.observationStyle = "EUROPEAN_AT_MATURITY" :
            KI = ( perf < knockIn.barrier )

        si coupon.regime = CALL_CONTINGENT et perf >= finalCouponTrigger :
            montant = N * (1 + n * c)
        sinon si non KI :
            montant = N * payoff_hausse(perf)      # = N si upside.type = NONE
        sinon :
            si   knockIn.airbagLevel non nul : montant = N * min(1, perf / airbagLevel)
            sinon si upside.type = TWIN_WIN et perf >= knockIn.barrier :
                                               montant = N * (1 + PR_down * (1 - perf))
            sinon : montant = N * max(0, 1 - gearing * (1 - perf))
            montant = max(montant, N * knockIn.floor)

si upside.cap non nul : montant = min(montant, N * cap)
ajouter (maturityDate, montant) à flux
RETOURNER flux
```

Fonction `payoff_hausse(perf)` :

```
selon upside.type :
    NONE          : retourner 1
    PARTICIPATION : retourner 1 + PR * max(0, perf - 1)
    BONUS         : retourner max(bonusLevel, perf)
    TWIN_WIN      : si perf >= 1 : retourner 1 + PR * (perf - 1)
                    sinon        : retourner 1 + PR_down * (1 - perf)
```

---

## 8. Glossaire

| Terme | Anglais | Définition |
|---|---|---|
| **Autocall** | Autocallable | Mécanisme de remboursement anticipé automatique déclenché par le franchissement à la hausse d'une barrière à une date de constatation |
| **PDI** | Put Down-and-In | Put à barrière activante à la baisse, vendu par l'investisseur ; il porte tout le risque de perte en capital et finance le coupon |
| **Barrière de protection** | Protection / KI barrier | Niveau `B_PDI` en deçà duquel le capital n'est plus protégé |
| **Barrière de rappel** | Autocall trigger | Niveau `B_AC` déclenchant le remboursement anticipé |
| **Barrière de coupon** | Coupon barrier | Niveau `B_CPN` conditionnant le versement du coupon périodique (Phoenix) |
| **Effet mémoire** | Memory / snowball coupon | Rattrapage des coupons non versés à la première constatation ultérieure au-dessus de `B_CPN` |
| **Coupon cumulatif** | Cumulative / snowball coupon | Coupon de rappel égal à `k × c`, versé d'un bloc au remboursement (Athena) |
| **Worst-of** | Worst-of | Panier dont la performance de référence est celle du sous-jacent le moins performant |
| **Airbag** | Airbag / cushion | Renormalisation de la perte par le niveau de barrière, supprimant la discontinuité du payoff |
| **Gearing** | Gearing / leverage | Coefficient multiplicateur de la perte sous la barrière |
| **Step-down** | Step-down trigger | Barrière de rappel dégressive dans le temps |
| **Indice décrément** | Decrement index | Indice dont on retranche un dividende synthétique forfaitaire (points ou pourcentage) |
| **Quanto** | Quanto | Taux de change figé, risque de change neutralisé pour l'investisseur |
| **Compo** | Composite | Performance convertie au taux de change courant, risque de change supporté |
| **Période de non-rappel** | No-call / lock-out period | Périodes initiales pendant lesquelles le rappel ne peut pas se déclencher |
| **Scénario blanc** | — | Remboursement du seul nominal à maturité, sans aucun coupon |
| **Barrière européenne** | European barrier | Observée uniquement à la constatation finale |
| **Barrière américaine** | American / continuous barrier | Observée en continu sur toute la vie du produit |
| **Low strike** | Low strike | Strike initial fixé sous le cours du jour, décalant toutes les barrières |
| **Rappel discrétionnaire** | Issuer call | Option de remboursement anticipé exerçable par l'émetteur (option bermudienne) |
| **Livraison physique** | Physical delivery | Remboursement en actions du sous-jacent le moins performant au lieu d'un règlement en espèces |
| **EMTN** | EMTN | *Euro Medium Term Note* — format d'émission de dette structurée le plus courant |

---

## 9. Utilisation de ce document avec un LLM

Consignes d'usage recommandées à joindre au prompt :

1. **Pour instancier un produit** — partir du template de la famille concernée en §5, ne surcharger
   que les champs explicitement demandés, et conserver tous les autres champs (y compris ceux à
   `null`) afin que l'instance reste conforme au schéma `autocall/v1`.
2. **Pour classer un produit décrit en langage naturel** — identifier d'abord le **régime de coupon**
   (§2.4), puis le **régime de remboursement final** (§2.5) : ces deux réponses déterminent la
   famille sans ambiguïté via la table de la §3. Les autres caractéristiques sont des overlays (§6).
3. **Pour calculer un payoff** — appliquer l'algorithme de la §7, en respectant l'ordre des tests :
   coupon avant rappel, rappel avant remboursement final, cap en dernier.
4. **Vocabulaire** — les appellations commerciales varient selon les émetteurs et les places
   (Athena / Express, Phoenix / Income, BRC / Reverse Convertible). Se fier aux mécanismes décrits
   en §2, jamais au nom commercial seul.
5. **Ne pas inventer de barrière absente** — un produit sans barrière de coupon déclarée est un
   Athena ou un Reverse Convertible, pas un Phoenix à `B_CPN = 0`.

## 10. Avertissements

- Les niveaux de coupons, barrières et maturités cités sont des **ordres de grandeur illustratifs**
  destinés à situer chaque famille les unes par rapport aux autres. Ils ne constituent ni une
  cotation, ni une offre, ni une recommandation d'investissement.
- Les termes juridiquement opposables d'un produit réel sont ceux de sa documentation d'émission
  (*Final Terms*, prospectus de base, KID PRIIPS) et d'elle seule ; les conventions du présent
  document (ordre des tests, traitement des coupons mémorisés lors d'un rappel, arrondis, dates de
  règlement) peuvent différer d'un émetteur à l'autre.
- Toutes les protections décrites sont conditionnées à la solvabilité de l'émetteur (§2.6).

---

## Sortie attendue

Pour **chaque cotation**, produisez une instance du schéma **`autocall/v1`** décrit au §4
ci-dessus (`schemaVersion: "autocall/v1"`), en ne renseignant que les champs déductibles de
la demande client et en laissant les autres à `null`. N'inventez aucun paramètre non exprimé
(barrières, coupon, maturité, dates…). Ajoutez à chaque cotation `quoteId`, `label`,
`confidenceScore`, `extractedTokens`, `aiExplanation`. Enveloppe finale : `{ "quotes": [ … ] }`.
