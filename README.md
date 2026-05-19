---
title: DocIntel RAG Platform
emoji: 🧠
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
---

# 🧠 Document Intelligence Platform

> A production-grade RAG (Retrieval-Augmented Generation) system featuring a React + Tailwind dark UI, FastAPI backend, fine-tunable deep learning embeddings, hybrid retrieval, and NLI-based hallucination detection.

## Features

- **Upload & Index** — Drag-and-drop PDF/TXT files, chunked and embedded with sentence-transformers
- **Chat** — Ask questions about your documents with faithfulness scoring
- **Fine-Tune** — Train the embedding model on your domain data with live loss charts
- **Evaluate** — Run 4-metric RAG evaluation (Faithfulness, Relevancy, Precision, Similarity)
- **Multi-Tenant** — Workspaces, user accounts, per-workspace API keys
- **Admin Panel** — User management and global configuration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | FastAPI + Uvicorn |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 |
| Vector Search | FAISS + BM25 hybrid retrieval |
| Reranker | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| Hallucination | cross-encoder/nli-deberta-v3-small |
| LLM | Groq API (Llama 3 / Mixtral) |
| Database | PostgreSQL + pgvector |
| Deployment | Docker on HuggingFace Spaces |

## Environment Variables (HF Spaces Secrets)

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Free API key from [console.groq.com](https://console.groq.com) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (e.g. Aiven with `?sslmode=require`) |
| `JWT_SECRET_KEY` | ✅ | Random secret for JWT token signing |
| `ALLOWED_ORIGINS` | ❌ | Comma-separated CORS origins (HF Spaces auto-allowed) |

## Local Development

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

## License

MIT
