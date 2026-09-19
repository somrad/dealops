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
    supersedes_id: Optional[int] = None

    class Config:
        from_attributes = True


class DocumentMoveRequest(BaseModel):
    folder: str


class FundingDocumentGenerateRequest(BaseModel):
    loan_amount: float
    interest_rate: float
    upfront_fee: float = 0
    legal_fee: float = 0
    currency: str = "USD"


class ReconciliationEntryOut(BaseModel):
    name: str
    status: str
    confirmed: bool


class ReconciliationOut(BaseModel):
    borrower: List[ReconciliationEntryOut] = []
    lenders: List[ReconciliationEntryOut] = []
    third_party: List[ReconciliationEntryOut] = []


class FundingDocumentOut(BaseModel):
    document: Optional[DocumentOut] = None
    reconciliation: ReconciliationOut


class DiffSegmentOut(BaseModel):
    text: str
    changed: bool = False


class DiffRowOut(BaseModel):
    type: str  # equal / add / remove / replace
    left_segments: Optional[List[DiffSegmentOut]] = None
    right_segments: Optional[List[DiffSegmentOut]] = None


class DocumentCompareOut(BaseModel):
    document_a: DocumentOut
    document_b: DocumentOut
    rows: List[DiffRowOut]


class SsiActivityItemOut(BaseModel):
    text: str
    level: str = "info"
    actor_name: str
    created_at: datetime


class StandingInstructionOut(BaseModel):
    id: int
    document_id: int
    # Optional: a StandingInstruction's source document should never
    # disappear (deletion is a soft move to "Deleted", never a hard
    # remove — see routes/documents.py), but this stays defensive in case
    # data ever ends up inconsistent, rather than 500ing the whole list.
    document_filename: Optional[str] = None
    document_folder: Optional[str] = None
    added_by: Optional[UserOut] = None
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
