from pypdf import PdfReader

# FR-3: which folder does a document belong in. This is deliberately simple
# keyword matching for the POC — the point of living in backend/ai/ is that
# everything outside this file only ever calls classify_document(), so this
# can be swapped for a real model later without touching anything else.
FOLDER_KEYWORDS = [
    ("Lenders", ["lender wire instructions", "commitment amount", "pro-rata"]),
    ("Credit Verification", ["credit verification", "debt service coverage", "credit rating"]),
    ("Funding Docs", ["funding authorization", "authorized funding amount"]),
    ("Borrower", ["borrower", "settlement account"]),
]


def extract_text(file_path: str, content_type: str) -> str:
    is_pdf = content_type == "application/pdf" or file_path.lower().endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(file_path)
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""

    try:
        with open(file_path, "r", errors="ignore") as f:
            return f.read()
    except Exception:
        return ""


def classify_document(filename: str, text_content: str) -> str:
    haystack = f"{filename} {text_content}".lower()
    for folder, keywords in FOLDER_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return folder
    return "Unfiled"
