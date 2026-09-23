import secrets
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Deal, DealMember, DealView, Document, Message, StandingInstruction, User
from schemas import AddMembersRequest, DealCreate, DealOut, UserOut
from security import get_current_user, hash_password
from activity import log_activity
from funding_document import _parties_for_folder

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


class DealMembershipManager:
    """Adds users straight to a Deal Room from the dashboard's +person
    picker — deliberately not gated to Ops Managers the way the chat
    @mention flow is (see CLAUDE.md FR-4); that flow is untouched and
    still works exactly as before."""

    def __init__(self, db: Session, deal: Deal):
        self.db = db
        self.deal = deal

    def add_users(self, user_ids: List[int], added_by: User) -> List[User]:
        agent = get_or_create_deal_agent(self.deal, self.db)
        added: List[User] = []

        for user_id in user_ids:
            user = self.db.query(User).filter(User.id == user_id).first()
            if user is None or user.role == "agent":
                continue

            already_member = self.db.query(DealMember).filter(
                DealMember.deal_id == self.deal.id, DealMember.user_id == user.id
            ).first()
            if already_member is not None:
                continue

            self.db.add(DealMember(deal_id=self.deal.id, user_id=user.id))
            self.db.commit()

            self.db.add(Message(
                deal_id=self.deal.id,
                user_id=agent.id,
                text=f"{user.name} was added to this deal by {added_by.name}.",
                level="success",
            ))
            self.db.commit()
            added.append(user)

        return added


def get_fallback_ssi_assignee(deal_id: int, db: Session):
    # FR-10's blind re-entry only works if a real Checker is actually on the
    # deal — a Standing Instruction created before one's been staffed would
    # otherwise sit with no one responsible for it. Falls back to an Ops
    # Manager (visibility/ownership only, not a permission grant — see
    # StandingInstruction.assigned_checker in models.py) so it's obvious who
    # should go add a real Checker, matching FR-15's own oversight role.
    members = get_deal_members(deal_id, db)
    if any(m.role == "checker" for m in members):
        return None
    ops_managers = [m for m in members if m.role == "ops_manager"]
    return ops_managers[0] if ops_managers else None


def pending_task_count_for(deal_id: int, current_user: User, db: Session) -> int:
    # The only task type that exists today is a Checker's SSI validation —
    # this is deliberately narrow rather than a generic "tasks" table, since
    # that's the only thing anyone is ever blocked waiting on right now. A
    # real count (not just a yes/no flag) is what lets the dashboard say
    # "2 Standing Instructions to review" instead of just "something's
    # pending" — see the founder's ask for a real to-do list on login.
    if current_user.role != "checker":
        return 0
    return db.query(StandingInstruction).filter(
        StandingInstruction.deal_id == deal_id,
        StandingInstruction.status == "pending_checker_review",
    ).count()


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
    # Deal Map summary, reused from funding_document.py's party-sourcing
    # logic (same "built from documents on file, not just SSIs" reasoning —
    # see _parties_for_folder) so the dashboard tile agrees with what the
    # Fund Flow Document itself would show for Borrower/Lenders.
    borrower_names = [p["name"] for p in _parties_for_folder(db, deal.id, "Borrower")]
    lender_names = [p["name"] for p in _parties_for_folder(db, deal.id, "Lenders")]
    message_count = db.query(Message).filter(Message.deal_id == deal.id).count()
    standing_instruction_count = db.query(StandingInstruction).filter(StandingInstruction.deal_id == deal.id).count()
    pending_task_count = pending_task_count_for(deal.id, current_user, db)
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
        "borrower_names": borrower_names,
        "lender_names": lender_names,
        "message_count": message_count,
        "standing_instruction_count": standing_instruction_count,
        "pending_task_count": pending_task_count,
        "has_pending_task": pending_task_count > 0,
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


@router.post("/deals/{deal_id}/members", response_model=List[UserOut])
def add_deal_members(
    deal_id: int,
    payload: AddMembersRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deal = require_deal_membership(deal_id, current_user, db)
    DealMembershipManager(db, deal).add_users(payload.user_ids, current_user)
    return get_deal_members(deal_id, db)
