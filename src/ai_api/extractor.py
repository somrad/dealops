import os
import time
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel, Field

from agentkit import ModelFactory
from agentkit.logging import setup_logger

# FR-5: pull structured payment/settlement details out of a document. Unlike
# the classifier (rule-based on purpose), this genuinely needs an LLM — bank
# details are described in whatever prose a document happens to use. Reuses
# the same swap-later shape though: one function, plain data in and out.

# Shared with the backend's own logging — one "logs" folder at the src/ level,
# not nested inside ai_api specifically (agentkit's own LOG_DIR constant
# would put it one level too deep for that).
_LOG_DIR = str(Path(__file__).parent.parent / "logs")
logger = setup_logger("ai_api.extractor", log_dir=_LOG_DIR, console=True, file=True)

MODEL_NAME = os.getenv("CHEAP_MODEL_NAME", "unknown")
MODEL_PROVIDER = os.getenv("CHEAP_MODEL_PROVIDER", "unknown")


class PaymentDetail(BaseModel):
    account_holder_name: Optional[str] = Field(None, description="Legal name of the account holder")
    bank_name: Optional[str] = Field(None, description="Name of the bank, if stated")
    account_number: str = Field(description="Bank account / settlement account number")
    routing_number: str = Field(description="ABA routing number")


class PaymentDetailsResult(BaseModel):
    parties: List[PaymentDetail] = Field(default_factory=list)


_factory = ModelFactory()
# .cheap() — this is straightforward structured extraction, not a task that
# needs the "smart" tier. Provider/model come from ai_api/.env, so switching
# LLM providers later is a config change, not a code change.
_extraction_llm = _factory.cheap().with_structured_output(PaymentDetailsResult)


def extract_payment_details(text: str) -> List[dict]:
    if not text.strip():
        return []

    prompt = (
        "Extract every bank account and its ABA routing number mentioned in this document, "
        "along with the account holder's legal name and bank name if stated. "
        "If the document contains no account/routing number pair, return an empty list. "
        "Do not invent values that aren't in the text.\n\n"
        f"---\n{text}"
    )

    logger.info(f"LLM call starting | provider={MODEL_PROVIDER} model={MODEL_NAME} | chars={len(text)}")
    started = time.monotonic()
    result = _extraction_llm.invoke(prompt)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"LLM call complete | {len(result.parties)} part(y/ies) found | {elapsed_ms}ms")

    return [p.model_dump() for p in result.parties]
