import os
import difflib
from itertools import zip_longest
import pymupdf as fitz

# Deterministic text comparison — not AI reasoning, so this stays in the
# backend rather than ai_api, same boundary reasoning as pdf_highlight.py.


def extract_text_for_diff(stored_path: str, content_type: str) -> str:
    if not os.path.exists(stored_path):
        return ""
    is_pdf = content_type == "application/pdf" or stored_path.lower().endswith(".pdf")
    if is_pdf:
        doc = fitz.open(stored_path)
        return "\n".join(page.get_text() for page in doc)
    with open(stored_path, "rb") as f:
        return f.read().decode("utf-8", errors="ignore")


def _inline_diff(a: str, b: str):
    # Character-level diff within one changed line pair — this is what lets
    # the UI highlight just "5510098765" -> "5510098799" instead of tinting
    # the entire line, matching a PR "rich diff" rather than a blunt +/- .
    matcher = difflib.SequenceMatcher(None, a, b)
    left, right = [], []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            left.append({"text": a[i1:i2], "changed": False})
            right.append({"text": b[j1:j2], "changed": False})
        elif tag == "delete":
            left.append({"text": a[i1:i2], "changed": True})
        elif tag == "insert":
            right.append({"text": b[j1:j2], "changed": True})
        elif tag == "replace":
            left.append({"text": a[i1:i2], "changed": True})
            right.append({"text": b[j1:j2], "changed": True})
    return left, right


def build_diff_rows(text_a: str, text_b: str) -> list:
    # Side-by-side, aligned rows (left = doc A, right = doc B) — the shape a
    # split/WinDiff-style view needs, as opposed to a single unified +/-
    # stream. A large context window isn't a factor here since every line
    # gets a row either way (these are short deal documents).
    lines_a = text_a.splitlines()
    lines_b = text_b.splitlines()
    matcher = difflib.SequenceMatcher(None, lines_a, lines_b)
    rows = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for la, lb in zip(lines_a[i1:i2], lines_b[j1:j2]):
                rows.append({
                    "type": "equal",
                    "left_segments": [{"text": la, "changed": False}],
                    "right_segments": [{"text": lb, "changed": False}],
                })
        elif tag == "delete":
            for la in lines_a[i1:i2]:
                rows.append({"type": "remove", "left_segments": [{"text": la, "changed": True}], "right_segments": None})
        elif tag == "insert":
            for lb in lines_b[j1:j2]:
                rows.append({"type": "add", "left_segments": None, "right_segments": [{"text": lb, "changed": True}]})
        elif tag == "replace":
            for la, lb in zip_longest(lines_a[i1:i2], lines_b[j1:j2]):
                if la is None:
                    rows.append({"type": "add", "left_segments": None, "right_segments": [{"text": lb, "changed": True}]})
                elif lb is None:
                    rows.append({"type": "remove", "left_segments": [{"text": la, "changed": True}], "right_segments": None})
                else:
                    left_segs, right_segs = _inline_diff(la, lb)
                    rows.append({"type": "replace", "left_segments": left_segs, "right_segments": right_segs})

    return rows
