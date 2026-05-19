from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.models import User, Workspace, WorkspaceConfig
from core.dependencies import get_db, get_current_user

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

@router.get("")
def list_workspaces(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspaces = db.query(Workspace).filter(Workspace.user_id == user.id).order_by(Workspace.created_at).all()
    return [
        {
            "id": ws.id,
            "name": ws.name,
            "created_at": ws.created_at.isoformat() if ws.created_at else "",
        }
        for ws in workspaces
    ]

@router.post("")
def create_workspace(
    data: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = data.get("name", "New Workspace").strip()
    if not name:
        name = "New Workspace"
    ws = Workspace(user_id=user.id, name=name)
    db.add(ws)
    db.flush()
    cfg = WorkspaceConfig(workspace_id=ws.id)
    db.add(cfg)
    db.commit()
    db.refresh(ws)
    return {"id": ws.id, "name": ws.name, "created_at": ws.created_at.isoformat() if ws.created_at else ""}

@router.delete("/{workspace_id}")
def delete_workspace_by_id(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user.id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    count = db.query(Workspace).filter(Workspace.user_id == user.id).count()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete your only workspace.")
    db.delete(ws)
    db.commit()
    return {"success": True, "message": f"Workspace '{ws.name}' and all its data deleted."}
