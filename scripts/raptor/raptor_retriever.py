"""RAPTOR retriever — query the hierarchical index for relevant document sections.

Given a query string and a .structured-summary.json (with raptorTree), embeds the
query and performs cosine similarity search across ALL tree levels, returning the
top-K most relevant leaf sections along with their parent cluster summaries for
broader context.

Usage:
    python raptor_retriever.py --summary-path <path> --query <text> [--top-k 8]
    python raptor_retriever.py --summary-path <path> --queries-json <json_array> [--top-k 8]

Output (stdout): JSON array of retrieved context objects.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embed_service import embed  # noqa: E402


def _load_tree(summary_path: str) -> dict:
    """Load structured summary with RAPTOR tree."""
    data = json.loads(Path(summary_path).read_text(encoding="utf-8"))
    if "raptorTree" not in data:
        raise ValueError("No raptorTree found in structured summary. Run raptor_builder first.")
    return data


def _collect_leaf_ids(nodes_by_id: dict[str, dict], node_id: str) -> list[str]:
    """Recursively collect all leaf node IDs under a given node."""
    node = nodes_by_id[node_id]
    if not node["children"]:
        return [node_id]
    leaves: list[str] = []
    for child_id in node["children"]:
        if child_id in nodes_by_id:
            leaves.extend(_collect_leaf_ids(nodes_by_id, child_id))
    return leaves


def retrieve(
    summary_data: dict,
    queries: list[str],
    top_k: int = 8,
) -> list[dict]:
    """Retrieve top-K relevant sections for a set of queries.

    Searches across all tree levels, then deduplicates and returns leaf sections
    with their parent cluster context.

    Args:
        summary_data: Parsed .structured-summary.json with raptorTree.
        queries: List of query strings (e.g., slide titles + bullets).
        top_k: Number of leaf sections to return.

    Returns:
        List of dicts: [{"heading", "text", "score", "clusterContext"}]
    """
    tree = summary_data["raptorTree"]
    nodes = tree["nodes"]

    if not nodes:
        return []

    # Build lookup
    nodes_by_id: dict[str, dict] = {n["id"]: n for n in nodes}

    # Build embedding matrix for all nodes
    if "embedding" not in nodes[0]:
        raise ValueError(
            "RAPTOR tree has no embeddings — rebuild with raptor_builder.py. "
            "Sample files may have embeddings stripped to save space."
        )
    all_embeddings = np.array([n["embedding"] for n in nodes], dtype=np.float32)
    # L2-normalize (should already be, but ensure)
    norms = np.linalg.norm(all_embeddings, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-12, None)
    all_embeddings = all_embeddings / norms

    # Embed queries
    query_embeddings = np.array(embed(queries, prefix="query: "), dtype=np.float32)

    # Compute similarities: (num_queries, num_nodes)
    sims = query_embeddings @ all_embeddings.T

    # Max similarity across queries for each node
    max_sims = sims.max(axis=0)  # shape: (num_nodes,)

    # Score leaf nodes both directly AND via their parent clusters
    leaf_scores: dict[str, float] = {}
    leaf_cluster_context: dict[str, list[str]] = {}

    for idx, node in enumerate(nodes):
        node_score = float(max_sims[idx])

        if node["level"] == 0:
            # Direct leaf match
            leaf_scores[node["id"]] = max(leaf_scores.get(node["id"], -1), node_score)
        else:
            # Cluster node — propagate score to children leaves with a small boost
            child_leaves = _collect_leaf_ids(nodes_by_id, node["id"])
            for leaf_id in child_leaves:
                # Cluster score propagates as a bonus (weighted down)
                boosted = max(leaf_scores.get(leaf_id, -1), node_score * 0.85)
                leaf_scores[leaf_id] = max(leaf_scores.get(leaf_id, -1), boosted)
                # Track cluster context
                if leaf_id not in leaf_cluster_context:
                    leaf_cluster_context[leaf_id] = []
                leaf_cluster_context[leaf_id].append(node["heading"])

    # Sort by score and take top-K
    ranked = sorted(leaf_scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    results: list[dict] = []
    for leaf_id, score in ranked:
        node = nodes_by_id[leaf_id]
        context = leaf_cluster_context.get(leaf_id, [])
        results.append({
            "heading": node["heading"],
            "text": node["text"],
            "score": round(score, 4),
            "clusterContext": context,
        })

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrieve relevant sections from RAPTOR tree")
    parser.add_argument("--summary-path", type=str, required=True, help="Path to .structured-summary.json")
    query_group = parser.add_mutually_exclusive_group(required=True)
    query_group.add_argument("--query", type=str, help="Single query string")
    query_group.add_argument("--queries-json", type=str, help="JSON array of query strings")
    parser.add_argument("--top-k", type=int, default=8, help="Number of results to return")
    args = parser.parse_args()

    t0 = time.perf_counter()

    summary_data = _load_tree(args.summary_path)

    if args.query:
        queries = [args.query]
    else:
        queries = json.loads(args.queries_json)

    results = retrieve(summary_data, queries, top_k=args.top_k)

    t1 = time.perf_counter()
    print(f"[raptor-retrieve] {len(results)} results in {t1 - t0:.2f}s", file=sys.stderr)

    # Output JSON to stdout
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
