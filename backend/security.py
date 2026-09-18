import secrets
import bcrypt
from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User

ACTIVE_TOKENS = {}  # token -> user_id. POC only: resets whenever the server restarts.


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_token_for_user(user_id: int) -> str:
    token = secrets.token_hex(16)
    ACTIVE_TOKENS[token] = user_id
    return token


def get_current_user(authorization: str = Header(...), db: Session = Depends(get_db)) -> User:
    token = authorization.replace("Bearer ", "")
    user_id = ACTIVE_TOKENS.get(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user
