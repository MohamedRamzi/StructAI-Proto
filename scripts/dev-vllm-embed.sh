#!/usr/bin/env bash
# Starts the embedding vLLM sidecar for local development, via the vllm-metal
# plugin (Apple Silicon / MLX — see inference-service/README.md). Used by
# `npm run dev:all` at the repo root. Override with env vars:
#   VLLM_METAL_VENV      path to the vllm-metal virtualenv (default: ~/.venv-vllm-metal)
#   EMBEDDING_MODEL_DEV  model to serve (default: Qwen/Qwen3-Embedding-0.6B)
#   EMBEDDING_PORT_DEV   port to serve on (default: 8002)
set -euo pipefail

VENV="${VLLM_METAL_VENV:-$HOME/.venv-vllm-metal}"
MODEL="${EMBEDDING_MODEL_DEV:-Qwen/Qwen3-Embedding-0.6B}"
PORT="${EMBEDDING_PORT_DEV:-8002}"

if [ ! -x "$VENV/bin/vllm" ]; then
  echo "[dev-vllm-embed] vllm-metal introuvable dans $VENV — installez-le (voir inference-service/README.md) ou définissez VLLM_METAL_VENV." >&2
  exit 1
fi

source "$VENV/bin/activate"
exec vllm serve "$MODEL" --port "$PORT" --runner pooling
