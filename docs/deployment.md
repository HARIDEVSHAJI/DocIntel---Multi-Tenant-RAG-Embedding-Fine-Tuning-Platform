# 🚀 DocIntel RAG Platform — Deployment Guide

> Step-by-step guide to deploy DocIntel on **HuggingFace Spaces** (Docker) with **Aiven PostgreSQL**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Step 1 — Set Up Aiven PostgreSQL](#2-step-1--set-up-aiven-postgresql)
3. [Step 2 — Create HuggingFace Space](#3-step-2--create-huggingface-space)
4. [Step 3 — Push Your Code to HuggingFace](#4-step-3--push-your-code-to-huggingface)
5. [Step 4 — Add Secrets in HuggingFace](#5-step-4--add-secrets-in-huggingface)
6. [Step 5 — Wait for Build & Test](#6-step-5--wait-for-build--test)
7. [Troubleshooting](#7-troubleshooting)
8. [What Files Get Pushed?](#8-what-files-get-pushed)
9. [Updating After Deployment](#9-updating-after-deployment)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    HuggingFace Spaces                            │
│                 (Docker Container, Free Tier)                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  FastAPI (port 7860)                                    │     │
│  │  ├── /api/*  → Backend API (Python)                     │     │
│  │  └── /*      → React SPA (static HTML/JS/CSS)           │     │
│  └─────────────────────────────────────────────────────────┘     │
│                           │                                      │
│                     SSL connection                                │
│                           │                                      │
│              ┌────────────▼────────────┐                         │
│              │  Aiven PostgreSQL       │                         │
│              │  (pgvector extension)   │                         │
│              │  External managed DB    │                         │
│              └─────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

**What goes where:**
- **HuggingFace Spaces** → Your entire app (frontend + backend) in one Docker container
- **Aiven PostgreSQL** → All your data (users, workspaces, documents, chat history, metrics, fine-tuned models)
- **Groq API** → LLM inference (external, free tier)

---

## 2. Step 1 — Set Up Aiven PostgreSQL

### 1.1 Create an Aiven Account
1. Go to [https://aiven.io](https://aiven.io)
2. Sign up (Google, GitHub, or email)
3. You get a **free tier** — no credit card needed

### 1.2 Create a PostgreSQL Service
1. Click **Create Service**
2. Choose **PostgreSQL**
3. Plan: **Free** (or Hobbyist if available)
4. Cloud: Pick the closest region to you
5. Click **Create Service**
6. Wait 1-2 minutes for it to provision

### 1.3 Enable pgvector Extension
> ⚠️ **This is critical!** Your app stores document embeddings as vectors.

1. Go to your PostgreSQL service page
2. Click **Extensions** (or **Advanced Configuration**)
3. Search for `vector`
4. Click **Enable** on the `vector` extension
5. If you don't see it in the UI, connect via terminal and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

### 1.4 Get Your Connection URI
1. On your service page, find the **Connection information** section
2. Copy the **Service URI** — it looks like:
   ```
   postgresql://avnadmin:YOUR_PASSWORD@your-service-name-project.aivencloud.com:12345/defaultdb?sslmode=require
   ```
3. **Save this URI** — you'll need it in Step 4

> 💡 **Tip:** The `?sslmode=require` at the end is important. Aiven requires SSL connections. Our code handles this automatically.

---

## 3. Step 2 — Create HuggingFace Space

### 2.1 Create a HuggingFace Account
1. Go to [https://huggingface.co](https://huggingface.co)
2. Sign up (free)

### 2.2 Create a New Space
1. Click your **profile icon** → **New Space**
2. Fill in:
   - **Space name:** `docintel` (or any name you want)
   - **License:** MIT
   - **SDK:** ⚡ **Docker** ← Very important! NOT Gradio, NOT Streamlit
   - **Hardware:** **CPU Basic (Free)** — 2 vCPU, 16GB RAM
3. Click **Create Space**

> The Space will show "Building" with an error initially — that's fine, it has no code yet.

### 2.3 Get Your Space's Git URL
After creating, you'll see a page with instructions. Your git URL is:
```
https://huggingface.co/spaces/YOUR_USERNAME/docintel
```

---

## 4. Step 3 — Push Your Code to HuggingFace

> 🎯 **You do NOT need to create a new folder or copy files manually.** Git + `.gitignore` handles everything. The `.gitignore` already excludes `venv/`, `node_modules/`, `.env`, `__pycache__/`, `backend/static/`, etc.

### Option A: Push from your existing project (Recommended)

Open a terminal in your project root (`d:\projects\rag-v2-full\rag-v2`):

```bash
# 1. Initialize git if not already done
git init

# 2. Add ALL files (gitignore auto-excludes venv, node_modules, .env, etc.)
git add .

# 3. Check what will be committed (verify no secrets or large files)
git status

# 4. Commit
git commit -m "feat: initial deployment"

# 5. Add HuggingFace as remote
git remote add hf https://huggingface.co/spaces/YOUR_USERNAME/docintel

# 6. Push to HuggingFace (it will ask for your HF credentials)
git push hf main
```

> 💡 **HuggingFace credentials:** When prompted, use:
> - Username: Your HuggingFace username
> - Password: A **User Access Token** (NOT your account password)
>   - Get it from: HuggingFace → Settings → Access Tokens → New Token (Write permission)

### Option B: Clone HF Space first, then copy files

If Option A doesn't work (e.g., you already have a different git remote):

```bash
# 1. Clone the empty HF Space
git clone https://huggingface.co/spaces/YOUR_USERNAME/docintel
cd docintel

# 2. Copy project files (PowerShell on Windows)
# This copies everything EXCEPT what should be excluded
$source = "d:\projects\rag-v2-full\rag-v2"
$exclude = @("venv", "node_modules", "__pycache__", ".env", "backend\static", ".cursor", "*.log", "*.pyc")

# Copy backend (without venv and __pycache__)
Copy-Item -Path "$source\backend" -Destination ".\backend" -Recurse -Force
Remove-Item -Recurse -Force ".\backend\venv" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\backend\__pycache__" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\backend\static" -ErrorAction SilentlyContinue
Remove-Item -Force ".\backend\.env" -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\backend" -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

# Copy frontend (without node_modules)
Copy-Item -Path "$source\frontend" -Destination ".\frontend" -Recurse -Force
Remove-Item -Recurse -Force ".\frontend\node_modules" -ErrorAction SilentlyContinue

# Copy root files
Copy-Item "$source\Dockerfile" ".\"
Copy-Item "$source\README.md" ".\"
Copy-Item "$source\.gitignore" ".\"
Copy-Item "$source\docker-compose.yml" ".\"
Copy-Item "$source\PROJECT_DOCUMENTATION.md" ".\"

# Copy data directory
Copy-Item -Path "$source\data" -Destination ".\data" -Recurse -Force

# 3. Verify no secrets leaked
# CHECK: backend/.env should NOT exist. If it does, delete it!
Test-Path ".\backend\.env"  # Should return False

# 4. Commit and push
git add .
git commit -m "feat: initial deployment"
git push
```

### What gets pushed? What stays behind?

| ✅ Pushed to Git | ❌ Excluded by .gitignore |
|---|---|
| `backend/*.py`, `backend/routers/`, `backend/core/`, `backend/db/`, `backend/src/` | `backend/venv/` (200MB+ Python packages) |
| `backend/requirements.txt`, `backend/.env.example` | `backend/.env` (your secrets!) |
| `frontend/src/`, `frontend/package.json`, `frontend/vite.config.js` | `frontend/node_modules/` (300MB+ npm packages) |
| `Dockerfile`, `README.md`, `.gitignore` | `backend/static/` (build output — Docker builds this) |
| `data/sample_*.csv` | `__pycache__/`, `*.log`, `*.pyc` |

> The Docker build on HuggingFace will install `node_modules` and Python packages fresh from `package.json` and `requirements.txt`. That's why you don't push them.

---

## 5. Step 4 — Add Secrets in HuggingFace

After pushing, go to your Space page on HuggingFace:

1. Click the **Settings** tab (⚙️ gear icon)
2. Scroll down to **Variables and Secrets**
3. Add these **3 secrets** (click "New Secret" for each):

| Secret Name | Value | Where to Get It |
|-------------|-------|-----------------|
| `GROQ_API_KEY` | `gsk_pEAAF49g...` (your real key) | [console.groq.com](https://console.groq.com) → API Keys |
| `DATABASE_URL` | `postgresql://avnadmin:...?sslmode=require` | Aiven dashboard → Connection info |
| `JWT_SECRET_KEY` | A long random string | Run in terminal: `python -c "import secrets; print(secrets.token_urlsafe(64))"` |

> ⚠️ **After adding secrets, the Space will automatically restart and rebuild.**

### Generate a strong JWT secret (run this locally):
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```
Copy the output and paste it as the `JWT_SECRET_KEY` secret value.

---

## 6. Step 5 — Wait for Build & Test

### 6.1 Watch the Build
1. Go to your Space page
2. You'll see a **Building** status with a log viewer
3. The build takes **5-8 minutes** on the first run:
   - Stage 1: Installing npm packages + building React (~2 min)
   - Stage 2: Installing Python packages (~3-5 min)
4. After build, the container starts and downloads ML models (~350MB, cached after first time)

### 6.2 First Startup
The first startup takes an extra **2-3 minutes** because it downloads 3 AI models:
- `sentence-transformers/all-MiniLM-L6-v2` (embedding model)
- `cross-encoder/ms-marco-MiniLM-L-6-v2` (reranker)
- `cross-encoder/nli-deberta-v3-small` (hallucination detector)

These are cached — subsequent restarts are fast (~30 seconds).

### 6.3 Test Your Deployment
Once the status shows **Running**, click the Space URL:
```
https://YOUR_USERNAME-docintel.hf.space
```

Test these in order:
1. ✅ **Register** — Create an account (first user)
2. ✅ **Login** — Log in with your credentials  
3. ✅ **Create Workspace** — On the Workspace page
4. ✅ **Upload a PDF** — Index it under the workspace
5. ✅ **Chat** — Ask a question about the uploaded document
6. ✅ **Training** — Try auto-generating training pairs and fine-tuning
7. ✅ **Evaluation** — Run auto-evaluation

---

## 7. Troubleshooting

### Build fails with "No space left on device"
Your Docker image might be too large for the free tier. This shouldn't happen with our optimized Dockerfile, but if it does:
- Check the build logs for which layer is large
- Consider removing `data/` from the Docker image

### "Connection refused" or "Database error" on startup
- Verify your `DATABASE_URL` secret is correct
- Make sure `?sslmode=require` is at the end
- Check that pgvector extension is enabled on Aiven

### "GROQ_API_KEY is not set"
- Go to Space Settings → Secrets → verify `GROQ_API_KEY` is set
- The key must start with `gsk_`

### Training hangs or OOM
- Free tier has 16GB RAM — should be fine
- If training OOMs, reduce epochs to 1-2

### Space goes to sleep
- Free tier Spaces sleep after 48 hours of inactivity
- They wake up automatically when someone visits (takes ~30 seconds)
- Your data is safe in Aiven PostgreSQL (not affected by sleep)

### "vector type not found" error
- You forgot to enable pgvector on Aiven
- Go to Aiven → Your Service → Extensions → Enable `vector`

### Changes not showing after push
- HF Spaces auto-rebuilds on push, wait 5-8 minutes
- Check the build logs in the Space settings

---

## 8. What Files Get Pushed?

Here's the exact structure that ends up in your HuggingFace repository:

```
docintel/
├── .gitignore
├── Dockerfile                  ← HF Spaces reads this to build
├── README.md                   ← Has YAML header for HF Spaces config
├── PROJECT_DOCUMENTATION.md
├── docker-compose.yml
│
├── backend/
│   ├── .env.example            ← Template (NOT the real .env!)
│   ├── main.py
│   ├── requirements.txt
│   ├── core/
│   │   ├── config.py
│   │   ├── dependencies.py
│   │   └── state.py
│   ├── db/
│   │   ├── database.py
│   │   └── models.py
│   ├── routers/
│   │   ├── admin.py
│   │   ├── auth.py
│   │   ├── chat.py
│   │   ├── config.py
│   │   ├── documents.py
│   │   ├── evaluation.py
│   │   ├── sessions.py
│   │   ├── system.py
│   │   ├── training.py
│   │   └── workspaces.py
│   ├── schemas/
│   │   └── ...
│   └── src/
│       ├── embeddings.py
│       ├── evaluation.py
│       ├── generation.py
│       ├── hallucination.py
│       ├── ingestion.py
│       ├── retrieval.py
│       └── training.py
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       ├── api/client.js
│       ├── components/...
│       ├── context/...
│       └── pages/...
│
└── data/
    ├── sample_training_pairs.csv
    └── sample_eval_pairs.csv
```

**NOT included** (excluded by .gitignore):
- `backend/venv/` — Python virtual environment (~200MB)
- `backend/.env` — Your secrets!
- `backend/static/` — Build output (Docker builds this)
- `frontend/node_modules/` — npm packages (~300MB)
- `__pycache__/` — Python cache files
- `models/` — FAISS indexes, fine-tuned models
- `.cursor/` — IDE config

---

## 9. Updating After Deployment

Whenever you make changes locally and want to update the deployed version:

```bash
# From your project root
git add .
git commit -m "fix: description of change"
git push hf main
```

HuggingFace will automatically rebuild and redeploy. Takes 5-8 minutes.

> 💡 **Your database data is preserved** — only the code changes. All users, workspaces, documents, and chat history in Aiven remain untouched.

---

## Quick Reference

| What | Value |
|------|-------|
| **Live URL** | `https://YOUR_USERNAME-docintel.hf.space` |
| **HF Space Type** | Docker SDK |
| **Port** | 7860 (configured in Dockerfile) |
| **Database** | Aiven PostgreSQL with pgvector |
| **LLM API** | Groq (free tier — 14,400 req/day) |
| **Required Secrets** | `GROQ_API_KEY`, `DATABASE_URL`, `JWT_SECRET_KEY` |
| **First build time** | ~5-8 minutes |
| **First startup time** | ~2-3 minutes (ML model download) |
| **Subsequent starts** | ~30 seconds |

---

*Last updated: May 2026*
