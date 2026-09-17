# StructAI - Plateforme IA de Structuration & Valorisation de Produits Dérivés

**StructAI** est une plateforme FinTech & InsurTech institutionnelle conçue pour les salles de marché, les ingénieurs financiers, les structurateurs et les conseillers en gestion de patrimoine. Elle permet de traduire des demandes clients en langage naturel (expressions de marché complexes, thématiques de sous-jacents, paniers d'actions) en structures financières réglementaires prêt-à-pricer, d'effectuer des simulations Monte Carlo en temps réel, d'analyser l'historique d'audit MIFID II et de générer des Termsheets officielles aux normes de banques d'investissement (Natixis CIB, BNP Paribas CIB, Société Générale CIB, etc.).

---

## 🌟 Fonctionnalités Clés

1. **Parsing NLP & Extraction Financière Multi-Moteurs** :
   - Traitement automatique du jargon de marché (*NC 1y, PDI 70%, départ forward 4 mois, coupon mémoire, observation trimestrielle*).
   - Support du **Moteur IA Hybride** : **Gemini 3.5 Flash** (avec validation d'API via `/api/test-gemini`), **Ollama local** (DeepSeek R1, Qwen 2.5/3.6, Gemma 2/4), **LM Studio** et endpoints compatibles OpenAI.
   - **Mode Raisonnement "Think" (Reasoning Tokens)** : Option basculable pour forcer les LLMs de raisonnement (DeepSeek R1, Qwen 2.5/3.6) à émettre leurs étapes de réflexion dans des balises `<think>...</think>` avant la génération du JSON.
   - Consultation des logs d'échanges LLM (`llm_debug.log`) directement depuis l'interface UI.

2. **Outil CLI en Ligne de Commande (`scripts/parse-query-cli.ts`)** :
   - Invocable via `npm run parse-cli` ou `npx tsx scripts/parse-query-cli.ts`.
   - **Option `--llm <prefix/model>`** : Sélection dynamique du fournisseur LLM (`cloud/gemini-3.5-flash`, `ollama/qwen3.6`, `lmstudio/qwen3.6`).
   - **Option `--reqs <filename>`** : Traitement par lot d'un fichier contenant une liste de requêtes séparées par des lignes vides.
   - **Option `--output <filename>`** : Export direct des résultats JSON vers un fichier (ou affichage console par défaut).

3. **Référentiel des Sous-Jacents — source unique dans `inference-service`** :
   - Il n'y a plus de base d'instruments locale dans l'app principale. Les sous-jacents vivent uniquement dans le **corpus d'instruments d'`inference-service`** (SQLite + index ChromaDB), géré depuis son admin (onglet *Instruments* : CRUD, import/export CSV/JSON, ré-indexation).
   - `/api/parse-query` résout chaque sous-jacent extrait via la **recherche sémantique** (`POST /api/instruments/search` → embeddings Qwen3 via vLLM). Un sous-jacent absent du corpus conserve son nom extrait avec des **données de marché indicatives** (placeholders), signalé dans les hypothèses.
   - Les données de marché (spot, vol, dividende) proviennent du champ `metadata` de chaque instrument en attendant un service de données de marché dédié (`src/services/market-data.ts`).
   - Amorçage initial : `npm run seed:vector` (pousse `scripts/seed-data/instruments.json` — ~215 instruments : indices Europe/US/Asie + constituants, taux, FX, crédit — dans le corpus). Même jeu en `scripts/seed-data/instruments.csv` pour l'import CSV de l'admin. **Données de marché indicatives** (~sept. 2026) en attendant le service de données de marché.

4. **Moteur Quantitatif de Pricing & Simulation Monte Carlo Interférente** :
   - **Axe des Temps Cohérent & Adaptatif** : L'axe des abscisses s'ajuste dynamiquement sur la maturité exacte du produit ($[0, \text{maturityMonths}]$) et occupe 100% de la largeur d'affichage réservée.
   - **Contrôles Interactifs de Sensibilité ($\mu$ & $q$)** :
     - **Taux de dérive ($\mu$)** : Slider de -5.0% à +15.0% p.a.
     - **Rendement dividende ($q$)** : Slider de 0.0% à 10.0% p.a. (initialisé selon le sous-jacent).
     - Recalcul dynamique des trajectoires browniennes géométriques $S_t$ en temps réel.
   - Résolution automatique du coupon (*solve target*), calcul du Fair Value, barrières et probabilités d'Autocall/PDI.

5. **Famille Institutionnelle « Autocall Yeti Phoenix » (9 Variantes)** :
   - Prise en charge intégrale des 9 variantes de payoffs de référence :
     - **Phoenix Asian PDI** (ID: 10449) - Moyennation asiatique (Asian In/Out) et PDI.
     - **Vanilla Autocall** (ID: 10488) - Structure mono-action standard avec PDI in-fine.
     - **Call On Custom Basket** (ID: 10627) - Performance Worst-Of sur-mesure & bonus digital.
     - **Multi Range-Accrual** (ID: 10740) - Corridor Range-Accrual au jour le jour.
     - **Capped/Floored Asian** (ID: 10401) - Caps et Floors individuels & globaux sur panier.
     - **Strategies Yeti** (ID: 10702) - Barrière Yeti conditionnelle & coupons Phoenix.
     - **Strategies Digits** (ID: 10756) - Barrières digitalisées & lissage dual-corridor.
     - **Target Coupon Redemption** (ID: 10743) - Rappel anticipé sur cumul cible de coupons.
     - **Yeti Phoenix Strategies** (ID: 10762) - Combinaison Yeti/Phoenix et effet Zenith.
   - Guide développeur d'intégration de nouveaux payoffs disponible dans [INTEGRATION_NOUVEAUX_PAYOFFS.md](INTEGRATION_NOUVEAUX_PAYOFFS.md).

6. **Termsheet Dynamic Renderer & Support Math (LaTeX) / Markdown** :
   - Rendu automatique React JSX propre avec récursivité pour l'imbrication des formules mathématiques ($S_0$, $S_T / S_0$) à l'intérieur des balises de texte en gras `**texte**`.
   - Fichier de configuration [src/assets/app-config.json](src/assets/app-config.json) liant automatiquement les Payoffs aux templates Markdown.

7. **Dashboard d'Analytics & Historique d'Audit (MIFID II)** :
   - Suivi et archivage automatique des cotations, métriques de coupons moyens et probabilités.
   - Export CSV et réimport instantané des spécifications historiques d'un clic.

---

## 🛠️ Architecture Technique

- **Frontend** : React 19, TypeScript 5, Tailwind CSS v4, Lucide Icons, Recharts (visualisation graphique).
- **Backend Node.js / Express** (`server.ts`) : Serveur full-stack unifié — moteur quantitatif de pricing (Monte Carlo), résolution des sous-jacents, persistance des logs. Délègue l'analyse NLP des demandes client et la recherche sémantique au `inference-service`.
- **`../inference-service/`** : Service **Python (FastAPI)** autonome unique qui héberge à la fois l'analyse NLP (prompt + appel LLM + détection des champs manquants) et la base vectorielle RAG (ChromaDB embarqué), avec authentification JWT, gestion des utilisateurs/rôles, et une page d'admin (config des moteurs, instruments, import/export CSV/JSON, utilisateurs, clés API). Modèle de données extensible par `assetClass` (EQUITY aujourd'hui, RATE_INDEX/FX/CREDIT prêts). Communique avec l'app principale via une clé d'API de service. Voir [`../inference-service/README.md`](../inference-service/README.md).
- **Outil CLI** : `scripts/parse-query-cli.ts` (exécutable via `npx tsx` ou `npm run parse-cli`) — appelle `inference-service`.
- **Moteur LLM** (configuré depuis la page d'admin de `inference-service`, pas dans l'app principale) : **vLLM**, exécuté comme deux process sidecar indépendants (`vllm serve`) exposant une API compatible OpenAI — un pour le chat/analyse, un pour les embeddings. `inference-service` ne parle qu'HTTP à ces sidecars ; aucun fallback déterministe : un échec d'extraction LLM renvoie une erreur explicite plutôt qu'un résultat deviné.
- **Build & Packaging** : Vite 6 & ESBuild pour un bundle CommonJS autonome (`dist/server.cjs`).

---

## 💻 Utilisation du Script en Ligne de Commande (CLI)

Le moteur LLM utilisé (modèle) est celui configuré dans `inference-service` (page d'admin), qui doit tourner pour que le script fonctionne.

```bash
# 1. Requête unique sans pricing (extraction rapide des caractéristiques)
npx tsx scripts/parse-query-cli.ts "Reverse Convertible 1 an sur TotalEnergies FP."

# 2. Requête unique AVEC les calculs de pricing et simulations Monte Carlo (--pricing)
npx tsx scripts/parse-query-cli.ts "Autocall LVMH 3 ans PDI 70%" --pricing

# 3. Traitement par lot d'un fichier de requêtes avec enregistrement du JSON
npx tsx scripts/parse-query-cli.ts --reqs mes_requetes.txt --output resultats.json --pricing

# Raccourci npm alternatif
npm run parse-cli -- "Phoenix Kering 2 ans"
```

---

## ⚙️ Configuration Applicative (`app-config.json`)

Le fichier `src/assets/app-config.json` permet de piloter le comportement de l'application sans recompiler :

```json
{
  "termsheetTemplatesByPayoff": {
    "AUTOCALL_CLASSIC": "natixis_cib_standard",
    "PHOENIX_MEMORY": "sg_cib_phoenix",
    "REVERSE_CONVERTIBLE": "bnp_cib_standard",
    "AUTOCALL_PHOENIX_ASIAN_PDI": "natixis_cib_standard"
  },
  "defaultTermsheetTemplateId": "natixis_cib_standard",
  "allowedLocalModels": {
    "ollama": [
      { "id": "qwen3.6", "label": "Qwen 3.6 / Qwen 2.5 (32B / 14B)", "desc": "Recommandé pour structuration" },
      { "id": "gemma4-e4b", "label": "Gemma 4 E4B / Gemma 2 (27B)", "desc": "Modèle léger Google" }
    ],
    "lmstudio": [
      { "id": "qwen3.6", "label": "Qwen 3.6 (Local LM Studio)", "desc": "Modèle local LM Studio" }
    ]
  }
}
```

---

## 🚀 Guide d'Installation & Lancement en Local

### Prérequis
- **Node.js** v20.0.0, v22.0.0 ou v24.0.0+ (100% compatible avec Node v24.18.0)
- **npm** v10.0.0 ou supérieur
- **Python 3.12** pour `../inference-service/` (pas 3.14 : `chromadb`/`pydantic-core` n'a pas encore de wheel précompilé) — `uv python install 3.12` si besoin.
- **vLLM** (via le plugin `vllm-metal` sur Apple Silicon, ou vLLM natif sur Linux/GPU) pour servir les deux sidecars chat/embedding — voir [`../inference-service/README.md`](../inference-service/README.md).

### 1. Cloner le Projet & Installer les Dépendances
Ce dépôt contient deux projets indépendants : `webapp/` (cette app) et `../inference-service/`
(service Python d'analyse NLP + base vectorielle — voir son propre README).
```bash
git clone <URL_DU_DEPOT>
cd structai/webapp
npm install
```

### 2. Variables d'Environnement
Créez un fichier `.env` à la racine de `webapp/` (voir `.env.example`) :
```env
PORT=3000
NODE_ENV=development

# inference-service (voir ../inference-service/README.md pour le générer)
INFERENCE_SERVICE_URL=http://localhost:4001
INFERENCE_SERVICE_API_KEY=isk_...
```

Puis configurez et démarrez `inference-service` (voir [`../inference-service/README.md`](../inference-service/README.md)) — c'est là que se trouvent désormais la config des sidecars vLLM (chat + embedding), configurable depuis sa page d'admin.

### 3. Lancer l'Application en Mode Développement
```bash
npm run dev:all   # démarre l'app principale (3000), les 2 sidecars vLLM (8001/8002) ET inference-service (4001)
```
Ou séparément, chacun dans son propre terminal : `npm run dev` (app principale), les deux sidecars vLLM (voir [`../inference-service/README.md`](../inference-service/README.md)), et `cd ../inference-service && .venv/bin/python run.py`.

La commande active le serveur et ouvre automatiquement un nouvel onglet navigateur sur : **`http://localhost:3000`**

---

## 📦 Guide de Déploiement en Production

### Option 1 : Déploiement Docker

Un fichier Dockerfile multi-stage permet un déploiement sécurisé et optimisé :

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
```

#### Commandes de build & exécution Docker :
```bash
# Construction de l'image Docker
docker build -t structai-app .

# Exécution du conteneur
docker run -d -p 3000:3000 -e GEMINI_API_KEY="votre_cle_gemini" --name structai structai-app
```

---

### Option 2 : Déploiement GCP Cloud Run (Google Cloud)

```bash
gcloud run deploy structai \
  --source . \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="votre_cle_gemini"
```

---

## 📚 Documentation Additionnelle
- **Guide d'Intégration d'un Nouveau Payoff** : [INTEGRATION_NOUVEAUX_PAYOFFS.md](INTEGRATION_NOUVEAUX_PAYOFFS.md)
- **Spécification Famille Autocall Yeti Phoenix** : [Autocall.md](Autocall.md)
- **Script CLI de Parsing** : [scripts/parse-query-cli.ts](scripts/parse-query-cli.ts)

---

## 📄 Licence
Propriété Institutionnelle - StructAI FinTech Systems.
