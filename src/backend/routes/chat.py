import re
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Document, Message, StandingInstruction, User, DealMember
from schemas import MessageCreate, MessageOut
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent, get_deal_members
import ai_client

router = APIRouter()

MENTION_PATTERN = re.compile(r"@(\w+)")


@router.get("/agent-commands")
def list_agent_commands(current_user: User = Depends(get_current_user)):
    # Thin proxy to ai_api — keeps the frontend's contract stable (still
    # calls the backend, never ai_api directly) while ai_api stays the
    # single source of truth for what commands actually exist.
    return ai_client.get_agent_commands()


@router.get("/deals/{deal_id}/messages", response_model=List[MessageOut])
def list_messages(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return db.query(Message).filter(Message.deal_id == deal_id).order_by(Message.created_at).all()


def build_deal_context(deal, db: Session) -> dict:
    # This is the context-engineering seam: ai_api never touches the DB, so
    # everything a skill might need has to be assembled here and handed over
    # as plain data. Extend this (and the matching schema in ai_api/main.py)
    # when a new skill needs something not already included.
    member_count = len(get_deal_members(deal.id, db))
    message_count = db.query(Message).filter(Message.deal_id == deal.id).count()
    documents = db.query(Document).filter(Document.deal_id == deal.id).all()
    standing_instructions = db.query(StandingInstruction).filter(StandingInstruction.deal_id == deal.id).all()
    return {
        "title": deal.title,
        "reference": deal.reference,
        "product_type": deal.product_type,
        "status": deal.status,
        "member_count": member_count,
        "message_count": message_count,
        "documents": [{"filename": d.original_filename, "folder": d.folder} for d in documents],
        "standing_instructions": [
            {
                "account_holder_name": s.account_holder_name,
                "status": s.status,
                "loan_iq_reference": s.loan_iq_reference,
            }
            for s in standing_instructions
        ],
    }


@router.post("/deals/{deal_id}/messages", response_model=MessageOut)
def post_message(deal_id: int, payload: MessageCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = require_deal_membership(deal_id, current_user, db)
    message = Message(deal_id=deal_id, user_id=current_user.id, text=payload.text)
    db.add(message)
    db.commit()
    db.refresh(message)

    agent = get_or_create_deal_agent(deal, db)
    mentioned_usernames = set(MENTION_PATTERN.findall(payload.text))

    # Talking to this deal's own agent, e.g. "@SomDeal2026_agent describe" —
    # any deal member can do this, not just Ops Managers. Whatever's typed
    # after the mention is the command; nothing recognized shows the menu.
    # The actual reasoning happens in ai_api — this just builds the context
    # payload and posts the reply it gets back.
    if agent.username in mentioned_usernames:
        match = re.search(rf"@{re.escape(agent.username)}\b(.*)", payload.text, re.DOTALL)
        command_text = match.group(1).strip() if match else ""
        deal_context = build_deal_context(deal, db)
        reply_text = ai_client.agent_respond(command_text, agent.name, agent.username, deal_context)
        db.add(Message(deal_id=deal_id, user_id=agent.id, text=reply_text, level="info"))
        db.commit()

    # An Ops Manager @mentioning a real person is the actual assignment action
    # (FR-1/FR-4), not just decorative text: it grants that person access to
    # this Deal Room. The resulting confirmation is posted by this deal's
    # agent, not by the Ops Manager, so the log clearly shows what a human
    # said vs. what the system did. This is a deterministic authorization
    # rule, not AI reasoning, so it stays here rather than in ai_api.
    if current_user.role == "ops_manager":
        for username in mentioned_usernames:
            mentioned_user = db.query(User).filter(User.username == username).first()
            if mentioned_user is None or mentioned_user.role == "agent":
                continue
            already_member = db.query(DealMember).filter(
                DealMember.deal_id == deal_id, DealMember.user_id == mentioned_user.id
            ).first()
            if already_member is not None:
                continue
            db.add(DealMember(deal_id=deal_id, user_id=mentioned_user.id))
            db.commit()
            db.add(Message(
                deal_id=deal_id,
                user_id=agent.id,
                text=f"{mentioned_user.name} was added to this deal.",
                level="success",
            ))
            db.commit()

    return message
