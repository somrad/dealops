import uuid

# FICTIONAL. dealops has no real Loan IQ integration — this simulates one so
# the "submit a standing instruction to Loan IQ" step can be demoed and
# tested end-to-end. Always succeeds; a real integration would need retry/
# error handling this deliberately skips for now.


def submit_standing_instruction(account_holder_name: str, bank_name: str, account_number: str, routing_number: str) -> dict:
    return {
        "loan_iq_reference": f"LIQ-{uuid.uuid4().hex[:10].upper()}",
        "status": "accepted",
    }
