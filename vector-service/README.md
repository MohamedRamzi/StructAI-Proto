# vector-service

Service Python autonome qui héberge la **base vectorielle RAG** de StructAI : recherche sémantique sur les sous-jacents (et, à terme, indices de taux / FX / crédit) via de vrais embeddings (Qwen3-Embedding servi par Ollama) et ChromaDB — remplace l'ancienne recherche TF-IDF codée en dur côté navigateur.

Il expose aussi une **page d'administration** (HTML/JS statique, sans build) pour gérer les instruments (CRUD, import/export CSV+JSON), configurer le modèle d'embedding, et gérer les utilisateurs/clés API.

## Démarrage rapide

Nécessite Python **3.12** (pas 3.14 : `pydantic-core`, dépendance de `chromadb`, n'a pas encore de wheel précompilé pour 3.14 sur cette machine — confirmé empiriquement). Si `python3.12` n'est pas disponible :

```bash
uv python install 3.12   # ou: brew install python@3.12
```

```bash
cd vector-service
cp .env.example .env   # puis éditez JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
$(uv python find 3.12) -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
ollama pull qwen3-embedding      # modèle d'embedding local (~4.7 Go)
python run.py                     # démarre sur http://localhost:4002
```

Au premier démarrage, un compte admin est créé automatiquement à partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD` (ou un mot de passe aléatoire est généré et affiché dans les logs si `ADMIN_PASSWORD` n'est pas défini).

1. Ouvrez **http://localhost:4002/admin/login.html** et connectez-vous.
2. Onglet **Configuration Embedding** : vérifiez/ajustez le modèle (`qwen3-embedding`) et l'URL Ollama.
3. Onglet **Clés API** : générez une clé de service (`vsk_...`) pour l'application principale — copiez-la immédiatement, elle n'est affichée qu'une fois.
4. Collez cette clé dans le `.env` de l'app principale (`VECTOR_SERVICE_API_KEY`), à la racine du repo.
5. Peuplez les 10 actions de démonstration : `npm run seed:vector` depuis la racine (nécessite `VECTOR_SERVICE_ADMIN_EMAIL`/`VECTOR_SERVICE_ADMIN_PASSWORD` dans le `.env` racine — un JWT admin, pas la clé de service, voir plus bas).

Depuis la racine du repo, `npm run dev:all` démarre l'app principale, `quotation-service`, **et** `vector-service` ensemble.

## Modèle de données (extensible)

Chaque enregistrement est un **instrument** : `{ id, assetClass, code, name, description, tags, metadata }`.
- `assetClass` : `EQUITY` aujourd'hui ; `RATE_INDEX` / `FX` / `CREDIT` prêts à recevoir des données sans migration de schéma (le champ `metadata` est un JSON libre, propre à chaque classe d'actif).
- `description` : texte libre qui est **effectivement embeddé** pour la recherche sémantique (fusionné avec les tags et les valeurs de `metadata`, voir `app/services/instruments.py::build_description_text`).
- SQLite (`app/db.py`) est la source de vérité (CRUD, listing, export) ; ChromaDB (`app/services/vector_store.py`) ne stocke que l'index sémantique (id → vecteur + `assetClass` pour le filtrage). Chaque écriture met à jour les deux.

ChromaDB tourne **intégré dans le process Python** (`PersistentClient`), pas comme un serveur `chroma run` séparé — un seul process à lancer, cohérent avec un unique consommateur.

## API

Toutes les routes retournent `{ success: true, ... }` ou `{ success: false, error: string }`.

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | JWT | Profil de l'utilisateur connecté |
| GET/POST/PATCH/DELETE | `/api/users` | JWT admin | Gestion des utilisateurs |
| GET | `/api/config/embedding` | JWT | Config active (provider/modèle/URL) |
| PUT | `/api/config/embedding` | JWT admin | Met à jour le modèle / l'URL Ollama |
| GET/POST/DELETE | `/api/api-keys` | JWT admin | Clés de service (`vsk_...`) |
| GET | `/api/instruments` | Clé API **ou** JWT | Liste/filtre (`assetClass`, `q`) |
| GET/POST/PUT/DELETE | `/api/instruments[/:id]` | JWT admin | CRUD — **pas** la clé de service (voir Sécurité) |
| **POST** | **`/api/instruments/search`** | Clé API **ou** JWT | **Le cœur** : `{ query, assetClass?, limit? }` → embed + ChromaDB |
| POST | `/api/instruments/import/csv` \| `/import/json` | JWT admin | Import en masse |
| GET | `/api/instruments/export?format=csv\|json` | JWT admin | Export |
| GET | `/api/status`, `/api/health` | — (public) | Statut sans secret |

### Sécurité : la clé de service est en lecture seule

`VECTOR_SERVICE_API_KEY` (utilisée par l'app principale pour `/api/instruments/search`) est **rejetée** par les routes de création/modification/suppression/import — celles-ci exigent un JWT admin humain. C'est volontaire (moindre privilège) : le process toujours actif de l'app principale ne peut interroger la base, pas la modifier. `scripts/seed-vector-service.ts` s'authentifie donc avec un login admin (`VECTOR_SERVICE_ADMIN_EMAIL`/`_PASSWORD` dans le `.env` racine), pas avec la clé de service.

### `POST /api/instruments/search`

```json
// Requête
{ "query": "actions luxe europeen fort potentiel de coupon", "assetClass": "EQUITY", "limit": 5 }

// Réponse
{
  "success": true,
  "results": [
    { "id": "EQUITY:KER FP", "assetClass": "EQUITY", "code": "KER FP", "name": "Kering SA", "score": 0.627, "description": "...", "tags": [...], "metadata": { "spotPrice": 245.8, "...": "..." } }
  ]
}
```

**Pas de fallback silencieux.** Si Ollama est injoignable ou le modèle n'est pas installé, la requête renvoie `{ "success": false, "error": "..." }` (message explicite, ex: *"model qwen3-embedding not found, try pulling it first"*) — jamais un résultat par mots-clés déguisé en recherche sémantique.

## Import / Export CSV & JSON

- **CSV** : scope à `EQUITY` (format tabulaire), colonnes compatibles avec l'ancien export du tableau de bord principal (`Ticker,ISIN,Name,Sector,Region,SpotPrice,Currency,ImpliedVol3m,DividendYield,VolatilityScore,Reasoning`) — `Ticker` est accepté comme alias de `Code`, donc un export existant s'importe presque tel quel.
- **JSON** : générique, toute classe d'actif — c'est le format utilisé par `scripts/seed-vector-service.ts`.

## Tests

```bash
source .venv/bin/activate
pytest
```

36 tests : hachage/JWT, CRUD, recherche sémantique (embeddings mockés — déterministes, aucun appel réseau réel), import/export CSV/JSON, RBAC, et le cas "échec de l'embedding → erreur claire, pas de repli silencieux".
