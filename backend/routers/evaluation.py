import os
import tempfile
import json
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile

from db.database import SessionLocal
from db.models import User, EvaluationResult
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_state, _get_workspace_config
from core.config import _reload_backend_dotenv, _groq_env_key_rejection_message

from src.evaluation import run_evaluation, load_eval_csv
from src.retrieval import hybrid_retrieve
from src.generation import generate_answer, get_groq_client

router = APIRouter(prefix="/api/evaluate", tags=["evaluation"])

@router.post("")
async def evaluate(workspace_id: int, file: UploadFile = File(...), user: User = Depends(get_current_user)):
    with _lock:
        ws_state = _get_workspace_state(workspace_id)
        index = ws_state["index"]
        chunks = ws_state["chunks"]
        bm25 = ws_state["bm25_index"]
        cfg = _get_workspace_config(workspace_id)

    if not chunks:
        raise HTTPException(status_code=400, detail="No documents indexed.")

    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.write(await file.read())
    tmp.close()

    try:
        questions, ground_truths = load_eval_csv(tmp.name)
    finally:
        os.remove(tmp.name)

    if not questions:
        raise HTTPException(status_code=422, detail="No valid Q&A pairs in CSV.")

    try:
        def rag_fn(question: str):
            results = hybrid_retrieve(question, workspace_id, chunks, bm25, top_k=cfg["top_k"])
            context = [text for _, _, text in results]
            answer = generate_answer(question, context, temperature=cfg["temperature"], model=cfg["llm_model"])
            return answer, context

        per_sample, aggregated = run_evaluation(questions, ground_truths, rag_fn, workspace_id)

        db = SessionLocal()
        try:
            db.query(EvaluationResult).filter(EvaluationResult.workspace_id == workspace_id).delete()
            eval_res = EvaluationResult(
                workspace_id=workspace_id,
                total_questions=len(questions),
                avg_faithfulness=aggregated.get("faithfulness", 0),
                avg_answer_relevancy=aggregated.get("answer_relevancy", 0),
                avg_context_precision=aggregated.get("context_precision", 0),
                avg_answer_similarity=aggregated.get("answer_similarity", 0),
            )
            db.add(eval_res)
            db.commit()
        except Exception as e:
            print(f"Error saving eval to DB: {e}")
        finally:
            db.close()

        return {"per_sample": per_sample, "aggregated": aggregated, "total": len(questions)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evaluation error: {e}")

@router.post("/auto")
async def evaluate_auto(workspace_id: int, user: User = Depends(get_current_user)):
    with _lock:
        ws_state = _get_workspace_state(workspace_id)
        index = ws_state["index"]
        chunks = ws_state["chunks"]
        bm25 = ws_state["bm25_index"]
        cfg = _get_workspace_config(workspace_id)

    if not chunks:
        raise HTTPException(status_code=400, detail="No documents indexed.")

    _reload_backend_dotenv()
    raw_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not raw_key or len(raw_key) < 20 or raw_key.endswith("_here"):
        raise HTTPException(status_code=400, detail=_groq_env_key_rejection_message(raw_key))

    csv_path = Path(tempfile.gettempdir()) / f"auto_generated_pairs_ws_{workspace_id}.csv"
    questions, ground_truths = [], []

    if csv_path.exists():
        try:
            qs, gts = load_eval_csv(str(csv_path))
            questions, ground_truths = qs[:10], gts[:10]
        except Exception:
            pass

    if not questions:
        import random
        sample = random.sample(chunks, min(10, len(chunks)))
        client = get_groq_client(workspace_id)

        passages = "\n\n---\n\n".join(f"Passage {i+1}: {c[:300]}" for i, c in enumerate(sample[:10]))
        prompt = (
            "For each passage, generate a question and the correct answer based on the passage content. "
            "Return a JSON array of objects with keys 'question' and 'ground_truth'. "
            f"Return only valid JSON.\n\n{passages}"
        )
        try:
            resp = client.chat.completions.create(model=cfg["llm_model"], messages=[{"role": "user", "content": prompt}], temperature=0.5, max_tokens=2048, timeout=45)
            raw = resp.choices[0].message.content.strip()
            if "```" in raw:
                raw = raw.split("```")[1]
                if raw.startswith("json"): raw = raw[4:]
                raw = raw.strip()
            pairs = json.loads(raw)
            if isinstance(pairs, list):
                for p in pairs:
                    if "question" in p and "ground_truth" in p:
                        questions.append(p["question"])
                        ground_truths.append(p["ground_truth"])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate eval pairs: {e}")

    if not questions:
        raise HTTPException(status_code=500, detail="Could not generate evaluation questions.")

    try:
        def rag_fn(question: str):
            results = hybrid_retrieve(question, workspace_id, chunks, bm25, top_k=cfg["top_k"])
            context = [text for _, _, text in results]
            answer = generate_answer(question, context, temperature=cfg["temperature"], model=cfg["llm_model"])
            return answer, context

        per_sample, aggregated = run_evaluation(questions, ground_truths, rag_fn, workspace_id)

        db = SessionLocal()
        try:
            db.query(EvaluationResult).filter(EvaluationResult.workspace_id == workspace_id).delete()
            eval_res = EvaluationResult(
                workspace_id=workspace_id,
                total_questions=len(questions),
                avg_faithfulness=aggregated.get("faithfulness", 0),
                avg_answer_relevancy=aggregated.get("answer_relevancy", 0),
                avg_context_precision=aggregated.get("context_precision", 0),
                avg_answer_similarity=aggregated.get("answer_similarity", 0),
            )
            db.add(eval_res)
            db.commit()
        except Exception as e:
            print(f"Error saving eval to DB: {e}")
        finally:
            db.close()

        return {"per_sample": per_sample, "aggregated": aggregated, "total": len(questions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-evaluation error: {e}")
