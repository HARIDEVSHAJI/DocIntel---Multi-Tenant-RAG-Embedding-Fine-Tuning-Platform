"""
generation.py — LLM answer generation via Groq API.

Uses Groq's free-tier inference (Llama 3, Mixtral) with:
  - Structured prompt template that forces grounded, cited answers
  - Exponential backoff retry on rate limits
  - Context window management (truncates chunks if needed)
"""

import os
import time
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

_BACKEND_ENV = Path(__file__).resolve().parent.parent / ".env"

# Groq client (lazy init so missing key doesn't crash on import)
_groq_client = None
_groq_client_key = None  # track which key was used to create the client

def clear_groq_client_cache():
    global _groq_client, _groq_client_key
    _groq_client = None
    _groq_client_key = None

def get_groq_client(workspace_id: Optional[int] = None):
    """Initialize and cache the Groq client. Re-creates if the key changes."""
    global _groq_client, _groq_client_key
    load_dotenv(dotenv_path=_BACKEND_ENV, override=True)
    
    # Start with OS system environment default
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    
    # Override with database-configured GlobalSetting key (Dashboard overrides OS env!)
    try:
        from db.database import SessionLocal
        from db.models import GlobalSetting
        from core.config import decrypt_key
        db = SessionLocal()
        setting = db.query(GlobalSetting).filter(GlobalSetting.key == "GROQ_API_KEY").first()
        if setting and setting.value_encrypted:
            decrypted = decrypt_key(setting.value_encrypted)
            if decrypted and len(decrypted) > 20:
                api_key = decrypted
        db.close()
    except Exception as e:
        print(f"[get_groq_client] Error loading DB global API key: {e}")

    # Check database for custom key if workspace_id is provided
    if workspace_id is not None:
        try:
            from db.database import SessionLocal
            from db.models import WorkspaceConfig
            import base64
            import hashlib
            from cryptography.fernet import Fernet
            
            db = SessionLocal()
            cfg = db.query(WorkspaceConfig).filter(WorkspaceConfig.workspace_id == workspace_id).first()
            if cfg and cfg.use_custom_key and cfg.api_key_encrypted:
                secret = os.environ.get("JWT_SECRET_KEY", "fallback_secret_key_1234567890")
                key_bytes = hashlib.sha256(secret.encode()).digest()
                fernet_key = base64.urlsafe_b64encode(key_bytes)
                cipher = Fernet(fernet_key)
                
                try:
                    decrypted = cipher.decrypt(cfg.api_key_encrypted.encode()).decode()
                    if decrypted:
                        api_key = decrypted
                except Exception:
                    pass
            db.close()
        except Exception as e:
            print(f"[get_groq_client] Error loading custom key: {e}")

    if not api_key or len(api_key) < 20 or api_key.endswith("_here"):
        if api_key.endswith("_here"):
            msg = (
                "GROQ_API_KEY looks like a template placeholder (it ends with \"_here\").\n"
                "Replace it with your real key in the Admin Panel or environment variables."
            )
        elif api_key and len(api_key) < 20:
            msg = (
                "GROQ_API_KEY is too short.\n"
                "Paste a valid key from https://console.groq.com."
            )
        else:
            msg = (
                "GROQ_API_KEY is not set.\n"
                "Configure a fallback key in the Admin Panel or environment variables."
            )
        raise ValueError(msg)

    # Re-create client if key changed
    if _groq_client is None or _groq_client_key != api_key:
        from groq import Groq
        _groq_client = Groq(api_key=api_key)
        _groq_client_key = api_key

    return _groq_client


def build_prompt(query: str, context_chunks: List[str], history_block: str = "") -> str:
    """
    Build a structured prompt that grounds the LLM in retrieved context.
    Uses the V2 professional prompt — no citation markers, no source references.
    Optionally includes conversation history for multi-turn context.
    """
    if not context_chunks:
        context_block = "No relevant context was retrieved."
    else:
        parts = []
        for chunk in context_chunks:
            # Truncate very long chunks to stay within context window
            truncated = chunk[:800] + "..." if len(chunk) > 800 else chunk
            parts.append(truncated)
        context_block = "\n\n---\n\n".join(parts)

    prompt = f"""You are a document assistant. Answer directly and professionally. If the topic is mentioned but lacks full detail, answer what you can and say "For more detail, this topic may not be fully covered in your uploaded documents." If there is zero relevance to the question, say only "I couldn't find information about this in your uploaded documents." Never answer completely off-topic questions like general knowledge about countries, celebrities, or science. Never mention sources. If the user uses pronouns like it, they, that, this, them, those referring to something mentioned earlier in the conversation, resolve what they refer to using the conversation history before answering. Never explain your reasoning process, never say what a pronoun refers to, just answer directly as if you already know what the user meant.

CONTEXT:
{context_block}

{history_block}QUESTION: {query}"""
    return prompt


def generate_answer(
    query: str,
    context_chunks: List[str],
    temperature: float = 0.1,
    model: str = "llama-3.1-8b-instant",
    max_retries: int = 3,
    history_block: str = "",
) -> str:
    """
    Generate an answer using the Groq LLM with exponential backoff retry.

    Args:
        query: user's question
        context_chunks: retrieved text chunks to use as context
        temperature: sampling temperature (lower = more deterministic)
        model: Groq model id (e.g. llama-3.1-8b-instant — see console.groq.com/docs/models)
        max_retries: number of retry attempts on rate limit errors
        history_block: formatted conversation history string (last 4 turns)

    Returns:
        Generated answer string.
    """
    client = get_groq_client()
    prompt = build_prompt(query, context_chunks, history_block=history_block)

    last_error = None
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=1024,
                timeout=30,
            )
            answer = response.choices[0].message.content.strip()
            return answer if answer else "No response generated."

        except Exception as e:
            last_error = e
            error_str = str(e).lower()

            if "rate_limit" in error_str or "429" in error_str:
                wait = 2 ** attempt  # 1s, 2s, 4s
                print(f"Rate limit hit. Retrying in {wait}s... (attempt {attempt + 1})")
                time.sleep(wait)
            elif "api_key" in error_str or "authentication" in error_str or "401" in error_str:
                raise ValueError(
                    "Invalid GROQ_API_KEY. Please check your key at https://console.groq.com"
                )
            elif attempt < max_retries - 1:
                time.sleep(1)
            else:
                break

    raise ValueError(f"Groq API failed after {max_retries} attempts: {last_error}")


def generate_suggestions(
    conversation_history: List[dict],
    document_sources: List[str],
    sample_chunks: List[str] | None = None,
    model: str = "llama-3.1-8b-instant",
) -> List[str]:
    """
    Generate 4 contextual follow-up question suggestions based on
    the conversation so far and the indexed documents.

    Args:
        conversation_history: list of {"role": ..., "content": ...} dicts (last few turns)
        document_sources: list of indexed document filenames
        sample_chunks: optional sample of chunk texts for topic awareness
        model: Groq model id

    Returns:
        List of 4 short follow-up question strings.
    """
    import json as _json

    client = get_groq_client()

    # Build a compact history summary (last 3 turns max)
    history_lines = []
    for msg in conversation_history[-6:]:  # up to 3 pairs
        role = msg.get("role", "user")
        content = msg.get("content", "")[:300]
        history_lines.append(f"{role.upper()}: {content}")
    history_block = "\n".join(history_lines) if history_lines else "No conversation yet."

    # Document context
    docs_block = ", ".join(document_sources[:10]) if document_sources else "No documents indexed."

    # Optional topic hints from chunks
    topic_hints = ""
    if sample_chunks:
        snippets = [c[:150] for c in sample_chunks[:5]]
        topic_hints = f"\n\nTOPIC HINTS FROM DOCUMENTS:\n" + "\n---\n".join(snippets)

    prompt = f"""You are a helpful assistant that suggests follow-up questions.

CONVERSATION SO FAR:
{history_block}

INDEXED DOCUMENTS: {docs_block}{topic_hints}

Generate exactly 4 short, natural follow-up questions the user might want to ask next.
The questions should:
- Be relevant to the conversation AND the indexed documents
- Be diverse (don't repeat similar questions)
- Be concise (under 12 words each)
- Help the user explore the documents further

Return ONLY a JSON array of 4 strings, no other text. Example:
["Question 1?", "Question 2?", "Question 3?", "Question 4?"]"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=256,
            timeout=15,
        )
        raw = response.choices[0].message.content.strip()

        # Extract JSON array from response (handle markdown code fences)
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        suggestions = _json.loads(raw)
        if isinstance(suggestions, list) and len(suggestions) >= 1:
            return [str(s).strip() for s in suggestions[:4]]
    except Exception as e:
        print(f"[suggestions] Generation failed: {e}")

    # Fallback suggestions
    return [
        "What are the key findings in the documents?",
        "Can you summarize the main points?",
        "What details can you provide about the methodology?",
        "Are there any recommendations mentioned?",
    ]
