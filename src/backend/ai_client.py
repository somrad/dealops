import httpx

# The backend never reasons about documents or agent replies itself — it
# calls out to ai_api for that and treats the response as an opaque result.
# This file is the entire coupling surface between the two services.
AI_API_BASE_URL = "http://localhost:8001"


def classify_document(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    # LLM call on the other end now (was rule-based) — same longer timeout as extraction.
    response = httpx.post(f"{AI_API_BASE_URL}/classify-document", files=files, timeout=30)
    response.raise_for_status()
    return response.json()  # {"folder": ..., "model_provider": ..., "model_name": ...}


def extract_payment_details(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    # LLM call on the other end — longer timeout than the other calls.
    response = httpx.post(f"{AI_API_BASE_URL}/extract-payment-details", files=files, timeout=60)
    response.raise_for_status()
    return response.json()  # {"parties": [...], "model_provider": ..., "model_name": ...}


def extract_deal_line_items(filename: str, content: bytes, content_type: str, folder: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    response = httpx.post(
        f"{AI_API_BASE_URL}/extract-deal-line-items", files=files, data={"folder": folder}, timeout=60
    )
    response.raise_for_status()
    return response.json()  # {"items": [...], "model_provider": ..., "model_name": ...}


def extract_fund_flow_statement(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    response = httpx.post(f"{AI_API_BASE_URL}/extract-fund-flow-statement", files=files, timeout=60)
    response.raise_for_status()
    return response.json()  # {"lines": [...], "model_provider": ..., "model_name": ...}


def get_agent_commands() -> list:
    response = httpx.get(f"{AI_API_BASE_URL}/commands", timeout=10)
    response.raise_for_status()
    return response.json()


def agent_respond(command_text: str, agent_name: str, agent_username: str, deal_context: dict) -> str:
    payload = {
        "command_text": command_text,
        "agent_name": agent_name,
        "agent_username": agent_username,
        "deal": deal_context,
    }
    response = httpx.post(f"{AI_API_BASE_URL}/agent-respond", json=payload, timeout=30)
    response.raise_for_status()
    return response.json()["reply_text"]
