dealops — Sample Test Documents
================================
These are FICTIONAL sample documents created to test the dealops POC.
No real people, companies, or account numbers are represented.

This folder is intentionally kept OUTSIDE the application source code
(it's test data, not code) so it never gets mixed into the codebase itself.

All documents are PDFs (converted from plain text with macOS's built-in
`cupsfilter`), so they behave like real uploaded loan documents would.

Deal 1: commercial_loan_acme_manufacturing/
  - A standard commercial loan with two syndicated lenders.
  - lenders/lender_wire_instructions_v1.pdf and _v2.pdf exist specifically
    to test document version diffing (FR-6) — Lender 1's account number
    was corrected between v1 and v2. Upload v1 first, then v2, to see the
    diff feature catch the change.

Deal 2: real_estate_loan_maple_street/
  - A real estate loan where funds must go to a title/escrow company,
    not directly to the borrower.
  - Exists specifically to test the AI discrepancy detection feature
    (FR-12) — the system should catch that funds should NOT go to the
    Borrower here, flag it, and require a manual override.

How to use these:
  Drag any of these .pdf files into a Deal Room in the dealops app to
  simulate a real document upload, and see auto-foldering (FR-3), the
  signal board (FR-11), diffing (FR-6), or discrepancy detection (FR-12)
  in action depending on which file you use.
