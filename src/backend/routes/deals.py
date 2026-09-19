import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Deal, DealMember, Document, Message, User
from schemas import DealCreate, DealOut, UserOut
from security import get_current_user, hash_password

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


def build_deal_out(deal: Deal, db: Session) -> dict:
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

    return [build_deal_out(d, db) for d in deals]


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

    return build_deal_out(deal, db)


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


@router.get("/deals/{deal_id}", response_model=DealOut)
def get_deal(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deal = require_deal_membership(deal_id, current_user, db)
    return build_deal_out(deal, db)


@router.get("/deals/{deal_id}/members", response_model=List[UserOut])
def list_deal_members(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)
    return get_deal_members(deal_id, db)
