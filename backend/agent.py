from sqlalchemy.orm import Session

from models import Deal, DealMember, Document, Message, User


def describe_deal(deal: Deal, db: Session) -> str:
    member_count = db.query(DealMember).filter(DealMember.deal_id == deal.id).count()
    message_count = db.query(Message).filter(Message.deal_id == deal.id).count()
    product_label = deal.product_type.replace("_", " ").title()
    return (
        f"{deal.title} ({deal.reference})\n"
        f"Product: {product_label}\n"
        f"Status: {deal.status}\n"
        f"Members: {member_count}\n"
        f"Messages so far: {message_count}"
    )


def list_deal_documents(deal: Deal, db: Session) -> str:
    documents = (
        db.query(Document)
        .filter(Document.deal_id == deal.id)
        .order_by(Document.folder, Document.original_filename)
        .all()
    )
    if not documents:
        return "No documents uploaded yet."

    by_folder = {}
    for doc in documents:
        by_folder.setdefault(doc.folder, []).append(doc.original_filename)

    lines = [f"{len(documents)} document{'s' if len(documents) != 1 else ''} in this deal:"]
    for folder, filenames in by_folder.items():
        lines.append(f"\n{folder} ({len(filenames)}):")
        for name in filenames:
            lines.append(f"  - {name}")
    return "\n".join(lines)


# Registry of agent commands. Add new capabilities here as they're built —
# each command is just a function taking (deal, db) and returning the text
# the agent should reply with. Nothing else needs to change to add one.
AGENT_COMMANDS = {
    "describe": {
        "handler": describe_deal,
        "help": "describe — get a summary of this deal",
    },
    "docs": {
        "handler": list_deal_documents,
        "help": "docs — list all documents in this deal, by folder",
    },
}


def build_menu_text(agent: User) -> str:
    lines = [f"Hi, I'm {agent.name}. Here's what I can do so far:"]
    for i, info in enumerate(AGENT_COMMANDS.values(), start=1):
        lines.append(f"{i}. {info['help']}")
    lines.append(f"\nMention me with a command, e.g. @{agent.username} describe")
    return "\n".join(lines)


def handle_agent_mention(command_text: str, deal: Deal, agent: User, db: Session) -> str:
    words = command_text.strip().split()
    first_word = words[0].lower() if words else ""
    if first_word in AGENT_COMMANDS:
        return AGENT_COMMANDS[first_word]["handler"](deal, db)
    return build_menu_text(agent)
