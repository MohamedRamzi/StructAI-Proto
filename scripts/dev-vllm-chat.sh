#!/usr/bin/env bash
# Starts the chat/analysis vLLM sidecar for local development, via the
# vllm-metal plugin (Apple Silicon / MLX — see inference-service/README.md).
# Used by `npm run dev:all` at the repo root. Override with env vars:
#   VLLM_METAL_VENV   path to the vllm-metal virtualenv (default: ~/.venv-vllm-metal)
#   LLM_MODEL_DEV     model to serve (default: Qwen/Qwen3-4B-Instruct-2507)
#   LLM_PORT_DEV      port to serve on (default: 8001)
set -euo pipefail

VENV="${VLLM_METAL_VENV:-$HOME/.venv-vllm-metal}"
MODEL="${LLM_MODEL_DEV:-Qwen/Qwen3-4B-Instruct-2507}"
PORT="${LLM_PORT_DEV:-8001}"

if [ ! -x "$VENV/bin/vllm" ]; then
  echo "[dev-vllm-chat] vllm-metal introuvable dans $VENV — installez-le (voir inference-service/README.md) ou définissez VLLM_METAL_VENV." >&2
  exit 1
fi

source "$VENV/bin/activate"
exec vllm serve "$MODEL" --port "$PORT"
