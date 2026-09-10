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

## PHASE 1 — `inference-service` ✅ (code + tests + admin UI faits ; smoke-tests réels vLLM/Gemini restants)

> État au 2026-09-10 : items 1–9 faits, 134 tests verts (dont `test_routing`,
> `test_prompt_resolver`, `test_prompts_crud`, `test_analyze_integration`
> réécrit, `test_db_migration` étendu). Onglet admin **Pré-prompts** + résumé
> de routage dans « Tester l'analyse » livrés et vérifiés au navigateur.
> `scripts/batch_analyze.py` accepte `--pipeline`. Reste : item 10 — smoke-tests
> contre de vrais moteurs (vLLM local + Gemini).

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

## PHASE 2 — app principale (après validation Phase 1)

- `server.ts` + `src/services/spec-builder.ts` : **adaptateur `autocall/v1` →
  `ExtractedProductSpec`** pour Athena/Phoenix/Reverse Convertible → Monte Carlo
  inchangé.
- Autres familles : structure riche + `pricingAvailable: false` + motif ;
  `QueryParserWorkbench.tsx` affiche sans grille de prix.
- `scripts/parse-query-cli.ts` adapté. Tests vitest : adaptateur + dégradation.

## PHASE 3 — ultérieur, hors lot
Pricers taux/FX réels · schéma riche de bout en bout dans le front · termsheets
par famille.
