import os
import ssl
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Database URL
# Defaults to a local SQLite database for easy testing if Postgres isn't running
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "sqlite:///./rag_database.db"
)

# Fix for Aiven / older URLs: SQLAlchemy 1.4+ removed support for "postgres://"
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# ── Build engine kwargs based on database type ────────────────────────────────
_is_sqlite = "sqlite" in SQLALCHEMY_DATABASE_URL

connect_args = {}
pool_kwargs = {}

if _is_sqlite:
    connect_args = {"check_same_thread": False}
else:
    # PostgreSQL pool settings — tuned for cloud databases (Aiven, Supabase, Neon)
    pool_kwargs = {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 1800,       # Recycle connections every 30 min
        "pool_pre_ping": True,      # Test connections before using (handles cloud DB drops)
    }

    # Handle SSL for cloud databases (Aiven requires sslmode=require)
    # psycopg2 reads sslmode from the URL query params automatically,
    # but we also set connect_args for robustness
    if "sslmode" in SQLALCHEMY_DATABASE_URL:
        connect_args["sslmode"] = "require"

# Create SQLAlchemy engine
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args=connect_args, **pool_kwargs
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for declarative models
Base = declarative_base()

def get_db():
    """
    Dependency generator that yields a database session.
    Usage in FastAPI endpoints:
        def my_endpoint(db: Session = Depends(get_db)):
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
