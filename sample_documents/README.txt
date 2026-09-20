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

Deal 3: commercial_loan_lfp_batteries/
  - A straightforward commercial loan for "LFP Batteries Inc" — one
    borrower, two syndicated lenders (Pacific Crest Capital Partners,
    Cascade Industrial Lending Group), no diffing/discrepancy scenario
    baked in. Deal Reference matches the actual "LFP Batteries Inc" deal
    (CL-2026-0200) in the app's seed data, so it reads as authentic when
    uploaded there for a demo.
    third_party_providers/legal_advisory_fee_statement_hartwell_boyd.pdf
    — a legal advisory fee statement genuinely written for this deal
    (Matter: LFP Batteries Inc, Loan Reference: CL-2026-0200), USD
    1,083,000 across 4 fee categories (Advisory Fees / Due Diligence
    Coordination / Filing and Recording / Courier). Supersedes an earlier
    same-named file that had wrongly carried Riverside Logistics Loan's
    own header fields (Matter/Loan Reference) despite being uploaded to
    this deal for testing — caught when the founder asked where a
    $45,000 figure in LFP's financial model actually came from (it
    didn't come from any real document at all; see CLAUDE.md).

Deal 4: commercial_loan_riverside_logistics/
  - A full document set for "Riverside Logistics Loan" (Deal Reference
    CL-2026-0100, matching the actual deal in the app's seed data):
      borrower/borrower_loan_agreement.pdf — Riverside Logistics Group
        LLC, a USD 12,000,000 facility.
      lenders/lender_wire_instructions.pdf — two syndicated lenders,
        Timberline Capital Partners (60%) and Anchor Point Commercial
        Lending (40%), summing to the full facility amount.
      third_party_providers/ — three separate fee statements, Hartwell &
        Boyd LLP (structuring & corporate advisory), Coastal Maritime
        Legal Group (fleet/warehouse asset & regulatory advisory), and
        Beacon Trade Compliance Counsel (cross-border customs/trade
        advisory), each billing just over USD 1,000,000 (USD 1,083,000 /
        USD 1,172,450 / USD 1,035,450) with its own bank/account/routing
        details. Exists to exercise the case where a folder has MULTIPLE
        distinct 3rd Party Provider documents rather than one — each
        becomes its own Standing Instruction, and the Fund Flow
        Document's "Legal & Professional Fees" section splits across all
        three when generated.
    This deal has no Checker member in the seed data, so uploading any
    of these also exercises FR-15's fallback-assignment behavior — each
    resulting Standing Instruction gets routed to the deal's Ops Manager
    (Omar) for oversight instead of sitting unassigned.

How to use these:
  Drag any of these .pdf files into a Deal Room in the dealops app to
  simulate a real document upload, and see auto-foldering (FR-3), the
  signal board (FR-11), diffing (FR-6), or discrepancy detection (FR-12)
  in action depending on which file you use.
