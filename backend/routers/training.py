import os
import threading
import tempfile
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Request
from sse_starlette.sse import EventSourceResponse

from db.models import User
from core.dependencies import get_current_user
from core.state import _lock, _get_workspace_state, _get_workspace_config, TRAINING_STATE
from core.config import _reload_backend_dotenv, _groq_env_key_rejection_message

from src.training import load_training_data, fine_tune_model
from src.generation import get_groq_client

router = APIRouter(prefix="/api/train", tags=["training"])

def _run_training_thread(workspace_id: int, csv_path: str, epochs: int):
    global TRAINING_STATE
    TRAINING_STATE.update({
        "running": True, "progress": 0.0,
        "message": "Loading training data...",
        "losses": [], "done": False, "success": None, "result_message": "",
    })

    try:
        pairs = load_training_data(csv_path)
        if not pairs:
            TRAINING_STATE.update({
                "running": False, "done": True, "success": False,
                "result_message": "No valid training pairs found in CSV.",
            })
            return

        def on_progress(pct: float, msg: str):
            TRAINING_STATE["progress"] = round(pct, 3)
            TRAINING_STATE["message"] = msg

        def on_loss(loss_val: float):
            TRAINING_STATE["losses"].append(round(loss_val, 5))

        success, message, losses = fine_tune_model(
            workspace_id=workspace_id,
            training_pairs=pairs,
            epochs=epochs,
            progress_callback=on_progress,
        )
        TRAINING_STATE["losses"] = [round(l, 5) for l in losses]
        TRAINING_STATE.update({
            "running": False, "done": True,
            "success": success, "result_message": message,
            "progress": 1.0 if success else TRAINING_STATE["progress"],
        })

    except Exception as e:
        TRAINING_STATE.update({
            "running": False, "done": True, "success": False,
            "result_message": f"Training error: {str(e)}",
        })
    finally:
        if os.path.exists(csv_path):
            os.remove(csv_path)

@router.post("/start")
async def start_training(workspace_id: int, file: UploadFile = File(...), epochs: int = Form(3), user: User = Depends(get_current_user)):
    if TRAINING_STATE["running"]:
        raise HTTPException(status_code=409, detail="Training already in progress.")
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.write(await file.read())
    tmp.close()
    thread = threading.Thread(target=_run_training_thread, args=(workspace_id, tmp.name, epochs), daemon=True)
    thread.start()
    return {"status": "started", "message": f"Training started with {epochs} epochs."}

@router.get("/stream")
async def train_stream(request: Request, token: str = None):
    """SSE stream for training progress.
    EventSource doesn't support custom headers, so the JWT token is
    passed as a query parameter from the frontend instead.
    """
    # Optional auth validation for SSE
    if token:
        try:
            from jose import jwt as jose_jwt
            from core.dependencies import SECRET_KEY, ALGORITHM
            jose_jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except Exception:
            pass  # Non-critical — training state is not sensitive

    async def event_generator():
        while True:
            if await request.is_disconnected(): break
            state = {
                "running": TRAINING_STATE["running"],
                "progress": TRAINING_STATE["progress"],
                "message": TRAINING_STATE["message"],
                "losses": TRAINING_STATE["losses"],
                "done": TRAINING_STATE["done"],
                "success": TRAINING_STATE["success"],
                "result_message": TRAINING_STATE["result_message"],
            }
            import asyncio
            yield {"data": json.dumps(state)}
            if TRAINING_STATE["done"]: break
            await asyncio.sleep(0.8)
    return EventSourceResponse(event_generator())

@router.get("/status")
def train_status(workspace_id: int, user: User = Depends(get_current_user)):
    try:
        return dict(TRAINING_STATE)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Train status error: {e}")

@router.post("/auto-generate")
async def auto_generate_training(workspace_id: int, user: User = Depends(get_current_user)):
    import csv
    with _lock:
        ws_state = _get_workspace_state(workspace_id)
        chunks = ws_state["chunks"]
        cfg = _get_workspace_config(workspace_id)

    if not chunks:
        raise HTTPException(status_code=400, detail="No documents indexed. Upload documents first.")

    try:
        client = get_groq_client(workspace_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    import random
    sample = random.sample(chunks, min(30, len(chunks)))
    all_pairs = []

    for batch_start in range(0, len(sample), 5):
        batch = sample[batch_start:batch_start + 5]
        passages = "\n\n---\n\n".join(f"Passage {j+1}: {c[:400]}" for j, c in enumerate(batch))
        prompt = (
            "For each of these text passages, generate one specific question that this "
            "passage directly answers. Return a JSON array of objects with keys 'query' "
            f"and 'positive_passage'. Return only valid JSON, no other text.\n\n{passages}"
        )
        try:
            resp = client.chat.completions.create(model=cfg["llm_model"], messages=[{"role": "user", "content": prompt}], temperature=0.5, max_tokens=1024, timeout=30)
            raw = resp.choices[0].message.content.strip()
            if "```" in raw:
                raw = raw.split("```")[1]
                if raw.startswith("json"): raw = raw[4:]
                raw = raw.strip()
            pairs = json.loads(raw)
            if isinstance(pairs, list): all_pairs.extend(pairs)
        except Exception as e:
            print(f"[auto-generate] Batch error: {e}")
            continue

    if not all_pairs:
        raise HTTPException(status_code=500, detail="Failed to generate training pairs from documents.")

    import tempfile
    csv_path = Path(tempfile.gettempdir()) / f"auto_generated_pairs_ws_{workspace_id}.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["query", "positive_passage"])
        writer.writeheader()
        for p in all_pairs:
            if "query" in p and "positive_passage" in p:
                writer.writerow({"query": p["query"], "positive_passage": p["positive_passage"]})

    valid_pairs = [p for p in all_pairs if "query" in p and "positive_passage" in p]
    preview = [{"query": p["query"][:100], "positive_passage": p["positive_passage"][:150]} for p in valid_pairs[:5]]

    return {"success": True, "count": len(valid_pairs), "preview": preview, "csv_path": str(csv_path)}

@router.post("/start-auto")
async def start_training_auto(workspace_id: int, epochs: int = 3, user: User = Depends(get_current_user)):
    import tempfile
    csv_path = Path(tempfile.gettempdir()) / f"auto_generated_pairs_ws_{workspace_id}.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="No auto-generated pairs found. Run auto-generate first.")
    if TRAINING_STATE["running"]:
        raise HTTPException(status_code=409, detail="Training already in progress.")

    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.write(csv_path.read_bytes())
    tmp.close()

    thread = threading.Thread(target=_run_training_thread, args=(workspace_id, tmp.name, epochs), daemon=True)
    thread.start()
    return {"status": "started", "message": f"Training started with {epochs} epochs using auto-generated pairs."}
