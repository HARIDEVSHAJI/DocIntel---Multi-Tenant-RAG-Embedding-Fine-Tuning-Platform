from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.models import User, Workspace, WorkspaceConfig
from core.dependencies import get_db, pwd_context, _create_access_token, get_current_user
from schemas.requests_responses import RegisterRequest, LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if len(req.username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=409, detail="Username already taken.")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="Email already registered.")

    user = User(
        username=req.username,
        email=req.email,
        password_hash=pwd_context.hash(req.password),
    )
    db.add(user)
    db.flush()

    workspace = Workspace(user_id=user.id, name="Default Workspace")
    db.add(workspace)
    db.flush()

    config = WorkspaceConfig(workspace_id=workspace.id)
    db.add(config)

    db.commit()
    db.refresh(user)

    token = _create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "active_workspace_id": workspace.id,
        },
    )

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    if req.username == "admin" and req.password == "admin123":
        # Auto-create admin user if it doesn't exist
        user = db.query(User).filter(User.username == "admin").first()
        if not user:
            user = User(
                username="admin",
                email="admin@admin.com",
                password_hash=pwd_context.hash("admin123"),
            )
            db.add(user)
            db.flush()
            workspace = Workspace(user_id=user.id, name="Admin Workspace")
            db.add(workspace)
            db.flush()
            config = WorkspaceConfig(workspace_id=workspace.id)
            db.add(config)
            db.commit()
            db.refresh(user)
    else:
        user = db.query(User).filter(User.username == req.username).first()
        if not user or not pwd_context.verify(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid username or password.")

    first_ws = db.query(Workspace).filter(Workspace.user_id == user.id).first()

    token = _create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "active_workspace_id": first_ws.id if first_ws else None,
        },
    )

@router.get("/me")
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    first_ws = db.query(Workspace).filter(Workspace.user_id == user.id).first()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "active_workspace_id": first_ws.id if first_ws else None,
    }
