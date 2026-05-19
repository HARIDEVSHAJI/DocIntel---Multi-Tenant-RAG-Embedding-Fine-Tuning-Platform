import os
import time
from typing import Dict, Any
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
import json

from db.database import SessionLocal
from db.models import User, QueryMetric, EvaluationResult
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_state, _workspace_dir, _get_workspace_config
from core.config import _reload_backend_dotenv, _groq_env_key_rejection_message, _groq_key_sig
from db.models import DocumentChunk

def get_index_stats(workspace_id: int):
    db = SessionLocal()
    try:
        count = db.query(DocumentChunk).filter(DocumentChunk.workspace_id == workspace_id).count()
        if count == 0:
            return {"status": "No index loaded", "vectors": 0, "chunks": 0, "dimension": 0}
        return {
            "status": "Loaded",
            "vectors": count,
            "chunks": count,
            "dimension": 384,
        }
    finally:
        db.close()

router = APIRouter(prefix="/api", tags=["system"])

_key_validation_cache: Dict[str, Any] = {
    "valid": None, "checked_at": 0, "model": "", "key_sig": "",
}

@router.get("/health")
def health(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        _reload_backend_dotenv()
        raw_key = os.environ.get("GROQ_API_KEY", "").strip()
        key_set = bool(raw_key) and len(raw_key) > 20 and not raw_key.endswith("_here")
        
        from db.database import SessionLocal
        from db.models import FineTunedModel
        db = SessionLocal()
        fine_tuned = False
        try:
            fine_tuned = db.query(FineTunedModel).filter(FineTunedModel.workspace_id == workspace_id).first() is not None
        finally:
            db.close()
        
        ws_state = _get_workspace_state(workspace_id)
        with _lock:
            chunk_count = len(ws_state["chunks"])
            indexed = chunk_count > 0
        return {
            "status": "ok",
            "groq_key_set": key_set,
            "index_loaded": indexed,
            "chunk_count": chunk_count,
            "fine_tuned_model": fine_tuned,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health check error: {e}")

@router.get("/validate-key")
async def validate_key():
    _reload_backend_dotenv()
    raw_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not raw_key or len(raw_key) < 20 or raw_key.endswith("_here"):
        return {"valid": False, "error": _groq_env_key_rejection_message(raw_key)}

    _sig = _groq_key_sig(raw_key)
    now = time.time()
    if (_key_validation_cache["valid"] is not None and (now - _key_validation_cache["checked_at"]) < 120 and _key_validation_cache.get("key_sig") == _sig):
        return {k: v for k, v in _key_validation_cache.items() if k != "key_sig"}

    try:
        from groq import Groq
        client = Groq(api_key=raw_key)
        model = os.getenv("DEFAULT_LLM_MODEL", "llama-3.1-8b-instant")
        resp = client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": "Say OK"}],
            max_tokens=3, temperature=0, timeout=15,
        )
        result = {"valid": True, "error": None, "model": model, "checked_at": now, "key_sig": _sig}
        _key_validation_cache.update(result)
        return {k: v for k, v in result.items() if k != "key_sig"}
    except Exception as e:
        err_str = str(e)
        result = {"valid": False, "error": err_str[:200], "model": "", "checked_at": now, "key_sig": _sig}
        _key_validation_cache.update(result)
        return {k: v for k, v in result.items() if k != "key_sig"}

@router.get("/stats")
def stats(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        ws_state = _get_workspace_state(workspace_id)
        with _lock:
            index = ws_state["index"]
            chunks = ws_state["chunks"]
            metadata = ws_state["metadata"]
            cfg = _get_workspace_config(workspace_id)

        _reload_backend_dotenv()
        raw_key = os.environ.get("GROQ_API_KEY", "").strip()
        key_set = bool(raw_key) and len(raw_key) > 20 and not raw_key.endswith("_here")
        
        from db.database import SessionLocal
        from db.models import FineTunedModel
        db = SessionLocal()
        fine_tuned = False
        try:
            fine_tuned = db.query(FineTunedModel).filter(FineTunedModel.workspace_id == workspace_id).first() is not None
        finally:
            db.close()
        stats = get_index_stats(workspace_id)

        sources: Dict[str, int] = {}
        for m in metadata:
            src = m.get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1

        sources_detail: Dict[str, Any] = {}
        for i, m in enumerate(metadata):
            src = m.get("source", "unknown")
            if src not in sources_detail:
                sources_detail[src] = {"chunks": 0, "indexed_at": m.get("indexed_at"), "total_chars": 0}
            sources_detail[src]["chunks"] += 1
            if i < len(chunks):
                sources_detail[src]["total_chars"] += len(chunks[i])

        return {
            "index": stats, "sources": sources, "sources_detail": sources_detail,
            "config": cfg, "fine_tuned_model": fine_tuned, "groq_key_set": key_set,
            "model_name": "Fine-tuned (custom)" if fine_tuned else "all-MiniLM-L6-v2 (base)",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats error: {e}")

@router.get("/metrics")
def get_metrics(workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        metrics = db.query(QueryMetric).filter(QueryMetric.workspace_id == workspace_id).all()
        eval_records = db.query(EvaluationResult).filter(EvaluationResult.workspace_id == workspace_id).order_by(EvaluationResult.timestamp.desc()).first()
        
        scores = [m.faithfulness_score for m in metrics]
        times = [m.response_time_ms for m in metrics]
        chunks_ct = [m.source_count for m in metrics]
        
        high = sum(1 for s in scores if s >= 0.65)
        medium = sum(1 for s in scores if 0.35 <= s < 0.65)
        low = sum(1 for s in scores if s < 0.35)

        now = datetime.now(timezone.utc)
        hourly_buckets: Dict[str, int] = {}
        source_freq: Dict[str, int] = {}
        query_log = []

        for m in metrics:
            query_log.append({
                "timestamp": m.timestamp.isoformat() if m.timestamp else "",
                "question": m.question[:200],
                "response_time_ms": round(m.response_time_ms, 1),
                "faithfulness_score": round(m.faithfulness_score, 4),
                "source_count": m.source_count,
            })
            if m.source_files:
                try:
                    sfs = json.loads(m.source_files)
                    for sf in sfs: source_freq[sf] = source_freq.get(sf, 0) + 1
                except:
                    pass

            if m.timestamp:
                try:
                    ts = m.timestamp
                    if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)
                    diff_hours = (now - ts).total_seconds() / 3600
                    if diff_hours <= 24:
                        hour_label = ts.strftime("%H:00")
                        hourly_buckets[hour_label] = hourly_buckets.get(hour_label, 0) + 1
                except:
                    pass

        query_log.sort(key=lambda x: x["timestamp"], reverse=True)
        query_log = query_log[:20]

        eval_data = None
        if eval_records:
            eval_data = {
                "total": eval_records.total_questions,
                "aggregated": {
                    "faithfulness": eval_records.avg_faithfulness,
                    "answer_relevancy": eval_records.avg_answer_relevancy,
                    "context_precision": eval_records.avg_context_precision,
                    "answer_similarity": eval_records.avg_answer_similarity
                },
                "timestamp": eval_records.timestamp.isoformat() if eval_records.timestamp else ""
            }

        last_indexed = None
        ws_state = _get_workspace_state(workspace_id)
        if ws_state["metadata"]:
            last_indexed = ws_state["metadata"][-1].get("indexed_at")
            if last_indexed is None:
                last_indexed = datetime.now(timezone.utc).isoformat()

        return {
            "total_queries": len(metrics),
            "avg_faithfulness": round(sum(scores) / len(scores), 4) if scores else 0.0,
            "avg_response_time_ms": round(sum(times) / len(times), 1) if times else 0.0,
            "avg_chunks_per_query": round(sum(chunks_ct) / len(chunks_ct), 1) if chunks_ct else 0.0,
            "faithfulness_distribution": {"high": high, "medium": medium, "low": low},
            "query_volume_24h": hourly_buckets,
            "source_frequency": dict(sorted(source_freq.items(), key=lambda x: x[1], reverse=True)[:10]),
            "query_log": query_log,
            "last_index_timestamp": last_indexed,
            "eval_results": eval_data,
        }
    except Exception as e:
        print(f"Error reading metrics from DB: {e}")
        return {"total_queries": 0, "avg_faithfulness": 0, "avg_response_time_ms": 0, "avg_chunks_per_query": 0, "faithfulness_distribution": {"high": 0, "medium": 0, "low": 0}, "query_volume_24h": {}, "source_frequency": {}, "query_log": []}
    finally:
        db.close()

# ── Sample CSV Downloads ──────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

@router.get("/samples/training")
def download_sample_training():
    """Download sample training CSV (query, positive_passage columns)."""
    file_path = _DATA_DIR / "sample_training_pairs.csv"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Sample training CSV not found")
    return FileResponse(
        path=str(file_path),
        filename="sample_training_pairs.csv",
        media_type="text/csv",
    )

@router.get("/samples/evaluation")
def download_sample_evaluation():
    """Download sample evaluation CSV (question, ground_truth columns)."""
    file_path = _DATA_DIR / "sample_eval_pairs.csv"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Sample evaluation CSV not found")
    return FileResponse(
        path=str(file_path),
        filename="sample_eval_pairs.csv",
        media_type="text/csv",
    )
