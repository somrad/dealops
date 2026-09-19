import os
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from database import get_db
from models import Document, Message, StandingInstruction, User
from schemas import StandingInstructionOut, StandingInstructionValidateRequest, StandingInstructionValidateResponse
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent
from routes.documents import deal_storage_path
from pdf_highlight import highlight_terms_in_pdf

router = APIRouter()


def mask_account_number(account_number: str) -> str:
    if len(account_number) <= 4:
        return "•" * len(account_number)
    return "•" * (len(account_number) - 4) + account_number[-4:]


def build_ssi_out(ssi: StandingInstruction, document: Document, db: Session) -> dict:
    # This SSI's own mini history — submitted, then approved/rejected — read
    # straight off the messages that were explicitly linked to it at
    # creation time (documents.py, this file's validate()), not guessed from
    # text. Messages predating that link (if any) just won't show here.
    activity_rows = (
        db.query(Message)
        .filter(Message.standing_instruction_id == ssi.id)
        .order_by(Message.created_at)
        .all()
    )
    return {
        "id": ssi.id,
        "document_id": ssi.document_id,
        "document_filename": document.original_filename,
        # Which folder the source document landed in (FR-3) is what "Borrower
        # vs. Lender" actually means here — there's no separate party-type
        # field, this is the natural signal already on the document.
        "document_folder": document.folder,
        "added_by": document.uploaded_by,
        "account_holder_name": ssi.account_holder_name,
        "bank_name": ssi.bank_name,
        "masked_account_number": mask_account_number(ssi.account_number),
        "status": ssi.status,
        "loan_iq_reference": ssi.loan_iq_reference,
        "submitted_at": ssi.submitted_at,
        "validated_by": ssi.validated_by,
        "validated_at": ssi.validated_at,
        "activity": [
            {"text": m.text, "level": m.level, "actor_name": m.user.name, "created_at": m.created_at}
            for m in activity_rows
        ],
    }


@router.get("/deals/{deal_id}/standing-instructions", response_model=List[StandingInstructionOut])
def list_standing_instructions(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    rows = db.query(StandingInstruction).filter(StandingInstruction.deal_id == deal_id).order_by(StandingInstruction.submitted_at).all()
    return [build_ssi_out(r, r.document, db) for r in rows]


@router.get("/deals/{deal_id}/standing-instructions/{ssi_id}/highlighted-document")
def get_highlighted_document(
    deal_id: int,
    ssi_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # The evidence view for FR-10: same source document the extraction came
    # from, with the exact spots it read from marked — never the value
    # itself, just where to look.
    require_deal_membership(deal_id, current_user, db)
    ssi = db.query(StandingInstruction).filter(
        StandingInstruction.id == ssi_id, StandingInstruction.deal_id == deal_id
    ).first()
    if ssi is None:
        raise HTTPException(status_code=404, detail="Standing instruction not found")

    document = ssi.document
    stored_path = os.path.join(deal_storage_path(deal_id), document.stored_filename)
    if not os.path.exists(stored_path):
        raise HTTPException(status_code=404, detail="File missing from storage")

    with open(stored_path, "rb") as f:
        original_bytes = f.read()

    if document.content_type != "application/pdf" and not document.stored_filename.lower().endswith(".pdf"):
        # Highlighting only understands PDF text search today — anything else
        # (Excel/Word, coming later) is served as-is rather than faked.
        return Response(content=original_bytes, media_type=document.content_type or "application/octet-stream")

    terms = [ssi.account_number, ssi.routing_number, ssi.bank_name, ssi.account_holder_name]
    highlighted_bytes = highlight_terms_in_pdf(original_bytes, terms)
    return Response(content=highlighted_bytes, media_type="application/pdf")


@router.post("/deals/{deal_id}/standing-instructions/{ssi_id}/validate", response_model=StandingInstructionValidateResponse)
def validate_standing_instruction(
    deal_id: int,
    ssi_id: int,
    payload: StandingInstructionValidateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deal = require_deal_membership(deal_id, current_user, db)
    if current_user.role != "checker":
        raise HTTPException(status_code=403, detail="Only a Checker can validate a standing instruction")

    ssi = db.query(StandingInstruction).filter(
        StandingInstruction.id == ssi_id, StandingInstruction.deal_id == deal_id
    ).first()
    if ssi is None:
        raise HTTPException(status_code=404, detail="Standing instruction not found")
    if ssi.status != "pending_checker_review":
        raise HTTPException(status_code=400, detail=f"This standing instruction is already {ssi.status}")

    # This is the actual point-and-call (FR-10): the Checker independently
    # re-typed a value from the source document, and it's compared here
    # against what was extracted — never shown to them beforehand.
    match = payload.entered_account_number.strip() == ssi.account_number
    ssi.status = "checker_validated" if match else "rejected"
    ssi.validated_by_id = current_user.id
    ssi.validated_at = datetime.utcnow()
    db.commit()
    db.refresh(ssi)

    agent = get_or_create_deal_agent(deal, db)
    party = ssi.account_holder_name or "this party"
    if match:
        reply_text = f"Checker {current_user.name} verified the standing instruction for {party} — account number confirmed."
    else:
        reply_text = f"Checker {current_user.name} could NOT verify the standing instruction for {party} — re-entered number did not match. Flagged for review."
    db.add(Message(
        deal_id=deal_id,
        user_id=agent.id,
        text=reply_text,
        level="success" if match else "error",
        standing_instruction_id=ssi.id,
    ))
    db.commit()

    return {"match": match, "standing_instruction": build_ssi_out(ssi, ssi.document, db)}
