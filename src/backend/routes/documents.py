import os
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Document, Message, User
from schemas import DocumentOut
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent
from ai.document_classifier import classify_document, extract_text

router = APIRouter()

STORAGE_ROOT = os.path.join(os.path.dirname(__file__), "..", "storage")


def deal_storage_path(deal_id: int) -> str:
    path = os.path.join(STORAGE_ROOT, f"deal_{deal_id}")
    os.makedirs(path, exist_ok=True)
    return path


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

        text_content = extract_text(stored_path, upload.content_type)
        folder = classify_document(upload.filename, text_content)

        document = Document(
            deal_id=deal_id,
            uploaded_by_id=current_user.id,
            original_filename=upload.filename,
            stored_filename=stored_filename,
            folder=folder,
            content_type=upload.content_type,
            size_bytes=len(content),
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        uploaded.append(document)

        # Two log entries: the human action (uploading), then the agent's
        # automated classification result — same pattern as the mention flow.
        db.add(Message(deal_id=deal_id, user_id=current_user.id, text=f"Uploaded {upload.filename}"))
        db.commit()
        db.add(Message(deal_id=deal_id, user_id=agent.id, text=f'Filed "{upload.filename}" under {folder}.'))
        db.commit()

    return uploaded


@router.get("/deals/{deal_id}/documents", response_model=List[DocumentOut])
def list_documents(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return db.query(Document).filter(Document.deal_id == deal_id).order_by(Document.uploaded_at).all()


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
