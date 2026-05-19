"""
retrieval.py — Hybrid retrieval pipeline.

Pipeline:
  1. Dense retrieval  → FAISS top-k (cosine similarity)
  2. Sparse retrieval → BM25 top-k (keyword overlap)
  3. Fusion           → Reciprocal Rank Fusion (RRF)
  4. Reranking        → Cross-encoder reranker for precision

This combination consistently outperforms any single method on open-domain QA.
"""

from typing import List, Tuple, Dict

import math
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder

from src.embeddings import embed_texts
from db.database import SessionLocal
from db.models import DocumentChunk

# ─── Module-level cache ────────────────────────────────────────────────────────
_reranker_cache: dict = {}
RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


# ─── BM25 ─────────────────────────────────────────────────────────────────────
def build_bm25_index(chunks: List[str]) -> BM25Okapi:
    """Build a BM25 index from text chunks (simple whitespace tokenization)."""
    tokenized = [chunk.lower().split() for chunk in chunks]
    return BM25Okapi(tokenized)


def bm25_search(
    query: str, bm25_index: BM25Okapi, k: int = 15
) -> List[Tuple[int, float]]:
    """
    Retrieve top-k chunks using BM25 keyword matching.

    Returns: list of (chunk_index, bm25_score) sorted by score descending.
    """
    tokenized_query = query.lower().split()
    scores = bm25_index.get_scores(tokenized_query)
    top_k = min(k, len(scores))
    top_indices = np.argsort(scores)[::-1][:top_k]
    return [(int(idx), float(scores[idx])) for idx in top_indices if scores[idx] > 0]


# ─── Dense Search ──────────────────────────────────────────────────────────────
def dense_search(
    query: str, workspace_id: int, chunks: List[str], k: int = 15
) -> List[Tuple[int, float]]:
    """
    Retrieve top-k chunks using pgvector dense retrieval (cosine distance).
    Returns: list of (chunk_index, similarity_score) sorted descending.
    """
    if not chunks:
        return []

    query_emb = embed_texts([query], workspace_id=workspace_id)[0].tolist()
    
    db = SessionLocal()
    try:
        # pgvector cosine_distance (smaller is better)
        docs = db.query(DocumentChunk).filter(DocumentChunk.workspace_id == workspace_id)\
                 .order_by(DocumentChunk.embedding.cosine_distance(query_emb))\
                 .limit(k).all()
        
        # Map back to indices in the `chunks` list
        content_to_idx = {c: i for i, c in enumerate(chunks)}
        
        results = []
        for i, doc in enumerate(docs):
            idx = content_to_idx.get(doc.content)
            if idx is not None:
                # Generate a fake descending score based on rank for RRF
                score = 1.0 - (i * 0.01) 
                results.append((idx, score))
        return results
    finally:
        db.close()


# ─── Reciprocal Rank Fusion ────────────────────────────────────────────────────
def reciprocal_rank_fusion(
    dense_results: List[Tuple[int, float]],
    bm25_results: List[Tuple[int, float]],
    rrf_k: int = 60,
) -> List[Tuple[int, float]]:
    """
    Combine dense and BM25 rankings using Reciprocal Rank Fusion.
    RRF score = Σ 1 / (rrf_k + rank)

    Returns: merged list of (chunk_index, rrf_score) sorted descending.
    """
    fused_scores: Dict[int, float] = {}

    for rank, (idx, _) in enumerate(dense_results):
        fused_scores[idx] = fused_scores.get(idx, 0.0) + 1.0 / (rrf_k + rank + 1)

    for rank, (idx, _) in enumerate(bm25_results):
        fused_scores[idx] = fused_scores.get(idx, 0.0) + 1.0 / (rrf_k + rank + 1)

    return sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)


# ─── Score Normalization ───────────────────────────────────────────────────────
def _sigmoid(x: float) -> float:
    """Map raw cross-encoder logits to 0-1 range."""
    return 1.0 / (1.0 + math.exp(-x))


# ─── Cross-Encoder Reranker ────────────────────────────────────────────────────
def get_reranker() -> CrossEncoder:
    """Load and cache the cross-encoder reranker model."""
    if RERANKER_MODEL not in _reranker_cache:
        print(f"Loading reranker: {RERANKER_MODEL}")
        _reranker_cache[RERANKER_MODEL] = CrossEncoder(RERANKER_MODEL, max_length=512)
        print("Reranker loaded.")
    return _reranker_cache[RERANKER_MODEL]


def rerank(
    query: str,
    candidates: List[Tuple[int, float]],
    chunks: List[str],
    top_k: int = 5,
) -> List[Tuple[int, float, str]]:
    """
    Rerank candidate chunks using a cross-encoder for precise relevance scoring.

    Args:
        query: user query string
        candidates: (chunk_index, fusion_score) pairs from RRF
        chunks: list of all text chunks
        top_k: number of final results

    Returns: list of (chunk_index, reranker_score, chunk_text) sorted descending.
    """
    if not candidates or not chunks:
        return []

    reranker = get_reranker()
    # Only rerank the top 20 candidates for efficiency
    top_candidates = candidates[:20]
    pairs = [(query, chunks[idx]) for idx, _ in top_candidates if idx < len(chunks)]
    indices = [idx for idx, _ in top_candidates if idx < len(chunks)]

    if not pairs:
        return []

    try:
        scores = reranker.predict(pairs)
        # Normalize raw cross-encoder logits to 0-1 via sigmoid
        normalized = [_sigmoid(s) for s in (scores.tolist() if hasattr(scores, "tolist") else scores)]
        ranked = sorted(
            zip(indices, normalized),
            key=lambda x: x[1],
            reverse=True,
        )
        return [(idx, float(score), chunks[idx]) for idx, score in ranked[:top_k]]
    except Exception as e:
        print(f"Reranker error: {e} — falling back to fusion scores")
        return [
            (idx, float(score), chunks[idx])
            for idx, score in candidates[:top_k]
            if idx < len(chunks)
        ]


# ─── Full Hybrid Pipeline ──────────────────────────────────────────────────────
def hybrid_retrieve(
    query: str,
    workspace_id: int,
    chunks: List[str],
    bm25_index: BM25Okapi,
    top_k: int = 5,
) -> List[Tuple[int, float, str]]:
    """
    Full hybrid retrieval: Dense → BM25 → RRF → Cross-encoder rerank.

    Returns: list of (chunk_index, reranker_score, chunk_text).
    """
    if not chunks:
        return []

    dense_results = dense_search(query, workspace_id, chunks, k=15)
    bm25_results = bm25_search(query, bm25_index, k=15)
    fused_results = reciprocal_rank_fusion(dense_results, bm25_results)
    final_results = rerank(query, fused_results, chunks, top_k=top_k)
    return final_results
