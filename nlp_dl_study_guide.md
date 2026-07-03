# DocIntel — Advanced NLP & Deep Learning Viva Study Guide

This expanded guide provides an in-depth, university-level breakdown of every Natural Language Processing (NLP) and Deep Learning (DL) concept in your platform. It is structured to help you answer both high-level architectural questions and deep mathematical/technical questions during a rigorous viva.

---

## 1. The Core Architecture: Transformers (Encoder vs Decoder)

**What is it?**  
The entire platform relies on the **Transformer Architecture** (introduced in "Attention Is All You Need", 2017). Transformers use **Self-Attention** mechanisms to weigh the importance of different words in a sentence, regardless of their distance from each other.

**How it is used in DocIntel:**
Your project utilizes both sides of the Transformer architecture:
1. **Encoder-only Models (BERT-family):** Used for understanding text. 
   - `sentence-transformers/all-MiniLM-L6-v2` (for Embeddings)
   - `cross-encoder/ms-marco-MiniLM-L-6-v2` (for Reranking)
   - `cross-encoder/nli-deberta-v3-small` (for Hallucination Detection)
2. **Decoder-only Models (GPT-family):** Used for generating text.
   - `Llama-3.1-8b-instant` (via Groq API, for Answer Generation & Query Rewriting)

### ❓ Viva Questions:
* **Q: What is the difference between an Encoder and a Decoder in Transformers?**
  * *A:* Encoders have **bidirectional self-attention**, meaning they can look at the entire sentence at once (past and future words) to build a deep contextual representation of the text. This makes them perfect for classification or embeddings. Decoders use **masked (unidirectional) self-attention**, meaning they can only look at past words. This makes them perfect for auto-regressive generation (predicting the next word).
* **Q: What is Self-Attention?**
  * *A:* It's a mechanism where each word in an input sequence creates three vectors: Query (Q), Key (K), and Value (V). The attention score is calculated as `softmax(Q * K^T / sqrt(d_k)) * V`. It allows the model to determine which other words in the sentence are most relevant to the current word (e.g., resolving that "bank" relates to "money" rather than "river").

---

## 2. Text Pre-processing: Chunking and Tokenization

**What is it?**  
Before neural networks can process documents, the text must be chunked into manageable sizes and tokenized into numbers.

**Where is it used?**  `backend/src/ingestion.py`

**Chunking Strategy:**  
We use **Recursive Paragraph-First Chunking** (default 500 chars, 50 char overlap). 
- **Why Overlap?** If a concept starts at the end of chunk A and finishes at the beginning of chunk B, a hard split destroys the meaning. Overlap ensures context continuity across chunk boundaries.

**Tokenization:**
- The embedding models use **WordPiece** tokenization (breaking "unhappiness" into "un", "##happi", "##ness").
- Llama 3 uses **Byte-Pair Encoding (BPE)**.

### ❓ Viva Questions:
* **Q: Why don't we feed the entire document into the LLM or embedding model at once?**
  * *A:* Because of the **Context Window Limitation** and **Quadratic Time Complexity**. In a Transformer, the self-attention mechanism scales $O(N^2)$ with respect to sequence length $N$. Feeding a 100-page PDF would cause the memory requirements to explode. Furthermore, embedding a whole document into a single vector dilutes the specific details (the "needle in a haystack" problem).
* **Q: How does WordPiece handle Out-Of-Vocabulary (OOV) words?**
  * *A:* Instead of treating unknown words as an `<UNK>` token (which loses information), WordPiece breaks the word down into known sub-word units. For example, a rare medical term might be broken into known prefixes and suffixes.

---

## 3. Dense Vector Embeddings & Mathematics

**What is it?**  
`all-MiniLM-L6-v2` maps text into a 384-dimensional dense vector space. 

**Mathematical Intuition:**  
In `backend/src/embeddings.py`, we set `normalize_embeddings=True`. This applies **L2 Normalization** to every vector, ensuring that the length (magnitude) of every vector is exactly 1.

### ❓ Viva Questions:
* **Q: Why do we apply L2 Normalization to our embeddings?**
  * *A:* Normalization projects all vectors onto a unit hypersphere. When vectors are L2-normalized, the **Euclidean distance**, **Cosine Similarity**, and **Dot Product** all rank vectors in the exact same order. Because calculating a Dot Product is computationally much cheaper (just element-wise multiplication and addition) than calculating Cosine Similarity (which requires calculating magnitudes), we normalize first and use Dot Product to speed up the database search in `pgvector`.
* **Q: What is the "Curse of Dimensionality" in vector search?**
  * *A:* As the number of dimensions increases (e.g., 384 to 1536), the distance between any two random points in space becomes roughly the same, making nearest-neighbor search less meaningful. MiniLM's 384 dimensions strike a good balance between retaining semantic meaning and avoiding extreme high-dimensional sparsity.

---

## 4. Hybrid Retrieval & Reciprocal Rank Fusion (RRF)

**What is it?**  
The system uses both **Dense Retrieval** (semantic meaning via pgvector) and **Sparse Retrieval** (lexical/keyword matching via BM25).

**Where is it used?** `backend/src/retrieval.py`

**The BM25 Algorithm (TF-IDF evolved):**  
Unlike standard TF-IDF, BM25 uses **Term Frequency Saturation**. In TF-IDF, if a word appears 10 times, it's 10x more relevant. In BM25, the relevance curve flattens out—appearing 5 times is better than 1 time, but appearing 100 times isn't much better than appearing 10 times. It prevents keyword stuffing from breaking the search.

**Reciprocal Rank Fusion (RRF):**  
`RRF_Score = 1 / (60 + rank)`

### ❓ Viva Questions:
* **Q: If Dense retrieval (embeddings) uses AI, why do we still need old algorithms like BM25?**
  * *A:* Embeddings are trained to cluster concepts, which makes them bad at exact string matching. If a user asks for "Error code 0x80040154", an embedding model might return documents about "software bugs" (conceptually similar), missing the exact code. BM25 catches exact lexical matches. Hybrid retrieval gives us the best of both.
* **Q: Why use Rank Fusion instead of just adding the Cosine Score and the BM25 Score together?**
  * *A:* Cosine similarity produces scores strictly between -1 and 1. BM25 is an unbounded probabilistic score (can be 0, 15, or 100). You cannot add them directly because BM25 would completely overpower the cosine score. RRF ignores the raw numbers and uses only the *rank position*, providing a mathematically sound way to merge disparate scoring systems.

---

## 5. Cross-Encoder Reranking

**What is it?**  
We take the top 20 results from RRF and pass them through `ms-marco-MiniLM-L-6-v2` to get a precise relevance score.

### ❓ Viva Questions:
* **Q: Deep Learning structurally, what is the difference between the Bi-Encoder we used for search and the Cross-Encoder we use for reranking?**
  * *A:* A **Bi-Encoder** passes the Query and Document through the Transformer separately to get two vectors, then compares them via dot product. A **Cross-Encoder** concatenates the Query and Document together (`[CLS] Query [SEP] Document [SEP]`) and passes the whole sequence through the Transformer. This allows "Cross-Attention"—words in the query can directly attend to words in the document at every layer of the network.
* **Q: Why don't we use the Cross-Encoder for the entire search?**
  * *A:* $O(N)$ complexity. For 10,000 documents, a Bi-Encoder takes 1 dot-product calculation. A Cross-Encoder would require running the Transformer neural network 10,000 times, which would take minutes per query. We use the Bi-encoder for fast approximate filtering, and the Cross-encoder for precise reranking.

---

## 6. Hallucination Detection via Natural Language Inference (NLI)

**What is it?**  
NLI is a foundational NLP classification task determining if a **Premise** entails a **Hypothesis**.
We use `nli-deberta-v3-small`.

**Where is it used?** `backend/src/hallucination.py`

### ❓ Viva Questions:
* **Q: How does DocIntel detect hallucinations without needing a human evaluator?**
  * *A:* By framing hallucination detection as an NLI problem. The retrieved document chunk is the *Premise*. The LLM's generated answer is the *Hypothesis*. We feed both into the DeBERTa Cross-Encoder. If the model outputs high probability for "Entailment" (>0.65), the answer is grounded in the text. If it outputs "Contradiction" or "Neutral" (<0.35), the LLM has generated facts not present in the document (hallucination).
* **Q: Why use DeBERTa instead of BERT for NLI?**
  * *A:* DeBERTa (Decoding-enhanced BERT with disentangled attention) improves upon BERT by representing each word using two vectors: one for content and one for position. This "disentangled attention" makes it significantly better at understanding complex syntactic relationships, achieving state-of-the-art results on NLI benchmarks.

---

## 7. Contrastive Learning: Fine-Tuning Embeddings

**What is it?**  
Adapting the embedding vector space to domain-specific jargon using `MultipleNegativesRankingLoss` (MNRL).

**Where is it used?** `backend/src/training.py`

### ❓ Viva Questions:
* **Q: Explain the intuition behind Multiple Negatives Ranking Loss (MNRL).**
  * *A:* MNRL is based on InfoNCE loss (used in self-supervised learning like SimCLR). In a batch of $B$ query-document pairs, for a given query, its matching document is the positive example, and the other $B-1$ documents in the batch are treated as "in-batch negatives." The loss applies a Softmax function over the dot products. It forces the model to pull the query vector closer to the positive document vector, while simultaneously pushing it away from all other document vectors in the batch.
* **Q: Why is MNRL highly efficient for Deep Learning training?**
  * *A:* Generating explicit "hard negative" examples (finding documents that are wrong but look similar) is very difficult and computationally expensive. By using in-batch negatives, we get $B-1$ negative examples for free at every step, requiring only a dataset of positive pairs to train highly effective models.

---

## 8. Generative AI & Prompt Engineering (LLMs)

**What is it?**  
Using Llama 3.1 8B via Groq to synthesize the final answer. 

**Where is it used?** `backend/src/generation.py`

### ❓ Viva Questions:
* **Q: We set the LLM Temperature to 0.1 in the config. What does temperature do mathematically in Deep Learning?**
  * *A:* In the final layer of the LLM, the model outputs raw logits for the next word vocabulary. To convert logits to probabilities, we use a Softmax function. Temperature scales the logits before Softmax: $p_i = \frac{\exp(logit_i / T)}{\sum \exp(logit_j / T)}$. 
  A temperature of 1.0 is standard. A high temperature (e.g., 2.0) flattens the distribution, making the model pick random, creative words. A low temperature (0.1) creates a sharp distribution, forcing the model to almost always pick the most mathematically probable word. For RAG, we want factual, deterministic answers, so we use 0.1.
* **Q: What is the purpose of Query Rewriting (Coreference Resolution)?**
  * *A:* If a user asks, "What is its purpose?", the vector database will search for the literal string "its purpose", returning useless results. We use the LLM to read the chat history and rewrite the query to "What is the Transformer's purpose?". This bridges the gap between conversational memory and stateless vector search.

---

## 9. Evaluation Metrics (Quantitative RAG Validation)

We calculate four mathematical metrics (`backend/src/evaluation.py`):

1. **Faithfulness:** Maximum NLI Entailment probability between the retrieved context and the generated answer.
2. **Answer Relevancy:** Cosine similarity between the vector of the *Question* and the vector of the *Generated Answer*.
3. **Context Precision:** Mean cosine similarity between the *Question* and all *Retrieved Chunks*. Evaluates the retriever.
4. **Answer Similarity:** Cosine similarity between the *Generated Answer* and the *Ground-Truth Answer*. Evaluates the end-to-end system.

### ❓ Viva Questions:
* **Q: Why don't we use BLEU or ROUGE scores to evaluate the RAG pipeline?**
  * *A:* BLEU and ROUGE are n-gram based metrics that measure exact string overlap. Because LLMs are generative, they rarely output the exact same phrasing as a ground-truth answer, even if the semantic meaning is 100% correct. Using Cosine Similarity on Sentence Embeddings evaluates the *semantic intent* of the answer, rather than the literal characters used.
