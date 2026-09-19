# Every function here takes plain data (a dict the backend assembled from its
# own DB) and returns plain text — no DB session, no ORM objects. That's the
# actual point of this being a separate service: the backend does context
# engineering (deciding what's relevant and building this dict); this module
# only ever reasons over what it's handed.


def describe_deal(deal: dict) -> str:
    product_label = deal["product_type"].replace("_", " ").title()
    ssis = deal.get("standing_instructions", [])
    pending = sum(1 for s in ssis if s["status"] == "pending_checker_review")
    return (
        f"{deal['title']} ({deal['reference']})\n"
        f"Product: {product_label}\n"
        f"Status: {deal['status']}\n"
        f"Members: {deal['member_count']}\n"
        f"Messages so far: {deal['message_count']}\n"
        f"Standing instructions: {len(ssis)} ({pending} awaiting Checker review)"
    )


def list_deal_documents(deal: dict) -> str:
    documents = deal.get("documents", [])
    if not documents:
        return "No documents uploaded yet."

    by_folder = {}
    for doc in documents:
        by_folder.setdefault(doc["folder"], []).append(doc["filename"])

    lines = [f"{len(documents)} document{'s' if len(documents) != 1 else ''} in this deal:"]
    for folder, filenames in by_folder.items():
        lines.append(f"\n{folder} ({len(filenames)}):")
        for name in filenames:
            lines.append(f"  - {name}")
    return "\n".join(lines)


def list_standing_instructions(deal: dict) -> str:
    ssis = deal.get("standing_instructions", [])
    if not ssis:
        return "No standing instructions yet."

    lines = [f"{len(ssis)} standing instruction{'s' if len(ssis) != 1 else ''}:"]
    for s in ssis:
        who = s["account_holder_name"] or "unnamed party"
        ref = f" (Loan IQ ref {s['loan_iq_reference']})" if s["loan_iq_reference"] else ""
        lines.append(f"  - {who}: {s['status']}{ref}")
    return "\n".join(lines)


def list_pending_validations(deal: dict) -> str:
    # Deliberately read-only: ai_api has no DB access and can't perform the
    # actual write, and blind re-entry (FR-10) was a deliberate choice to
    # keep as a dedicated UI flow, not a chat command — typing the account
    # number into a shared, logged channel would undercut the point of a
    # blind, independent check. This just tells you what's waiting.
    ssis = deal.get("standing_instructions", [])
    pending = [s for s in ssis if s["status"] == "pending_checker_review"]
    if not pending:
        return "Nothing awaiting Checker validation right now."

    lines = [f"{len(pending)} standing instruction{'s' if len(pending) != 1 else ''} awaiting Checker validation:"]
    for s in pending:
        lines.append(f"  - {s['account_holder_name'] or 'unnamed party'}")
    lines.append("\nOpen the SSI panel (left rail) and use Approve to validate — blind re-entry happens there, not in chat.")
    return "\n".join(lines)


def funding_document_status(deal: dict) -> str:
    # Read-only, same reasoning as list_pending_validations — generating or
    # uploading the Fund Flow Document is a write (a new Document row, a
    # Deal.fund_flow_document_id update), which ai_api can't do without a DB
    # session. This just reports status and points at the real action.
    ff = deal.get("fund_flow_document")
    if ff:
        return (
            f'Fund Flow / Settlement and Closing Document on file: "{ff["filename"]}".\n'
            f"Open Remittances (left rail) to review reconciliation or regenerate it."
        )
    return (
        "No Fund Flow / Settlement and Closing Document yet for this deal.\n"
        "Only a Deal Team member can create one — open Remittances (left rail) to "
        "generate it from the deal's standing instructions, or upload an existing "
        "settlement/closing PDF there."
    )


# Registry of agent commands/skills. Add new capabilities here as they're
# built — each is a function taking the deal context dict and returning the
# reply text. Nothing else needs to change to add one.
AGENT_COMMANDS = {
    "describe": {
        "handler": describe_deal,
        "help": "describe — get a summary of this deal",
    },
    "docs": {
        "handler": list_deal_documents,
        "help": "docs — list all documents in this deal, by folder",
    },
    "ssi": {
        "handler": list_standing_instructions,
        "help": "ssi — list standing instructions and their Checker-review status",
    },
    "validate": {
        "handler": list_pending_validations,
        "help": "validate — list standing instructions awaiting Checker validation",
    },
    "generate-funding-document": {
        "handler": funding_document_status,
        # The real handler for this now lives in backend/routes/chat.py
        # (GENERATE_FUNDING_PATTERN) — a write action needs a DB session,
        # which this service never has — so it intercepts the exact command
        # before it ever reaches here. This entry stays registered purely so
        # /commands (the frontend's autocomplete) still lists it with the
        # right usage; funding_document_status() below is unreachable in
        # normal use, kept only as a harmless fallback.
        "help": "generate-funding-document <amount> <rate> [<upfront_fee> <legal_fee>] — generate the Fund Flow Document (Deal Team only)",
    },
}


def build_menu_text(agent_name: str, agent_username: str) -> str:
    lines = [f"Hi, I'm {agent_name}. Here's what I can do so far:"]
    for i, info in enumerate(AGENT_COMMANDS.values(), start=1):
        lines.append(f"{i}. {info['help']}")
    lines.append(f"\nMention me with a command, e.g. @{agent_username} describe")
    return "\n".join(lines)


def handle_agent_mention(command_text: str, agent_name: str, agent_username: str, deal: dict) -> str:
    words = command_text.strip().split()
    first_word = words[0].lower() if words else ""
    if first_word in AGENT_COMMANDS:
        return AGENT_COMMANDS[first_word]["handler"](deal)
    return build_menu_text(agent_name, agent_username)
