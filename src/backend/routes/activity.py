from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, Message, User
from schemas import ActivityItemOut
from security import get_current_user
from routes.deals import require_deal_membership

router = APIRouter()


@router.get("/deals/{deal_id}/activity", response_model=List[ActivityItemOut])
def get_deal_activity(deal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_deal_membership(deal_id, current_user, db)

    items = []
    for entry in db.query(ActivityLog).filter(ActivityLog.deal_id == deal_id).all():
        items.append({
            "timestamp": entry.created_at,
            "actor_name": entry.actor.name if entry.actor else "System",
            "actor_role": entry.actor.role if entry.actor else None,
            "event_type": entry.event_type,
            "description": entry.description,
            "level": entry.level,
        })
    for message in db.query(Message).filter(Message.deal_id == deal_id).all():
        items.append({
            "timestamp": message.created_at,
            "actor_name": message.user.name,
            "actor_role": message.user.role,
            "event_type": "message",
            "description": message.text,
            "level": message.level,
        })

    items.sort(key=lambda item: item["timestamp"])
    return items
