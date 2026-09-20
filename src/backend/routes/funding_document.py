import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
from models import Deal, Document, Message, User
from schemas import FundingDocumentGenerateRequest, FundingDocumentOut
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent
from routes.documents import deal_storage_path, run_extraction_pipeline
import ai_client
from activity import log_activity
from funding_document import generate_funding_document, compute_reconciliation

router = APIRouter()


def require_deal_team(current_user: User):
    if current_user.role != "deal_team":
        raise HTTPException(status_code=403, detail="Only a Deal Team member can do this")


def build_funding_document_out(db: Session, deal: Deal, storage_path: str) -> dict:
    document = None
    reconciliation = {"borrower": [], "lenders": [], "third_party": []}
    if deal.fund_flow_document_id:
        document = db.query(Document).filter(Document.id == deal.fund_flow_document_id).first()
        if document is not None:
            reconciliation = compute_reconciliation(db, deal.id, document, storage_path)
    return {"document": document, "reconciliation": reconciliation}


@router.get("/deals/{deal_id}/funding-document", response_model=FundingDocumentOut)
def get_funding_document(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = require_deal_membership(deal_id, current_user, db)
    return build_funding_document_out(db, deal, deal_storage_path(deal_id))


@router.post("/deals/{deal_id}/funding-document/generate", response_model=FundingDocumentOut)
def generate(
    deal_id: int,
    payload: FundingDocumentGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deal = require_deal_membership(deal_id, current_user, db)
    require_deal_team(current_user)
    agent = get_or_create_deal_agent(deal, db)
    storage_path = deal_storage_path(deal_id)

    generate_funding_document(
        db, deal, current_user, agent, storage_path,
        payload.loan_amount, payload.interest_rate, payload.upfront_fee, payload.legal_fee,
        interest_amount=payload.interest_amount, lead_agent_fee=payload.lead_agent_fee, currency=payload.currency,
    )
    db.refresh(deal)
    return build_funding_document_out(db, deal, storage_path)


@router.post("/deals/{deal_id}/funding-document/upload", response_model=FundingDocumentOut)
def upload(
    deal_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Same classify + extract pipeline any document upload goes through
    # (routes/documents.py) — the only difference is this one gets
    # designated as the deal's Fund Flow Document afterward, and only a
    # Deal Team member may do it.
    deal = require_deal_membership(deal_id, current_user, db)
    require_deal_team(current_user)
    agent = get_or_create_deal_agent(deal, db)
    storage_path = deal_storage_path(deal_id)

    content = file.file.read()
    extension = os.path.splitext(file.filename)[1]
    stored_filename = f"{uuid.uuid4().hex}{extension}"
    with open(os.path.join(storage_path, stored_filename), "wb") as f:
        f.write(content)

    classification = ai_client.classify_document(file.filename, content, file.content_type)
    folder = classification["folder"]
    if classification["model_name"]:
        log_activity(
            db, deal_id, "llm_call",
            f"LLM classification call on {file.filename} (model: {classification['model_provider']}/{classification['model_name']}) — filed under {folder}.",
            actor_id=agent.id,
        )

    # FR-6 applies here too: replacing the Fund Flow Document via upload is a
    # new version of whichever one this deal already pointed to, not an
    # unrelated document. Capture that BEFORE overwriting the pointer.
    previous_fund_flow_id = deal.fund_flow_document_id

    document = Document(
        deal_id=deal_id,
        uploaded_by_id=current_user.id,
        original_filename=file.filename,
        stored_filename=stored_filename,
        folder=folder,
        content_type=file.content_type,
        size_bytes=len(content),
        supersedes_id=previous_fund_flow_id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    db.add(Message(deal_id=deal_id, user_id=current_user.id, text=f'Uploaded "{file.filename}" as the Fund Flow / Settlement and Closing Document.'))
    db.commit()
    supersede_note = " — superseding the previous version" if previous_fund_flow_id else ""
    db.add(Message(
        deal_id=deal_id, user_id=agent.id,
        text=f'Filed "{file.filename}" under {folder} and set it as this deal\'s Fund Flow Document{supersede_note}.',
        level="info",
    ))
    db.commit()

    run_extraction_pipeline(db, deal_id, document, content, file.content_type, agent)

    deal.fund_flow_document_id = document.id
    db.commit()
    db.refresh(deal)

    return build_funding_document_out(db, deal, storage_path)
