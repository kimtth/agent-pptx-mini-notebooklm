"""Lightweight multilingual embedding service using multilingual-e5-small via ONNX Runtime.

Provides 384-dimensional sentence embeddings with no external API calls.
Supports 100+ languages (ja, ko, zh, en, de, fr, ar, etc.).

Model: intfloat/multilingual-e5-small (quantized INT8 via Xenova)
Requires "query: " or "passage: " prefix — handled via the `prefix` parameter.

Model is loaded lazily on first call and cached in-process.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "resources" / "models" / "embed"

_session: ort.InferenceSession | None = None
_tokenizer: Tokenizer | None = None
_input_names: list[str] | None = None
_MAX_SEQ_LEN = 512  # multilingual-e5-small supports 512 tokens


def _ensure_loaded() -> tuple[ort.InferenceSession, Tokenizer]:
    global _session, _tokenizer, _input_names
    if _session is not None and _tokenizer is not None:
        return _session, _tokenizer

    model_path = _MODEL_DIR / "model.onnx"
    tokenizer_path = _MODEL_DIR / "tokenizer.json"

    if not model_path.exists():
        raise FileNotFoundError(
            f"ONNX model not found at {model_path}. "
            "Run: uv run python scripts/raptor/download_model.py"
        )

    opts = ort.SessionOptions()
    opts.inter_op_num_threads = 1
    opts.intra_op_num_threads = 2
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    _session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])
    _input_names = [inp.name for inp in _session.get_inputs()]

    _tokenizer = Tokenizer.from_file(str(tokenizer_path))
    _tokenizer.enable_truncation(max_length=_MAX_SEQ_LEN)
    _tokenizer.enable_padding(length=_MAX_SEQ_LEN)

    return _session, _tokenizer


def _mean_pool(token_embeddings: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    """Mean-pool token embeddings using attention mask."""
    mask_expanded = np.expand_dims(attention_mask, axis=-1).astype(np.float32)
    summed = np.sum(token_embeddings * mask_expanded, axis=1)
    counts = np.clip(mask_expanded.sum(axis=1), a_min=1e-9, a_max=None)
    return summed / counts


def _normalize(vectors: np.ndarray) -> np.ndarray:
    """L2-normalize each row vector."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.clip(norms, a_min=1e-12, a_max=None)
    return vectors / norms


def embed(texts: Sequence[str], prefix: str = "query: ") -> list[list[float]]:
    """Embed a batch of texts into 384-dim normalized vectors.

    Args:
        texts: List of strings to embed.
        prefix: E5 prefix — use "query: " for queries/symmetric tasks,
                "passage: " for document passages to be searched.

    Returns:
        List of 384-dimensional float vectors (L2-normalized).
    """
    if not texts:
        return []

    session, tokenizer = _ensure_loaded()

    # E5 models require prefix for proper embedding alignment
    prefixed = [f"{prefix}{t}" for t in texts]
    encoded = tokenizer.encode_batch(prefixed)

    input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)

    feeds: dict[str, np.ndarray] = {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
    }
    # Only provide token_type_ids if the ONNX model expects it
    if _input_names and "token_type_ids" in _input_names:
        feeds["token_type_ids"] = np.zeros_like(input_ids, dtype=np.int64)

    outputs = session.run(None, feeds)

    # outputs[0] = last_hidden_state: (batch, seq_len, 384)
    pooled = _mean_pool(outputs[0], attention_mask)
    normalized = _normalize(pooled)

    return normalized.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors (assumed L2-normalized)."""
    return float(np.dot(a, b))


def cosine_similarity_matrix(vectors: list[list[float]]) -> np.ndarray:
    """Compute pairwise cosine similarity matrix (assumes L2-normalized vectors)."""
    mat = np.array(vectors, dtype=np.float32)
    return mat @ mat.T


# --- CLI quick-test ---
if __name__ == "__main__":
    import sys
    import time

    test_texts = [
        "Power Platform Center of Excellence governance strategy",
        "機械学習モデルのトレーニングパイプライン",  # Japanese
        "클라우드 인프라 배포 전략",  # Korean
        "Stratégie de déploiement cloud Azure",  # French
    ]

    print("Loading model...", file=sys.stderr)
    t0 = time.perf_counter()
    vectors = embed(test_texts, prefix="query: ")
    t1 = time.perf_counter()
    print(f"First call (with model load): {t1 - t0:.3f}s", file=sys.stderr)
    print(f"Vector dimensions: {len(vectors[0])}", file=sys.stderr)

    t0 = time.perf_counter()
    vectors2 = embed(test_texts, prefix="query: ")
    t1 = time.perf_counter()
    print(f"Second call (cached): {t1 - t0:.3f}s", file=sys.stderr)

    # Similarity matrix
    sims = cosine_similarity_matrix(vectors)
    print("\nSimilarity matrix (multilingual):")
    for i, t in enumerate(test_texts):
        print(f"  [{i}] {t[:50]}")
    print(sims.round(3))

    print(json.dumps({"ok": True, "dim": len(vectors[0]), "count": len(vectors)}))
