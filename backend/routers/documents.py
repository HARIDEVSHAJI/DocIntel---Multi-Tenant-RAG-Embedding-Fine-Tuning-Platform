import time
import shutil
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form

from db.models import User
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_state, _workspace_dir, TRAINING_STATE, _WORKSPACE_CACHE
from src.ingestion import process_documents
from src.embeddings import embed_texts, clear_model_cache
from src.retrieval import build_bm25_index
from db.database import SessionLocal
from db.models import DocumentChunk

router = APIRouter(prefix="/api", tags=["documents"])

# Helper from main.py for merging indices (assuming it exists in src or we can just replace the whole index logic)
# Wait, main.py references `merge_indices`, I should import it from src.embeddings or write it.
# Actually main.py doesn't define merge_indices, let me just use the code from main.py exactly.
# Oh, main.py called `merge_indices(ws_state["index"], ws_state["chunks"], ws_state["metadata"], idx, chunks, metadata)`
# merge_indices was not found, we will manually append to FAISS in the route

@router.post("/upload")
async def upload_and_index(
    workspace_id: int = Form(...),
    files: List[UploadFile] = File(...),
    chunk_size: int = Form(500),
    overlap: int = Form(50),
    user: User = Depends(get_current_user),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    tmp_dir = tempfile.mkdtemp()
    tmp_paths = []
    try:
        for uf in files:
            dest = Path(tmp_dir) / uf.filename
            content = await uf.read()
            dest.write_bytes(content)
            tmp_paths.append(str(dest))

        t0 = time.time()
        chunks, metadata = process_documents(tmp_paths, chunk_size=chunk_size, overlap=overlap)

        if not chunks:
            raise HTTPException(status_code=422, detail="No text could be extracted from the files.")

        now_iso = datetime.now(timezone.utc).isoformat()
        for m in metadata:
            m["indexed_at"] = now_iso

        embeddings = embed_texts(chunks, workspace_id=workspace_id)
        embed_time = round(time.time() - t0, 2)

        db = SessionLocal()
        try:
            for i, chunk_text in enumerate(chunks):
                doc = DocumentChunk(
                    workspace_id=workspace_id,
                    filename=metadata[i].get("source", "unknown"),
                    content=chunk_text,
                    embedding=embeddings[i].tolist()
                )
                db.add(doc)
            db.commit()
        finally:
            db.close()

        # Invalidate cache so it reloads from DB on next search
        with _lock:
            if workspace_id in _WORKSPACE_CACHE:
                del _WORKSPACE_CACHE[workspace_id]
            # Immediately load so we can return the preview
            ws_state = _get_workspace_state(workspace_id)
            new_chunks = ws_state["chunks"]
            new_metadata = ws_state["metadata"]

        sources: Dict[str, int] = {}
        for m in new_metadata:
            src = m.get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1

        return {
            "success": True,
            "chunk_count": len(new_chunks),
            "embedding_dim": int(embeddings.shape[1]),
            "embed_time_s": embed_time,
            "sources": sources,
            "preview": [
                {"source": new_metadata[i]["source"], "chunk_id": new_metadata[i]["chunk_id"], "text": new_chunks[i][:300] + "..."}
                for i in range(min(3, len(new_chunks)))
            ],
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

@router.delete("/document/{filename}")
async def delete_document(filename: str, workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        deleted = db.query(DocumentChunk).filter(
            DocumentChunk.workspace_id == workspace_id,
            DocumentChunk.filename == filename
        ).delete()
        db.commit()
    finally:
        db.close()

    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Document '{filename}' not found in index.")

    with _lock:
        if workspace_id in _WORKSPACE_CACHE:
            del _WORKSPACE_CACHE[workspace_id]
        ws_state = _get_workspace_state(workspace_id)
        new_chunks = ws_state["chunks"]

    return {"success": True, "message": f"Removed {deleted} chunks from '{filename}'.", "remaining_chunks": len(new_chunks)}

@router.delete("/index")
def clear_index(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        db = SessionLocal()
        try:
            db.query(DocumentChunk).filter(DocumentChunk.workspace_id == workspace_id).delete()
            db.commit()
        finally:
            db.close()
        
        with _lock:
            if workspace_id in _WORKSPACE_CACHE:
                del _WORKSPACE_CACHE[workspace_id]
        return {"success": True, "message": "Index cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clear index error: {e}")

def _do_reset_workspace(workspace_id: int):
    global TRAINING_STATE
    
    db = SessionLocal()
    fine_tuned_removed = False
    try:
        db.query(DocumentChunk).filter(DocumentChunk.workspace_id == workspace_id).delete()
        
        from db.models import FineTunedModel, QueryMetric, EvaluationResult
        db.query(QueryMetric).filter(QueryMetric.workspace_id == workspace_id).delete()
        db.query(EvaluationResult).filter(EvaluationResult.workspace_id == workspace_id).delete()

        ft_deleted = db.query(FineTunedModel).filter(FineTunedModel.workspace_id == workspace_id).delete()
        if ft_deleted > 0:
            fine_tuned_removed = True
            clear_model_cache(workspace_id)
            
        db.commit()
    finally:
        db.close()
        
    with _lock:
        if workspace_id in _WORKSPACE_CACHE:
            del _WORKSPACE_CACHE[workspace_id]
        TRAINING_STATE.update({
            "running": False, "progress": 0.0, "message": "Idle",
            "losses": [], "done": False, "success": None, "result_message": "",
        })

    msg = "All indexed documents removed. Fine-tuned embedding model removed; you are back on the base model." if fine_tuned_removed else "All indexed documents removed. No fine-tuned model was present."
    return {"success": True, "message": msg, "index_cleared": True, "fine_tuned_model_removed": fine_tuned_removed}

@router.delete("/reset-workspace")
def reset_workspace(workspace_id: int, user: User = Depends(get_current_user)):
    return _do_reset_workspace(workspace_id)

@router.delete("/workspace")
def reset_workspace_alt(workspace_id: int, user: User = Depends(get_current_user)):
    return _do_reset_workspace(workspace_id)
