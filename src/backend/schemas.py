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
    # Both computed per requesting user at read time (see build_deal_out) —
    # not stored on the deal itself, since they mean something different for
    # every person looking at the dashboard.
    has_pending_task: bool = False
    has_mention: bool = False

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    text: str


class MessageOut(BaseModel):
    id: int
    text: str
    level: str = "info"
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


class SsiActivityItemOut(BaseModel):
    text: str
    level: str = "info"
    actor_name: str
    created_at: datetime


class StandingInstructionOut(BaseModel):
    id: int
    document_id: int
    document_filename: str
    document_folder: str
    added_by: UserOut
    account_holder_name: Optional[str] = None
    bank_name: Optional[str] = None
    # Never the full number, even to a Checker — blind re-entry only means
    # something if they're verifying against the source document, not a
    # value the system shows them right next to the "confirm" button.
    masked_account_number: str
    status: str
    loan_iq_reference: Optional[str] = None
    submitted_at: datetime
    validated_by: Optional[UserOut] = None
    validated_at: Optional[datetime] = None
    activity: List[SsiActivityItemOut] = []


class StandingInstructionValidateRequest(BaseModel):
    entered_account_number: str


class StandingInstructionValidateResponse(BaseModel):
    match: bool
    standing_instruction: StandingInstructionOut


class ActivityItemOut(BaseModel):
    timestamp: datetime
    actor_name: str
    actor_role: Optional[str] = None
    event_type: str
    description: str
    level: str = "info"
