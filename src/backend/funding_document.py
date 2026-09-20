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

SSI_STATUS_LABELS = {
    "pending_checker_review": "Pending Checker review",
    "checker_validated": "Checker validated",
    "rejected": "Rejected",
    "superseded": "Superseded",
}


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


def _lead_lender(lender_parties):
    # Convention only: the first lender on file is treated as the lead/agent
    # bank for Upfront Fee and Lead Agent Fee attribution. This app doesn't
    # track an explicit "lead lender" designation yet — see the open
    # question logged in docs/SPECIFICATIONS.md (FR-13). Revisit this the
    # day a deal's lender list needs a real "who's the agent" flag.
    return lender_parties[0] if lender_parties else None


def _build_statement(borrower_parties, lender_parties, third_party_parties,
                      loan_amount, upfront_fee, interest_amount, lead_agent_fee, legal_fee):
    # Real double-entry logic, not just a list of numbers: Sources (money
    # coming in — the lender facility) must equal Uses (money going out —
    # net proceeds to the borrower plus every fee withheld at closing). Net
    # proceeds is DERIVED from the other four fee figures specifically so
    # the book balances by construction, not by coincidence.
    #
    # Each use is broken into its OWN section (Borrower Proceeds / Upfront
    # Fees / Interest / Lead Agent Fees / Legal & Professional Fees) with
    # the actual payee named on every line — not one lump "fees" figure.
    lead = _lead_lender(lender_parties)

    if lender_parties:
        per_lender = loan_amount / len(lender_parties)
        sources = [(p, per_lender) for p in lender_parties]
        lender_split_note = len(lender_parties) > 1
    else:
        sources = [(None, loan_amount)]
        lender_split_note = False

    borrower = borrower_parties[0] if borrower_parties else None
    net_to_borrower = loan_amount - upfront_fee - interest_amount - lead_agent_fee - legal_fee

    use_sections = [("Borrower Proceeds", [(borrower, net_to_borrower)])]

    if upfront_fee:
        # Paid to the bank arranging the facility — approximated as the
        # lead lender (see _lead_lender's caveat above).
        use_sections.append(("Upfront Fees", [(lead, upfront_fee)]))

    if interest_amount:
        # Prepaid interest accrues to whoever put up the facility — split
        # the same way the source contribution is split.
        if lender_parties:
            per_lender_interest = interest_amount / len(lender_parties)
            use_sections.append(("Interest", [(p, per_lender_interest) for p in lender_parties]))
        else:
            use_sections.append(("Interest", [(None, interest_amount)]))

    if lead_agent_fee:
        use_sections.append(("Lead Agent Fees", [(lead, lead_agent_fee)]))

    if legal_fee:
        if third_party_parties:
            per_provider = legal_fee / len(third_party_parties)
            use_sections.append(("Legal & Professional Fees", [(p, per_provider) for p in third_party_parties]))
        else:
            use_sections.append(("Legal & Professional Fees", [(None, legal_fee)]))

    total_sources = sum(amt for _, amt in sources)
    total_uses = sum(amt for _, lines in use_sections for _, amt in lines)

    return {
        "sources": sources,
        "use_sections": use_sections,
        "total_sources": total_sources,
        "total_uses": total_uses,
        "lender_split_note": lender_split_note,
        "lead_lender": lead,
    }


def _party_key(party):
    # NOT document.id — one document can yield multiple parties (e.g. two
    # lenders named in a single wire-instructions file, the actual sample
    # data this bug was found against), so keying by document alone
    # silently merged their amounts together and every party sharing that
    # document then showed the *combined* total instead of their own share.
    # A Standing Instruction's own id is unique per party; the document id
    # is only a safe fallback for the no-SSI case, where it really is 1:1.
    if party["ssi"] is not None:
        return ("ssi", party["ssi"].id)
    return ("doc", party["document"].id)


def _amounts_by_party(lines) -> dict:
    totals = {}
    for party, amount in lines:
        if party is not None:
            key = _party_key(party)
            totals[key] = totals.get(key, 0) + amount
    return totals


def _draw_funding_document_pdf(deal: Deal, product_label: str, borrower_parties, lender_parties,
                                third_party_parties, other_parties, loan_amount, interest_rate,
                                upfront_fee, interest_amount, lead_agent_fee, legal_fee, currency) -> bytes:
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

    def new_page():
        state["page"] = doc.new_page(width=612, height=792)
        state["y"] = 60

    def payee_label(party, fallback):
        return party["name"] if party is not None else fallback

    def row(label, amount, size=10, dy=15, bold=False, x=x_label):
        write(label, size=size, dy=0, x=x, bold=bold)
        amount_text = f"{currency} {amount:,.2f}"
        fontname = "hebo" if bold else "helv"
        text_width = fitz.get_text_length(amount_text, fontname=fontname, fontsize=size)
        write(amount_text, size=size, dy=dy, x=x_amount - text_width, bold=bold)

    def rule():
        state["page"].draw_line((x_label, state["y"] - 4), (x_amount, state["y"] - 4), color=(0.6, 0.6, 0.6), width=0.6)
        state["y"] += 4

    def field(label, value):
        write(f"{label}: {value}", size=9, dy=13, x=x_label + 14)

    statement = _build_statement(borrower_parties, lender_parties, third_party_parties,
                                  loan_amount, upfront_fee, interest_amount, lead_agent_fee, legal_fee)

    # ---------- Page 1: Sources & Uses ----------
    write("FUND FLOW / SETTLEMENT AND CLOSING STATEMENT", size=14, dy=22)
    write(f"Deal: {deal.title} ({deal.reference})", size=10, dy=14)
    write(f"Product: {product_label}", size=10, dy=22)

    write("LOAN DETAILS", size=12, dy=18)
    row("Loan Amount", loan_amount)
    write(f"Interest Rate: {interest_rate:.3f}% per annum", size=10, dy=22, x=x_label)

    write("SOURCES OF FUNDS (CREDIT)", size=12, dy=18)
    for party, amount in statement["sources"]:
        row(payee_label(party, "Loan Proceeds (no lender on file yet)"), amount)
    rule()
    row("TOTAL SOURCES", statement["total_sources"], bold=True)
    state["y"] += 10
    if statement["lender_split_note"]:
        write("(Lender contributions shown as an even split - pro-rata allocation not yet tracked per lender.)", size=8, dy=16)

    write("USES OF FUNDS (DEBIT)", size=12, dy=18)
    for title, lines in statement["use_sections"]:
        write(title, size=10.5, dy=15, x=x_label, bold=True)
        for party, amount in lines:
            if title == "Borrower Proceeds":
                label = f"Net Proceeds to Borrower - {payee_label(party, 'Borrower')}"
            else:
                label = f"{title.rstrip('s')} - {payee_label(party, 'Unassigned')}"
            row(label, amount, x=x_label + 14)
        state["y"] += 4
    rule()
    row("TOTAL USES", statement["total_uses"], bold=True)
    state["y"] += 14

    balance = statement["total_sources"] - statement["total_uses"]
    write(f"Balance Check: Sources {currency} {statement['total_sources']:,.2f} - Uses {currency} {statement['total_uses']:,.2f} = {currency} {balance:,.2f}", size=9, dy=14)
    write("BALANCED" if abs(balance) < 0.005 else "OUT OF BALANCE", size=9, dy=22)

    write("This is a system-generated statement assembled from documents on file for this deal.", size=8, dy=12)
    write("SAMPLE / TEST DOCUMENT.", size=8, dy=12)

    # ---------- Page 2: Bank / wire details appendix ----------
    # Deliberately UNMASKED, unlike the Checker's blind re-entry screen —
    # this is the final settlement paperwork, by which point every party's
    # Standing Instruction should already be Checker-validated (that's the
    # whole point of the blind re-entry step). Ops needs the real account
    # and routing numbers to actually place the wires; the status label
    # next to each one still makes it obvious if something here somehow
    # ISN'T validated yet, rather than silently hiding that fact.
    new_page()
    write("APPENDIX - BANK / WIRE DETAILS", size=14, dy=22)
    write("Full account and routing numbers below - this statement is generated once standing", size=8, dy=11)
    write("instructions are expected to already be Checker-validated (see FR-10 blind re-entry).", size=8, dy=20)

    source_amounts = _amounts_by_party(statement["sources"])
    interest_amounts = _amounts_by_party(next((lines for t, lines in statement["use_sections"] if t == "Interest"), []))
    lead_agent_amounts = _amounts_by_party(next((lines for t, lines in statement["use_sections"] if t == "Lead Agent Fees"), []))
    borrower_amounts = _amounts_by_party(next((lines for t, lines in statement["use_sections"] if t == "Borrower Proceeds"), []))
    legal_amounts = _amounts_by_party(next((lines for t, lines in statement["use_sections"] if t == "Legal & Professional Fees"), []))

    def bank_fields(party):
        ssi = party["ssi"]
        if ssi is None:
            field("Bank", "-")
            field("Account Number", "-")
            field("Routing Number", "-")
            field("Status", "No standing instruction on file in this deal")
            return
        field("Bank", ssi.bank_name or "-")
        field("Account Number", ssi.account_number)
        field("Routing Number", ssi.routing_number)
        field("Status", SSI_STATUS_LABELS.get(ssi.status, ssi.status))

    def party_block(party, amount_lines):
        write(party["name"], size=11, dy=15, x=x_label, bold=True)
        bank_fields(party)
        for amount_label, amount in amount_lines:
            if amount:
                field(amount_label, f"{currency} {amount:,.2f}")
        state["y"] += 10

    write("BORROWER", size=12, dy=18)
    if borrower_parties:
        for p in borrower_parties:
            party_block(p, [("Amount", borrower_amounts.get(_party_key(p), 0))])
    else:
        write("None on file.", size=9, dy=16, x=x_label)
        state["y"] += 6

    write("LENDERS", size=12, dy=18)
    if lender_parties:
        for p in lender_parties:
            party_block(p, [
                ("Source Amount", source_amounts.get(_party_key(p), 0)),
                ("Interest Due", interest_amounts.get(_party_key(p), 0)),
                ("Lead Agent Fee", lead_agent_amounts.get(_party_key(p), 0)),
            ])
    else:
        write("None on file.", size=9, dy=16, x=x_label)
        state["y"] += 6

    write("3RD PARTY PROVIDERS", size=12, dy=18)
    if third_party_parties:
        for p in third_party_parties:
            party_block(p, [("Amount", legal_amounts.get(_party_key(p), 0))])
    else:
        write("None on file.", size=9, dy=16, x=x_label)
        state["y"] += 6

    if other_parties:
        write("OTHER PARTIES", size=12, dy=18)
        for p in other_parties:
            party_block(p, [])

    return doc.tobytes()


def generate_funding_document(
    db: Session, deal: Deal, current_user: User, agent: User, storage_path: str,
    loan_amount: float, interest_rate: float, upfront_fee: float, legal_fee: float,
    interest_amount: float = 0.0, lead_agent_fee: float = 0.0, currency: str = "USD",
) -> Document:
    borrower_parties = _parties_for_folder(db, deal.id, "Borrower")
    lender_parties = _parties_for_folder(db, deal.id, "Lenders")
    third_party_parties = _parties_for_folder(db, deal.id, "3rd Party Providers")
    # Point 5: any other party a transfer might go to that doesn't fit the
    # three named folders — the classifier's own catch-all.
    other_parties = _parties_for_folder(db, deal.id, "Unfiled")

    pdf_bytes = _draw_funding_document_pdf(
        deal, deal.product_type, borrower_parties, lender_parties, third_party_parties, other_parties,
        loan_amount, interest_rate, upfront_fee, interest_amount, lead_agent_fee, legal_fee, currency,
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

    statement = _build_statement(borrower_parties, lender_parties, third_party_parties,
                                  loan_amount, upfront_fee, interest_amount, lead_agent_fee, legal_fee)
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
            f'Sources {currency} {statement["total_sources"]:,.2f} = Uses {currency} {statement["total_uses"]:,.2f} — balanced. '
            f'Page 2 lists full bank/wire details for remittance.'
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
