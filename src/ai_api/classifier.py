import io
import os
import time
from pathlib import Path
from typing import Literal

from pypdf import PdfReader
from pydantic import BaseModel

from agentkit import ModelFactory
from agentkit.logging import setup_logger

# FR-3: which folder does a document belong in. Was rule-based keyword
# matching; now genuinely uses an LLM, same reasoning as extractor.py —
# document wording varies too much for keywords to hold up (the earlier
# keyword version misfiled a real estate closing letter as "Borrower" just
# because the word "borrower" appeared in a sentence saying funds should NOT
# go to the borrower). Same swap-later shape though: plain data in, folder
# name out — the backend never sees how the decision was made.

_LOG_DIR = str(Path(__file__).parent.parent / "logs")
logger = setup_logger("ai_api.classifier", log_dir=_LOG_DIR, console=True, file=True)

MODEL_NAME = os.getenv("CHEAP_MODEL_NAME", "unknown")
MODEL_PROVIDER = os.getenv("CHEAP_MODEL_PROVIDER", "unknown")

# The classifiable set — "Deleted" is deliberately excluded here; a document
# only ever reaches that folder via an explicit user move (see
# backend/routes/documents.py), never a classification decision.
FOLDER_CATEGORIES = [
    "Borrower",
    "Lenders",
    "Credit Verification",
    "Funding Docs",
    "3rd Party Providers",
    "Unfiled",
]

FOLDER_GUIDE = """- Borrower: documents about the borrower — loan agreements, borrower identity, the borrower's own bank/wire details.
- Lenders: documents about a lender or lender syndicate — lender wire instructions, commitment letters, pro-rata shares.
- Credit Verification: credit reports, credit approval memos, underwriting or credit committee documents.
- Funding Docs: funding authorization letters, disbursement instructions, closing/settlement funding paperwork.
- 3rd Party Providers: documents from or about a third-party service provider to the deal — attorneys/law firms, title companies, escrow agents, appraisers, notaries — anyone who isn't the borrower, a lender, or the bank's own team.
- Unfiled: use only if the document genuinely doesn't fit any category above."""


class ClassificationResult(BaseModel):
    folder: Literal[
        "Borrower", "Lenders", "Credit Verification", "Funding Docs", "3rd Party Providers", "Unfiled"
    ]


_factory = ModelFactory()
# .cheap() — a single-label classification call doesn't need the "smart"
# tier, same reasoning as the extractor.
_classifier_llm = _factory.cheap().with_structured_output(ClassificationResult)


def extract_text(content: bytes, content_type: str, filename: str) -> str:
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""

    try:
        return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def classify_document(filename: str, text_content: str) -> dict:
    # No filename and no text at all — nothing to reason about, skip the
    # call entirely rather than asking a model to guess from nothing.
    if not filename.strip() and not text_content.strip():
        return {"folder": "Unfiled", "model_provider": None, "model_name": None}

    prompt = (
        "Classify this loan deal document into exactly one folder.\n\n"
        f"Folders:\n{FOLDER_GUIDE}\n\n"
        f"Filename: {filename}\n\n"
        f"Document text (may be partial):\n---\n{text_content[:4000]}"
    )

    logger.info(f"LLM call starting | provider={MODEL_PROVIDER} model={MODEL_NAME} | file={filename}")
    started = time.monotonic()
    result = _classifier_llm.invoke(prompt)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"LLM call complete | folder={result.folder} | {elapsed_ms}ms")

    return {
        "folder": result.folder,
        "model_provider": MODEL_PROVIDER,
        "model_name": MODEL_NAME,
    }
