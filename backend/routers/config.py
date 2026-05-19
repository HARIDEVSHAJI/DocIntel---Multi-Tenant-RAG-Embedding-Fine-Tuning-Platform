import os
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException

from db.database import SessionLocal
from db.models import User, WorkspaceConfig
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_config
from core.config import encrypt_key, decrypt_key
from src.embeddings import clear_model_cache
from schemas.requests_responses import KeySaveRequest, KeyToggleRequest, KeyTestRequest, ConfigUpdate

router = APIRouter(prefix="/api", tags=["config"])

@router.get("/config/db-status")
def get_db_status():
    try:
        from db.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"online": True, "message": "Database is online"}
    except Exception as e:
        return {"online": False, "message": str(e)}

@router.get("/config/key-status")
def get_key_status(workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        from core.config import _reload_backend_dotenv
        _reload_backend_dotenv()
        cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
        env_key = os.environ.get("GROQ_API_KEY", "").strip()
        env_key_set = bool(env_key and not env_key.endswith("_here"))
        
        has_custom_key = False
        masked_key = ""
        use_custom_key = False
        
        if cfg:
            use_custom_key = cfg.use_custom_key
            if cfg.api_key_encrypted:
                has_custom_key = True
                decrypted = decrypt_key(cfg.api_key_encrypted)
                if len(decrypted) > 8:
                    masked_key = decrypted[:4] + "•" * 16 + decrypted[-4:]
                elif decrypted:
                    masked_key = "•" * 10
                    
        return {
            "env_key_set": env_key_set,
            "has_custom_key": has_custom_key,
            "use_custom_key": use_custom_key,
            "masked_key": masked_key
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.delete("/config/key-clear")
def clear_custom_key(workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
        if cfg:
            cfg.api_key_encrypted = None
            cfg.use_custom_key = False
            db.commit()
            
            from src.generation import clear_groq_client_cache
            clear_groq_client_cache()
            
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.post("/config/key-save")
def save_custom_key(req: KeySaveRequest, workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
        if not cfg:
            cfg = WorkspaceConfig(workspace_id=workspace_id)
            db.add(cfg)
        
        cfg.api_key_encrypted = encrypt_key(req.api_key)
        cfg.use_custom_key = True
        db.commit()
        
        from src.generation import clear_groq_client_cache
        clear_groq_client_cache()
        
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.post("/config/key-toggle")
def toggle_custom_key(req: KeyToggleRequest, workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
        if not cfg:
            cfg = WorkspaceConfig(workspace_id=workspace_id)
            db.add(cfg)
        
        cfg.use_custom_key = req.use_custom_key
        db.commit()
        
        from src.generation import clear_groq_client_cache
        clear_groq_client_cache()
        
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.post("/config/key-test")
def test_api_key(req: KeyTestRequest, workspace_id: int, user: User = Depends(get_current_user)):
    try:
        from groq import Groq
        key_to_use = req.api_key
        
        if req.use_env:
            from core.config import _reload_backend_dotenv
            _reload_backend_dotenv()
            key_to_use = os.environ.get("GROQ_API_KEY", "").strip()
            if not key_to_use or key_to_use.endswith("_here"):
                return {"success": False, "message": "Environment key is not set or invalid."}
        else:
            if not key_to_use:
                db = SessionLocal()
                try:
                    cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
                    if cfg and cfg.api_key_encrypted:
                        key_to_use = decrypt_key(cfg.api_key_encrypted)
                finally:
                    db.close()
                
        if not key_to_use:
            return {"success": False, "message": "No API key provided."}
            
        client = Groq(api_key=key_to_use)
        client.models.list()
        
        return {"success": True, "message": "Connection working!"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/config")
def get_config(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        with _lock:
            return dict(_get_workspace_config(workspace_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Config read error: {e}")

@router.post("/config")
def update_config(cfg: ConfigUpdate, workspace_id: int, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        with _lock:
            db_cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
            if not db_cfg:
                db_cfg = WorkspaceConfig(workspace_id=workspace_id)
                db.add(db_cfg)
            if cfg.chunk_size is not None:
                db_cfg.chunk_size = cfg.chunk_size
            if cfg.overlap is not None:
                db_cfg.overlap = cfg.overlap
            if cfg.top_k is not None:
                db_cfg.top_k = cfg.top_k
            if cfg.temperature is not None:
                db_cfg.temperature = cfg.temperature
            if cfg.llm_model is not None:
                db_cfg.llm_model = cfg.llm_model
            db.commit()
            updated = dict(_get_workspace_config(workspace_id))
        return {"success": True, "config": updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Config update error: {e}")
    finally:
        db.close()

@router.delete("/model")
def delete_model(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        path = Path("models") / f"ws_{workspace_id}" / "fine_tuned"
        if path.exists():
            shutil.rmtree(path)
            clear_model_cache()
            return {"success": True, "message": "Fine-tuned model deleted. Reverted to base model."}
        return {"success": False, "message": "No fine-tuned model found."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete model error: {e}")
