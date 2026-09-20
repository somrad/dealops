import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
from models import Deal, Document, Message, User
from schemas import (
    FundingDocumentOut, FundFlowDiagramOut, DealFinancialModelOut, FillFinancialLinesRequest,
)
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent
from routes.documents import deal_storage_path, run_extraction_pipeline
import ai_client
from activity import log_activity
from funding_document import generate_funding_document, get_remittance_readiness, build_diagram_data
import financial_model

router = APIRouter()


def require_deal_team(current_user: User):
    if current_user.role != "deal_team":
        raise HTTPException(status_code=403, detail="Only a Deal Team member can do this")


def build_funding_document_out(db: Session, deal: Deal) -> dict:
    # Remittance readiness reflects the deal's CURRENT financial model +
    # SSI status at all times — deliberately not gated on a Fund Flow
    # Document existing yet. A party can be "Ready" (amount known, SSI
    # validated) before anyone has generated the settlement PDF; that's
    # useful to see early, not just after the fact.
    document = None
    if deal.fund_flow_document_id:
        document = db.query(Document).filter(Document.id == deal.fund_flow_document_id).first()
    reconciliation = get_remittance_readiness(db, deal.id)
    return {"document": document, "reconciliation": reconciliation}


@router.get("/deals/{deal_id}/funding-document", response_model=FundingDocumentOut)
def get_funding_document(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = require_deal_membership(deal_id, current_user, db)
    return build_funding_document_out(db, deal)


@router.get("/deals/{deal_id}/fund-flow-diagram", response_model=FundFlowDiagramOut)
def get_fund_flow_diagram(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Powers the Deal Map's visual fund-flow diagram — a reshape of the
    # same deal financial model the PDF and Remittances also read from.
    # See build_diagram_data() in funding_document.py.
    deal = require_deal_membership(deal_id, current_user, db)
    return build_diagram_data(db, deal)


@router.get("/deals/{deal_id}/financial-model", response_model=DealFinancialModelOut)
def get_financial_model(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # The Generate Fund Flow Document panel's data source: every line item
    # known so far (extracted or manually entered), and what's still
    # missing — the "ask only for what's missing" form reads this.
    require_deal_membership(deal_id, current_user, db)
    model = financial_model.get_deal_financial_model(db, deal_id)
    if not model["has_lines"]:
        # Lazily backfill from documents already on file (e.g. uploaded
        # before this feature existed) rather than showing an empty model
        # when there's real data to derive it from.
        financial_model.sync_all_financial_lines_for_deal(db, deal_id)
        model = financial_model.get_deal_financial_model(db, deal_id)
    return model


@router.post("/deals/{deal_id}/financial-model/fill", response_model=DealFinancialModelOut)
def fill_financial_model(
    deal_id: int,
    payload: FillFinancialLinesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_deal_membership(deal_id, current_user, db)
    require_deal_team(current_user)
    for fill in payload.fills:
        financial_model.fill_missing_line(db, deal_id, fill.line_id, fill.amount, current_user)
    return financial_model.get_deal_financial_model(db, deal_id)


@router.post("/deals/{deal_id}/funding-document/generate", response_model=FundingDocumentOut)
def generate(
    deal_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # No body anymore — this reads the deal's financial model directly.
    # Fill in missing amounts first via /financial-model/fill.
    deal = require_deal_membership(deal_id, current_user, db)
    require_deal_team(current_user)
    agent = get_or_create_deal_agent(deal, db)
    storage_path = deal_storage_path(deal_id)

    try:
        generate_funding_document(db, deal, current_user, agent, storage_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.refresh(deal)
    return build_funding_document_out(db, deal)


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
    # Deal Team member may do it. Per the founder's explicit rule, an
    # UPLOADED Fund Flow Document is authoritative — it REPLACES the deal's
    # whole financial model (financial_model.sync_financial_lines_from_fund_flow_document),
    # not just contributes to it like a normal Borrower/Lenders document does.
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

    # Bank/wire identity extraction still runs (so an uploaded settlement
    # statement's own account numbers can back Standing Instructions too).
    run_extraction_pipeline(db, deal_id, document, content, file.content_type, agent)

    # Deal economics: this upload REPLACES the financial model, not just
    # this document's own contribution to it (see module docstring above).
    ff_result = ai_client.extract_fund_flow_statement(file.filename, content, file.content_type)
    financial_model.sync_financial_lines_from_fund_flow_document(db, deal, document, ff_result["lines"])
    if ff_result["model_name"]:
        log_activity(
            db, deal_id, "llm_call",
            f"LLM fund-flow-statement extraction on {file.filename} (model: {ff_result['model_provider']}/{ff_result['model_name']}) — "
            f"found {len(ff_result['lines'])} line item(s), replacing this deal's financial model.",
            actor_id=agent.id,
        )

    deal.fund_flow_document_id = document.id
    db.commit()
    db.refresh(deal)

    return build_funding_document_out(db, deal)
