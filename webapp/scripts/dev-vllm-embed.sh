#!/usr/bin/env bash
# Starts the embedding vLLM sidecar for local development, via the vllm-metal
# plugin (Apple Silicon / MLX — see ../inference-service/README.md). Used by
# `npm run dev:all` at the repo root. Override with env vars:
#   VLLM_METAL_VENV      path to the vllm-metal virtualenv (default: ~/.venv-vllm-metal)
#   EMBEDDING_MODEL_DEV  model to serve (default: Qwen/Qwen3-Embedding-0.6B)
#   EMBEDDING_PORT_DEV   port to serve on (default: 8002)
#
# Qwen's embedding checkpoints ship with flat (no "model." prefix) safetensors
# key names, which vllm-metal's MLX loader can't match against the
# Qwen3ForCausalLM skeleton it builds — confirmed empirically as an upstream
# vllm-metal bug, not a config issue (chat-model checkpoints, which DO carry
# the "model." prefix, load fine through the exact same code path). Every
# Qwen embedding model is patched through scripts/patch-vllm-metal-embedding.py
# (idempotent — cached under ~/.cache/vllm-metal-patched, only rewritten once)
# before being served, and `vllm serve` points at that local patched copy with
# --served-model-name preserving the original HF id so inference-service's
# configured model name still matches.
set -euo pipefail

VENV="${VLLM_METAL_VENV:-$HOME/.venv-vllm-metal}"
MODEL="${EMBEDDING_MODEL_DEV:-Qwen/Qwen3-Embedding-0.6B}"
PORT="${EMBEDDING_PORT_DEV:-8002}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -x "$VENV/bin/vllm" ]; then
  echo "[dev-vllm-embed] vllm-metal introuvable dans $VENV — installez-le (voir ../inference-service/README.md) ou définissez VLLM_METAL_VENV." >&2
  exit 1
fi

source "$VENV/bin/activate"

case "$MODEL" in
  Qwen/Qwen3-Embedding-*)
    PATCHED_PATH="$(python3 "$SCRIPT_DIR/patch-vllm-metal-embedding.py" "$MODEL")"
    exec vllm serve "$PATCHED_PATH" --served-model-name "$MODEL" --port "$PORT" --runner pooling
    ;;
  *)
    exec vllm serve "$MODEL" --port "$PORT" --runner pooling
    ;;
esac
