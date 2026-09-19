from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # deal_team, ops_manager, ops_team_member, checker, agent

    # Set only for role == "agent": which deal this background agent identity
    # belongs to. Agents never log in and never count as a real Deal Room member.
    agent_for_deal_id = Column(Integer, ForeignKey("deals.id"), nullable=True)


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True)
    reference = Column(String, nullable=False)
    title = Column(String, nullable=False)
    product_type = Column(String, nullable=False)  # commercial_loan, real_estate_loan
    status = Column(String, default="open")
    created_by_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    created_by = relationship("User", foreign_keys=[created_by_id])


class DealMember(Base):
    __tablename__ = "deal_members"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(String, nullable=False)
    # info / success / error — set explicitly wherever a message is created,
    # never inferred from the text later. Only meaningful for agent-authored
    # messages (the UI boxes those); a human's own message ignores it.
    level = Column(String, default="info")
    # Set only on the extraction/validation messages that concern a specific
    # SSI — lets the SSI detail view show its own mini history (submitted,
    # then approved/rejected) without guessing from message text.
    standing_instruction_id = Column(Integer, ForeignKey("standing_instructions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)  # random name on disk — never the original, no path traversal risk
    folder = Column(String, nullable=False)  # Borrower, Lenders, Credit Verification, Funding Docs, Unfiled
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    uploaded_by = relationship("User")


class StandingInstruction(Base):
    __tablename__ = "standing_instructions"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    account_holder_name = Column(String, nullable=True)
    bank_name = Column(String, nullable=True)
    account_number = Column(String, nullable=False)
    routing_number = Column(String, nullable=False)
    # pending_checker_review, checker_validated, rejected
    status = Column(String, default="pending_checker_review")
    loan_iq_reference = Column(String, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    validated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    validated_at = Column(DateTime, nullable=True)

    document = relationship("Document")
    validated_by = relationship("User", foreign_keys=[validated_by_id])


class DealView(Base):
    __tablename__ = "deal_views"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    last_viewed_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=False)
    # Null actor = a system event with no single human responsible.
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    event_type = Column(String, nullable=False)  # deal_created, llm_call, ...
    description = Column(String, nullable=False)
    level = Column(String, default="info")
    created_at = Column(DateTime, default=datetime.utcnow)

    actor = relationship("User")
