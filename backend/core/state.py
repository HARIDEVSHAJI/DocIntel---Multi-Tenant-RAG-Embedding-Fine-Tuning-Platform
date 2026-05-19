import os
import threading
from typing import Dict, Any
from pathlib import Path

from src.retrieval import build_bm25_index
from db.database import SessionLocal
from db.models import WorkspaceConfig, DocumentChunk

_lock = threading.Lock()

# Per-workspace in-memory cache: { workspace_id: { index, chunks, metadata, bm25_index } }
_WORKSPACE_CACHE: Dict[int, Dict[str, Any]] = {}

TRAINING_STATE: Dict[str, Any] = {
    "running": False,
    "progress": 0.0,
    "message": "Idle",
    "losses": [],
    "done": False,
    "success": None,
    "result_message": "",
}

# The in-memory METRICS_STORE and EVAL_RESULTS_STORE have been replaced 
# by Postgres database tables via db.models.QueryMetric and db.models.EvaluationResult

def _workspace_dir(workspace_id: int) -> str:
    """Return the on-disk directory for a workspace's FAISS index."""
    return str(Path("models") / f"ws_{workspace_id}")

def _get_workspace_state(workspace_id: int) -> Dict[str, Any]:
    """Get or lazily load the in-memory state for a workspace.
    Loads chunks from the database on first access."""
    if workspace_id in _WORKSPACE_CACHE:
        return _WORKSPACE_CACHE[workspace_id]

    db = SessionLocal()
    try:
        db_chunks = db.query(DocumentChunk).filter(DocumentChunk.workspace_id == workspace_id).all()
        chunks = [c.content for c in db_chunks]
        metadata = [{"source": c.filename, "chunk_id": c.id} for c in db_chunks]
    finally:
        db.close()

    state = {
        "index": None, # Removed FAISS
        "chunks": chunks,
        "metadata": metadata,
        "bm25_index": build_bm25_index(chunks) if chunks else None,
    }
    _WORKSPACE_CACHE[workspace_id] = state
    if chunks:
        print(f"[workspace {workspace_id}] Loaded {len(chunks)} chunks from database.")
    return state

def _get_workspace_config(workspace_id: int) -> dict:
    """Load workspace config from DB, falling back to env defaults."""
    db = SessionLocal()
    try:
        cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
        if cfg:
            return {
                "chunk_size": cfg.chunk_size,
                "overlap": cfg.overlap,
                "top_k": cfg.top_k,
                "temperature": cfg.temperature,
                "llm_model": cfg.llm_model,
            }
    except Exception:
        pass
    finally:
        db.close()
    return {
        "chunk_size": int(os.getenv("DEFAULT_CHUNK_SIZE", 800)),
        "overlap": int(os.getenv("DEFAULT_CHUNK_OVERLAP", 100)),
        "top_k": int(os.getenv("DEFAULT_TOP_K", 5)),
        "temperature": float(os.getenv("DEFAULT_TEMPERATURE", 0.1)),
        "llm_model": os.getenv("DEFAULT_LLM_MODEL", "llama-3.1-8b-instant"),
    }
