"""
backend/main.py — FastAPI backend for Document Intelligence Platform.

Restructured to an industry-grade architecture. All endpoints are in routers/.
"""

import os
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Load environment logic
from core.config import _reload_backend_dotenv, _ENV_PATH

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))
os.chdir(ROOT)

# ── Database & State ─────────────────────────────────────────────────────────
from db.database import engine, Base, SessionLocal
from sqlalchemy import text, inspect

# Create vector extension if Postgres
try:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
except Exception as e:
    print(f"[startup] pgvector extension: {e} (safe to ignore for SQLite)")

# Create database tables automatically
import db.models  # Ensure models are registered with Base.metadata
Base.metadata.create_all(bind=engine)

# Run schema migration for manual API key if needed (safe — checks column existence first)
try:
    inspector = inspect(engine)
    existing_columns = {col["name"] for col in inspector.get_columns("workspace_configs")}
    db = SessionLocal()
    if "api_key_encrypted" not in existing_columns:
        db.execute(text("ALTER TABLE workspace_configs ADD COLUMN api_key_encrypted VARCHAR(500) NULL"))
        print("[db] Migrated: added api_key_encrypted column.")
    if "use_custom_key" not in existing_columns:
        db.execute(text("ALTER TABLE workspace_configs ADD COLUMN use_custom_key BOOLEAN NOT NULL DEFAULT FALSE"))
        print("[db] Migrated: added use_custom_key column.")
    db.commit()
except Exception as e:
    print(f"[db] Migration check: {e}")
finally:
    try:
        db.close()
    except Exception:
        pass

print("[startup] Workspace-scoped mode: indexes load on first access per workspace.")

# ══════════════════════════════════════════════════════════════════════════════
# FastAPI app
# ══════════════════════════════════════════════════════════════════════════════
app = FastAPI(title="Document Intelligence Platform API", version="2.0.0")

# ── CORS — configurable for production ────────────────────────────────────────
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
if _allowed_origins:
    origins = [o.strip() for o in _allowed_origins.split(",") if o.strip()]
else:
    # Default: allow localhost dev + HuggingFace Spaces wildcard
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:7860",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.hf\.space",  # All HuggingFace Spaces subdomains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Include Routers ───────────────────────────────────────────────────────────
from routers.admin import router as admin_router
from routers.auth import router as auth_router
from routers.workspaces import router as workspaces_router
from routers.sessions import router as sessions_router
from routers.chat import router as chat_router
from routers.documents import router as documents_router
from routers.system import router as system_router
from routers.training import router as training_router
from routers.evaluation import router as evaluation_router
from routers.config import router as config_router

app.include_router(admin_router)
app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(sessions_router)
app.include_router(chat_router)
app.include_router(documents_router)
app.include_router(system_router)
app.include_router(training_router)
app.include_router(evaluation_router)
app.include_router(config_router)

# ══════════════════════════════════════════════════════════════════════════════
# Serve React build (production)
# Mount AFTER all API routes so /api/ takes priority
# ══════════════════════════════════════════════════════════════════════════════
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        # Serve the requested file if it exists (for favicon, manifest, etc.)
        requested = STATIC_DIR / full_path
        if full_path and requested.exists() and requested.is_file():
            return FileResponse(str(requested))
        # Otherwise serve index.html (SPA client-side routing)
        index_file = STATIC_DIR / "index.html"
        return FileResponse(str(index_file))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=int(os.getenv("BACKEND_PORT", 8000)),
        reload=True,
        reload_dirs=[str(Path(__file__).parent)],
    )
