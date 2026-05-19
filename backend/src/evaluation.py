"""
evaluation.py — Custom RAG evaluation metrics.

Implements four evaluation dimensions without external dependencies:

  1. Faithfulness      — NLI entailment of answer given context (from hallucination.py)
  2. Answer Relevancy  — Cosine similarity between question and answer embeddings
  3. Context Precision — Mean cosine similarity of retrieved chunks to the question
  4. Answer Similarity — Cosine similarity between generated and ground-truth answers

All scores ∈ [0, 1]. Higher = better.
"""

from typing import List, Dict, Tuple, Callable, Optional

import numpy as np


# ─── Individual Metrics ────────────────────────────────────────────────────────
def compute_answer_relevancy(question: str, answer: str, workspace_id: int) -> float:
    """
    How well does the generated answer address the question?
    Measured via cosine similarity of their embeddings.
    """
    from src.embeddings import embed_texts
    try:
        if not question.strip() or not answer.strip():
            return 0.0
        embs = embed_texts([question, answer], workspace_id=workspace_id)
        # embeddings are L2-normalized, so dot product = cosine similarity
        score = float(np.dot(embs[0], embs[1]))
        return max(0.0, min(1.0, score))
    except Exception as e:
        print(f"Answer relevancy error: {e}")
        return 0.0


def compute_context_precision(question: str, contexts: List[str], workspace_id: int) -> float:
    """
    How relevant are the retrieved chunks to the question?
    Measured as mean cosine similarity between question and each context embedding.
    """
    from src.embeddings import embed_texts
    try:
        if not question.strip() or not contexts:
            return 0.0
        all_texts = [question] + contexts
        embs = embed_texts(all_texts, workspace_id=workspace_id)
        q_emb = embs[0]
        c_embs = embs[1:]
        similarities = np.dot(c_embs, q_emb)  # shape: (num_contexts,)
        return float(np.mean(similarities))
    except Exception as e:
        print(f"Context precision error: {e}")
        return 0.0


def compute_answer_similarity(generated: str, ground_truth: str, workspace_id: int) -> float:
    """
    Semantic similarity between generated answer and the ground-truth answer.
    Measured via cosine similarity of embeddings.
    """
    from src.embeddings import embed_texts
    try:
        if not generated.strip() or not ground_truth.strip():
            return 0.0
        embs = embed_texts([generated, ground_truth], workspace_id=workspace_id)
        score = float(np.dot(embs[0], embs[1]))
        return max(0.0, min(1.0, score))
    except Exception as e:
        print(f"Answer similarity error: {e}")
        return 0.0


def evaluate_single_sample(
    question: str,
    ground_truth: str,
    generated_answer: str,
    contexts: List[str],
    workspace_id: int,
) -> Dict[str, float]:
    """
    Evaluate one RAG sample across all four metrics.

    Returns:
        dict with keys: faithfulness, answer_relevancy, context_precision, answer_similarity
    """
    from src.hallucination import score_faithfulness

    return {
        "faithfulness": score_faithfulness(generated_answer, contexts),
        "answer_relevancy": compute_answer_relevancy(question, generated_answer, workspace_id),
        "context_precision": compute_context_precision(question, contexts, workspace_id),
        "answer_similarity": compute_answer_similarity(generated_answer, ground_truth, workspace_id),
    }


# ─── Batch Evaluation ──────────────────────────────────────────────────────────
def run_evaluation(
    questions: List[str],
    ground_truths: List[str],
    rag_fn: Callable[[str], Tuple[str, List[str]]],
    workspace_id: int,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Tuple[List[Dict], Dict[str, float]]:
    """
    Run full evaluation over a list of Q&A pairs.

    Args:
        questions: list of questions to evaluate
        ground_truths: list of reference answers (same length as questions)
        rag_fn: callable that takes a question string and returns (answer, context_chunks)
        progress_callback: optional fn(progress_0_to_1, message) for UI updates

    Returns:
        (per_sample_results, aggregated_metrics)
        per_sample_results: list of dicts, one per question
        aggregated_metrics: dict with mean scores across all samples
    """
    assert len(questions) == len(ground_truths), "questions and ground_truths must have equal length"

    per_sample: List[Dict] = []
    total = len(questions)

    for i, (q, gt) in enumerate(zip(questions, ground_truths)):
        if progress_callback:
            progress_callback(i / total, f"Evaluating question {i + 1}/{total}...")

        try:
            answer, contexts = rag_fn(q)
            metrics = evaluate_single_sample(q, gt, answer, contexts, workspace_id)
        except Exception as e:
            print(f"Evaluation error on question {i}: {e}")
            answer = f"Error: {str(e)}"
            metrics = {
                "faithfulness": 0.0,
                "answer_relevancy": 0.0,
                "context_precision": 0.0,
                "answer_similarity": 0.0,
            }
            contexts = []

        record = {
            "question": q,
            "ground_truth": gt,
            "generated_answer": answer[:300] + "..." if len(answer) > 300 else answer,
            **{k: round(v, 3) for k, v in metrics.items()},
        }
        per_sample.append(record)

    if progress_callback:
        progress_callback(1.0, "Evaluation complete!")

    # ── Aggregate ──
    metric_keys = ["faithfulness", "answer_relevancy", "context_precision", "answer_similarity"]
    if per_sample:
        aggregated = {
            k: round(float(np.mean([r[k] for r in per_sample])), 3)
            for k in metric_keys
        }
    else:
        aggregated = {k: 0.0 for k in metric_keys}

    return per_sample, aggregated


def load_eval_csv(csv_path: str) -> Tuple[List[str], List[str]]:
    """
    Load evaluation CSV with columns [question, ground_truth].

    Returns:
        (questions, ground_truths)
    """
    import csv

    questions, ground_truths = [], []
    try:
        with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
            sample = f.read(2048)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel

            reader = csv.DictReader(f, dialect=dialect)
            if not reader.fieldnames:
                raise ValueError("CSV has no headers")

            fields_lower = [fn.lower().strip() for fn in reader.fieldnames]
            q_key = next(
                (reader.fieldnames[i] for i, f in enumerate(fields_lower)
                 if f in ("question", "query", "q")), None
            )
            gt_key = next(
                (reader.fieldnames[i] for i, f in enumerate(fields_lower)
                 if f in ("ground_truth", "answer", "expected", "gt", "reference")), None
            )

            if not q_key or not gt_key:
                raise ValueError(
                    f"CSV must have 'question' and 'ground_truth' columns. "
                    f"Found: {reader.fieldnames}"
                )

            for row in reader:
                q = row.get(q_key, "").strip()
                gt = row.get(gt_key, "").strip()
                if q and gt:
                    questions.append(q)
                    ground_truths.append(gt)

    except Exception as e:
        raise ValueError(f"Error reading evaluation CSV: {e}")

    return questions, ground_truths
