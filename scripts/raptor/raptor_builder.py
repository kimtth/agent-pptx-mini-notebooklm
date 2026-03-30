"""RAPTOR tree builder — hierarchical document indexing with local embeddings.

Reads raw markdown (from MarkItDown), splits into sections, embeds via
multilingual-e5-small (ONNX), clusters by cosine similarity, and writes a
.structured-summary.json with the RAPTOR tree for retrieval-augmented PPTX
generation.

Usage:
    python raptor_builder.py --markdown-path <path> --output-path <path> [--title <title>]
    python raptor_builder.py --markdown <text>     --output-path <path> [--title <title>]

The output JSON schema:
{
  "documentTitle": str,
  "globalSummary": { "mainTheme": str },
  "raptorTree": {
    "nodes": [
      { "id": str, "level": int, "heading": str, "text": str,
        "embedding": [float...], "children": [str...] }
    ]
  }
}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import TypedDict

import numpy as np

# Sibling import
sys.path.insert(0, str(Path(__file__).resolve().parent))
from embed_service import cosine_similarity_matrix, embed  # noqa: E402

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class RaptorNode(TypedDict):
    id: str
    level: int
    heading: str
    text: str
    embedding: list[float]
    children: list[str]


class RaptorTree(TypedDict):
    nodes: list[RaptorNode]


class StructuredSummary(TypedDict):
    documentTitle: str
    globalSummary: dict
    raptorTree: RaptorTree


# ---------------------------------------------------------------------------
# Section splitting — hybrid: heading-based + semantic paragraph grouping
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(
    r"""
    ^(?:
        (?P<md>\#{1,6})\s+(?P<md_title>.+)         # ## Heading
      | (?P<num>\d+(?:\.\d+)*)[.)]\s+(?P<num_title>.+)  # 1.2) Heading
      | (?P<caps>[A-Z][A-Z\s]{4,})$                 # ALL CAPS HEADING
    )
    """,
    re.VERBOSE | re.MULTILINE,
)

# Paragraph boundary: two or more newlines, or a line that is only whitespace
_PARA_SPLIT_RE = re.compile(r"\n\s*\n")


def _heading_level(match: re.Match) -> tuple[int, str]:
    if match.group("md"):
        return len(match.group("md")), match.group("md_title").strip()
    if match.group("num"):
        depth = match.group("num").count(".") + 1
        return min(depth + 1, 6), match.group("num_title").strip()
    if match.group("caps"):
        return 2, match.group("caps").strip().title()
    return 2, ""


def _split_sections_by_headings(markdown: str, min_chars: int = 100) -> list[dict]:
    """Split markdown into sections by heading detection (original approach)."""
    sections: list[dict] = []
    current_heading = "Introduction"
    current_level = 1
    current_lines: list[str] = []

    for line in markdown.split("\n"):
        m = _HEADING_RE.match(line.strip())
        if m:
            text = "\n".join(current_lines).strip()
            if text and len(text) >= min_chars:
                sections.append({
                    "heading": current_heading,
                    "text": text,
                    "level": current_level,
                })
            current_level, current_heading = _heading_level(m)
            current_lines = []
        else:
            current_lines.append(line)

    text = "\n".join(current_lines).strip()
    if text and len(text) >= min_chars:
        sections.append({
            "heading": current_heading,
            "text": text,
            "level": current_level,
        })

    return sections


def _extract_paragraph_heading(text: str, max_len: int = 80) -> str:
    """Extract a short representative heading from paragraph text."""
    first_line = text.split("\n")[0].strip()
    # Strip markdown formatting
    heading = re.sub(r"[*_`#]", "", first_line).strip()
    # If table row, use first cell content
    if heading.startswith("|"):
        cells = [c.strip() for c in heading.split("|") if c.strip()]
        heading = cells[0] if cells else heading
    if len(heading) > max_len:
        heading = heading[:max_len].rsplit(" ", 1)[0] + "…"
    return heading or "Section"


def _split_sections_by_semantics(
    markdown: str,
    target_chars: int = 2000,
    max_chars: int = 4000,
    similarity_threshold: float = 0.5,
) -> list[dict]:
    """Split text into sections by paragraph boundaries + embedding similarity.

    Groups consecutive paragraphs until:
    - character budget exceeded, OR
    - embedding similarity to next paragraph drops below threshold (topic shift)

    Content is preserved verbatim — only split positions are decided.
    """
    paragraphs = [p.strip() for p in _PARA_SPLIT_RE.split(markdown) if p.strip()]

    if not paragraphs:
        return []

    if len(paragraphs) == 1:
        return [{"heading": _extract_paragraph_heading(paragraphs[0]),
                 "text": paragraphs[0], "level": 1}]

    # Embed all paragraphs in one batch (fast — ~100ms for 50 paragraphs)
    embed_texts = [p[:500] for p in paragraphs]  # first 500 chars per para
    try:
        embeddings = embed(embed_texts, prefix="passage: ")
    except Exception:
        # If embedding fails, fall back to character-budget-only splitting
        return _split_sections_by_char_budget(paragraphs, target_chars)

    emb_arr = np.array(embeddings, dtype=np.float32)

    # Compute pairwise consecutive similarities
    consecutive_sims: list[float] = []
    for i in range(len(emb_arr) - 1):
        sim = float(emb_arr[i] @ emb_arr[i + 1])
        consecutive_sims.append(sim)

    # Group paragraphs
    sections: list[dict] = []
    group: list[str] = [paragraphs[0]]
    group_len = len(paragraphs[0])

    for i in range(1, len(paragraphs)):
        sim = consecutive_sims[i - 1] if i - 1 < len(consecutive_sims) else 1.0
        para = paragraphs[i]

        # Split if: topic shift detected OR budget exceeded
        budget_exceeded = group_len + len(para) > max_chars
        topic_shift = group_len >= target_chars and sim < similarity_threshold

        if budget_exceeded or topic_shift:
            combined = "\n\n".join(group)
            sections.append({
                "heading": _extract_paragraph_heading(combined),
                "text": combined,
                "level": 1,
            })
            group = [para]
            group_len = len(para)
        else:
            group.append(para)
            group_len += len(para)

    # Flush remaining
    if group:
        combined = "\n\n".join(group)
        sections.append({
            "heading": _extract_paragraph_heading(combined),
            "text": combined,
            "level": 1,
        })

    return sections


def _split_sections_by_char_budget(
    paragraphs: list[str],
    target_chars: int = 2000,
) -> list[dict]:
    """Simple fallback: group paragraphs by character budget only."""
    sections: list[dict] = []
    group: list[str] = []
    group_len = 0

    for para in paragraphs:
        if group and group_len + len(para) > target_chars:
            combined = "\n\n".join(group)
            sections.append({
                "heading": _extract_paragraph_heading(combined),
                "text": combined,
                "level": 1,
            })
            group = []
            group_len = 0
        group.append(para)
        group_len += len(para)

    if group:
        combined = "\n\n".join(group)
        sections.append({
            "heading": _extract_paragraph_heading(combined),
            "text": combined,
            "level": 1,
        })

    return sections


# Threshold: heading-based splitting must produce at least this many sections
# to be considered "good enough". Below this we fall back to semantic splitting.
_HEADING_SECTION_THRESHOLD = 3


def split_sections(markdown: str, min_chars: int = 100) -> list[dict]:
    """Hybrid section splitter: heading-based with semantic paragraph fallback.

    1. Try heading-based splitting (regex for #, numbered, ALL CAPS).
    2. If that yields ≤2 sections (poor/no heading structure), use
       paragraph-boundary + embedding-similarity splitting instead.

    Content is never modified — only split positions change.
    """
    heading_sections = _split_sections_by_headings(markdown, min_chars=min_chars)

    if len(heading_sections) >= _HEADING_SECTION_THRESHOLD:
        return heading_sections

    # Headings didn't produce enough structure — fall back to semantic splitting
    total_chars = sum(len(s["text"]) for s in heading_sections) if heading_sections else len(markdown)
    if total_chars < min_chars * 2:
        # Very short document — heading-based result (even if few) is fine
        return heading_sections or [{"heading": "Document", "text": markdown.strip(), "level": 1}]

    print(
        f"[raptor] Heading-based split yielded only {len(heading_sections)} section(s); "
        f"falling back to semantic paragraph splitting.",
        file=sys.stderr,
    )
    return _split_sections_by_semantics(markdown)


# ---------------------------------------------------------------------------
# Clustering (agglomerative, threshold-based)
# ---------------------------------------------------------------------------

CLUSTER_THRESHOLD = 0.55  # cosine similarity threshold for merging


def _agglomerative_cluster(
    ids: list[str],
    embeddings: list[list[float]],
    threshold: float = CLUSTER_THRESHOLD,
) -> list[list[str]]:
    """Simple agglomerative clustering: merge closest pair until below threshold."""
    if len(ids) <= 1:
        return [ids] if ids else []

    # Each cluster is a list of original IDs
    clusters: list[list[str]] = [[id_] for id_ in ids]
    # Centroid per cluster
    centroids = [np.array(e, dtype=np.float32) for e in embeddings]

    while len(clusters) > 1:
        n = len(clusters)
        # Build centroid similarity matrix
        centroid_mat = np.stack(centroids)
        sims = centroid_mat @ centroid_mat.T
        np.fill_diagonal(sims, -1.0)  # exclude self

        best_i, best_j = np.unravel_index(np.argmax(sims), sims.shape)
        best_sim = sims[best_i, best_j]

        if best_sim < threshold:
            break  # no more pairs above threshold

        # Merge j into i
        i, j = int(min(best_i, best_j)), int(max(best_i, best_j))
        clusters[i].extend(clusters[j])
        # Average centroid
        n_i = len(clusters[i]) - len(clusters[j])
        n_j = len(clusters[j])
        centroids[i] = (centroids[i] * n_i + centroids[j] * n_j) / (n_i + n_j)
        # Normalize
        norm = np.linalg.norm(centroids[i])
        if norm > 1e-12:
            centroids[i] = centroids[i] / norm

        del clusters[j]
        del centroids[j]

    return clusters


# ---------------------------------------------------------------------------
# RAPTOR tree construction
# ---------------------------------------------------------------------------

MAX_CLUSTER_SUMMARY_CHARS = 2000  # max chars for cluster summary text


def _make_cluster_summary(sections: list[dict]) -> str:
    """Create a summary text for a cluster of sections."""
    parts: list[str] = []
    for sec in sections:
        parts.append(f"## {sec['heading']}")
        # Take first ~500 chars of each section
        text = sec["text"][:500].strip()
        if text:
            parts.append(text)
    combined = "\n".join(parts)
    return combined[:MAX_CLUSTER_SUMMARY_CHARS]


def build_raptor_tree(
    sections: list[dict],
    embeddings: list[list[float]],
) -> tuple[RaptorTree, dict]:
    """Build a multi-level RAPTOR tree from sections and their embeddings.

    Returns (tree, globalSummary).
    """
    all_nodes: list[RaptorNode] = []

    # Level 0: leaf nodes (original sections)
    leaf_ids: list[str] = []
    leaf_embeddings: list[list[float]] = []
    id_to_section: dict[str, dict] = {}

    for i, (sec, emb) in enumerate(zip(sections, embeddings)):
        node_id = f"L0-{i}"
        node: RaptorNode = {
            "id": node_id,
            "level": 0,
            "heading": sec["heading"],
            "text": sec["text"][:3000],  # cap leaf text
            "embedding": emb,
            "children": [],
        }
        all_nodes.append(node)
        leaf_ids.append(node_id)
        leaf_embeddings.append(emb)
        id_to_section[node_id] = sec

    # Build cluster levels
    current_ids = leaf_ids
    current_embeddings = leaf_embeddings
    level = 1

    while len(current_ids) > 1 and level <= 5:
        clusters = _agglomerative_cluster(current_ids, current_embeddings)

        # If clustering didn't merge anything (all singletons), stop
        if all(len(c) == 1 for c in clusters):
            break

        next_ids: list[str] = []
        next_embeddings: list[list[float]] = []

        for ci, cluster_member_ids in enumerate(clusters):
            if len(cluster_member_ids) == 1:
                # Singleton — promote to next level as-is
                next_ids.append(cluster_member_ids[0])
                node_map = {n["id"]: n for n in all_nodes}
                next_embeddings.append(node_map[cluster_member_ids[0]]["embedding"])
                continue

            # Gather sections for this cluster
            node_map = {n["id"]: n for n in all_nodes}
            cluster_sections = []
            for mid in cluster_member_ids:
                if mid in node_map:
                    cluster_sections.append({
                        "heading": node_map[mid]["heading"],
                        "text": node_map[mid]["text"],
                    })

            # Create cluster summary
            summary_text = _make_cluster_summary(cluster_sections)
            headings = [s["heading"] for s in cluster_sections]

            # Embed the cluster summary
            cluster_emb = embed([summary_text], prefix="passage: ")[0]

            cluster_id = f"L{level}-{ci}"
            cluster_node: RaptorNode = {
                "id": cluster_id,
                "level": level,
                "heading": f"Cluster: {', '.join(headings[:3])}{'...' if len(headings) > 3 else ''}",
                "text": summary_text,
                "embedding": cluster_emb,
                "children": cluster_member_ids,
            }
            all_nodes.append(cluster_node)
            next_ids.append(cluster_id)
            next_embeddings.append(cluster_emb)

        current_ids = next_ids
        current_embeddings = next_embeddings
        level += 1

    # Global summary: combine top-level nodes
    top_nodes = [n for n in all_nodes if n["id"] in current_ids]
    global_headings = []
    for n in top_nodes:
        global_headings.append(n["heading"])

    global_text_parts = []
    for n in top_nodes[:5]:
        global_text_parts.append(n["text"][:500])
    main_theme = " | ".join(global_headings[:5])

    global_summary = {
        "mainTheme": main_theme[:500],
    }

    tree: RaptorTree = {"nodes": all_nodes}
    return tree, global_summary


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_from_markdown(
    markdown: str,
    title: str = "Untitled",
) -> StructuredSummary:
    """Full pipeline: markdown → sections → embeddings → RAPTOR tree → summary."""
    t0 = time.perf_counter()

    # 1. Split into sections
    sections = split_sections(markdown)
    if not sections:
        # Fallback: treat entire document as one section
        sections = [{"heading": title, "text": markdown[:5000], "level": 1}]
    t_split = time.perf_counter()
    print(f"[raptor] Split into {len(sections)} sections ({t_split - t0:.2f}s)", file=sys.stderr)

    # 2. Embed all sections
    texts_to_embed = [f"{s['heading']}. {s['text'][:1000]}" for s in sections]
    embeddings = embed(texts_to_embed, prefix="passage: ")
    t_embed = time.perf_counter()
    print(f"[raptor] Embedded {len(embeddings)} sections ({t_embed - t_split:.2f}s)", file=sys.stderr)

    # 3. Build RAPTOR tree
    tree, global_summary = build_raptor_tree(sections, embeddings)
    t_tree = time.perf_counter()
    print(f"[raptor] Built tree with {len(tree['nodes'])} nodes ({t_tree - t_embed:.2f}s)", file=sys.stderr)

    summary: StructuredSummary = {
        "documentTitle": title,
        "globalSummary": global_summary,
        "raptorTree": tree,
    }

    total = time.perf_counter() - t0
    print(f"[raptor] Total build time: {total:.2f}s", file=sys.stderr)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Build RAPTOR index from markdown")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--markdown-path", type=str, help="Path to markdown file")
    group.add_argument("--markdown", type=str, help="Raw markdown text")
    parser.add_argument("--output-path", type=str, required=True, help="Output .structured-summary.json path")
    parser.add_argument("--title", type=str, default="Untitled", help="Document title")
    args = parser.parse_args()

    if args.markdown_path:
        markdown = Path(args.markdown_path).read_text(encoding="utf-8")
    else:
        markdown = args.markdown

    summary = build_from_markdown(markdown, title=args.title)

    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({"ok": True, "sections": len(summary["raptorTree"]["nodes"]), "path": str(output_path)}))


if __name__ == "__main__":
    main()
