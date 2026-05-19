"""
ingestion.py — Document parsing and text chunking.
Supports PDF (via PyMuPDF) and plain TXT files.
"""

import os
from typing import List, Tuple

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


def parse_pdf(file_path: str) -> str:
    """Extract all text from a PDF file using PyMuPDF."""
    if not PYMUPDF_AVAILABLE:
        raise ImportError("PyMuPDF not installed. Run: pip install PyMuPDF")
    try:
        doc = fitz.open(file_path)
        pages_text = []
        for page_num, page in enumerate(doc):
            text = page.get_text("text")
            if text.strip():
                pages_text.append(f"[Page {page_num + 1}]\n{text}")
        doc.close()
        return "\n\n".join(pages_text)
    except Exception as e:
        raise ValueError(f"Failed to parse PDF '{os.path.basename(file_path)}': {str(e)}")


def parse_text_file(file_path: str) -> str:
    """Extract text from a plain text file."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception as e:
        raise ValueError(f"Failed to read text file '{os.path.basename(file_path)}': {str(e)}")


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split text into overlapping chunks using a recursive paragraph-first strategy.
    Falls back to sentence splitting, then character splitting.
    """
    if not text or not text.strip():
        return []

    chunks = []

    # Step 1: split by double newlines (paragraphs)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    current_chunk = ""

    for para in paragraphs:
        # If adding this paragraph stays within chunk_size, append it
        if len(current_chunk) + len(para) + 2 <= chunk_size:
            current_chunk = (current_chunk + "\n\n" + para).strip()
        else:
            # Save current chunk if non-empty
            if current_chunk:
                chunks.append(current_chunk.strip())
                # Carry overlap from end of current chunk
                words = current_chunk.split()
                overlap_word_count = max(1, overlap // 6)
                overlap_text = " ".join(words[-overlap_word_count:])
                current_chunk = overlap_text + "\n\n" + para
            else:
                # Paragraph itself is larger than chunk_size — split by sentences
                if len(para) > chunk_size:
                    sentences = para.replace(". ", ".|").replace("? ", "?|").replace("! ", "!|").split("|")
                    sub_chunk = ""
                    for sent in sentences:
                        if len(sub_chunk) + len(sent) <= chunk_size:
                            sub_chunk = (sub_chunk + " " + sent).strip()
                        else:
                            if sub_chunk:
                                chunks.append(sub_chunk.strip())
                            # If single sentence is still too long, hard-split by characters
                            if len(sent) > chunk_size:
                                for i in range(0, len(sent), chunk_size - overlap):
                                    part = sent[i: i + chunk_size].strip()
                                    if len(part) > 30:
                                        chunks.append(part)
                                sub_chunk = ""
                            else:
                                sub_chunk = sent
                    if sub_chunk:
                        current_chunk = sub_chunk
                else:
                    current_chunk = para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    # Filter out very short or empty chunks
    chunks = [c for c in chunks if len(c) >= 40]
    return chunks


def process_documents(
    files: List, chunk_size: int = 500, overlap: int = 50
) -> Tuple[List[str], List[dict]]:
    """
    Process a list of uploaded files into text chunks with metadata.

    Returns:
        all_chunks: list of text chunk strings
        metadata: list of dicts with 'source', 'chunk_id', 'char_count'
    """
    all_chunks: List[str] = []
    metadata: List[dict] = []
    errors: List[str] = []

    if not files:
        return [], []

    for file in files:
        # Gradio 4.x gives file paths as strings
        file_path = file if isinstance(file, str) else getattr(file, "name", str(file))
        filename = os.path.basename(file_path)

        try:
            ext = os.path.splitext(filename)[1].lower()
            if ext == ".pdf":
                text = parse_pdf(file_path)
            else:
                text = parse_text_file(file_path)

            if not text.strip():
                errors.append(f"⚠ {filename}: No text content found")
                continue

            chunks = chunk_text(text, chunk_size=chunk_size, overlap=overlap)

            if not chunks:
                errors.append(f"⚠ {filename}: Could not extract any chunks")
                continue

            for i, chunk in enumerate(chunks):
                all_chunks.append(chunk)
                metadata.append(
                    {
                        "source": filename,
                        "chunk_id": i,
                        "char_count": len(chunk),
                    }
                )

        except Exception as e:
            errors.append(f"❌ {filename}: {str(e)}")
            continue

    if errors:
        print("Ingestion warnings/errors:\n" + "\n".join(errors))

    return all_chunks, metadata
