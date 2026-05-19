"""
training.py — Fine-tune the sentence-transformer embedding model.

Uses MultipleNegativesRankingLoss with a manual PyTorch training loop
so we can yield per-step loss values for the live loss chart in the UI.

Input: CSV with columns [query, positive_passage]
  - query: a question or search query
  - positive_passage: the relevant document excerpt that answers it

Output: Fine-tuned model saved to models/fine_tuned/
"""

import os
import csv
from typing import List, Tuple, Callable, Generator, Optional

FINE_TUNED_PATH = "models/fine_tuned"
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


# ─── Data Loading ──────────────────────────────────────────────────────────────
def load_training_data(csv_path: str) -> List[Tuple[str, str]]:
    """
    Load (query, positive_passage) pairs from a CSV file.
    Accepts files with or without a header row.
    """
    pairs: List[Tuple[str, str]] = []
    try:
        with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
            # Sniff delimiter
            sample = f.read(2048)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel

            reader = csv.DictReader(f, dialect=dialect)

            # Try header-based loading first
            if reader.fieldnames:
                fields_lower = [fn.lower().strip() for fn in reader.fieldnames]
                q_key = next(
                    (reader.fieldnames[i] for i, f in enumerate(fields_lower)
                     if f in ("query", "question", "q")), None
                )
                p_key = next(
                    (reader.fieldnames[i] for i, f in enumerate(fields_lower)
                     if f in ("positive_passage", "passage", "answer", "positive", "context")), None
                )

                if q_key and p_key:
                    for row in reader:
                        q = row.get(q_key, "").strip()
                        p = row.get(p_key, "").strip()
                        if q and p and len(q) > 5 and len(p) > 10:
                            pairs.append((q, p))
                    return pairs

            # Fallback: treat as two-column CSV without header
            f.seek(0)
            reader2 = csv.reader(f, dialect=dialect)
            for row in reader2:
                if len(row) >= 2:
                    q, p = row[0].strip(), row[1].strip()
                    # Skip header-like rows
                    if q.lower() in ("query", "question", "q"):
                        continue
                    if q and p and len(q) > 5 and len(p) > 10:
                        pairs.append((q, p))

    except Exception as e:
        raise ValueError(f"Error reading training CSV: {e}")

    return pairs


# ─── Training ──────────────────────────────────────────────────────────────────
def fine_tune_model(
    workspace_id: int,
    training_pairs: List[Tuple[str, str]],
    epochs: int = 2,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Tuple[bool, str, List[float]]:
    """
    Fine-tune the sentence-transformer using MultipleNegativesRankingLoss.
    Uses a manual PyTorch training loop for real-time loss tracking.
    Saves the fine-tuned model to the database as a zipped byte array.

    Args:
        workspace_id: The ID of the workspace for this model
        training_pairs: list of (query, positive_passage) tuples
        epochs: number of training epochs
        batch_size: training batch size
        learning_rate: AdamW learning rate
        progress_callback: optional fn(progress_0_to_1, message) for UI updates

    Returns:
        (success, message, loss_values_list)
    """
    try:
        import torch
        from sentence_transformers import SentenceTransformer, InputExample, losses
        from torch.utils.data import DataLoader

        # ── Load model ──
        if progress_callback:
            progress_callback(0.0, "Loading base model...")
        model = SentenceTransformer(BASE_MODEL)

        # ── Prepare data ──
        if len(training_pairs) < 2:
            return False, "Need at least 2 training pairs.", []

        examples = [InputExample(texts=[q, p]) for q, p in training_pairs]
        effective_batch = min(batch_size, max(2, len(examples)))

        loader = DataLoader(
            examples,
            shuffle=True,
            batch_size=effective_batch,
            collate_fn=model.smart_batching_collate,
            drop_last=False,
        )

        # ── Loss function ──
        loss_fn = losses.MultipleNegativesRankingLoss(model=model)

        # ── Optimizer ──
        # Separate weight decay for bias and LayerNorm params (standard practice)
        no_decay = ["bias", "LayerNorm.bias", "LayerNorm.weight"]
        param_groups = [
            {
                "params": [
                    p for n, p in model.named_parameters()
                    if p.requires_grad and not any(nd in n for nd in no_decay)
                ],
                "weight_decay": 0.01,
            },
            {
                "params": [
                    p for n, p in model.named_parameters()
                    if p.requires_grad and any(nd in n for nd in no_decay)
                ],
                "weight_decay": 0.0,
            },
        ]
        optimizer = torch.optim.AdamW(param_groups, lr=learning_rate)

        # ── LR Scheduler ──
        total_steps = len(loader) * epochs
        warmup_steps = max(1, int(total_steps * 0.1))
        from torch.optim.lr_scheduler import LambdaLR

        def lr_lambda(current_step):
            if current_step < warmup_steps:
                return float(current_step) / float(max(1, warmup_steps))
            progress = float(current_step - warmup_steps) / float(
                max(1, total_steps - warmup_steps)
            )
            return max(0.0, 1.0 - progress)

        scheduler = LambdaLR(optimizer, lr_lambda)

        # ── Training Loop ──
        all_losses: List[float] = []
        global_step = 0
        model.train()

        for epoch in range(epochs):
            epoch_loss = 0.0
            for batch_idx, (features, labels) in enumerate(loader):
                optimizer.zero_grad()
                loss_val = loss_fn(features, labels)
                loss_val.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                scheduler.step()

                loss_item = loss_val.item()
                epoch_loss += loss_item
                all_losses.append(loss_item)
                global_step += 1

                if progress_callback:
                    pct = global_step / total_steps
                    msg = (
                        f"Epoch {epoch + 1}/{epochs} | "
                        f"Batch {batch_idx + 1}/{len(loader)} | "
                        f"Loss: {loss_item:.4f}"
                    )
                    progress_callback(pct, msg)

            avg = epoch_loss / max(1, len(loader))
            print(f"Epoch {epoch + 1}/{epochs} complete. Avg loss: {avg:.4f}")

        # ── Save ──
        import tempfile
        import zipfile
        import io
        import shutil
        from db.database import SessionLocal
        from db.models import FineTunedModel

        if progress_callback:
            progress_callback(1.0, "Compressing and saving model to database...")

        tmp_dir = tempfile.mkdtemp()
        model.save(tmp_dir)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(tmp_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, tmp_dir)
                    zf.write(file_path, arcname)
        
        zip_bytes = buf.getvalue()
        shutil.rmtree(tmp_dir, ignore_errors=True)

        db = SessionLocal()
        try:
            db.query(FineTunedModel).filter(FineTunedModel.workspace_id == workspace_id).delete()
            new_model = FineTunedModel(workspace_id=workspace_id, model_binary=zip_bytes)
            db.add(new_model)
            db.commit()
        finally:
            db.close()

        # Clear embedding model cache so next retrieval uses the fine-tuned model
        from src.embeddings import clear_model_cache
        clear_model_cache(workspace_id)

        msg = (
            f"✅ Fine-tuning complete!\n"
            f"• Trained on {len(training_pairs)} pairs for {epochs} epoch(s)\n"
            f"• Final loss: {all_losses[-1]:.4f}\n"
            f"• Model saved to PostgreSQL Database.\n"
            f"• The retrieval system now uses your fine-tuned embeddings."
        )
        return True, msg, all_losses

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"Training error:\n{tb}")
        return False, f"❌ Training failed: {str(e)}", []
