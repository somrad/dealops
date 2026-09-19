import io

from pypdf import PdfReader

# FR-3: which folder does a document belong in. Deliberately simple keyword
# matching for the POC — the point of this being its own service (not just
# its own file) is that the backend never sees this logic at all, only the
# HTTP contract (bytes in, folder out). Swapping this for a real model later
# doesn't touch the backend.
FOLDER_KEYWORDS = [
    ("Lenders", ["lender wire instructions", "commitment amount", "pro-rata"]),
    ("Credit Verification", ["credit verification", "debt service coverage", "credit rating"]),
    ("Funding Docs", ["funding authorization", "authorized funding amount"]),
    ("Borrower", ["borrower", "settlement account"]),
]


def extract_text(content: bytes, content_type: str, filename: str) -> str:
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""

    try:
        return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def classify_document(filename: str, text_content: str) -> str:
    haystack = f"{filename} {text_content}".lower()
    for folder, keywords in FOLDER_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return folder
    return "Unfiled"
