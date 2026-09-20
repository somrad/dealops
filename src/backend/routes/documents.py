import os
import re
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Document, Message, StandingInstruction, User
from schemas import DocumentOut, DocumentCompareOut, DocumentMoveRequest
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent, get_fallback_ssi_assignee
from activity import log_activity
from document_diff import extract_text_for_diff, build_diff_rows
import ai_client
import mock_loan_iq

router = APIRouter()

STORAGE_ROOT = os.path.join(os.path.dirname(__file__), "..", "storage")

# The folders a document can be classified into automatically, plus "Deleted"
# — which a document only ever reaches via an explicit user move (see
# move_document below), never a classification decision.
CLASSIFIABLE_FOLDERS = ["Borrower", "Lenders", "Credit Verification", "Funding Docs", "3rd Party Providers", "Unfiled"]
ALL_FOLDERS = CLASSIFIABLE_FOLDERS + ["Deleted"]

# Strips a trailing version-ish suffix ("_v1", "-v2", " (3)", " copy") from
# the filename stem so "lender_wire_instructions_v1.pdf" and
# "..._v2.pdf" normalize to the same family key. Deliberately simple — a
# POC heuristic, not a general version-string parser.
VERSION_SUFFIX = re.compile(r"([ _-]v\d+|\s*\(\d+\)|\s*copy)$", re.IGNORECASE)


def normalize_version_key(filename: str) -> str:
    stem, ext = os.path.splitext(filename)
    stem = VERSION_SUFFIX.sub("", stem).strip()
    return f"{stem.lower()}{ext.lower()}"


def deal_storage_path(deal_id: int) -> str:
    path = os.path.join(STORAGE_ROOT, f"deal_{deal_id}")
    os.makedirs(path, exist_ok=True)
    return path


def run_extraction_pipeline(db: Session, deal_id: int, document: Document, content: bytes, content_type: str, agent: User, trigger_note: str = None) -> list:
    # FR-5: shared by a fresh upload and a corrective move (see
    # move_document) — same pipeline either way: extract, create a
    # StandingInstruction per party, submit to mock Loan IQ, post the outcome.
    extraction = ai_client.extract_payment_details(document.original_filename, content, content_type)
    parties = extraction["parties"]

    if extraction["model_name"]:
        suffix = f" ({trigger_note})" if trigger_note else ""
        log_activity(
            db, deal_id, "llm_call",
            f"LLM extraction call on {document.original_filename}{suffix} (model: {extraction['model_provider']}/{extraction['model_name']}) — "
            f"found {len(parties)} payment part{'y' if len(parties) == 1 else 'ies'}.",
            actor_id=agent.id,
        )

    # Checked once per pipeline run, not per party — deal membership doesn't
    # change mid-loop. None means a real Checker is already on the deal.
    fallback_assignee = get_fallback_ssi_assignee(deal_id, db) if parties else None

    for party in parties:
        ssi = StandingInstruction(
            deal_id=deal_id,
            document_id=document.id,
            account_holder_name=party.get("account_holder_name"),
            bank_name=party.get("bank_name"),
            account_number=party["account_number"],
            routing_number=party["routing_number"],
            assigned_checker_id=fallback_assignee.id if fallback_assignee else None,
        )
        db.add(ssi)
        db.commit()
        db.refresh(ssi)

        loan_iq_result = mock_loan_iq.submit_standing_instruction(
            ssi.account_holder_name, ssi.bank_name, ssi.account_number, ssi.routing_number
        )
        ssi.loan_iq_reference = loan_iq_result["loan_iq_reference"]
        db.commit()

        who = ssi.account_holder_name or "an unnamed party"
        last4 = ssi.account_number[-4:] if len(ssi.account_number) >= 4 else ssi.account_number
        awaiting = (
            f"Awaiting review by {fallback_assignee.name} — no Checker is on this deal yet."
            if fallback_assignee else "Awaiting Checker validation."
        )
        db.add(Message(
            deal_id=deal_id,
            user_id=agent.id,
            text=(
                f"Extracted payment details for {who} from {document.original_filename} and submitted a standing "
                f"instruction to Loan IQ (account ...{last4}, reference {ssi.loan_iq_reference}). "
                f"{awaiting}"
            ),
            level="info",
            standing_instruction_id=ssi.id,
        ))
        db.commit()

    return parties


def cancel_superseded_standing_instructions(db: Session, deal_id: int, old_document_id: int, account_holder_name: str, agent: User) -> None:
    if not account_holder_name:
        return
    stale = db.query(StandingInstruction).filter(
        StandingInstruction.document_id == old_document_id,
        StandingInstruction.status == "pending_checker_review",
        StandingInstruction.account_holder_name == account_holder_name,
    ).all()
    for ssi in stale:
        ssi.status = "superseded"
        db.commit()
        db.add(Message(
            deal_id=deal_id,
            user_id=agent.id,
            text=(
                f"Standing instruction for {account_holder_name} from the previous document version was "
                f"superseded by a newer upload — no longer awaiting Checker review."
            ),
            level="info",
            standing_instruction_id=ssi.id,
        ))
        db.commit()


@router.post("/deals/{deal_id}/documents", response_model=List[DocumentOut])
def upload_documents(
    deal_id: int,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deal = require_deal_membership(deal_id, current_user, db)
    agent = get_or_create_deal_agent(deal, db)
    folder_path = deal_storage_path(deal_id)

    uploaded = []
    for upload in files:
        extension = os.path.splitext(upload.filename)[1]
        stored_filename = f"{uuid.uuid4().hex}{extension}"
        stored_path = os.path.join(folder_path, stored_filename)

        content = upload.file.read()
        with open(stored_path, "wb") as f:
            f.write(content)

        classification = ai_client.classify_document(upload.filename, content, upload.content_type)
        folder = classification["folder"]
        if classification["model_name"]:
            log_activity(
                db, deal_id, "llm_call",
                f"LLM classification call on {upload.filename} (model: {classification['model_provider']}/{classification['model_name']}) — filed under {folder}.",
                actor_id=agent.id,
            )

        # FR-6: does this filename (version suffix stripped) match an
        # existing document already in this folder that nothing has
        # superseded yet? If so, this upload is a new version of it, not a
        # separate document — link the chain rather than filing it standalone.
        key = normalize_version_key(upload.filename)
        previous_head = None
        for candidate in db.query(Document).filter(Document.deal_id == deal_id, Document.folder == folder).all():
            if normalize_version_key(candidate.original_filename) != key:
                continue
            already_superseded = db.query(Document).filter(Document.supersedes_id == candidate.id).first()
            if already_superseded is None:
                previous_head = candidate
                break

        document = Document(
            deal_id=deal_id,
            uploaded_by_id=current_user.id,
            original_filename=upload.filename,
            stored_filename=stored_filename,
            folder=folder,
            content_type=upload.content_type,
            size_bytes=len(content),
            supersedes_id=previous_head.id if previous_head else None,
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        uploaded.append(document)

        # Two log entries: the human action (uploading), then the agent's
        # automated classification result — same pattern as the mention flow.
        db.add(Message(deal_id=deal_id, user_id=current_user.id, text=f"Uploaded {upload.filename}"))
        db.commit()
        if previous_head is not None:
            db.add(Message(
                deal_id=deal_id, user_id=agent.id,
                text=f'"{upload.filename}" is a new version of "{previous_head.original_filename}" — filed under {folder}, superseding it.',
                level="info",
            ))
        else:
            db.add(Message(deal_id=deal_id, user_id=agent.id, text=f'Filed "{upload.filename}" under {folder}.', level="info"))
        db.commit()

        # FR-5: try extraction on every upload, not just Borrower/Lenders —
        # simpler than special-casing by folder, and documents with no
        # payment details just come back with an empty party list.
        parties = run_extraction_pipeline(db, deal_id, document, content, upload.content_type, agent)

        # A new version can correct exactly what a pending SSI was extracted
        # from (the v1/v2 lender fixture is the real case — a corrected
        # account number) — leaving the old, now-stale SSI sitting as
        # "Pending Review" risks a Checker blind-confirming a superseded
        # value. Only pending ones are touched: a Checker's already-recorded
        # validate/reject decision is a real outcome, not something a later
        # upload should silently erase.
        if previous_head is not None:
            for party in parties:
                cancel_superseded_standing_instructions(db, deal_id, previous_head.id, party.get("account_holder_name"), agent)

    return uploaded


@router.get("/deals/{deal_id}/documents", response_model=List[DocumentOut])
def list_documents(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return db.query(Document).filter(Document.deal_id == deal_id).order_by(Document.uploaded_at).all()


@router.post("/deals/{deal_id}/documents/{document_id}/move", response_model=DocumentOut)
def move_document(
    deal_id: int,
    document_id: int,
    payload: DocumentMoveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # A "delete" is just a move into the special "Deleted" folder — the file
    # stays on disk and any SSI evidence still resolves to it, it's just set
    # aside out of the normal working folders. One mechanism for both.
    deal = require_deal_membership(deal_id, current_user, db)
    document = db.query(Document).filter(Document.id == document_id, Document.deal_id == deal_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    new_folder = payload.folder
    if new_folder not in ALL_FOLDERS:
        raise HTTPException(status_code=400, detail=f"Unknown folder: {new_folder}")

    old_folder = document.folder
    if old_folder == new_folder:
        return document

    document.folder = new_folder
    db.commit()
    db.refresh(document)

    agent = get_or_create_deal_agent(deal, db)
    is_delete = new_folder == "Deleted"
    if is_delete:
        note = f'Deleted "{document.original_filename}" (was filed under {old_folder}).'
    else:
        note = f'Moved "{document.original_filename}" from {old_folder} to {new_folder}.'
    db.add(Message(deal_id=deal_id, user_id=current_user.id, text=note))
    db.commit()

    # A manual correction into a real working folder should trigger the same
    # downstream pipeline a correctly-classified upload would have — but only
    # if extraction hasn't already produced a standing instruction for this
    # document, so correcting a folder never creates duplicate SSIs. Deleting
    # a document is the opposite of a correction, so it never triggers this.
    if not is_delete:
        already_extracted = db.query(StandingInstruction).filter(StandingInstruction.document_id == document.id).first()
        if already_extracted is None:
            stored_path = os.path.join(deal_storage_path(deal_id), document.stored_filename)
            if os.path.exists(stored_path):
                with open(stored_path, "rb") as f:
                    content = f.read()
                run_extraction_pipeline(
                    db, deal_id, document, content, document.content_type, agent,
                    trigger_note=f"re-triggered after move to {new_folder}",
                )

    return document


@router.get("/deals/{deal_id}/documents/compare", response_model=DocumentCompareOut)
def compare_documents(
    deal_id: int,
    doc_a: int,
    doc_b: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_deal_membership(deal_id, current_user, db)
    documents = db.query(Document).filter(Document.id.in_([doc_a, doc_b]), Document.deal_id == deal_id).all()
    by_id = {d.id: d for d in documents}
    if doc_a not in by_id or doc_b not in by_id:
        raise HTTPException(status_code=404, detail="Both documents must exist in this deal")

    first, second = by_id[doc_a], by_id[doc_b]
    storage = deal_storage_path(deal_id)
    text_a = extract_text_for_diff(os.path.join(storage, first.stored_filename), first.content_type)
    text_b = extract_text_for_diff(os.path.join(storage, second.stored_filename), second.content_type)

    return {
        "document_a": first,
        "document_b": second,
        "rows": build_diff_rows(text_a, text_b),
    }


@router.get("/deals/{deal_id}/documents/{document_id}/download")
def download_document(deal_id: int, document_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    document = db.query(Document).filter(Document.id == document_id, Document.deal_id == deal_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    stored_path = os.path.join(deal_storage_path(deal_id), document.stored_filename)
    if not os.path.exists(stored_path):
        raise HTTPException(status_code=404, detail="File missing from storage")

    return FileResponse(stored_path, filename=document.original_filename, media_type=document.content_type)
