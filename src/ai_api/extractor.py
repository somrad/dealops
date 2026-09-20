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


# The deal financial model (see funding_document.py's financial_model
# module): unlike extract_payment_details (bank/wire identity), this reads a
# document for the deal ECONOMICS — who is owed or contributing how much.
# Deliberately a separate extraction, not folded into PaymentDetail, so a
# document's financial-line identity is never accidentally coupled to
# whether its bank-detail extraction happened to succeed.

_ROLE_DESCRIPTIONS = {
    "Borrower": "the borrower(s) named in this document, and the dollar amount owed or paid to each",
    "Lenders": "the lender(s) named in this document, and the dollar amount each is contributing to the facility",
    "3rd Party Providers": "the third-party payee(s) named in this document (e.g. legal counsel, title company, appraiser), and the dollar amount owed to each",
}
_DEFAULT_ROLE_DESCRIPTION = "every party named in this document, and the dollar amount associated with each"


class DealLineItem(BaseModel):
    party_name: str = Field(description="Legal name of the party this line item is about")
    category: str = Field(description="A short label for what this amount represents, e.g. 'Principal', 'Advisory Fee', 'Upfront Fee'")
    amount: Optional[float] = Field(
        None,
        description="Dollar amount stated for this party, if any. Null if the party is named but no specific dollar figure is given for them (e.g. only a percentage share).",
    )
    currency: Optional[str] = Field(None, description="Currency code if stated, e.g. USD")


class DealLineItemsResult(BaseModel):
    items: List[DealLineItem] = Field(default_factory=list)


_line_item_llm = _factory.cheap().with_structured_output(DealLineItemsResult)


def extract_deal_line_items(text: str, folder: str) -> List[dict]:
    if not text.strip():
        return []

    role_description = _ROLE_DESCRIPTIONS.get(folder, _DEFAULT_ROLE_DESCRIPTION)
    prompt = (
        f"This document is filed under the '{folder}' category of a commercial lending deal. "
        f"Identify {role_description}. "
        "If a party is named but the document doesn't state a specific dollar amount for them "
        "(for example, it only gives a percentage share), still include them with amount set to null — "
        "do not compute or guess a dollar figure yourself. "
        "Do not invent parties or amounts that aren't in the text.\n\n"
        f"---\n{text}"
    )

    logger.info(f"LLM call starting (deal line items) | provider={MODEL_PROVIDER} model={MODEL_NAME} | folder={folder} | chars={len(text)}")
    started = time.monotonic()
    result = _line_item_llm.invoke(prompt)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"LLM call complete | {len(result.items)} line item(s) found | {elapsed_ms}ms")

    return [i.model_dump() for i in result.items]


class FundFlowLine(BaseModel):
    party_name: str = Field(description="Legal name of the party this line item is about")
    flow: str = Field(description="'source' if this is money contributed to the deal (e.g. a lender's facility amount), 'use' if this is money paid out (e.g. to the borrower, a fee, a third party)")
    role: str = Field(description="One of: borrower, lender, third_party, other")
    category: str = Field(description="A short label for what this amount represents, e.g. 'Principal', 'Advisory Fee', 'Upfront Fee'")
    amount: float = Field(description="Dollar amount for this line")
    currency: Optional[str] = Field(None, description="Currency code if stated, e.g. USD")


class FundFlowStatementResult(BaseModel):
    lines: List[FundFlowLine] = Field(default_factory=list)


_fund_flow_llm = _factory.cheap().with_structured_output(FundFlowStatementResult)


def extract_fund_flow_statement(text: str) -> List[dict]:
    # Used only when a Deal Team member UPLOADS their own settlement/closing
    # document and designates it the deal's Fund Flow Document — per the
    # founder's explicit rule, that upload becomes the authoritative source
    # of the deal's financial model, overwriting whatever the bottom-up
    # per-folder-document extraction produced.
    if not text.strip():
        return []

    prompt = (
        "This document is a deal's Fund Flow / Settlement and Closing Statement. "
        "Extract every source of funds (money contributed, e.g. by lenders) and every use of funds "
        "(money paid out, e.g. to the borrower, fees, third parties), with the party name, "
        "dollar amount, and a short category label for each. "
        "Do not invent parties or amounts that aren't in the text.\n\n"
        f"---\n{text}"
    )

    logger.info(f"LLM call starting (fund flow statement) | provider={MODEL_PROVIDER} model={MODEL_NAME} | chars={len(text)}")
    started = time.monotonic()
    result = _fund_flow_llm.invoke(prompt)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"LLM call complete | {len(result.lines)} line(s) found | {elapsed_ms}ms")

    return [l.model_dump() for l in result.lines]
