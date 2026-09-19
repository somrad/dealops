from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User
from schemas import UserOut
from security import get_current_user

router = APIRouter()


@router.get("/users", response_model=List[UserOut])
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Used by the frontend's @mention autocomplete, which needs to suggest
    # people even before they're a member of the current deal. Agents aren't
    # real people to staff onto a deal, so they're excluded from suggestions.
    return db.query(User).filter(User.role != "agent").all()
