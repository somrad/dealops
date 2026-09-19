from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    username: str
    role: str

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class DealCreate(BaseModel):
    reference: str
    title: str
    product_type: str


class DealOut(BaseModel):
    id: int
    reference: str
    title: str
    product_type: str
    status: str
    members: List[UserOut] = []
    document_count: int = 0
    last_message_text: Optional[str] = None
    last_message_at: Optional[datetime] = None
    last_message_user: Optional[str] = None

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    text: str


class MessageOut(BaseModel):
    id: int
    text: str
    created_at: datetime
    user: UserOut

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    id: int
    original_filename: str
    folder: str
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    uploaded_at: datetime
    uploaded_by: UserOut

    class Config:
        from_attributes = True
