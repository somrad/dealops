from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from classifier import classify_document, extract_text
from agent_skills import AGENT_COMMANDS, handle_agent_mention
from extractor import (
    extract_payment_details, extract_deal_line_items, extract_fund_flow_statement,
    MODEL_NAME, MODEL_PROVIDER,
)

app = FastAPI(title="dealops ai_api")

# Only the backend calls this service — no browser ever talks to it directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/classify-document")
async def classify_document_endpoint(file: UploadFile = File(...)):
    content = await file.read()
    text_content = extract_text(content, file.content_type, file.filename)
    return classify_document(file.filename, text_content)


@app.post("/extract-payment-details")
async def extract_payment_details_endpoint(file: UploadFile = File(...)):
    content = await file.read()
    text_content = extract_text(content, file.content_type, file.filename)
    parties = extract_payment_details(text_content)
    # extract_payment_details() skips the LLM call entirely for empty text —
    # mirror that here so the response doesn't claim a model ran when it didn't.
    call_made = bool(text_content.strip())
    return {
        "parties": parties,
        "model_provider": MODEL_PROVIDER if call_made else None,
        "model_name": MODEL_NAME if call_made else None,
    }


@app.post("/extract-deal-line-items")
async def extract_deal_line_items_endpoint(file: UploadFile = File(...), folder: str = Form(...)):
    content = await file.read()
    text_content = extract_text(content, file.content_type, file.filename)
    items = extract_deal_line_items(text_content, folder)
    call_made = bool(text_content.strip())
    return {
        "items": items,
        "model_provider": MODEL_PROVIDER if call_made else None,
        "model_name": MODEL_NAME if call_made else None,
    }


@app.post("/extract-fund-flow-statement")
async def extract_fund_flow_statement_endpoint(file: UploadFile = File(...)):
    content = await file.read()
    text_content = extract_text(content, file.content_type, file.filename)
    lines = extract_fund_flow_statement(text_content)
    call_made = bool(text_content.strip())
    return {
        "lines": lines,
        "model_provider": MODEL_PROVIDER if call_made else None,
        "model_name": MODEL_NAME if call_made else None,
    }


@app.get("/commands")
def list_commands():
    return [{"name": name, "help": info["help"]} for name, info in AGENT_COMMANDS.items()]


class DocumentContext(BaseModel):
    filename: str
    folder: str


class StandingInstructionContext(BaseModel):
    account_holder_name: Optional[str] = None
    status: str
    loan_iq_reference: Optional[str] = None


class FundFlowDocumentContext(BaseModel):
    filename: str


class DealContext(BaseModel):
    title: str
    reference: str
    product_type: str
    status: str
    member_count: int
    message_count: int
    documents: List[DocumentContext] = []
    standing_instructions: List[StandingInstructionContext] = []
    fund_flow_document: Optional[FundFlowDocumentContext] = None
    borrower_names: List[str] = []
    lender_names: List[str] = []


class AgentRespondRequest(BaseModel):
    command_text: str
    agent_name: str
    agent_username: str
    deal: DealContext


@app.post("/agent-respond")
def agent_respond(payload: AgentRespondRequest):
    reply_text = handle_agent_mention(
        payload.command_text,
        payload.agent_name,
        payload.agent_username,
        payload.deal.model_dump(),
    )
    return {"reply_text": reply_text}
