# 🧠 Document Intelligence Platform

> A production-grade RAG (Retrieval-Augmented Generation) system with a React + Tailwind dark UI, FastAPI backend, fine-tunable deep learning embeddings, hybrid retrieval, and NLI-based hallucination detection.

---

## 📌 Table of Contents

1. [What This Project Does](#what-this-project-does)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Pages & Features](#pages--features)
5. [How It Works — Architecture](#how-it-works--architecture)
6. [Prerequisites](#prerequisites)
7. [Step 1 — Get Free Groq API Key](#step-1--get-free-groq-api-key)
8. [Step 2 — Set Up the .env File](#step-2--set-up-the-env-file)
9. [Step 3 — Run Locally (Mac / Linux)](#step-3--run-locally-mac--linux)
10. [Step 4 — Run Locally (Windows)](#step-4--run-locally-windows)
11. [Step 5 — Manual Setup (if scripts fail)](#step-5--manual-setup-if-scripts-fail)
12. [Using the App](#using-the-app)
13. [API Reference](#api-reference)
14. [Deploy to HuggingFace Spaces](#deploy-to-huggingface-spaces)
15. [Troubleshooting](#troubleshooting)
16. [CV Bullet Points](#cv-bullet-points)

---

## What This Project Does

You upload any PDF or text document. The system:

1. **Parses** the document into clean text chunks
2. **Embeds** each chunk using a fine-tunable sentence-transformer deep learning model
3. **Indexes** embeddings in a FAISS vector database + BM25 keyword index
4. **Retrieves** the most relevant chunks using hybrid search (dense + sparse) and cross-encoder reranking
5. **Generates** a grounded answer using Groq's free LLM API (Llama 3 / Mixtral)
6. **Scores** the answer for hallucination using an NLI model (DeBERTa)
7. **Lets you fine-tune** the embedding model on your own Q&A data with a live loss chart
8. **Evaluates** the full pipeline across 4 metrics with a radar chart

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **UI Framework** | React 18 + Vite | Fast, component-based, hot reload |
| **Styling** | Tailwind CSS | Dark theme, utility-first, no CSS files |
| **Charts** | Recharts | Bar, Line, Radar charts in React |
| **Backend** | FastAPI + Uvicorn | Async Python API, auto docs at `/docs` |
| **Embeddings** | sentence-transformers/all-MiniLM-L6-v2 | 22MB, fast on CPU, fine-tunable |
| **Vector DB** | FAISS (faiss-cpu) | Local, no API key, fast similarity search |
| **Keyword Search** | rank-bm25 | Classic BM25, complements dense retrieval |
| **Reranker** | cross-encoder/ms-marco-MiniLM-L-6-v2 | Precision reranking of top candidates |
| **Hallucination** | cross-encoder/nli-deberta-v3-small | NLI entailment → faithfulness score |
| **LLM** | Groq API (free tier) | Llama 3 8B / Mixtral — 14,400 req/day free |
| **Training Loss** | MultipleNegativesRankingLoss | Industry-standard contrastive loss for embeddings |
| **PDF Parsing** | PyMuPDF (fitz) | Fast, accurate, handles multi-page PDFs |
| **Live Streaming** | Server-Sent Events (SSE) | Real-time training loss to frontend |
| **Env Config** | python-dotenv | Loads `.env` file automatically |
| **Deployment** | Docker + HuggingFace Spaces | Free cloud hosting |

---

## Project Structure

```
rag-v2/
│
├── .env                          ← Your secrets (GROQ_API_KEY) — never commit this
├── .env.example                  ← Template — copy to .env and fill in
├── .gitignore                    ← Ignores .env, node_modules, __pycache__, venv
├── Dockerfile                    ← For HuggingFace Spaces Docker deployment
├── README.md                     ← HuggingFace Spaces header + project info
├── run_local.sh                  ← One-command local start (Mac/Linux)
├── run_local.bat                 ← One-command local start (Windows)
├── build_and_deploy.sh           ← Build React + deploy instructions
│
├── backend/
│   ├── main.py                   ← FastAPI app — all API endpoints
│   ├── requirements.txt          ← Python dependencies (pinned versions)
│   └── src/
│       ├── __init__.py
│       ├── ingestion.py          ← PDF/TXT parsing + text chunking
│       ├── embeddings.py         ← Sentence-transformer loading + FAISS index
│       ├── retrieval.py          ← BM25 + dense search + RRF + cross-encoder rerank
│       ├── generation.py         ← Groq API call + prompt template + retry logic
│       ├── hallucination.py      ← NLI faithfulness scorer (DeBERTa)
│       ├── training.py           ← PyTorch fine-tuning loop + live loss tracking
│       └── evaluation.py        ← 4 custom RAG evaluation metrics
│
├── frontend/
│   ├── index.html                ← Entry point (loads Inter font)
│   ├── package.json              ← Node dependencies
│   ├── vite.config.js            ← Vite + proxy /api → localhost:8000
│   ├── tailwind.config.js        ← Dark theme color tokens
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx              ← React root + toast provider
│       ├── App.jsx               ← Router + sidebar layout
│       ├── index.css             ← Tailwind base + custom component classes
│       ├── api/
│       │   └── client.js         ← Axios wrapper for all API calls
│       ├── components/
│       │   ├── Sidebar.jsx       ← Dark sidebar navigation
│       │   └── ui.jsx            ← StatCard, ProgressBar, DropZone, badges, etc.
│       └── pages/
│           ├── Dashboard.jsx     ← System overview, stat cards, bar chart
│           ├── Upload.jsx        ← Drag-and-drop file indexer
│           ├── Chat.jsx          ← Chat interface with source citations
│           ├── Training.jsx      ← Fine-tuning UI with live loss chart
│           ├── Evaluation.jsx    ← Radar chart + per-question metrics table
│           └── Config.jsx        ← Settings panel + danger zone
│
├── data/
│   ├── sample_training_pairs.csv ← 20 AI/ML Q&A pairs (training works out of the box)
│   └── sample_eval_pairs.csv    ← 5 evaluation Q&A pairs (eval works out of the box)
│
└── models/
    └── fine_tuned/               ← Auto-created after training (saved model files)
```

---

## Pages & Features

### 1. Overview (Dashboard)
- 4 stat cards — documents indexed, vector count, embedding model status, API status
- Bar chart — chunks per document (color-coded per file)
- Active config summary panel
- System health checklist — backend, Groq key, index, fine-tuned model

### 2. Upload & Index
- Drag-and-drop or click-to-browse PDF and TXT files (multiple files at once)
- Chunk size slider (100–1500 chars) and overlap slider (0–200 chars)
- Progress during embedding and indexing
- Shows chunk count, embedding dimension, time taken
- Preview of first 3 chunks per file
- Index persists to disk — survives server restarts

### 3. Chat
- Dark chat interface with user and bot bubbles
- Press Enter to send, Shift+Enter for new line
- Each answer shows:
  - Full LLM-generated response with source citations
  - Faithfulness badge — 🟢 High / 🟡 Medium / 🔴 Low (with % score)
  - Collapsible source chunks with similarity scores
- Typing indicator during retrieval and generation
- Clear chat button

### 4. Model Training
- Upload a CSV with `query` and `positive_passage` columns
- Sample CSV with 20 AI/ML pairs included — works immediately
- Epochs slider (1–10)
- Live loss chart updates via Server-Sent Events (SSE) — no page refresh needed
- Stats: total steps, minimum loss, latest loss
- After training, all future retrievals automatically use the fine-tuned model

### 5. Evaluation
- Upload a CSV with `question` and `ground_truth` columns
- Sample eval CSV with 5 pairs included
- Runs the full RAG pipeline on every question
- 4 metrics computed:
  - **Faithfulness** — NLI entailment: is the answer grounded in retrieved context?
  - **Answer Relevancy** — cosine similarity between question and answer embeddings
  - **Context Precision** — mean cosine similarity of retrieved chunks to the question
  - **Answer Similarity** — semantic similarity to the ground truth answer
- Radar chart of all 4 metrics
- Per-question table with color-coded scores

### 6. Config & System
- Change LLM model (llama3-8b-8192, llama3-70b-8192, mixtral-8x7b-32768, gemma2-9b-it)
- Adjust temperature, top-k retrieval, chunk size, overlap — live without restart
- View indexed sources and chunk counts
- Danger zone — clear index, delete fine-tuned model

---

## How It Works — Architecture

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────────┐
│                   RETRIEVAL PIPELINE                 │
│                                                     │
│  Query ──► Dense Search (FAISS)  ──┐                │
│       │                            ├──► RRF Fusion  │
│       └──► Sparse Search (BM25)  ──┘        │       │
│                                             ▼       │
│                                   Cross-Encoder     │
│                                     Reranker        │
│                                        │            │
│                                    Top-K Chunks     │
└────────────────────────────────────────┼────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────┐
│                  GENERATION PIPELINE                 │
│                                                     │
│  System Prompt + Retrieved Chunks + User Query      │
│                        │                            │
│                         ▼                           │
│               Groq API (Llama 3 / Mixtral)          │
│                        │                            │
│                    LLM Answer                       │
└────────────────────────┼────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│               HALLUCINATION DETECTION                │
│                                                     │
│  NLI(Retrieved Context → Generated Answer)          │
│  DeBERTa → entailment probability → faithfulness %  │
└─────────────────────────────────────────────────────┘
```

---

## Prerequisites

Before you start, make sure these are installed:

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| Python | 3.10 or 3.11 | `python --version` | [python.org](https://python.org) |
| Node.js | 18 or 20 | `node --version` | [nodejs.org](https://nodejs.org) |
| npm | 9+ | `npm --version` | Comes with Node.js |
| Git | any | `git --version` | [git-scm.com](https://git-scm.com) |

> ⚠️ **Python 3.12 is not recommended** — some ML packages have compatibility issues. Use 3.10 or 3.11.

---

## Step 1 — Get Free Groq API Key

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up (Google or email — takes 30 seconds)
3. Click **API Keys** in the left sidebar
4. Click **Create API Key**
5. Copy the key — it starts with `gsk_`
6. Keep it safe — you will add it to `.env` next

**Free tier limits:** 14,400 requests/day, 30 requests/minute — more than enough.

---

## Step 2 — Set Up the .env File

Open the `.env` file in the project root (it was created from `.env.example`).

Replace the placeholder with your real key:

```env
GROQ_API_KEY=gsk_your_actual_key_here
```

Leave all other values as they are unless you know what you are changing:

```env
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
DEFAULT_LLM_MODEL=llama3-8b-8192
DEFAULT_CHUNK_SIZE=500
DEFAULT_CHUNK_OVERLAP=50
DEFAULT_TOP_K=5
DEFAULT_TEMPERATURE=0.1
MODELS_DIR=models
DATA_DIR=data
```

> ⚠️ Never push `.env` to GitHub. It is already listed in `.gitignore`.

---

## Step 3 — Run Locally (Mac / Linux)

Open a terminal, navigate to the project folder, and run:

```bash
cd rag-v2
bash run_local.sh
```

The script will:
1. Check that your `.env` has a real API key
2. Create a Python virtual environment in `backend/venv/`
3. Install all Python packages from `backend/requirements.txt`
4. Install Node.js packages in `frontend/node_modules/`
5. Start the FastAPI backend on `http://localhost:8000`
6. Start the React dev server on `http://localhost:3000`

**Then open your browser and go to:** `http://localhost:3000`

To stop both servers: press `Ctrl + C` in the terminal.

> **First launch takes 5–10 minutes** — it downloads 3 AI models totalling ~350MB. This only happens once. After that it starts in under 10 seconds.

---

## Step 4 — Run Locally (Windows)

**Option A — Double-click:**
Double-click `run_local.bat` in the project folder.

**Option B — Command Prompt:**
```cmd
cd rag-v2
run_local.bat
```

Two new terminal windows will open — one for the backend, one for the frontend.

**Then open your browser and go to:** `http://localhost:3000`

To stop: close both terminal windows.

---

## Step 5 — Manual Setup (if scripts fail)

If the scripts do not work on your machine, follow these steps manually.

### Backend

```bash
# Navigate to project root
cd rag-v2

# Create virtual environment
python -m venv backend/venv

# Activate it
# Mac/Linux:
source backend/venv/bin/activate
# Windows:
backend\venv\Scripts\activate

# Install Python packages
pip install --upgrade pip
pip install -r backend/requirements.txt

# Start FastAPI backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend (open a second terminal)

```bash
# Navigate to frontend folder
cd rag-v2/frontend

# Install Node packages
npm install

# Start React dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Using the App

Follow this exact order the first time:

### Step 1 — Upload Documents
1. Click **Upload** in the sidebar
2. Drag and drop any PDF or TXT file onto the upload zone
   - Try a research paper, book chapter, Wikipedia article saved as PDF, or any document you have
3. Leave chunk size at 500 and overlap at 50 (defaults are good)
4. Click **Index Documents**
5. Wait for the green status — indexing takes 10–30 seconds depending on file size
6. You will see chunk count, embedding dimension, and a preview of the first 3 chunks

### Step 2 — Chat with Your Documents
1. Click **Chat** in the sidebar
2. Type a question related to what you uploaded
3. Press **Enter** or click the send button
4. The response includes:
   - The LLM-generated answer with source citations like `[Source 1]`
   - A faithfulness badge showing how grounded the answer is
   - Collapsible source chunks — click to expand and see the exact retrieved text

### Step 3 — Fine-Tune the Embedding Model (Optional but impressive)
1. Click **Training** in the sidebar
2. The sample CSV (`data/sample_training_pairs.csv`) is ready — 20 AI/ML Q&A pairs
3. Upload it via the drop zone
4. Set epochs to 2 or 3 (fast enough on CPU)
5. Click **Start Fine-Tuning**
6. Watch the loss curve update live on the chart
7. After training, the system automatically uses your fine-tuned model for all future retrievals

### Step 4 — Evaluate the Pipeline
1. Click **Evaluation** in the sidebar
2. Upload `data/sample_eval_pairs.csv` (5 questions already provided)
3. Click **Run Evaluation**
4. Wait ~1–2 minutes (it runs the full RAG pipeline on each question)
5. See the radar chart and per-question score table

### Step 5 — Adjust Settings
1. Click **Config** in the sidebar
2. Change LLM model, temperature, top-k retrieval as needed
3. Click **Save Config** — takes effect immediately, no restart needed

---

## API Reference

The FastAPI backend exposes these endpoints. Full interactive docs at `http://localhost:8000/docs`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check — returns API key status, index status |
| `GET` | `/api/stats` | Full system stats — chunks, sources, config, model info |
| `POST` | `/api/upload` | Upload and index documents (multipart/form-data) |
| `POST` | `/api/chat` | RAG query — returns answer, sources, faithfulness score |
| `POST` | `/api/train/start` | Start fine-tuning in background thread |
| `GET` | `/api/train/stream` | SSE stream of training progress and loss values |
| `GET` | `/api/train/status` | Current training state (JSON snapshot) |
| `POST` | `/api/evaluate` | Batch evaluation — returns per-sample and aggregated metrics |
| `GET` | `/api/config` | Get current pipeline config |
| `POST` | `/api/config` | Update pipeline config |
| `DELETE` | `/api/index` | Clear FAISS index and chunk data |
| `DELETE` | `/api/model` | Delete fine-tuned model, revert to base |

Example chat request:

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is retrieval augmented generation?", "history": []}'
```

---

## Deploy to HuggingFace Spaces

Once the app works perfectly locally, deploy it with a shareable public URL.

### Step 1 — Create a HuggingFace Account
Go to [huggingface.co](https://huggingface.co) and sign up for free.

### Step 2 — Create a New Space
1. Click your profile → **New Space**
2. Fill in:
   - Space name: `rag-document-intelligence`
   - License: MIT
   - **SDK: Docker** ← important, not Gradio
   - Hardware: **CPU Basic (Free)**
3. Click **Create Space**

### Step 3 — Build the React App First

```bash
cd rag-v2/frontend
npm install
npm run build
```

This compiles React into `backend/static/` — FastAPI serves it in production.

### Step 4 — Clone and Push

```bash
git clone https://huggingface.co/spaces/YOUR_USERNAME/rag-document-intelligence
cd rag-document-intelligence

# Copy all project files here
cp -r /path/to/rag-v2/* .

# Push
git add .
git commit -m "feat: initial deployment"
git push
```

### Step 5 — Add Your API Key as a Secret
1. Go to your Space → **Settings** tab
2. Scroll to **Variables and Secrets**
3. Click **New Secret**
4. Name: `GROQ_API_KEY` | Value: `gsk_your_key_here`
5. Click Save

HuggingFace builds automatically using the `Dockerfile`. Takes 3–5 minutes on first build.

### Step 6 — Your Live URL
```
https://YOUR_USERNAME-rag-document-intelligence.hf.space
```

Put this on your CV and GitHub README. ✅

---

## Troubleshooting

### `ModuleNotFoundError: No module named 'fitz'`
```bash
pip install PyMuPDF==1.24.10
```

### `GROQ_API_KEY not set` error in the app
Open `.env` and make sure your key is set correctly. The key must start with `gsk_`. No quotes needed in `.env`.

### Chat tab says "No documents indexed"
You need to upload and index documents first in the **Upload** tab before using Chat or Evaluation.

### `Port 8000 already in use`
Another process is running on that port.

```bash
# Mac/Linux — find and kill it
lsof -i :8000
kill -9 <PID>

# Or use a different port
uvicorn main:app --port 8001
```

Then update `frontend/vite.config.js` proxy target to `http://localhost:8001`.

### `Port 3000 already in use`
```bash
# Mac/Linux
lsof -i :3000
kill -9 <PID>
```

Or change the port in `frontend/vite.config.js`:
```js
server: { port: 3001, ... }
```

### Training hangs for a long time
Normal. Training on CPU takes 3–8 minutes for 20 pairs × 3 epochs. The loss chart updates live. Do not close the tab.

### `npm: command not found`
Node.js is not installed or not in PATH. Download from [nodejs.org](https://nodejs.org) and restart your terminal.

### `python: command not found` on Mac/Linux
Try `python3` instead. On Mac you may need to install via Homebrew:
```bash
brew install python@3.11
```

### Models download very slow
The 3 AI models (~350MB total) download from HuggingFace on first run. They are cached in `~/.cache/huggingface/`. Every run after first is instant.

### HuggingFace build fails
Make sure you built the React app first (`npm run build` in `frontend/`) so `backend/static/` exists before pushing.

---

## CV Bullet Points

Copy any of these for your resume or LinkedIn:

> Built a production-grade RAG Document Intelligence Platform with a React + Tailwind dark UI, FastAPI backend, fine-tunable sentence-transformer embeddings, hybrid dense + BM25 retrieval, cross-encoder reranking, NLI-based hallucination detection, and a real-time training loss dashboard via Server-Sent Events.

> Implemented a full NLP deep learning pipeline: document ingestion → semantic chunking → FAISS vector indexing → Reciprocal Rank Fusion → cross-encoder reranking → Groq LLM generation → DeBERTa faithfulness scoring. Deployed on HuggingFace Spaces with Docker.

> Fine-tuned a sentence-transformer embedding model using MultipleNegativesRankingLoss on domain-specific Q&A pairs, achieving measurable improvement in retrieval quality evaluated via faithfulness, answer relevancy, context precision, and answer similarity metrics.

---

## Quick Reference Card

| What you want to do | Command |
|---------------------|---------|
| Start everything (Mac/Linux) | `bash run_local.sh` |
| Start everything (Windows) | `run_local.bat` |
| Start only backend | `cd backend && uvicorn main:app --reload` |
| Start only frontend | `cd frontend && npm run dev` |
| Build for production | `cd frontend && npm run build` |
| Install Python deps | `pip install -r backend/requirements.txt` |
| Install Node deps | `cd frontend && npm install` |
| View API docs | Open `http://localhost:8000/docs` |
| Open app | Open `http://localhost:3000` |

---

*Project: Document Intelligence Platform — RAG with Deep Learning*
*Stack: React · Tailwind · FastAPI · FAISS · sentence-transformers · Groq · PyTorch*
*Last updated: May 2026*
