"""Download multilingual-e5-small INT8-quantized ONNX model and tokenizer.

Model: intfloat/multilingual-e5-small  (100 languages, 384-dim, 12 layers)
ONNX:  Xenova/multilingual-e5-small    (quantized by HuggingFace for Transformers.js)

The INT8-quantized variant (model_quantized.onnx, ~118 MB) provides excellent
multilingual embeddings at a minimal footprint.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "resources" / "models" / "embed"

# Xenova repo has portable INT8 quantized models + unified tokenizer.json
HF_BASE = "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main"

FILES = {
    "model.onnx": f"{HF_BASE}/onnx/model_quantized.onnx",
    "tokenizer.json": f"{HF_BASE}/tokenizer.json",
    "tokenizer_config.json": f"{HF_BASE}/tokenizer_config.json",
    "config.json": f"{HF_BASE}/config.json",
}


def download_file(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"  [skip] {dest.name} already exists ({dest.stat().st_size:,} bytes)")
        return
    print(f"  [download] {dest.name} from {url} ...")
    urllib.request.urlretrieve(url, dest)
    print(f"  [done] {dest.name} ({dest.stat().st_size:,} bytes)")


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Model directory: {MODEL_DIR}")

    for filename, url in FILES.items():
        download_file(url, MODEL_DIR / filename)

    # Verify model file is reasonable size (>20MB for quantized model)
    model_path = MODEL_DIR / "model.onnx"
    if model_path.exists() and model_path.stat().st_size < 1_000_000:
        print(f"WARNING: model.onnx is suspiciously small ({model_path.stat().st_size} bytes)", file=sys.stderr)
        sys.exit(1)

    # Verify tokenizer loads (multilingual-e5-small uses sentencepiece vocab)
    tokenizer_path = MODEL_DIR / "tokenizer.json"
    if tokenizer_path.exists():
        data = json.loads(tokenizer_path.read_text(encoding="utf-8"))
        # Sentencepiece tokenizer.json uses model.vocab (list) not model.vocab (dict)
        vocab = data.get("model", {}).get("vocab", [])
        vocab_size = len(vocab) if isinstance(vocab, list) else len(vocab)
        print(f"Tokenizer vocab size: {vocab_size}")

    print("\nAll model files ready (multilingual-e5-small INT8).")


if __name__ == "__main__":
    main()
