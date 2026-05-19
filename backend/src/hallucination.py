"""
hallucination.py — NLI-based faithfulness / hallucination detection.

Uses a cross-encoder trained on Natural Language Inference (NLI) to check
whether the generated answer is entailed by the retrieved context.

Label order for cross-encoder/nli-deberta-v3-small:
  Index 0 → contradiction
  Index 1 → entailment
  Index 2 → neutral

Faithfulness score = max entailment probability across top retrieved chunks.
Score ∈ [0, 1]:  high = answer is grounded,  low = possible hallucination.
"""

from typing import List, Tuple

import numpy as np
from sentence_transformers import CrossEncoder

# ─── Constants ────────────────────────────────────────────────────────────────
NLI_MODEL_NAME = "cross-encoder/nli-deberta-v3-small"
_nli_cache: dict = {}

# Label thresholds
HIGH_THRESHOLD = 0.65
LOW_THRESHOLD = 0.35


# ─── Model Loading ─────────────────────────────────────────────────────────────
def get_nli_model() -> CrossEncoder:
    """Load and cache the NLI cross-encoder model."""
    if NLI_MODEL_NAME not in _nli_cache:
        print(f"Loading NLI model: {NLI_MODEL_NAME}")
        _nli_cache[NLI_MODEL_NAME] = CrossEncoder(NLI_MODEL_NAME)
        print("NLI model loaded.")
    return _nli_cache[NLI_MODEL_NAME]


# ─── Scoring ──────────────────────────────────────────────────────────────────
def score_faithfulness(answer: str, context_chunks: List[str]) -> float:
    """
    Score how faithful the generated answer is to the retrieved context.

    Strategy: for each context chunk, compute NLI(chunk → answer).
    Faithfulness = max entailment score across all checked chunks.

    Args:
        answer: LLM-generated answer string
        context_chunks: list of retrieved text chunks used as context

    Returns:
        Faithfulness score in [0.0, 1.0]
    """
    if not answer or not answer.strip():
        return 0.0
    if not context_chunks:
        return 0.0

    try:
        model = get_nli_model()

        # Check up to the top 3 most relevant chunks
        chunks_to_check = context_chunks[:3]
        pairs = [(chunk, answer) for chunk in chunks_to_check]

        # apply_softmax=True gives class probabilities summing to 1
        scores = model.predict(pairs, apply_softmax=True)
        # scores shape: (N, 3) — [contradiction, entailment, neutral]

        entailment_scores = scores[:, 1]  # index 1 = entailment
        faithfulness = float(np.max(entailment_scores))
        return round(faithfulness, 4)

    except Exception as e:
        print(f"Hallucination scoring error: {e}")
        return 0.5  # neutral fallback — don't mislead the user


# ─── Label Helpers ─────────────────────────────────────────────────────────────
def get_faithfulness_label(score: float) -> Tuple[str, str]:
    """
    Convert a faithfulness score to a human-readable label and color hex.

    Returns:
        (label_text, color_hex)
    """
    if score >= HIGH_THRESHOLD:
        return (f"🟢 High Faithfulness ({score:.0%})", "#27500A")
    elif score >= LOW_THRESHOLD:
        return (f"🟡 Medium Faithfulness ({score:.0%})", "#633806")
    else:
        return (f"🔴 Low Faithfulness — Possible Hallucination ({score:.0%})", "#791F1F")


def format_score_badge(score: float) -> str:
    """Return a markdown-formatted badge string for the Gradio chatbot."""
    label, _ = get_faithfulness_label(score)
    return label
