from sqlalchemy.orm import Session

from models import ActivityLog

# Separate from Message on purpose: chat messages are things a human or the
# agent *said*; ActivityLog rows are system-level facts about the deal's
# lifecycle that don't have a natural chat message of their own (deal
# creation, an LLM call happening). The Activity Log UI merges both into one
# timeline — see routes/activity.py.


def log_activity(db: Session, deal_id: int, event_type: str, description: str, actor_id: int = None):
    db.add(ActivityLog(deal_id=deal_id, actor_id=actor_id, event_type=event_type, description=description))
    db.commit()
