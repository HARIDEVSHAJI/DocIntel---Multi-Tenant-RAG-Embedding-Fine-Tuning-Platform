import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.database import SessionLocal
from db.models import User, Workspace
from core.dependencies import get_current_user, get_db
from core.config import _ENV_PATH, _reload_backend_dotenv

router = APIRouter(prefix="/api/admin", tags=["admin"])

def require_admin(user: User = Depends(get_current_user)):
    if user.username != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user

@router.get("/users")
def list_users(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.username != "admin").all()
    results = []
    for u in users:
        ws_count = db.query(func.count(Workspace.id)).filter(Workspace.user_id == u.id).scalar()
        results.append({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "workspaces": ws_count
        })
    return results

@router.delete("/users/{target_id}")
def delete_user(target_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    target_user = db.query(User).filter(User.id == target_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user.username == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin user")
    
    db.delete(target_user)
    db.commit()
    return {"status": "success", "message": f"User {target_user.username} deleted"}

from pydantic import BaseModel
class UpdateKeyRequest(BaseModel):
    api_key: str

@router.post("/global-key")
def update_global_key(req: UpdateKeyRequest, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from db.models import GlobalSetting
    from core.config import encrypt_key
    
    new_key = req.api_key.strip()
    
    # Securely encrypt and save to GlobalSetting table
    setting = db.query(GlobalSetting).filter(GlobalSetting.key == "GROQ_API_KEY").first()
    if not setting:
        setting = GlobalSetting(key="GROQ_API_KEY")
        db.add(setting)
        
    setting.value_encrypted = encrypt_key(new_key)
    db.commit()
    
    # Clear active generation client cache
    from src.generation import clear_groq_client_cache
    clear_groq_client_cache()
    
    return {"status": "success"}

@router.get("/global-key-status")
def get_global_key_status(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from db.models import GlobalSetting
    from core.config import decrypt_key
    
    # Check system environment variable first
    env_key = os.environ.get("GROQ_API_KEY", "").strip()
    is_env_set = bool(env_key) and len(env_key) > 20 and not env_key.endswith("_here")
    
    is_db_set = False
    db_masked = ""
    
    # Check DB settings second
    setting = db.query(GlobalSetting).filter(GlobalSetting.key == "GROQ_API_KEY").first()
    if setting and setting.value_encrypted:
        decrypted = decrypt_key(setting.value_encrypted)
        if decrypted and len(decrypted) > 20:
            is_db_set = True
            db_masked = decrypted[:4] + "•" * 16 + decrypted[-4:]
            
    if is_db_set:
        return {"is_set": True, "source": "database", "masked_key": db_masked}
    elif is_env_set:
        masked = env_key[:4] + "•" * 16 + env_key[-4:]
        return {"is_set": True, "source": "env", "masked_key": masked}
    else:
        return {"is_set": False, "source": None, "masked_key": ""}

@router.delete("/global-key")
def delete_global_key(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from db.models import GlobalSetting
    setting = db.query(GlobalSetting).filter(GlobalSetting.key == "GROQ_API_KEY").first()
    if setting:
        db.delete(setting)
        db.commit()
        
    from src.generation import clear_groq_client_cache
    clear_groq_client_cache()
    return {"status": "success"}



