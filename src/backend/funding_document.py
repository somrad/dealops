import os
import uuid
import pymupdf as fitz
from sqlalchemy.orm import Session

from models import Deal, Document, Message, DealFinancialLine, User
from activity import log_activity
import financial_model
import storage_backend

# FR-13: the Fund Flow / Settlement and Closing Document. Generation is
# deterministic (assembled from the deal's financial model, not an LLM call
# at this stage) - same boundary reasoning as pdf_highlight.py and
# document_diff.py: this is backend work, not ai_api's.
#
# The diagram, this PDF, and the Remittances readiness view all read from
# financial_model.get_deal_financial_model() - ONE model, three consumers.
# See CLAUDE.md's "we cannot have different mental models" note; this
# replaces the old _build_statement()/_parties_for_folder() heuristics
# (even-split lender contributions, "first lender = lead lender", net
# proceeds computed as a plug figure) with real per-party amounts that are
# either extracted from a document or explicitly entered by a Deal Team
# member - never guessed.

SSI_STATUS_LABELS = {
    "pending_checker_review": "Pending Checker review",
    "checker_validated": "Checker validated",
    "rejected": "Rejected",
    "superseded": "Superseded",
}


def _parties_for_folder(db: Session, deal_id: int, folder: str) -> list:
    # Party NAMES only, for the dashboard tile and the agent's describe/chat
    # context - sourced from DealFinancialLine.party_name (itself extracted
    # directly from the document's own text), deliberately NOT from
    # StandingInstruction. A party's identity should never depend on
    # whether a separate, unrelated bank-detail extraction happened to
    # succeed on the same document.
    docs = db.query(Document).filter(Document.deal_id == deal_id, Document.folder == folder).all()
    superseded_ids = {d.supersedes_id for d in docs if d.supersedes_id is not None}
    heads = [d for d in docs if d.id not in superseded_ids]

    names = []
    seen = set()
    for doc in heads:
        lines = db.query(DealFinancialLine).filter(DealFinancialLine.document_id == doc.id).all()
        if lines:
            for line in lines:
                if line.party_name not in seen:
                    names.append(line.party_name)
                    seen.add(line.party_name)
        else:
            fallback_name = os.path.splitext(doc.original_filename)[0].replace("_", " ").replace("-", " ").strip().title()
            name = fallback_name or doc.original_filename
            if name not in seen:
                names.append(name)
                seen.add(name)
    return [{"name": n} for n in names]


def _draw_funding_document_pdf(db: Session, deal: Deal, product_label: str, model: dict, currency: str) -> bytes:
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

    def row(label, amount, size=10, dy=15, bold=False, x=x_label):
        write(label, size=size, dy=0, x=x, bold=bold)
        amount_text = f"{currency} {(amount or 0):,.2f}"
        fontname = "hebo" if bold else "helv"
        text_width = fitz.get_text_length(amount_text, fontname=fontname, fontsize=size)
        write(amount_text, size=size, dy=dy, x=x_amount - text_width, bold=bold)

    def rule():
        state["page"].draw_line((x_label, state["y"] - 4), (x_amount, state["y"] - 4), color=(0.6, 0.6, 0.6), width=0.6)
        state["y"] += 4

    def field(label, value):
        write(f"{label}: {value}", size=9, dy=13, x=x_label + 14)

    # ---------- Page 1: Sources & Uses ----------
    write("FUND FLOW / SETTLEMENT AND CLOSING STATEMENT", size=14, dy=22)
    write(f"Deal: {deal.title} ({deal.reference})", size=10, dy=14)
    write(f"Product: {product_label}", size=10, dy=22)

    write("SOURCES OF FUNDS (CREDIT)", size=12, dy=18)
    for line in model["sources"]:
        row(f"{line['category']} - {line['party_name']}", line["amount"])
    rule()
    row("TOTAL SOURCES", model["total_sources"], bold=True)
    state["y"] += 10

    write("USES OF FUNDS (DEBIT)", size=12, dy=18)
    grouped, order = {}, []
    for line in model["uses"]:
        if line["category"] not in grouped:
            grouped[line["category"]] = []
            order.append(line["category"])
        grouped[line["category"]].append(line)
    for category in order:
        write(category, size=10.5, dy=15, x=x_label, bold=True)
        for line in grouped[category]:
            row(line["party_name"], line["amount"], x=x_label + 14)
        state["y"] += 4
    rule()
    row("TOTAL USES", model["total_uses"], bold=True)
    state["y"] += 14

    balance = model["total_sources"] - model["total_uses"]
    write(f"Balance Check: Sources {currency} {model['total_sources']:,.2f} - Uses {currency} {model['total_uses']:,.2f} = {currency} {balance:,.2f}", size=9, dy=14)
    write("BALANCED" if abs(balance) < 0.005 else "OUT OF BALANCE", size=9, dy=22)

    write("This is a system-generated statement assembled from this deal's financial model - every", size=8, dy=12)
    write("amount below was either extracted from a source document or entered by a Deal Team member.", size=8, dy=12)
    write("SAMPLE / TEST DOCUMENT.", size=8, dy=12)

    # ---------- Page 2: Bank / wire details appendix ----------
    # Deliberately UNMASKED, unlike the Checker's blind re-entry screen -
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

    raw_lines_by_id = {l.id: l for l in db.query(DealFinancialLine).filter(DealFinancialLine.deal_id == deal.id).all()}

    def bank_fields(line_out):
        ssi = financial_model.find_ssi_for_line(db, deal.id, raw_lines_by_id[line_out["id"]])
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

    def party_section(title, role):
        write(title, size=12, dy=18)
        lines = [l for l in model["lines"] if l["role"] == role]
        if not lines:
            write("None on file.", size=9, dy=16, x=x_label)
            state["y"] += 6
            return
        by_party = {}
        order = []
        for l in lines:
            if l["party_name"] not in by_party:
                by_party[l["party_name"]] = []
                order.append(l["party_name"])
            by_party[l["party_name"]].append(l)
        for name in order:
            party_lines = by_party[name]
            write(name, size=11, dy=15, x=x_label, bold=True)
            bank_fields(party_lines[0])
            for l in party_lines:
                if l["amount"]:
                    field(l["category"], f"{currency} {l['amount']:,.2f}")
            state["y"] += 10

    party_section("BORROWER", "borrower")
    party_section("LENDERS", "lender")
    party_section("3RD PARTY PROVIDERS", "third_party")
    if any(l["role"] == "other" for l in model["lines"]):
        party_section("OTHER PARTIES", "other")

    return doc.tobytes()


def generate_funding_document(db: Session, deal: Deal, current_user: User, agent: User) -> Document:
    # No loan-economics arguments anymore - this reads the deal's financial
    # model directly (financial_model.get_deal_financial_model()). Raises
    # ValueError, caught by the route as a 400, if the model isn't complete
    # or doesn't balance; filling in missing amounts happens through the
    # separate financial-model endpoints BEFORE this is called.
    #
    # Re-syncs first — a real click ("Save & Generate"), not the poll, so
    # the generated document reflects whatever's on file at THIS moment.
    financial_model.sync_all_financial_lines_for_deal(db, deal.id)
    model = financial_model.get_deal_financial_model(db, deal.id)
    if not model["has_lines"]:
        raise ValueError("No financial line items on file yet. Upload Borrower/Lenders/3rd Party documents first.")
    if not model["all_known"]:
        missing_desc = ", ".join(f"{l['party_name']} ({l['category']})" for l in model["missing"])
        raise ValueError(f"Still missing amounts for: {missing_desc}. Fill these in before generating.")
    if not model["balanced"]:
        raise ValueError(
            f"Sources ({model['total_sources']:,.2f}) and Uses ({model['total_uses']:,.2f}) don't balance. "
            "Review the amounts before generating."
        )

    currency = model["lines"][0]["currency"] if model["lines"] else "USD"
    pdf_bytes = _draw_funding_document_pdf(db, deal, deal.product_type, model, currency)

    stored_filename = f"{uuid.uuid4().hex}.pdf"
    storage_backend.write_file(deal.id, stored_filename, pdf_bytes)

    # FR-6 applies here too: regenerating (or replacing via upload) isn't a
    # new, unrelated document - it's a new version of whichever one this
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

    borrower_count = len({l["party_name"] for l in model["lines"] if l["role"] == "borrower"})
    lender_count = len({l["party_name"] for l in model["lines"] if l["role"] == "lender"})
    third_party_count = len({l["party_name"] for l in model["lines"] if l["role"] == "third_party"})

    db.add(Message(deal_id=deal.id, user_id=current_user.id, text="Requested generation of the Fund Flow / Settlement and Closing Document."))
    db.commit()
    db.add(Message(
        deal_id=deal.id,
        user_id=agent.id,
        text=(
            f'Generated "{filename}" - {borrower_count} borrower part{"y" if borrower_count == 1 else "ies"}, '
            f'{lender_count} lender{"s" if lender_count != 1 else ""}, '
            f'{third_party_count} third-party provider{"s" if third_party_count != 1 else ""} included, '
            f"drawn from this deal's financial model. "
            f'Filed under Funding Docs{" - superseding the previous version" if previous_fund_flow_id else ""}. '
            f'Sources {currency} {model["total_sources"]:,.2f} = Uses {currency} {model["total_uses"]:,.2f} - balanced. '
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


def build_diagram_data(db: Session, deal: Deal) -> dict:
    # The Deal Map fund-flow diagram - a visual reshape of
    # get_deal_financial_model()'s own output, not a second calculation.
    # Only drawn once every line item has a known amount - a partial model
    # would need to render null amounts, which is worse than a clear
    # "still missing N items" message pointing at where to fill them in.
    model = financial_model.get_deal_financial_model(db, deal.id)
    if not model["has_lines"]:
        return {"has_data": False, "missing_count": 0}
    if not model["all_known"]:
        return {"has_data": False, "missing_count": len(model["missing"])}

    currency = model["lines"][0]["currency"] if model["lines"] else "USD"
    sources = [{"name": l["party_name"], "category": l["category"], "amount": l["amount"]} for l in model["sources"]]

    # Every USE line becomes its own diagram node — each one is a distinct
    # remittance (a separate wire), so merging several into one box would
    # hide that there's more than one payment happening. No grouping/summing
    # by party here; that's what made the old diagram misleading once a
    # party had more than one line (e.g. a law firm billing four separate
    # fee categories on one invoice is four separate wires, not one).
    borrower_lines = []
    fee_lines = []
    legal_lines = []
    for l in model["uses"]:
        if l["role"] == "borrower":
            borrower_lines.append({"name": l["party_name"], "category": l["category"], "amount": l["amount"]})
        elif l["role"] == "third_party":
            legal_lines.append({"party": l["party_name"], "category": l["category"], "amount": l["amount"]})
        else:
            fee_lines.append({"section": l["category"], "party": l["party_name"], "amount": l["amount"]})

    return {
        "has_data": True,
        "missing_count": 0,
        "currency": currency,
        "total_sources": model["total_sources"],
        "total_uses": model["total_uses"],
        "sources": sources,
        "borrower_lines": borrower_lines,
        "fee_lines": fee_lines,
        "legal_lines": legal_lines,
    }


def get_remittance_readiness(db: Session, deal_id: int) -> dict:
    # FR-14's readiness view - a party is "Ready" once its amount is known
    # AND its Standing Instruction (if any document on file produced one)
    # is Checker-validated. Same shape as the old PDF-text reconciliation
    # this replaces ({borrower, lenders, third_party} -> [{name, status,
    # confirmed}]) so the frontend Remittances panel needed no rewrite -
    # only what "confirmed" means underneath changed: a real known amount,
    # not a fragile substring match against generated PDF text.
    model = financial_model.get_deal_financial_model(db, deal_id)
    raw_by_id = {l.id: l for l in db.query(DealFinancialLine).filter(DealFinancialLine.deal_id == deal_id).all()}

    def group(role):
        seen = {}
        order = []
        for line_out in model["lines"]:
            if line_out["role"] != role:
                continue
            name = line_out["party_name"]
            confirmed = line_out["amount"] is not None
            if name not in seen:
                ssi = financial_model.find_ssi_for_line(db, deal_id, raw_by_id[line_out["id"]])
                status = ssi.status if ssi is not None else "no_ssi_on_file"
                seen[name] = {"name": name, "status": status, "confirmed": confirmed}
                order.append(name)
            else:
                seen[name]["confirmed"] = seen[name]["confirmed"] and confirmed
        return [seen[n] for n in order]

    return {
        "borrower": group("borrower"),
        "lenders": group("lender"),
        "third_party": group("third_party"),
    }
