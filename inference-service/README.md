# inference-service

Service Python unique regroupant :

- **l'analyse NLP** des demandes client (remplace l'ancien `quotation-service` Node — prompt + extraction JSON + détection des champs manquants) ;
- **les embeddings** pour la recherche sémantique sur les sous-jacents (remplace l'ancien `vector-service` — ChromaDB + ranking).

Les embeddings sont toujours servis par un sidecar **vLLM** local (`vllm serve --runner pooling`), jamais importé en Python dans ce service — `inference-service` ne lui parle qu'en HTTP, via son API compatible OpenAI (`/v1/embeddings`).

Le chat/analyse, lui, supporte **deux types de fournisseur** (configurable depuis l'admin, onglet "Config. Chat") :
- **`openai_compatible`** : tout endpoint parlant le protocole OpenAI chat-completions — par défaut le sidecar vLLM local (`vllm serve`, même principe que pour l'embedding), mais aussi LM Studio, l'endpoint OpenAI-compatible d'Ollama, ou une vraie API cloud OpenAI-compatible moyennant une clé.
- **`gemini`** : l'API Google Gemini (cloud), appelée directement en REST (pas de dépendance SDK) — une clé API est requise.

La clé API, quand elle existe, est stockée en base et **n'est jamais renvoyée en clair** par l'API (`GET /api/config/llm` ne renvoie que `hasApiKey: true/false`).

## Pourquoi un sidecar HTTP plutôt qu'un import direct de `vllm` ?

- **Isolation des pannes** : un crash du moteur vLLM (observé en pratique : segfault au shutdown avec `vllm-metal`) ne touche jamais ce service — le sidecar redémarre seul.
- **Cycle de vie découplé** : redéployer ce code ne recharge jamais un modèle de plusieurs Go de VRAM.
- **Mode d'usage officiel** : `vllm serve` gère batching, métriques, health checks.
- **Cohérent avec le reste du projet** : mêmes appels HTTP localhost que les anciennes intégrations Gemini/Ollama.

Conséquence : `requirements.txt` ne contient **aucune dépendance vLLM**.

## Développement (Mac, via vllm-metal)

```bash
# Terminal 1 — sidecar chat
bash ../scripts/dev-vllm-chat.sh

# Terminal 2 — sidecar embedding
bash ../scripts/dev-vllm-embed.sh

# Terminal 3 — ce service (venv léger, sans vllm)
cd inference-service
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # puis ajuster JWT_SECRET / ADMIN_PASSWORD
.venv/bin/python run.py
```

Page d'admin : http://localhost:4001/admin/login.html (identifiants bootstrap : voir `.env`, un mot de passe est généré et affiché dans les logs au premier démarrage si `ADMIN_PASSWORD` n'est pas défini).

Depuis la racine du monorepo, `npm run dev:all` démarre les 3 process ci-dessus en même temps que l'app principale (voir `package.json`).

**Vérifié en réel** sur ce Mac avec `Qwen/Qwen3-4B-Instruct-2507` (chat) et `Qwen/Qwen3-Embedding-0.6B` (embedding) : `/api/analyze` et `/api/instruments/search` fonctionnent de bout en bout contre de vrais sidecars vLLM. Deux limitations vllm-metal réelles ont été rencontrées et corrigées dans `scripts/dev-vllm-*.sh` :

- **Contexte par défaut trop grand** : `Qwen3-4B-Instruct-2507` réclame par défaut un contexte de 262144 tokens (~36 Go de KV cache à lui seul), ce qui affame le sidecar d'embedding tournant en parallèle sur la même mémoire unifiée. `dev-vllm-chat.sh` passe `--max-model-len 8192` (largement suffisant pour ces prompts courts, ajustable via `LLM_MAX_MODEL_LEN_DEV`).
- **Checkpoints d'embedding Qwen incompatibles avec le chargeur MLX de vllm-metal** : les poids `.safetensors` des modèles d'embedding Qwen (`Qwen3-Embedding-*`) sont stockés avec des noms de clés "plats" (`embed_tokens.weight`, `layers.0...`) — convention encoder-only/sentence-transformers — alors que le chargeur MLX de vllm-metal construit un squelette `Qwen3ForCausalLM` qui attend un préfixe `model.` (comme les checkpoints de chat, qui eux fonctionnent sans problème). Résultat sans le contournement : `ValueError: Received 310 parameters not in model: embed_tokens.weight, ...`. `dev-vllm-embed.sh` appelle automatiquement `scripts/patch-vllm-metal-embedding.py`, qui télécharge le modèle, réécrit les noms de clés avec le préfixe manquant, et sert cette copie locale (mise en cache sous `~/.cache/vllm-metal-patched/`, réécrite une seule fois) — totalement transparent, `EMBEDDING_MODEL_DEV` reste le nom du modèle HF.

## Tests

```bash
cd inference-service
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

Le sidecar vLLM est **toujours mocké** dans les tests (`app.services.inference_client.chat_completion` / `.embed`) — aucun process `vllm serve` réel n'est nécessaire pour faire tourner la suite, ni en local ni en CI.

## Production (Linux + GPU, Docker)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export ADMIN_PASSWORD=... # mot de passe admin initial
docker compose up -d
```

`docker-compose.yml` démarre 3 conteneurs : `vllm-chat` et `vllm-embed` (image officielle `vllm/vllm-openai`, GPU passthrough) et `app` (ce service, sans GPU). Ajuster les noms de modèles et `--gpu-memory-utilization` une fois les tailles définitives connues sur le GPU cible (ex: NVIDIA Grace Hopper GH200, 96 Go de VRAM).

## Authentification

- **Utilisateurs humains** (page d'admin) : JWT via `POST /api/auth/login`, rôles `admin`/`user`.
- **Service-à-service** (l'application principale StructAI) : clé API `isk_<id>_<secret>`, générée une seule fois depuis l'admin UI (onglet "Clés API"), utilisée en `Authorization: Bearer isk_...` sur `POST /api/analyze` et `POST /api/instruments/search`.

## Endpoints principaux

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/analyze` | clé API ou JWT | Analyse NLP d'une demande client → JSON structuré par cotation |
| POST | `/api/instruments/search` | clé API ou JWT | Recherche sémantique sur les instruments |
| GET/POST/PUT/DELETE | `/api/instruments*` | JWT admin (lecture: clé API ou JWT) | CRUD + import/export CSV/JSON |
| GET/PUT | `/api/config/llm` | JWT (écriture: admin) | Config du sidecar de chat (baseUrl, modèle, température) |
| GET/PUT | `/api/config/embedding` | JWT (écriture: admin) | Config du sidecar d'embedding (baseUrl, modèle) |
| * | `/api/users`, `/api/api-keys` | JWT admin | Gestion des utilisateurs et des clés de service |
| GET | `/api/status`, `/api/health` | public | Statut sans secret, pour les badges de l'app principale |

## Extensibilité des classes d'actifs

Le schéma `AssetClass` (`EQUITY`, `RATE_INDEX`, `FX`, `CREDIT`) est déjà accepté de bout en bout (SQLite, Chroma, admin UI) — seul `EQUITY` est peuplé aujourd'hui. Ajouter une nouvelle classe d'actif ne nécessite pas de migration de schéma, seulement (le cas échéant) une nouvelle correspondance de colonnes CSV dans `app/services/csv_io.py` (le JSON reste générique).
