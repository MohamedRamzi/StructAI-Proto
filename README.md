# StructAI

Deux projets indépendants, chacun avec sa propre documentation, ses propres dépendances et son
propre cycle de vie :

- **[`webapp/`](webapp/README.md)** — l'application principale (React + Express/Node) : parsing NLP,
  pricing Monte Carlo, génération de termsheets. Développement local : `cd webapp && npm install &&
  npm run dev:all`.
- **[`inference-service/`](inference-service/README.md)** — service Python (FastAPI) autonome :
  analyse NLP (LLM), base vectorielle RAG (ChromaDB), admin (utilisateurs, clés API, instruments,
  pré-prompts, journal des requêtes). Appelé par `webapp/` en HTTP via une clé d'API de service.
  Déployé en production sur la machine Linux GPU dans `/srv/StructAI`, avec ses propres stacks
  Docker séparées (`inference-service/config/` pour les sidecars vLLM, `inference-service/app/config/`
  pour l'app elle-même — démarrage/arrêt indépendants, voir son README).

Voir [`SETUP_MACBOOK.md`](webapp/SETUP_MACBOOK.md) pour un guide d'installation locale pas-à-pas
sur macOS.
