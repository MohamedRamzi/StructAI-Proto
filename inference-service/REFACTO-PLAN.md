# Refacto — pipeline d'analyse en 2 étapes (routage → extraction ciblée)

> Document de référence pour un changement qui s'étale sur plusieurs sessions.
> Origine : `~/Dev/Tests/refacto.md` (proposition initiale de l'utilisateur).

## Objectif

Remplacer l'appel LLM unique de `/api/analyze` (un seul `QuotationPrompt.md`
générique) par un pipeline :

1. **Routage** — 1 appel LLM court : classe la demande, par cotation, en
   `{assetClass, productFamily, underlying?, routerConfidence}`.
2. **Résolution du pré-prompt** — cascade **déterministe**
   `{famille}-{classe}` → `{classe}` → `default`. Le niveau atteint (3/2/1)
   pondère la confiance finale.
3. **Extraction** — 1 appel LLM par groupe `(assetClass, famille)` distinct,
   avec le pré-prompt de domaine résolu comme contexte. Sortie = **schéma
   riche** par enveloppe (`autocall/v1`, `rates/v1`, `fx/v1`, générique).

## Décisions verrouillées (2026-09-10)

| Sujet | Choix |
|---|---|
| Schéma de sortie | **Riche**, par enveloppe / famille (pas l'ancien schéma plat) |
| Sélection du pré-prompt | **Cascade déterministe** (pas de 2ᵉ appel LLM pour choisir le fichier) |
| Stockage des prompts | **Table SQLite `prompts`**, seedée depuis `inference-service/prompts/*.md`, CRUD admin ensuite |
| Familles non priçables (taux, FX, crédit, actions non-autocall) | Parsées en schéma riche ; l'app principale les affiche **sans prix** (`pricingAvailable: false`) |
| Séquencement | **Phase 1 complète et validée**, puis Phase 2 |

## PHASE 1 — `inference-service` ✅ TERMINÉE (2026-09-10)

> Items 1–10 faits. 134 tests pytest verts. Onglet admin **Pré-prompts** +
> résumé de routage dans « Tester l'analyse » vérifiés au navigateur.
> `scripts/batch_analyze.py` accepte `--pipeline`.
>
> **Smoke-tests réels (Gemini, 4 cas)** — pipeline mécaniquement OK sur tous :
> - Athena LVMH 3Y → `equity-autocall` (précision 3), `autocall/v1`, flag `coupon.rate` (= « coupon à chercher ») ✔
> - TARF EUR/USD → routé **FX** (correct, pas RATES) → `fx` (précision 2), `fx/v1` ; `fx.md` est un squelette → sortie pauvre (flags `underlying`/`maturity`) — attendu
> - Multi Phoenix worst-of + Range Accrual Euribor → 2 groupes, 2 appels, fusion par quoteId : q1 `equity-autocall` p3 / q2 `rates` p2 ✔
> - Variance swap Nikkei (hors scope) → router dit EQUITY/vanilla → `equity` (précision 2), `generic/v1` — repli raisonnable (pas `default` p1 car le router a donné une classe)
> - Pondération de confiance par précision vérifiée (0.98→0.98, 0.98→0.882, 0.95→0.855)
>
> **Points de réglage notés (prompts, PAS le pipeline)** :
> - `_detect_autocall_v1` devrait aussi accepter une maturité exprimée en ténor
>   (« 5 ans ») et pas seulement `dates.finalValuationDate` / `observation.numberOfObservations`
> - `fx.md` et `credit.md` sont des squelettes à étoffer
> - envisager un prompt `equity` distinct d'un futur `equity-vanilla` pour éviter que l'exotique hors-scope tombe en `generic/v1` sans cible

### 1. Table `prompts`
`key` (PK) · `name` · `kind` (`router`|`common`|`domain`) · `asset_class` (null) ·
`product_family` (null) · `scope_description` · `body` · `is_protected` (int) ·
`updated_at` · `updated_by`. Migration DB. Seed **idempotent** au boot depuis
`prompts/*.md` (frontmatter YAML simple) — n'écrase jamais une row éditée.

### 2. Fichiers seed (`inference-service/prompts/`)
`router.md` (de `pre-prompt.md`) · `_common.md` (règles transverses extraites de
`QuotationPrompt.md`) · `default.md` · `equity.md` · `equity-autocall.md` (de
`equity-prompt.md`) · `rates.md` (de `rates-prompt.md`) · squelettes `fx.md`,
`credit.md`, `rates-swap.md`.

### 3. `services/routing.py`
`classify_request(query) -> {"quotes":[{quoteId, assetClass, productFamily, underlying?, routerConfidence}]}`.
Réutilise `inference_client` + `extract_json_from_text`. `assetClass` contraint
(EQUITY/RATES/FX/CREDIT) ; `productFamily` libre, normalisé ensuite.

### 4. `services/prompt_resolver.py`
`FAMILY_ALIASES` (ATHENA/PHOENIX/AIRBAG/YETI/… → `autocall` ; TARF/TARN/RANGE_ACCRUAL/
CMS_SPREAD/SNOWBALL/… → familles taux ; …). `resolve(asset_class, family) ->
(prompt_row, scope_precision ∈ {1,2,3})`.

### 5. `services/analyze.py` (refonte)
Routage → groupement des cotations par scope résolu → 1 appel d'extraction par
groupe (`system = domain.body + "\n\n" + common.body`) → fusion par `quoteId`.
`confidenceScore *= scope_factor(precision)` (1.0 / 0.9 / 0.75). Échec d'un
groupe : remonte (pas de repli silencieux), les autres groupes préservés.

### 6. `services/validation.py`
`detect_missing_fields(extraction, schema_version)` piloté par le schéma
(champs requis déclarés par enveloppe).

### 7. Contrat `POST /api/analyze`
`quote = {quoteId, label, schemaVersion, routing:{assetClass, productFamily,
promptKey, scopePrecision, routerConfidence}, extraction (riche), missingFields}`.
Entrée `pipeline: "routed"` (défaut) | `"single"` (ancien comportement, rollback).

### 8. Admin UI
Onglet **« Prompts »** : liste + édition `body` (textarea) + ajout + suppression
(sauf `is_protected`). Onglet « Tester l'analyse » : affiche routage → prompt
retenu → extraction + confidences.

### 9. Tests (LLM mocké)
`test_routing` · `test_prompt_resolver` · `test_analyze_routed` (multi-cotations
hétérogènes, fusion, confiance, modes) · `test_validation_by_schema` ·
`test_prompts_crud` (RBAC, protégés, seed idempotent) · `test_db_migration`.

### 10. Vérification
pytest vert · smoke-tests réels (vLLM + Gemini) : equity/autocall, rates/tarf,
multi-cotations equity+rates, hors-scope → default · `scripts/batch_analyze.py`
adapté.

## PHASE 2 — app principale

### 2a — adaptateur + wiring backend ✅ (2026-09-10, branche `refacto/phase2-rich-schema-adapter`)

- `src/services/spec-builder.ts` : `buildSpecFromAutocallV1({query, extraction, ...})`
  — mappe l'enveloppe `autocall/v1` vers `ExtractedProductSpec` (famille→productTypeId,
  maturité depuis `dates.finalValuationDate` ou `observation.numberOfObservations`×fréquence,
  strike date future→forward start, barrières `initialTrigger`/`knockIn.barrier`,
  `targetToSolve` = le champ laissé `null`). Monte Carlo (`quant-pricer.ts`) inchangé.
- `src/services/analyze-adapter.ts` (NOUVEAU) : `adaptAnalyzeResponse()` — le seul endroit
  qui connaît le mapping schemaVersion→builder. `autocall/v1`/`generic/v1` → spec+prix ;
  `rates/v1`/`fx/v1`/`credit/v1`/autre → `{pricingAvailable:false, richExtraction, degradationReason}`.
  Partagé par `server.ts` `/api/parse-query` ET `scripts/parse-query-cli.ts`.
- `server.ts` : `/api/parse-query` utilise l'adaptateur ; réponse enrichie de `pipeline`,
  et chaque quote porte `schemaVersion`/`routing`/`pricingAvailable`. Top-level `spec`/`pricing`
  = 1re quote priçable.
- `llm-parser.ts` : `QuoteBundle`/`ParseQueryResult` étendus (champs optionnels).
- Tests : `analyze-adapter.test.ts` (14 cas — autocall/v1, generic/v1, dégradation rates/fx,
  bundle hétérogène, vector underlying), `spec-builder.test.ts` inchangé. 47 vitest verts, `tsc --noEmit` clean.

### 2b — front ✅ (2026-09-10, même branche)

- `src/components/RichExtractionPanel.tsx` (NOUVEAU) : pour une quote non priçable —
  chips de routage, bannière « pricing indisponible » + `degradationReason`, liste des
  champs manquants, vue JSON récursive read-only de `richExtraction`.
- `QueryParserWorkbench.tsx` : `handleParseQuery` accepte une réponse avec `quotes` sans
  `spec` top-level ; re-pricing/re-résolution du sous-jacent uniquement pour les quotes
  priçables ; sélectionne la 1re quote priçable pour la grille, sinon `RichExtractionPanel`.
  `handleSwitchQuote` branche sur `isPriceable(quote)`. Onglets multi-cotations : point ambre
  + libellé schéma pour les legs parse-only ; tableau comparateur affiche « — » / « pricing indispo. ».
- `tsc --noEmit`, 47 vitest, `vite build` OK. Vérifié end-to-end (Gemini réel) : Athena/LVMH
  → autocall/v1 → spec priçable.

### RESTE (hors périmètre immédiat)

- Smoke-test navigateur d'une demande **taux** de bout en bout (le CLI a validé le chemin
  autocall en réel ; le chemin dégradé n'a que la couverture vitest — quota Gemini épuisé pendant les tests).
- Étoffer les pré-prompts squelettes `fx.md` / `credit.md` et le validateur `_detect_autocall_v1` (ténor).
- Brancher un vrai `_common` de sortie taux/FX quand un pricer existera (Phase 3).

## PHASE 3 — ultérieur, hors lot
Pricers taux/FX réels · schéma riche de bout en bout dans le front · termsheets
par famille.
