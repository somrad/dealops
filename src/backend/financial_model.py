import os
from sqlalchemy.orm import Session

from models import Deal, Document, DealFinancialLine, StandingInstruction, User
import ai_client
import storage_backend as storage

# The ONE deal financial model — the diagram, the generated Fund Flow
# Document, and the Remittances readiness view all read from
# get_deal_financial_model() instead of each running their own arithmetic.
# See CLAUDE.md's "we cannot have different mental models" note.

# Which document folders carry deal economics (who is owed or contributing
# how much) and what role/flow that implies. Deliberately excludes "Credit
# Verification" (underwriting docs, not economics) and "Funding Docs" (that's
# where the designated Fund Flow Document itself lives — handled separately,
# see sync_financial_lines_from_fund_flow_document) and "Deleted".
FOLDER_ROLE = {
    "Borrower": ("borrower", "use"),
    "Lenders": ("lender", "source"),
    "3rd Party Providers": ("third_party", "use"),
    "Unfiled": ("other", "use"),
}


def sync_financial_lines_for_document(db: Session, deal_id: int, document: Document, extracted_items: list) -> None:
    # Party identity and amount here come from a dedicated extraction over
    # the document's own text (ai_api's extract_deal_line_items) —
    # deliberately NOT derived from whether this document's separate
    # bank-detail (StandingInstruction) extraction happened to succeed.
    #
    # Called on every read now (see get_deal_financial_model()), not just
    # once at upload time — this is what makes a corrected document
    # self-healing without needing a manual delete-and-resync. A line a
    # human explicitly typed in (amount_source == "manual_entry") is never
    # silently erased just because a fresh extraction pass still finds
    # nothing for it — re-syncing must never lose a human's entered value.
    role_flow = FOLDER_ROLE.get(document.folder)
    if role_flow is None:
        return
    role, flow = role_flow

    existing = db.query(DealFinancialLine).filter(DealFinancialLine.document_id == document.id).all()

    if extracted_items:
        # Fresh extraction found real content — this always wins, even over
        # a previous manual entry, since a corrected/re-read document is
        # more authoritative than a placeholder value someone typed in
        # before the real content was available.
        for l in existing:
            db.delete(l)
        for item in extracted_items:
            amount = item.get("amount")
            db.add(DealFinancialLine(
                deal_id=deal_id, flow=flow, role=role,
                category=item.get("category") or ("Principal" if flow == "source" else "Amount Owed"),
                party_name=item["party_name"],
                amount=amount, currency=item.get("currency") or "USD",
                amount_source="extracted_from_document" if amount is not None else None,
                document_id=document.id,
            ))
    elif any(l.amount_source == "manual_entry" for l in existing):
        # Extraction (still) finds nothing, but a human already filled this
        # document's line in by hand — keep it exactly as-is.
        return
    else:
        # Nothing extracted, nothing manually entered yet — (re)create the
        # placeholder so the party still shows up as something to fill in.
        for l in existing:
            db.delete(l)
        fallback_name = os.path.splitext(document.original_filename)[0].replace("_", " ").replace("-", " ").strip().title()
        db.add(DealFinancialLine(
            deal_id=deal_id, flow=flow, role=role,
            category="Principal" if flow == "source" else "Amount Owed",
            party_name=fallback_name or document.original_filename,
            amount=None, currency="USD", amount_source=None,
            document_id=document.id,
        ))
    db.commit()


def sync_financial_lines_from_fund_flow_document(db: Session, deal: Deal, document: Document, extracted_lines: list) -> None:
    # A Deal Team member's own uploaded settlement statement is authoritative
    # (founder's explicit rule) — it REPLACES the whole deal's financial
    # model, not just this one document's contribution to it.
    db.query(DealFinancialLine).filter(DealFinancialLine.deal_id == deal.id).delete()
    for line in extracted_lines:
        flow = line.get("flow") if line.get("flow") in ("source", "use") else "use"
        role = line.get("role") if line.get("role") in ("borrower", "lender", "third_party", "other") else "other"
        db.add(DealFinancialLine(
            deal_id=deal.id, flow=flow, role=role,
            category=line.get("category") or "Amount",
            party_name=line["party_name"], amount=line.get("amount"),
            currency=line.get("currency") or "USD",
            amount_source="uploaded_fund_flow_document",
            document_id=document.id,
        ))
    db.commit()


def _line_out(line: DealFinancialLine) -> dict:
    return {
        "id": line.id,
        "flow": line.flow,
        "role": line.role,
        "category": line.category,
        "party_name": line.party_name,
        "amount": line.amount,
        "currency": line.currency,
        "amount_source": line.amount_source,
        "document_id": line.document_id,
        "document_filename": line.document.original_filename if line.document else None,
        "standing_instruction_id": line.standing_instruction_id,
    }


def get_deal_financial_model(db: Session, deal_id: int) -> dict:
    # Deliberately a PURE READ — does not call sync_all_financial_lines_for_deal()
    # itself. That call is expensive (real LLM calls, one per document) and
    # this function is reached from routes/documents.py's/DealRoomPage.jsx's
    # 3-second background poll (GET /deals/{id}/funding-document, used to
    # keep the Remittances summary fresh) via get_remittance_readiness() ->
    # build_funding_document_out(). Putting the resync in here once caused
    # every poll tick to kick off a fresh multi-document extraction pass
    # before the previous one even finished, overwhelming the backend on any
    # deal with more than a couple of documents.
    #
    # Callers that ARE a real user action — not a timer — call
    # sync_all_financial_lines_for_deal() themselves first: the fund-flow-
    # diagram and financial-model routes (Deal Map / Generate panel clicks)
    # and generate_funding_document() (the Save & Generate / Save click).
    all_lines = db.query(DealFinancialLine).filter(DealFinancialLine.deal_id == deal_id).all()

    # Only current (non-superseded, non-deleted) documents' lines count —
    # same dedup-to-version-heads logic used elsewhere in this app.
    docs = db.query(Document).filter(Document.deal_id == deal_id).all()
    superseded_ids = {d.supersedes_id for d in docs if d.supersedes_id is not None}
    by_id = {d.id: d for d in docs}

    def is_current(line: DealFinancialLine) -> bool:
        if line.document_id is None:
            return True
        if line.document_id in superseded_ids:
            return False
        doc = by_id.get(line.document_id)
        return doc is not None and doc.folder != "Deleted"

    lines = [l for l in all_lines if is_current(l)]

    source_lines = [l for l in lines if l.flow == "source"]
    use_lines = [l for l in lines if l.flow == "use"]
    borrower_lines = [l for l in use_lines if l.role == "borrower"]
    non_borrower_use_lines = [l for l in use_lines if l.role != "borrower"]

    # Borrower net proceeds are a DERIVED residual, never an independently
    # extracted or manually-typed figure — the founder's explicit rule:
    # "fees should be deducted from the available funds and borrower's net
    # proceeds are reduced by that amount." A loan agreement's own stated
    # "facility amount" describes the SIZE of the loan (i.e. Sources), not
    # what the borrower actually nets after fees — so it's deliberately
    # NOT trusted as the borrower's use-line amount, even when extraction
    # finds one. Computed fresh on every read from current Sources/Uses,
    # same as everything else in this model — never cached/stored.
    sources_known = len(source_lines) > 0 and all(l.amount is not None for l in source_lines)
    non_borrower_uses_known = all(l.amount is not None for l in non_borrower_use_lines)
    total_sources = sum(l.amount for l in source_lines if l.amount is not None)
    non_borrower_total = sum(l.amount for l in non_borrower_use_lines if l.amount is not None)

    derivable = sources_known and non_borrower_uses_known and len(borrower_lines) > 0
    # Multiple co-borrowers split the residual evenly — a documented
    # approximation (no per-borrower allocation is tracked), same caveat
    # pattern used elsewhere in this app for unstated splits.
    derived_each = (total_sources - non_borrower_total) / len(borrower_lines) if derivable else None

    def use_line_out(l: DealFinancialLine) -> dict:
        out = _line_out(l)
        if l.role == "borrower":
            out["amount"] = derived_each  # None while non-borrower uses are still incomplete
            out["amount_source"] = "derived" if derivable else None
        return out

    source_outs = [_line_out(l) for l in source_lines]
    use_outs = [use_line_out(l) for l in use_lines]
    line_outs = source_outs + use_outs

    total_uses = non_borrower_total + (derived_each * len(borrower_lines) if derivable else 0)
    missing = [o for o in line_outs if o["amount"] is None]
    all_known = len(line_outs) > 0 and len(missing) == 0
    balanced = all_known and abs(total_sources - total_uses) < 0.005

    return {
        "lines": line_outs,
        "sources": source_outs,
        "uses": use_outs,
        "total_sources": total_sources,
        "total_uses": total_uses,
        "missing": missing,
        "all_known": all_known,
        "balanced": balanced,
        "has_lines": len(lines) > 0,
    }


def find_ssi_for_line(db: Session, deal_id: int, line: DealFinancialLine):
    # Links a financial line (economics: who/how much) to its bank/wire
    # identity row (StandingInstruction), if the same document produced
    # one — by document + party name, not by guessing. Used for the PDF's
    # bank-details appendix and for Remittances readiness.
    if line.document_id is None:
        return None
    candidates = db.query(StandingInstruction).filter(
        StandingInstruction.deal_id == deal_id,
        StandingInstruction.document_id == line.document_id,
    ).all()
    for ssi in candidates:
        if (ssi.account_holder_name or "").strip().lower() == line.party_name.strip().lower():
            return ssi
    return candidates[0] if len(candidates) == 1 else None


def fill_missing_line(db: Session, deal_id: int, line_id: int, amount: float, current_user: User) -> DealFinancialLine:
    line = db.query(DealFinancialLine).filter(DealFinancialLine.id == line_id, DealFinancialLine.deal_id == deal_id).first()
    if line is None:
        return None
    if line.role == "borrower":
        # Never manually typed — always derived (Sources minus every other
        # Use) in get_deal_financial_model(). Silently ignored rather than
        # erroring: the frontend no longer renders an input for these, so
        # only a direct API call could reach this, and it should be a no-op
        # rather than let a typed figure contradict the derivation rule.
        return line
    line.amount = amount
    line.amount_source = "manual_entry"
    line.entered_by_id = current_user.id
    db.commit()
    db.refresh(line)
    return line


def sync_all_financial_lines_for_deal(db: Session, deal_id: int) -> None:
    # Re-reads EVERY current document in a financial-economics folder and
    # re-runs extraction, every single time this is called — not just the
    # first time a deal has zero lines. Called at the top of
    # get_deal_financial_model(), so every consumer (Deal Map's diagram,
    # the Generate panel, Remittances, and generation itself) always
    # operates on freshly re-extracted data. This is deliberately the
    # founder's own call: it trades a fast DB read for real latency and
    # LLM cost on every view, in exchange for the model never going stale
    # without someone noticing — no more manual delete-and-resync needed
    # when a document turns out to be wrong or gets corrected.
    docs = db.query(Document).filter(Document.deal_id == deal_id, Document.folder.in_(FOLDER_ROLE.keys())).all()
    superseded_ids = {d.supersedes_id for d in db.query(Document).filter(Document.deal_id == deal_id).all() if d.supersedes_id}
    heads = [d for d in docs if d.id not in superseded_ids]

    for doc in heads:
        content = storage.read_file(deal_id, doc.stored_filename)
        if content is None:
            continue
        try:
            result = ai_client.extract_deal_line_items(doc.original_filename, content, doc.content_type, doc.folder)
        except Exception:
            # ai_api unreachable/erroring on this one document shouldn't
            # break the whole page — leave that document's existing lines
            # as they were and keep going with the rest.
            continue
        sync_financial_lines_for_document(db, deal_id, doc, result["items"])
