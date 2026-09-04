# quotation-service

Service Node.js autonome qui héberge l'**analyse NLP des demandes client** pour StructAI : il prend une requête en langage naturel, la concatène au prompt système (`QuotationPrompt.md`), interroge le LLM configuré, et retourne le JSON reconnu — en signalant les champs requis que le modèle n'a pas pu extraire (ex : maturité absente) au lieu de les deviner silencieusement.

Il expose aussi une **page d'administration** (HTML/JS statique, sans build) pour configurer l'accès au LLM, gérer les utilisateurs et leurs rôles, et générer les clés d'API utilisées par l'application principale StructAI pour l'appeler.

## Démarrage rapide

```bash
cd quotation-service
cp .env.example .env   # puis éditez JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run dev             # démarre sur http://localhost:4001
```

Au premier démarrage, un compte admin est créé automatiquement à partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD` (ou un mot de passe aléatoire est généré et affiché dans les logs si `ADMIN_PASSWORD` n'est pas défini).

1. Ouvrez **http://localhost:4001/admin/login.html** et connectez-vous.
2. Onglet **Configuration LLM** : choisissez le provider (Gemini, Ollama, LM Studio, ou tout endpoint OpenAI-compatible — vLLM inclus), le modèle, et la clé API si nécessaire.
3. Onglet **Clés API** : générez une clé de service (`qsk_...`) — copiez-la immédiatement, elle n'est affichée qu'une fois.
4. Collez cette clé dans le `.env` de l'app principale (`LLM_SERVICE_API_KEY`), à la racine du repo.

Depuis la racine du repo, `npm run dev:all` démarre l'app principale **et** quotation-service ensemble.

## API

Toutes les routes retournent `{ success: boolean, ... }` ou `{ success: false, error: string }`.

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | JWT | Profil de l'utilisateur connecté |
| GET | `/api/users` | JWT admin | Liste des utilisateurs |
| POST | `/api/users` | JWT admin | Crée un utilisateur `{ email, password, role }` |
| PATCH | `/api/users/:id` | JWT admin | Modifie rôle/mot de passe |
| DELETE | `/api/users/:id` | JWT admin | Supprime un utilisateur |
| GET | `/api/config/llm` | JWT | Config LLM active (sans la clé API en clair) |
| PUT | `/api/config/llm` | JWT admin | Met à jour la config LLM |
| GET | `/api/api-keys` | JWT admin | Liste des clés API (préfixe seulement) |
| POST | `/api/api-keys` | JWT admin | Génère une clé — le token complet n'est renvoyé qu'à la création |
| DELETE | `/api/api-keys/:id` | JWT admin | Révoque une clé |
| POST | `/api/analyze` | Clé API ou JWT | **Le cœur du service** — voir ci-dessous |
| GET | `/api/status` | — (public) | `{ provider, modelName }`, sans secret |
| GET | `/api/health` | — (public) | Ping |

### `POST /api/analyze`

```json
// Requête
{ "query": "Autocall LVMH première fixation le 01/12/2026 PDI 70% 3 ans" }

// Réponse
{
  "success": true,
  "providerUsed": "gemini",
  "modelUsed": "gemini-3.5-flash",
  "quotes": [{
    "quoteId": 1,
    "label": "Autocall Classic",
    "extraction": { "productTypeId": "AUTOCALL_CLASSIC", "maturityMonths": 36, "forwardStartDate": "2026-12-01", "...": "..." },
    "missingFields": []
  }]
}
```

Si un champ requis n'a pas pu être extrait (ex : maturité), il apparaît dans `missingFields` :
`[{ "field": "maturityMonths", "label": "Maturité totale (mois)", "message": "Maturité non spécifiée dans la demande client." }]`.

**Pas de fallback déterministe.** Si le LLM configuré ne répond pas ou échoue (clé invalide, endpoint injoignable, réponse non exploitable), `/api/analyze` renvoie `{ "success": false, "error": "..." }` — il n'y a aucun mécanisme de repli qui devinerait une extraction approximative à sa place. C'est volontaire : un échec d'extraction doit être visible et signalé à l'utilisateur, pas masqué derrière un résultat plausible mais potentiellement faux.

## Configuration (`.env`)

Voir `.env.example` pour la liste complète. Points clés :
- `JWT_SECRET` — obligatoire, secret de signature des tokens de connexion admin.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — compte admin créé au premier démarrage.
- `DB_PATH` — fichier SQLite (utilisateurs, config LLM, clés API), via le module natif `node:sqlite`.
- `GEMINI_API_KEY` — utilisée uniquement comme valeur de secours au tout premier démarrage (si aucune config LLM n'existe encore) ; ensuite, la clé se configure et se met à jour depuis l'admin UI.

## Tests

```bash
npm test
```

Couvre : `detectMissingFields` (validation.ts), hash/JWT, et un parcours d'intégration complet via `supertest` (login, RBAC admin/user, clés API, `/api/analyze` — y compris les cas d'échec : endpoint LLM en erreur, clé Gemini absente — le tout sans appel réseau réel grâce à un endpoint LLM simulé).
