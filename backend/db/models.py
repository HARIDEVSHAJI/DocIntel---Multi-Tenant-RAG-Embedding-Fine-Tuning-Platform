from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, LargeBinary, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

try:
    from pgvector.sqlalchemy import Vector
except ImportError:
    # Fallback: if pgvector isn't installed, use a placeholder (embeddings stored as binary)
    Vector = lambda dim: LargeBinary

from .database import Base

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(384)) # MiniLM-L6-v2 produces 384-dimensional embeddings



class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    workspaces = relationship("Workspace", back_populates="user", cascade="all, delete-orphan")


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False, default="Default Workspace")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="workspaces")
    config = relationship("WorkspaceConfig", back_populates="workspace", uselist=False, cascade="all, delete-orphan")
    sessions = relationship("ChatSession", back_populates="workspace", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="workspace", cascade="all, delete-orphan")
    document_chunks = relationship("DocumentChunk", cascade="all, delete-orphan")
    query_metrics = relationship("QueryMetric", back_populates="workspace", cascade="all, delete-orphan")
    evaluation_results = relationship("EvaluationResult", back_populates="workspace", cascade="all, delete-orphan")
    fine_tuned_model = relationship("FineTunedModel", back_populates="workspace", uselist=False, cascade="all, delete-orphan")


class WorkspaceConfig(Base):
    """Per-workspace RAG configuration — persisted in DB instead of in-memory dict."""
    __tablename__ = "workspace_configs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True, nullable=False)
    chunk_size = Column(Integer, default=500)
    overlap = Column(Integer, default=50)
    top_k = Column(Integer, default=5)
    temperature = Column(Float, default=0.1)
    llm_model = Column(String(100), default="llama-3.1-8b-instant")
    
    # Custom API Key setup
    api_key_encrypted = Column(String(500), nullable=True)
    use_custom_key = Column(Boolean, default=False, nullable=False)

    # Relationships
    workspace = relationship("Workspace", back_populates="config")




class FineTunedModel(Base):
    """Stores the fine-tuned embedding model (zipped byte array) per workspace."""
    __tablename__ = "fine_tuned_models"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True, nullable=False)
    model_binary = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="fine_tuned_model")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(50), primary_key=True, index=True)  # UUID from frontend
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), default="New Chat")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    faithfulness_score = Column(Float, nullable=True)
    source_count = Column(Integer, default=0)
    source_files = Column(Text, nullable=True)  # JSON list
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    session = relationship("ChatSession", back_populates="messages")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    total_chars = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    indexed_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="documents")


class QueryMetric(Base):
    __tablename__ = "query_metrics"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    question = Column(Text, nullable=False)
    faithfulness_score = Column(Float, nullable=False)
    response_time_ms = Column(Float, nullable=False)
    source_count = Column(Integer, default=0)
    source_files = Column(Text, nullable=True)  # JSON list of strings
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="query_metrics")


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    total_questions = Column(Integer, nullable=False)
    avg_faithfulness = Column(Float, nullable=False)
    avg_answer_relevancy = Column(Float, nullable=False)
    avg_context_precision = Column(Float, nullable=False)
    avg_answer_similarity = Column(Float, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="evaluation_results")


class GlobalSetting(Base):
    """Stores platform-wide settings (e.g. database-configured API keys) to prevent writing to read-only container filesystems at runtime."""
    __tablename__ = "global_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value_encrypted = Column(String(500), nullable=True)

