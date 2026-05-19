from typing import List, Optional, Dict
from pydantic import BaseModel

class CreateSessionRequest(BaseModel):
    workspace_id: int
    title: Optional[str] = "New Chat"
    session_id: Optional[str] = None

class SaveMessageRequest(BaseModel):
    session_id: str
    role: str
    content: str
    faithfulness_score: Optional[float] = None
    source_count: Optional[int] = 0
    source_files: Optional[List[str]] = []

class ChatRequest(BaseModel):
    message: str
    history: List[List[str]] = []
    session_id: Optional[str] = None
    workspace_id: Optional[int] = None

class KeySaveRequest(BaseModel):
    api_key: str

class KeyToggleRequest(BaseModel):
    use_custom_key: bool

class KeyTestRequest(BaseModel):
    api_key: Optional[str] = None
    use_env: Optional[bool] = False

class ConfigUpdate(BaseModel):
    chunk_size: Optional[int] = None
    overlap: Optional[int] = None
    top_k: Optional[int] = None
    temperature: Optional[float] = None
    llm_model: Optional[str] = None

class SuggestionsRequest(BaseModel):
    history: List[Dict[str, str]] = []

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    active_workspace_id: Optional[int] = None
