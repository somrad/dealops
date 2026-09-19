import os
import uuid
import pymupdf as fitz
from sqlalchemy.orm import Session

from models import Deal, Document, Message, StandingInstruction, User
from activity import log_activity
from document_diff import extract_text_for_diff

# FR-13: the Fund Flow / Settlement and Closing Document. Generation is
# deterministic (assembled from documents already on file, not an LLM call)
# — same boundary reasoning as pdf_highlight.py and document_diff.py: this
# is backend work, not ai_api's.


def _parties_for_folder(db: Session, deal_id: int, folder: str) -> list:
    # Built from DOCUMENTS on file, not Standing Instructions. A co-lender's
    # bank details are often already on file from a PREVIOUS deal and reused
    # here — this deal may never extract a fresh StandingInstruction for
    # them even though they're clearly a real party (there's a document
    # naming them). A document is what proves participation in THIS deal;
    # an SSI is just richer detail this deal happens to have extracted too.
    #
    # Only current heads count (not older superseded versions) — same
    # dedup logic as the frontend's version tree. One document can still
    # yield multiple parties (e.g. two lenders in one wire-instructions
    # file) when it does have SSIs; when it has none, it contributes one
    # fallback party named from the document itself.
    docs = db.query(Document).filter(Document.deal_id == deal_id, Document.folder == folder).all()
    superseded_ids = {d.supersedes_id for d in docs if d.supersedes_id is not None}
    heads = [d for d in docs if d.id not in superseded_ids]

    parties = []
    for doc in heads:
        ssis = db.query(StandingInstruction).filter(StandingInstruction.document_id == doc.id).all()
        if ssis:
            for ssi in ssis:
                parties.append({"name": ssi.account_holder_name or "Unnamed party", "ssi": ssi, "document": doc})
        else:
            fallback_name = os.path.splitext(doc.original_filename)[0].replace("_", " ").replace("-", " ").strip().title()
            parties.append({"name": fallback_name or doc.original_filename, "ssi": None, "document": doc})
    return parties


def _build_ledger(borrower_parties, lender_parties, third_party_parties, loan_amount, upfront_fee, legal_fee):
    # Real double-entry logic, not just a list of numbers: Sources (money
    # coming in — the lender facility) must equal Uses (money going out —
    # net proceeds to the borrower plus every fee withheld at closing). Net
    # proceeds is DERIVED from the other three figures specifically so the
    # book balances by construction, not by coincidence.
    if lender_parties:
        per_lender = loan_amount / len(lender_parties)
        sources = []
        for p in lender_parties:
            label = p["name"] if p["ssi"] else f'{p["name"]} (no standing instruction on file in this deal)'
            sources.append((label, per_lender))
        split_note = len(lender_parties) > 1
    else:
        sources = [("Loan Proceeds (no lender on file yet)", loan_amount)]
        split_note = False

    borrower_name = borrower_parties[0]["name"] if borrower_parties else "Borrower"
    net_to_borrower = loan_amount - upfront_fee - legal_fee

    uses = [(f"Net Proceeds to Borrower — {borrower_name}", net_to_borrower)]
    if upfront_fee:
        uses.append(("Origination / Upfront Fee", upfront_fee))
    if legal_fee:
        provider_names = [p["name"] for p in third_party_parties]
        label = f"Legal & Professional Fees — {', '.join(provider_names)}" if provider_names else "Legal & Professional Fees"
        uses.append((label, legal_fee))

    return sources, uses, split_note


def _draw_funding_document_pdf(deal: Deal, product_label: str, borrower_parties, lender_parties, third_party_parties, loan_amount, interest_rate, upfront_fee, legal_fee, currency) -> bytes:
    doc = fitz.open()
    x_label, x_amount = 70, 550
    state = {"page": doc.new_page(width=612, height=792), "y": 60}

    def write(text, size=11, dy=16, x=56, bold=False):
        if state["y"] > 740:
            state["page"] = doc.new_page(width=612, height=792)
            state["y"] = 60
        fontname = "hebo" if bold else "helv"
        state["page"].insert_text((x, state["y"]), text, fontsize=size, fontname=fontname, color=(0, 0, 0))
        state["y"] += dy

    def row(label, amount, size=10, dy=15, bold=False):
        write(label, size=size, dy=0, x=x_label, bold=bold)
        amount_text = f"{currency} {amount:,.2f}"
        fontname = "hebo" if bold else "helv"
        text_width = fitz.get_text_length(amount_text, fontname=fontname, fontsize=size)
        write(amount_text, size=size, dy=dy, x=x_amount - text_width, bold=bold)

    def rule():
        state["page"].draw_line((x_label, state["y"] - 4), (x_amount, state["y"] - 4), color=(0.6, 0.6, 0.6), width=0.6)
        state["y"] += 4

    sources, uses, split_note = _build_ledger(borrower_parties, lender_parties, third_party_parties, loan_amount, upfront_fee, legal_fee)
    total_sources = sum(amt for _, amt in sources)
    total_uses = sum(amt for _, amt in uses)

    write("FUND FLOW / SETTLEMENT AND CLOSING STATEMENT", size=14, dy=22)
    write(f"Deal: {deal.title} ({deal.reference})", size=10, dy=14)
    write(f"Product: {product_label}", size=10, dy=22)

    write("LOAN DETAILS", size=12, dy=18)
    row("Loan Amount", loan_amount)
    write(f"Interest Rate: {interest_rate:.3f}% per annum", size=10, dy=22, x=x_label)

    write("SOURCES OF FUNDS (CREDIT)", size=12, dy=18)
    for name, amount in sources:
        row(name, amount)
    rule()
    row("TOTAL SOURCES", total_sources, bold=True)
    state["y"] += 10
    if split_note:
        write("(Lender contributions shown as an even split — pro-rata allocation not yet tracked per lender.)", size=8, dy=16)

    write("USES OF FUNDS (DEBIT)", size=12, dy=18)
    for name, amount in uses:
        row(name, amount)
    rule()
    row("TOTAL USES", total_uses, bold=True)
    state["y"] += 14

    balance = total_sources - total_uses
    write(f"Balance Check: Sources {currency} {total_sources:,.2f} - Uses {currency} {total_uses:,.2f} = {currency} {balance:,.2f}", size=9, dy=14)
    write("BALANCED" if abs(balance) < 0.005 else "OUT OF BALANCE", size=9, dy=22)

    if third_party_parties:
        write("THIRD-PARTY PROVIDERS ON THIS DEAL", size=12, dy=18)
        for p in third_party_parties:
            write(f"- {p['name']}", dy=14)
        state["y"] += 8

    write("This is a system-generated statement assembled from documents on file for this deal.", size=8, dy=12)
    write("SAMPLE / TEST DOCUMENT.", size=8, dy=12)

    return doc.tobytes()


def generate_funding_document(
    db: Session, deal: Deal, current_user: User, agent: User, storage_path: str,
    loan_amount: float, interest_rate: float, upfront_fee: float, legal_fee: float, currency: str = "USD",
) -> Document:
    borrower_parties = _parties_for_folder(db, deal.id, "Borrower")
    lender_parties = _parties_for_folder(db, deal.id, "Lenders")
    third_party_parties = _parties_for_folder(db, deal.id, "3rd Party Providers")

    pdf_bytes = _draw_funding_document_pdf(
        deal, deal.product_type, borrower_parties, lender_parties, third_party_parties,
        loan_amount, interest_rate, upfront_fee, legal_fee, currency,
    )

    stored_filename = f"{uuid.uuid4().hex}.pdf"
    with open(os.path.join(storage_path, stored_filename), "wb") as f:
        f.write(pdf_bytes)

    # FR-6 applies here too: regenerating (or replacing via upload) isn't a
    # new, unrelated document — it's a new version of whichever one this
    # deal already pointed to. Capture that BEFORE overwriting the pointer.
    previous_fund_flow_id = deal.fund_flow_document_id

    filename = f"Fund_Flow_Settlement_Statement_{deal.reference}.pdf"
    document = Document(
        deal_id=deal.id,
        uploaded_by_id=current_user.id,
        original_filename=filename,
        stored_filename=stored_filename,
        folder="Funding Docs",
        content_type="application/pdf",
        size_bytes=len(pdf_bytes),
        supersedes_id=previous_fund_flow_id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    deal.fund_flow_document_id = document.id
    db.commit()

    sources, uses, _ = _build_ledger(borrower_parties, lender_parties, third_party_parties, loan_amount, upfront_fee, legal_fee)
    total_sources = sum(amt for _, amt in sources)
    total_uses = sum(amt for _, amt in uses)
    no_ssi_count = sum(1 for p in borrower_parties + lender_parties + third_party_parties if p["ssi"] is None)

    db.add(Message(deal_id=deal.id, user_id=current_user.id, text="Requested generation of the Fund Flow / Settlement and Closing Document."))
    db.commit()
    db.add(Message(
        deal_id=deal.id,
        user_id=agent.id,
        text=(
            f'Generated "{filename}" — {len(borrower_parties)} borrower part{"y" if len(borrower_parties) == 1 else "ies"}, '
            f'{len(lender_parties)} lender{"s" if len(lender_parties) != 1 else ""}, '
            f'{len(third_party_parties)} third-party provider{"s" if len(third_party_parties) != 1 else ""} included, '
            f'drawn from documents on file{f" ({no_ssi_count} without a standing instruction in this deal)" if no_ssi_count else ""}. '
            f'Filed under Funding Docs{" — superseding the previous version" if previous_fund_flow_id else ""}. '
            f'Sources {currency} {total_sources:,.2f} = Uses {currency} {total_uses:,.2f} — balanced.'
        ),
        level="success",
    ))
    db.commit()

    log_activity(
        db, deal.id, "funding_document_generated",
        f"{current_user.name} generated the Fund Flow / Settlement and Closing Document.",
        actor_id=current_user.id,
    )

    return document


def compute_reconciliation(db: Session, deal_id: int, document: Document, storage_path: str) -> dict:
    # Compares FR-13's fund flow document against the deal's actual
    # participants — points 9/10/11: does each party a document proves is
    # part of this deal actually appear in the document driving remittance?
    # Built from documents (via _parties_for_folder), not just Standing
    # Instructions — a party can be real and correctly named here even with
    # no SSI of its own in this deal (see _parties_for_folder).
    stored_path = os.path.join(storage_path, document.stored_filename)
    doc_text = extract_text_for_diff(stored_path, document.content_type).lower()

    def check(folder):
        entries = []
        for p in _parties_for_folder(db, deal_id, folder):
            name = p["name"].strip()
            confirmed = bool(name) and name.lower() in doc_text
            status = p["ssi"].status if p["ssi"] is not None else "no_ssi_on_file"
            entries.append({"name": name or "Unnamed party", "status": status, "confirmed": confirmed})
        return entries

    return {
        "borrower": check("Borrower"),
        "lenders": check("Lenders"),
        "third_party": check("3rd Party Providers"),
    }
