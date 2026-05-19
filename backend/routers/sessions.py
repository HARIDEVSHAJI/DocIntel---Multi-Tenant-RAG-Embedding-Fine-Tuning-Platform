import uuid
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.models import User, Workspace, ChatSession, ChatMessage
from core.dependencies import get_db, get_current_user
from schemas.requests_responses import CreateSessionRequest, SaveMessageRequest

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

@router.get("")
def list_sessions(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user.id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    sessions = db.query(ChatSession).filter(ChatSession.workspace_id == workspace_id).order_by(ChatSession.updated_at.desc()).all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat() if s.created_at else "",
            "updated_at": (s.updated_at or s.created_at).isoformat() if (s.updated_at or s.created_at) else "",
            "message_count": len(s.messages),
        }
        for s in sessions
    ]

@router.post("")
def create_session(
    req: CreateSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = db.query(Workspace).filter(Workspace.id == req.workspace_id, Workspace.user_id == user.id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    session_id = req.session_id or str(uuid.uuid4())
    session = ChatSession(id=session_id, workspace_id=req.workspace_id, title=req.title or "New Chat")
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": session.id,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else "",
    }

@router.patch("/{session_id}")
def update_session(
    session_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .join(Workspace)
        .filter(ChatSession.id == session_id, Workspace.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if "title" in data:
        session.title = data["title"][:200]
    db.commit()
    return {"success": True}

@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .join(Workspace)
        .filter(ChatSession.id == session_id, Workspace.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    db.delete(session)
    db.commit()
    return {"success": True}

@router.get("/{session_id}/messages")
def get_session_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .join(Workspace)
        .filter(ChatSession.id == session_id, Workspace.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return [
        {
            "role": m.role,
            "content": m.content,
            "faithfulness_score": m.faithfulness_score,
            "source_count": m.source_count,
            "source_files": json.loads(m.source_files) if m.source_files else [],
        }
        for m in session.messages
    ]

@router.post("/{session_id}/messages")
def save_message(
    session_id: str,
    req: SaveMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .join(Workspace)
        .filter(ChatSession.id == session_id, Workspace.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    msg = ChatMessage(
        session_id=session_id,
        role=req.role,
        content=req.content,
        faithfulness_score=req.faithfulness_score,
        source_count=req.source_count,
        source_files=json.dumps(req.source_files) if req.source_files else None,
    )
    db.add(msg)
    db.commit()
    return {"success": True}
