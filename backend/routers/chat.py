import time
import os
import random
import json
from fastapi import APIRouter, Depends, HTTPException

from db.database import SessionLocal
from db.models import User, QueryMetric
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_state, _get_workspace_config
from core.config import _reload_backend_dotenv, _groq_env_key_rejection_message
from schemas.requests_responses import ChatRequest, SuggestionsRequest

from src.generation import generate_answer, generate_suggestions, get_groq_client
from src.retrieval import hybrid_retrieve
from src.hallucination import score_faithfulness, get_faithfulness_label

router = APIRouter(prefix="/api", tags=["chat"])

def _classify_intent(message: str, model: str, workspace_id: int = None) -> str:
    try:
        client = get_groq_client(workspace_id)
        classify_prompt = (
            "Classify this message into one of three categories. "
            "Reply with only one word.\n"
            "Categories:\n"
            "GREETING (if the message is a casual greeting or small talk with no document-related intent)\n"
            "QUESTION (if the message is asking something that could relate to a document)\n"
            "CHITCHAT (if the message is random keyboard spam or completely nonsensical)\n"
            f"Message: '{message}'"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": classify_prompt}],
            temperature=0.0,
            max_tokens=10,
            timeout=10,
        )
        result = resp.choices[0].message.content.strip().upper()
        if "GREETING" in result: return "GREETING"
        if "CHITCHAT" in result: return "CHITCHAT"
        return "QUESTION"
    except Exception as e:
        print(f"[classify_intent] Error: {e}")
        return "QUESTION"

def _build_history_block(history: list, max_turns: int = 4) -> str:
    if not history: return ""
    recent = history[-max_turns:]
    lines = []
    for turn in recent:
        user_msg = turn[0] if len(turn) > 0 else ""
        asst_msg = turn[1] if len(turn) > 1 else ""
        if user_msg: lines.append(f"User: {user_msg}")
        if asst_msg: lines.append(f"Assistant: {asst_msg}")
    if not lines: return ""
    return "CONVERSATION HISTORY:\n" + "\n".join(lines) + "\n\n"

def _record_query_metrics(workspace_id: int, question: str, faith_score: float, response_time_ms: float, chunk_count: int, source_files: list):
    db = SessionLocal()
    try:
        metric = QueryMetric(
            workspace_id=workspace_id,
            question=question,
            faithfulness_score=faith_score,
            response_time_ms=response_time_ms,
            source_count=chunk_count,
            source_files=json.dumps(source_files)
        )
        db.add(metric)
        db.commit()
    except Exception as e:
        print(f"Error saving metric to DB: {e}")
    finally:
        db.close()

_GENERIC_SUGGESTIONS = [
    "What topics are covered in the documents?",
    "Summarize the key points",
    "What are the main conclusions?",
    "List the important concepts",
]

@router.post("/chat")
async def chat(req: ChatRequest, user: User = Depends(get_current_user)):
    t_start = time.time()
    if not req.workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required.")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Empty message.")

    _reload_backend_dotenv()
    raw_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not raw_key or len(raw_key) < 20 or raw_key.endswith("_here"):
        raise HTTPException(status_code=400, detail=_groq_env_key_rejection_message(raw_key))

    ws_state = _get_workspace_state(req.workspace_id)
    cfg = _get_workspace_config(req.workspace_id)
    intent = _classify_intent(req.message, cfg["llm_model"], req.workspace_id)

    if intent == "GREETING":
        try:
            client = get_groq_client(req.workspace_id)
            greeting_prompt = (
                f"The user said: '{req.message}'. Respond as a professional AI document assistant. "
                f"Greet them warmly, briefly mention you can answer questions about their uploaded documents, "
                f"and ask what they'd like to know. Keep it to 2-3 sentences maximum."
            )
            resp = client.chat.completions.create(
                model=cfg["llm_model"], messages=[{"role": "user", "content": greeting_prompt}],
                temperature=0.7, max_tokens=200, timeout=15,
            )
            answer = resp.choices[0].message.content.strip()
        except Exception:
            answer = "Hello! 👋 I'm your document assistant. Upload some documents and ask me anything about them!"
        return {"answer": answer, "faithfulness_score": 1.0, "faithfulness_label": "🟢 Greeting", "source_count": 0, "source_files": []}

    if intent == "CHITCHAT":
        return {"answer": "I'm here to help with your uploaded documents. Please ask a question related to them.", "faithfulness_score": 1.0, "faithfulness_label": "🟢 Chitchat", "source_count": 0, "source_files": []}

    with _lock:
        chunks = ws_state["chunks"]
        bm25 = ws_state["bm25_index"]
        metadata = ws_state["metadata"]

    if not chunks:
        raise HTTPException(status_code=400, detail="No documents indexed. Please upload documents first.")

    # history includes last 6 exchanges with pronoun resolution
    history_block = _build_history_block(req.history, max_turns=6)

    search_query = req.message
    if req.history:
        last_2_messages = "\\n".join([f"User: {t[0]}\\nAssistant: {t[1]}" if len(t)>1 else f"User: {t[0]}" for t in req.history[-2:]])
        rewrite_prompt = f"Rewrite the following message by replacing any pronouns or vague references like it, they, that, this, them with their explicit meaning based on the conversation history. Return only the rewritten message, nothing else. Conversation history: {last_2_messages}. Current message: {req.message}"
        try:
            client = get_groq_client(req.workspace_id)
            rewrite_resp = client.chat.completions.create(
                model=cfg["llm_model"],
                messages=[{"role": "user", "content": rewrite_prompt}],
                temperature=0.0,
                max_tokens=100,
                timeout=10
            )
            search_query = rewrite_resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"Query rewrite failed: {e}")

    try:
        results = hybrid_retrieve(query=search_query, workspace_id=req.workspace_id, chunks=chunks, bm25_index=bm25, top_k=cfg["top_k"])
        if not results:
            elapsed_ms = round((time.time() - t_start) * 1000, 1)
            _record_query_metrics(req.workspace_id, req.message, 0.0, elapsed_ms, 0, [])
            return {"answer": "I couldn't find information about this in your uploaded documents.", "faithfulness_score": 0.0, "faithfulness_label": "🔴 No context found", "source_count": 0, "source_files": []}

        context_chunks = [text for _, _, text in results]
        answer = generate_answer(query=req.message, context_chunks=context_chunks, temperature=cfg["temperature"], model=cfg["llm_model"], history_block=history_block)
        faith_score = score_faithfulness(answer, context_chunks)
        faith_label, _ = get_faithfulness_label(faith_score)

        source_files = []
        for chunk_idx, score, text in results:
            src = metadata[chunk_idx]["source"] if chunk_idx < len(metadata) else "unknown"
            if src not in source_files:
                source_files.append(src)

        elapsed_ms = round((time.time() - t_start) * 1000, 1)
        _record_query_metrics(req.workspace_id, req.message, faith_score, elapsed_ms, len(results), source_files)

        return {"answer": answer, "faithfulness_score": round(faith_score, 4), "faithfulness_label": faith_label, "source_count": len(results), "source_files": source_files}
    except Exception as e:
        print(f"[chat] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

@router.get("/suggestions")
async def get_suggestions_endpoint(workspace_id: int):
    with _lock:
        ws_state = _get_workspace_state(workspace_id)
        chunks = ws_state["chunks"]
        cfg = _get_workspace_config(workspace_id)

    if not chunks: return {"suggestions": _GENERIC_SUGGESTIONS}
    _reload_backend_dotenv()
    raw_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not raw_key or len(raw_key) < 20 or raw_key.endswith("_here"):
        return {"suggestions": _GENERIC_SUGGESTIONS}

    sample = random.sample(chunks, min(8, len(chunks)))
    excerpts = "\n".join(f"- {c[:200]}" for c in sample)
    prompt = f"Based on these document excerpts, generate exactly 4 short, specific questions a user might ask. Return only a JSON array of 4 question strings, no other text.\n\nExcerpts:\n{excerpts}"

    try:
        client = get_groq_client(workspace_id)
        resp = client.chat.completions.create(model=cfg["llm_model"], messages=[{"role": "user", "content": prompt}], temperature=0.7, max_tokens=256, timeout=15)
        raw = resp.choices[0].message.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
            raw = raw.strip()
        result = json.loads(raw)
        if isinstance(result, list) and len(result) >= 1:
            return {"suggestions": [str(s).strip() for s in result[:4]]}
    except Exception as e:
        print(f"[suggestions] Error: {e}")
    return {"suggestions": _GENERIC_SUGGESTIONS}

@router.post("/suggestions")
async def suggestions_contextual(req: SuggestionsRequest, workspace_id: int):
    with _lock:
        ws_state = _get_workspace_state(workspace_id)
        chunks = ws_state["chunks"]
        metadata = ws_state["metadata"]
        cfg = _get_workspace_config(workspace_id)

    source_names = list({m.get("source", "unknown") for m in metadata})
    sample_chunks = None
    if chunks:
        step = max(1, len(chunks) // 5)
        sample_chunks = [chunks[i] for i in range(0, len(chunks), step)][:5]

    try:
        result = generate_suggestions(conversation_history=req.history, document_sources=source_names, sample_chunks=sample_chunks, model=cfg["llm_model"])
        return {"suggestions": result}
    except Exception as e:
        print(f"[suggestions] Error: {e}")
        return {"suggestions": _GENERIC_SUGGESTIONS}
