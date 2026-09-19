import pymupdf as fitz

# Light green, matches the "checkpoint went green" language used elsewhere
# in the product (Signal Board) — same color vocabulary for "this is right".
HIGHLIGHT_COLOR = (0.72, 0.96, 0.76)


def highlight_terms_in_pdf(pdf_bytes: bytes, terms: list) -> bytes:
    # Points the Checker at exactly where a value came from without ever
    # showing them the system's extracted value itself — the highlight marks
    # a spot in the source document, which is the one thing blind re-entry
    # still trusts.
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    for page in doc:
        for term in terms:
            term = (term or "").strip()
            if not term:
                continue
            for rect in page.search_for(term):
                annot = page.add_highlight_annot(rect)
                annot.set_colors(stroke=HIGHLIGHT_COLOR)
                annot.update()
    return doc.tobytes()
