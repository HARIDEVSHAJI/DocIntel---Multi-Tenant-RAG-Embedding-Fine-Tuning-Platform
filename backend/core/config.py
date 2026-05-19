import os
import hashlib
import base64
from pathlib import Path
from cryptography.fernet import Fernet
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

def _reload_backend_dotenv() -> None:
    """Re-read backend/.env so key edits apply without a full process restart (dev)."""
    load_dotenv(dotenv_path=_ENV_PATH, override=True)

def _groq_key_sig(raw: str) -> str:
    """Stable short fingerprint for cache invalidation (not reversible to the key)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16] if raw else ""

def _get_fernet_cipher():
    secret = os.environ.get("JWT_SECRET_KEY", "fallback_secret_key_1234567890")
    key_bytes = hashlib.sha256(secret.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)

def encrypt_key(raw_key: str) -> str:
    if not raw_key: return ""
    return _get_fernet_cipher().encrypt(raw_key.encode()).decode()

def decrypt_key(encrypted_key: str) -> str:
    if not encrypted_key: return ""
    try:
        return _get_fernet_cipher().decrypt(encrypted_key.encode()).decode()
    except Exception:
        return ""

def _groq_env_key_rejection_message(raw_key: str) -> str:
    """Why GROQ_API_KEY failed local checks (never includes the secret value)."""
    if not raw_key:
        return (
            "GROQ_API_KEY is not set. Add it to backend/.env, restart the API server, "
            "then get a key at https://console.groq.com"
        )
    if len(raw_key) < 20:
        return (
            "GROQ_API_KEY is too short. Paste the full key from https://console.groq.com "
            "into backend/.env and restart the server."
        )
    if raw_key.endswith("_here"):
        return (
            "GROQ_API_KEY still looks like a template placeholder (it ends with \"_here\"). "
            "Replace it with your real Groq key from https://console.groq.com in backend/.env "
            "and restart the server."
        )
    return (
        "GROQ_API_KEY failed local validation. Update backend/.env and restart the server. "
        "Get a key at https://console.groq.com"
    )
