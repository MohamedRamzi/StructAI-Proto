#!/usr/bin/env python3
"""
Workaround for a real vllm-metal (Apple Silicon MLX plugin) loading bug: Qwen's
published embedding checkpoints (e.g. Qwen3-Embedding-0.6B) ship their
safetensors weights with FLAT key names (`embed_tokens.weight`,
`layers.0...`, `norm.weight`) — the sentence-transformers/AutoModel encoder-only
convention. vllm-metal's MLX loader (`mlx_lm.utils.load_model`) instead builds
a `Qwen3ForCausalLM`-shaped skeleton that expects `model.`-prefixed keys (as
regular chat-model checkpoints have), so it fails immediately with:

    ValueError: Received 310 parameters not in model: embed_tokens.weight, ...

Confirmed empirically: the identical model class loads fine for chat models
(their checkpoints DO have the `model.` prefix), so this is specific to
Qwen's embedding-model checkpoint format, not a MLX/hardware limitation.

This script downloads the checkpoint via huggingface_hub, rewrites the
safetensors weight names to add the missing `model.` prefix (skipping any
`lm_head.*` keys, which embedding checkpoints don't ship anyway since
`tie_word_embeddings` is true), and writes the patched copy to a stable local
cache directory. Idempotent — skips the rewrite if a patched copy already
exists. `vllm serve` is then pointed at that local directory instead of the
bare HF repo id.

Usage: python3 patch-vllm-metal-embedding.py <hf_model_id> [<output_dir>]
Prints the resulting local path to stdout on success.
"""
import shutil
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: patch-vllm-metal-embedding.py <hf_model_id> [<output_dir>]", file=sys.stderr)
        sys.exit(1)

    model_id = sys.argv[1]
    cache_root = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / ".cache" / "vllm-metal-patched"
    dest = cache_root / model_id.replace("/", "--")
    marker = dest / ".patched-ok"

    if marker.exists():
        print(str(dest))
        return

    from huggingface_hub import snapshot_download
    from safetensors import safe_open
    from safetensors.torch import save_file

    print(f"[patch-vllm-metal-embedding] Downloading {model_id} ...", file=sys.stderr)
    src = Path(snapshot_download(model_id))

    dest.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name == "model.safetensors":
            continue
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    safetensors_files = sorted(src.glob("*.safetensors"))
    if not safetensors_files:
        print(f"[patch-vllm-metal-embedding] No .safetensors file found in {src}", file=sys.stderr)
        sys.exit(1)

    print(f"[patch-vllm-metal-embedding] Rewriting weight key names (adding 'model.' prefix) ...", file=sys.stderr)
    for sf in safetensors_files:
        tensors = {}
        with safe_open(str(sf), framework="pt") as f:
            for key in f.keys():
                new_key = key if key.startswith(("lm_head.", "model.")) else f"model.{key}"
                tensors[new_key] = f.get_tensor(key)
        save_file(tensors, str(dest / sf.name), metadata={"format": "pt"})

    marker.write_text(f"patched from {model_id}\n")
    print(str(dest))


if __name__ == "__main__":
    main()
