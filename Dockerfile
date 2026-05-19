# ══════════════════════════════════════════════════════════════════════════════
#  DocIntel RAG Platform — Production Dockerfile
#  Multi-stage build: React frontend → FastAPI backend → Single container
#  Deploys on HuggingFace Spaces (Docker SDK, port 7860)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build React Frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build
# Output: /frontend/dist (configured via vite.config.js → ../backend/static won't work here,
# so we use default dist and copy in stage 2)

# ── Stage 2: Production Python Backend ────────────────────────────────────────
FROM python:3.11-slim

# Install system dependencies for PDF parsing and Postgres
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (cached layer — only rebuilds when requirements.txt changes)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY backend/ ./backend/
COPY data/ ./data/

# Copy built React frontend into backend/static (FastAPI serves it)
COPY --from=frontend-builder /backend/static ./backend/static

# Create models directory (ephemeral — fine-tuned models are in DB)
RUN mkdir -p /app/models

# ── HuggingFace Spaces requires non-root user with uid 1000 ──────────────────
RUN useradd -m -u 1000 user && \
    chown -R user:user /app
USER user

# Pre-cache HuggingFace models directory
ENV HF_HOME=/app/.cache/huggingface
RUN mkdir -p /app/.cache/huggingface

EXPOSE 7860

# ── Environment defaults (overridden by HF Spaces secrets) ────────────────────
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=7860
ENV PYTHONUNBUFFERED=1

WORKDIR /app/backend

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:7860/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
