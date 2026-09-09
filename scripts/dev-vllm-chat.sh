#!/usr/bin/env bash
# Starts the chat/analysis vLLM sidecar for local development, via the
# vllm-metal plugin (Apple Silicon / MLX — see inference-service/README.md).
# Used by `npm run dev:all` at the repo root. Override with env vars:
#   VLLM_METAL_VENV      path to the vllm-metal virtualenv (default: ~/.venv-vllm-metal)
#   LLM_MODEL_DEV        model to serve (default: Qwen/Qwen3-4B-Instruct-2507)
#   LLM_PORT_DEV         port to serve on (default: 8001)
#   LLM_MAX_MODEL_LEN_DEV  context window cap (default: 8192) — Qwen3-4B-Instruct-2507's
#     own default (262144) needs ~36GB of KV cache alone, which starves the embedding
#     sidecar running alongside it on the same unified memory; 8192 is ample for the
#     short quotation-parsing prompts this service sends and leaves headroom to spare.
set -euo pipefail

VENV="${VLLM_METAL_VENV:-$HOME/.venv-vllm-metal}"
MODEL="${LLM_MODEL_DEV:-Qwen/Qwen3-4B-Instruct-2507}"
PORT="${LLM_PORT_DEV:-8001}"
MAX_MODEL_LEN="${LLM_MAX_MODEL_LEN_DEV:-8192}"

if [ ! -x "$VENV/bin/vllm" ]; then
  echo "[dev-vllm-chat] vllm-metal introuvable dans $VENV — installez-le (voir inference-service/README.md) ou définissez VLLM_METAL_VENV." >&2
  exit 1
fi

source "$VENV/bin/activate"
exec vllm serve "$MODEL" --port "$PORT" --max-model-len "$MAX_MODEL_LEN"
