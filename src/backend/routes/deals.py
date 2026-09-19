import secrets
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Deal, DealMember, DealView, Document, Message, StandingInstruction, User
from schemas import DealCreate, DealOut, UserOut
from security import get_current_user, hash_password
from activity import log_activity

router = APIRouter()


def get_or_create_deal_agent(deal: Deal, db: Session) -> User:
    # Every deal gets its own background agent identity, automatically —
    # not just for automated actions (a mention-triggered assignment today;
    # document classification, extraction, and discrepancy detection later),
    # but as a real member of the Deal Room that anyone can talk to.
    existing = db.query(User).filter(User.agent_for_deal_id == deal.id).first()
    if existing is not None:
        return existing

    # username == name deliberately: mentions match on username, and the
    # whole point is typing "@SomDeal2026_agent" — the name people actually
    # see — works as the mention, not some internal id-based handle.
    agent_name = f"{deal.title.replace(' ', '_')}_agent"
    agent = User(
        name=agent_name,
        username=agent_name,
        password_hash=hash_password(secrets.token_hex(16)),  # agents never log in
        role="agent",
        agent_for_deal_id=deal.id,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def get_deal_members(deal_id: int, db: Session) -> List[User]:
    # A Deal Room's real membership is "explicit DealMember rows" PLUS every
    # Ops Manager (standing access, see CLAUDE.md) PLUS the deal's own agent,
    # created on first access if it doesn't exist yet. Keeping this in one
    # place means the mention dropdown, sidebar member list, and dashboard
    # bars all agree on who's actually in the room.
    memberships = db.query(DealMember).filter(DealMember.deal_id == deal_id).all()
    member_ids = {m.user_id for m in memberships}

    combined = {}
    if member_ids:
        for u in db.query(User).filter(User.id.in_(member_ids)).all():
            combined[u.id] = u
    for u in db.query(User).filter(User.role == "ops_manager").all():
        combined[u.id] = u

    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if deal is not None:
        agent = get_or_create_deal_agent(deal, db)
        combined[agent.id] = agent

    return list(combined.values())


def has_pending_task_for(deal_id: int, current_user: User, db: Session) -> bool:
    # The only task type that exists today is a Checker's SSI validation —
    # this is deliberately narrow rather than a generic "tasks" table, since
    # that's the only thing anyone is ever blocked waiting on right now.
    if current_user.role != "checker":
        return False
    pending = db.query(StandingInstruction).filter(
        StandingInstruction.deal_id == deal_id,
        StandingInstruction.status == "pending_checker_review",
    ).first()
    return pending is not None


def has_unread_mention_for(deal_id: int, current_user: User, db: Session) -> bool:
    view = db.query(DealView).filter(
        DealView.deal_id == deal_id, DealView.user_id == current_user.id
    ).first()
    since = view.last_viewed_at if view else datetime.min

    token = f"@{current_user.username}"
    recent = (
        db.query(Message)
        .filter(Message.deal_id == deal_id, Message.created_at > since)
        .order_by(Message.created_at.desc())
        .limit(200)
        .all()
    )
    return any(token in m.text for m in recent)


def build_deal_out(deal: Deal, db: Session, current_user: User) -> dict:
    members = get_deal_members(deal.id, db)
    document_count = db.query(Document).filter(Document.deal_id == deal.id).count()
    last_message = (
        db.query(Message)
        .filter(Message.deal_id == deal.id)
        .order_by(Message.created_at.desc())
        .first()
    )
    return {
        "id": deal.id,
        "reference": deal.reference,
        "title": deal.title,
        "product_type": deal.product_type,
        "status": deal.status,
        "members": members,
        "document_count": document_count,
        "last_message_text": last_message.text if last_message else None,
        "last_message_at": last_message.created_at if last_message else None,
        "last_message_user": last_message.user.name if last_message else None,
        "has_pending_task": has_pending_task_for(deal.id, current_user, db),
        "has_mention": has_unread_mention_for(deal.id, current_user, db),
    }


@router.get("/deals", response_model=List[DealOut])
def list_my_deals(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Ops Managers have standing visibility into every Deal Room (see CLAUDE.md),
    # so they see a staffing request the moment it's posted, even before anyone
    # has explicitly added them to that deal.
    if current_user.role == "ops_manager":
        deals = db.query(Deal).all()
    else:
        memberships = db.query(DealMember).filter(DealMember.user_id == current_user.id).all()
        deal_ids = [m.deal_id for m in memberships]
        deals = db.query(Deal).filter(Deal.id.in_(deal_ids)).all()

    return [build_deal_out(d, db, current_user) for d in deals]


@router.post("/deals", response_model=DealOut)
def create_deal(payload: DealCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = Deal(
        reference=payload.reference,
        title=payload.title,
        product_type=payload.product_type,
        created_by_id=current_user.id,
    )
    db.add(deal)
    db.commit()
    db.refresh(deal)

    # The deal's creator automatically becomes the first Deal Room member.
    db.add(DealMember(deal_id=deal.id, user_id=current_user.id))
    db.commit()

    log_activity(db, deal.id, "deal_created", f"Deal room created by {current_user.name}.", actor_id=current_user.id)

    return build_deal_out(deal, db, current_user)


def require_deal_membership(deal_id: int, current_user: User, db: Session) -> Deal:
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if deal is None:
        raise HTTPException(status_code=404, detail="Deal not found")

    # Ops Managers can open and post in any Deal Room, same reasoning as above.
    if current_user.role == "ops_manager":
        return deal

    is_member = db.query(DealMember).filter(
        DealMember.deal_id == deal_id, DealMember.user_id == current_user.id
    ).first()
    if is_member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this deal")
    return deal


def mark_deal_viewed(deal_id: int, current_user: User, db: Session) -> None:
    # Opening a Deal Room is what clears its "@" badge on the dashboard —
    # any mention older than this moment no longer counts as unread.
    view = db.query(DealView).filter(
        DealView.deal_id == deal_id, DealView.user_id == current_user.id
    ).first()
    if view is None:
        db.add(DealView(deal_id=deal_id, user_id=current_user.id, last_viewed_at=datetime.utcnow()))
    else:
        view.last_viewed_at = datetime.utcnow()
    db.commit()


@router.get("/deals/{deal_id}", response_model=DealOut)
def get_deal(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = require_deal_membership(deal_id, current_user, db)
    out = build_deal_out(deal, db, current_user)
    mark_deal_viewed(deal_id, current_user, db)
    return out


@router.get("/deals/{deal_id}/members", response_model=List[UserOut])
def list_deal_members(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return get_deal_members(deal_id, db)
