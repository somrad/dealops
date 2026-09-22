import os
import time
import httpx

# The backend never reasons about documents or agent replies itself — it
# calls out to ai_api for that and treats the response as an opaque result.
# This file is the entire coupling surface between the two services.
# Local dev defaults to the local ai_api process; Cloud Run sets
# AI_API_BASE_URL to the ai_api service's own Cloud Run URL.
AI_API_BASE_URL = os.environ.get("AI_API_BASE_URL", "http://localhost:8001")

# ai_api is deployed as a PRIVATE Cloud Run service (--no-allow-unauthenticated)
# so the public internet can't invoke it directly and spend our LLM API
# credits — only this backend's own Cloud Run service account, granted
# roles/run.invoker on it, can. Local dev's ai_api has no such check, so
# this is a no-op there (AI_API_REQUIRES_AUTH unset).
_REQUIRES_AUTH = os.environ.get("AI_API_REQUIRES_AUTH", "false").lower() == "true"
_cached_token = None
_cached_token_expiry = 0


def _auth_headers() -> dict:
    if not _REQUIRES_AUTH:
        return {}
    global _cached_token, _cached_token_expiry
    if _cached_token is None or time.time() > _cached_token_expiry:
        import google.auth.transport.requests
        import google.oauth2.id_token
        _cached_token = google.oauth2.id_token.fetch_id_token(google.auth.transport.requests.Request(), AI_API_BASE_URL)
        _cached_token_expiry = time.time() + 55 * 60  # Google ID tokens last ~1hr; refresh a bit early.
    return {"Authorization": f"Bearer {_cached_token}"}


def classify_document(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    # LLM call on the other end now (was rule-based) — same longer timeout as extraction.
    response = httpx.post(f"{AI_API_BASE_URL}/classify-document", files=files, headers=_auth_headers(), timeout=30)
    response.raise_for_status()
    return response.json()  # {"folder": ..., "model_provider": ..., "model_name": ...}


def extract_payment_details(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    # LLM call on the other end — longer timeout than the other calls.
    response = httpx.post(f"{AI_API_BASE_URL}/extract-payment-details", files=files, headers=_auth_headers(), timeout=60)
    response.raise_for_status()
    return response.json()  # {"parties": [...], "model_provider": ..., "model_name": ...}


def extract_deal_line_items(filename: str, content: bytes, content_type: str, folder: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    response = httpx.post(
        f"{AI_API_BASE_URL}/extract-deal-line-items", files=files, data={"folder": folder}, headers=_auth_headers(), timeout=60
    )
    response.raise_for_status()
    return response.json()  # {"items": [...], "model_provider": ..., "model_name": ...}


def extract_fund_flow_statement(filename: str, content: bytes, content_type: str) -> dict:
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    response = httpx.post(f"{AI_API_BASE_URL}/extract-fund-flow-statement", files=files, headers=_auth_headers(), timeout=60)
    response.raise_for_status()
    return response.json()  # {"lines": [...], "model_provider": ..., "model_name": ...}


def get_agent_commands() -> list:
    response = httpx.get(f"{AI_API_BASE_URL}/commands", headers=_auth_headers(), timeout=10)
    response.raise_for_status()
    return response.json()


def agent_respond(command_text: str, agent_name: str, agent_username: str, deal_context: dict) -> str:
    payload = {
        "command_text": command_text,
        "agent_name": agent_name,
        "agent_username": agent_username,
        "deal": deal_context,
    }
    response = httpx.post(f"{AI_API_BASE_URL}/agent-respond", json=payload, headers=_auth_headers(), timeout=30)
    response.raise_for_status()
    return response.json()["reply_text"]
