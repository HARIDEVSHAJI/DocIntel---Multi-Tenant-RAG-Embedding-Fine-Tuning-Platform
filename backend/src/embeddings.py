"""
embeddings.py — Embedding model management and FAISS vector index operations.
Uses sentence-transformers for dense embeddings and FAISS for fast similarity search.
Embeddings are L2-normalized so inner product equals cosine similarity.
"""

import os
import pickle
from typing import List, Tuple, Optional

import numpy as np
from sentence_transformers import SentenceTransformer

# ─── Constants ────────────────────────────────────────────────────────────────
BASE_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Module-level cache to avoid reloading models on every request
_model_cache: dict = {}


# ─── Model Loading ─────────────────────────────────────────────────────────────
def get_embedding_model(workspace_id: int, force_base: bool = False) -> SentenceTransformer:
    """
    Load and cache the embedding model for the given workspace.
    Checks the database for a fine-tuned model first.
    """
    import tempfile
    import zipfile
    import io
    import shutil
    from db.database import SessionLocal
    from db.models import FineTunedModel

    model_key = f"ws_{workspace_id}_fine_tuned"
    
    if force_base:
        model_key = BASE_MODEL_NAME

    if model_key in _model_cache:
        return _model_cache[model_key]

    if force_base:
        print(f"Loading base embedding model: {BASE_MODEL_NAME}")
        _model_cache[model_key] = SentenceTransformer(BASE_MODEL_NAME)
        return _model_cache[model_key]

    # Try loading from DB
    db = SessionLocal()
    try:
        ft_model = db.query(FineTunedModel).filter(FineTunedModel.workspace_id == workspace_id).first()
        if ft_model:
            print(f"Loading fine-tuned model from database for workspace {workspace_id}...")
            tmp_dir = tempfile.mkdtemp()
            with zipfile.ZipFile(io.BytesIO(ft_model.model_binary)) as zf:
                zf.extractall(tmp_dir)
            _model_cache[model_key] = SentenceTransformer(tmp_dir)
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return _model_cache[model_key]
    finally:
        db.close()

    # Fallback to base model
    print(f"No fine-tuned model found. Loading base embedding model: {BASE_MODEL_NAME}")
    _model_cache[model_key] = SentenceTransformer(BASE_MODEL_NAME)
    return _model_cache[model_key]


def clear_model_cache(workspace_id: Optional[int] = None):
    """Clear the model cache so the next call reloads from DB."""
    if workspace_id:
        key = f"ws_{workspace_id}_fine_tuned"
        if key in _model_cache:
            del _model_cache[key]
    else:
        _model_cache.clear()


# ─── Embedding ─────────────────────────────────────────────────────────────────
def embed_texts(
    texts: List[str],
    workspace_id: int,
    batch_size: int = 64,
    force_base: bool = False,
) -> np.ndarray:
    """
    Encode a list of texts into L2-normalized float32 embeddings.

    Returns:
        numpy array of shape (len(texts), embedding_dim), dtype float32
    """
    if not texts:
        return np.array([], dtype=np.float32)

    model = get_embedding_model(workspace_id=workspace_id, force_base=force_base)
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # L2 normalize → cosine sim = inner product
    )
    return embeddings.astype(np.float32)



