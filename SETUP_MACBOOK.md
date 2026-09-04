# 💻 Guide de Configuration & Lancement Local sur macOS (MacBook)

Ce guide détaillé vous explique pas-à-pas comment installer, configurer et exécuter **StructAI** sur votre MacBook (compatible processeurs **Apple Silicon M1 / M2 / M3 / M4** et **Intel**).

---

## 📋 1. Prérequis Système sur macOS

### A. Installer Homebrew (Gestionnaire de paquets macOS)
Ouvrez le **Terminal** (ou iTerm2) et exécutez la commande suivante :
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### B. Installer Node.js (Version 20+, 22+ ou 24+ - ex: v24.18.0) & Git
```bash
brew install node git
```
Vérifiez les versions installées :
```bash
node -v   # Affiche v20.x, v22.x ou v24.18.0+
npm -v    # Affiche v10.x.x ou plus récent
git --version
```

---

## 🚀 2. Installation du Projet StructAI

### A. Cloner le Projet ou Télécharger les Sources
```bash
# Accéder à votre dossier de projets
cd ~/Documents

# Cloner le dépôt Git
git clone <URL_DU_DEPOT> structai
cd structai
```

### B. Installer les Dépendances npm
```bash
npm install
```

### C. Configurer le Fichier d'Environnement `.env`
Créez un fichier `.env` à la racine de votre dossier `structai` :
```bash
cp .env.example .env
```
Ouvrez le fichier `.env` avec VS Code ou TextEdit :
```bash
code .env
```
Renseignez votre clé API Gemini (gratuite sur [Google AI Studio](https://aistudio.google.com/)) :
```env
GEMINI_API_KEY=votre_cle_api_gemini_securisee
PORT=3000
NODE_ENV=development
```

---

## 🧠 3. Options d'IA / Moteur LLM sur MacBook

StructAI vous offre 3 possibilités pour alimenter le moteur d'extraction NLP :

### Option A : Clé API Google Gemini (Recommandé - Ultra Rapide & Sans Charge Processeur)
- Obtenez une clé sur **https://aistudio.google.com/**.
- Ajoutez-la dans le fichier `.env` (`GEMINI_API_KEY=AIzaSy...`).
- L'application utilisera le modèle `gemini-2.5-flash` en serveur-side.

### Option B : Moteur IA 100% Local sur MacBook avec Ollama (Confidentialité Totale)
Si vous travaillez sur des données sensibles et souhaitez que le LLM s'exécute localement sur la mémoire unifiée de votre Mac :

1. **Installer Ollama pour Mac** via Homebrew :
   ```bash
   brew install ollama
   ```
2. **Lancer un modèle performant en finance** (ex: Llama 3.2 ou Mistral) :
   ```bash
   ollama run llama3.2
   ```
3. **Dans l'interface StructAI** : Sélectionnez *"Moteur Local Ollama / LM Studio"* dans le sélecteur d'engine en haut à droite de l'en-tête.

4. vLLM installé 
To use vllm, activate the virtual environment:
```bash
  source /Users/ramzimohamed/.venv-vllm-metal/bin/activate
```
Or add the venv to your PATH:
```bash
  export PATH="/Users/ramzimohamed/.venv-vllm-metal/bin:$PATH"
```

### Option C : LM Studio sur Apple Silicon (Puces M1/M2/M3/M4)
- Téléchargez [LM Studio pour Mac](https://lmstudio.ai/).
- Chargez un modèle Qwen 2.5 Coder, Llama 3 ou Mistral.
- Activez le *"Local Server"* sur le port `1234`.

---

## 🏃 4. Démarrage de l'Application

Dans le Terminal, à la racine du projet `structai` :

```bash
npm run dev
```

Un message confirme le démarrage du serveur Express + Vite :
```text
Server running on http://localhost:3000
```

Accédez à l'application depuis Safari, Chrome ou Firefox à l'adresse :
👉 **`http://localhost:3000`**

---

## 🛠️ 5. Résolution des Problèmes Fréquents (Troubleshooting macOS)

### Port 3000 déjà utilisé ?
Si vous obtenez l'erreur `EADDRINUSE: address already in use :::3000` :
```bash
# Identifier le processus occupant le port 3000
lsof -i :3000

# Arrêter le processus
kill -9 <PID>
```

### Problème de permissions de fichiers ?
```bash
sudo chown -R $(whoami) ~/Documents/structai
```

### Réinitialiser proprement le projet
Si vous modifiez les dépendances ou rencontrez un souci de build :
```bash
npm run clean
rm -rf node_modules package-lock.json
npm install
npm run dev
```

---

## 🎯 Commandes Utiles sur Mac

- `npm run dev` : Lance le serveur de développement full-stack.
- `npm run build` : Compile le projet pour la production dans `/dist`.
- `npm run lint` : Vérifie les types TypeScript.
- `npm start` : Exécute le serveur de production compilé.
