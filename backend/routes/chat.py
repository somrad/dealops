import re
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Message, User, DealMember
from schemas import MessageCreate, MessageOut
from security import get_current_user
from routes.deals import require_deal_membership, get_or_create_deal_agent
from agent import handle_agent_mention, AGENT_COMMANDS

router = APIRouter()

MENTION_PATTERN = re.compile(r"@(\w+)")


@router.get("/agent-commands")
def list_agent_commands(current_user: User = Depends(get_current_user)):
    # Lets the frontend's command-autocomplete stay in sync automatically as
    # AGENT_COMMANDS grows — no need to hardcode the list on both sides.
    return [{"name": name, "help": info["help"]} for name, info in AGENT_COMMANDS.items()]


@router.get("/deals/{deal_id}/messages", response_model=List[MessageOut])
def list_messages(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return db.query(Message).filter(Message.deal_id == deal_id).order_by(Message.created_at).all()


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
    if agent.username in mentioned_usernames:
        match = re.search(rf"@{re.escape(agent.username)}\b(.*)", payload.text, re.DOTALL)
        command_text = match.group(1).strip() if match else ""
        reply_text = handle_agent_mention(command_text, deal, agent, db)
        db.add(Message(deal_id=deal_id, user_id=agent.id, text=reply_text))
        db.commit()

    # An Ops Manager @mentioning a real person is the actual assignment action
    # (FR-1/FR-4), not just decorative text: it grants that person access to
    # this Deal Room. The resulting confirmation is posted by this deal's
    # agent, not by the Ops Manager, so the log clearly shows what a human
    # said vs. what the system did.
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
            ))
            db.commit()

    return message
