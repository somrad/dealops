# dealops — Functional Specifications

> Status: pre-implementation. This document is a functional spec derived from the product vision in `../CLAUDE.md`. It has **not** been reviewed for technical feasibility or scoped into engineering tasks yet — that happens after the vision conversation with the founder concludes.

## 1. Overview

dealops bridges origination (nCino-style) and servicing/structuring (Loan IQ-style) for commercial loan deals. The centerpiece of the collaboration layer is the **Deal Room**: a per-deal workspace combining chat, document management, team membership, and workflow actions.

## 2. Actors / Roles

| Role | Description |
|---|---|
| **Deal Team Member** | Originates and manages a deal; uploads documents; requests ops staffing; triggers funding once ready. |
| **Ops Team Manager / Admin** | Assigns ops team members to a deal; has all Ops Team Member permissions plus membership management. |
| **Ops Team Member** | Added to a specific deal by an Ops Manager/Admin; works the deal's servicing/structuring tasks within its Deal Room; executes funding/disbursement. |
| **Checker** | Added to a Deal Room to independently verify critical deal data via explicit point-and-call confirmations (see FR-10) before funding can proceed. Distinct from Deal Team and Ops Team — a verification/segregation-of-duties role. |

A user may hold roles across multiple deals simultaneously (e.g. Ops Manager on Deal A, Ops Team Member on Deal B), and both Deal Team Members and Ops Team Members work **multiple deals concurrently**.

**Ops Manager standing visibility:** Ops Managers/Admins have access to *every* Deal Room by default (an oversight role), even before any Ops Team Member has been assigned to that deal. This is what allows FR-1's staffing request to be seen and actioned in-chat.

## 3. Core Entities

- **Deal** — a commercial loan deal of a given loan product type; has a status, a Deal Room, a document set, and standing instructions.
- **Deal Room** — the per-deal workspace: membership list, chat/message log, document folders.
- **Document** — an uploaded file, belongs to exactly one Deal, classified into a folder category, may have multiple versions.
- **Folder Category** — classification bucket for documents within a deal (e.g. Borrower, Lenders, Credit Verification, Funding Docs — extensible, not a fixed enum).
- **Standing Instruction** — a payment/settlement instruction record derived from extracted borrower/lender account details, submitted to the mock Loan IQ API.
- **Fund Flow Document (a.k.a. Settlement and Closing Document)** — the authoritative document stating how much each party is owed at closing (see FR-13); distinct from the account-detail documents behind each Standing Instruction.
- **Remittance** — a per-party disbursement, gated on that party's Standing Instruction being Checker-validated (see FR-14).
- **Audit Log Entry** — an immutable record of a Deal Room conversation message or a significant deal action.

## 4. Functional Requirements

### FR-1 — Ops Staffing Request
A Deal Team Member can, from within a deal's Deal Room, submit a request — **posted as a chat message/event in the Deal Room itself** — that an Ops Manager/Admin assign one or more Ops Team Members to the deal.
- Because Ops Managers/Admins have standing visibility into every Deal Room (see Section 2), they see the request the moment it's posted, without needing to be separately notified via an outside queue.
- The Ops Manager/Admin responds and assigns directly in that same chat thread (see FR-4) — the whole request → assignment exchange is one continuous in-chat conversation, logged like any other message (FR-7).
- A Deal Team Member cannot directly add Ops Team Members themselves — only request.

### FR-2 — Drag-and-Drop Document Upload
A Deal Team Member can drag and drop one or more loan documents at once into the Deal Room chat.
- Multiple files in a single drop are all accepted and processed individually.
- Each uploaded document appears in the chat as a message/event and in the deal's document set.

### FR-3 — Automatic Document Folder Arrangement
Each uploaded document is automatically classified into a folder category (e.g. Borrower, Lenders, Credit Verification, Funding Docs) without manual filing by the user.
- If a document cannot be confidently classified, it is placed into an "Unfiled" / "Needs Review" category rather than silently dropped or misfiled.
- A user can see which folder a document landed in and (open question, see `CLAUDE.md`) may be able to correct its classification.

### FR-4 — Ops Team Membership Management
An Ops Manager/Admin can add one or more Ops Team Members to a specific deal.
- Adding a member grants that member access to the deal's Deal Room: its chat history, documents, and status.
- Only Ops Managers/Admins may add Ops Team Members (Deal Team Members cannot).

### FR-5 — Standing Instruction Extraction & Mock Loan IQ Submission
The system extracts borrower account details and lender account details from deal documents/data and submits them to a **mock Loan IQ API** to create standing instructions.
- This runs as a background process (not blocking the deal team's or ops team's workflow).
- The outcome (created / failed / needs-review) is visible within the Deal Room.

### FR-6 — Document Version Diffing
When a new version of a lender document is dropped into an existing deal's Deal Room, the system detects that it is a new version of a prior document and displays a diff between the previous and new versions.
- The system needs a way to determine that two uploads are "versions of the same document" (exact mechanism is an open question — see `CLAUDE.md`).
- The diff is viewable from within the Deal Room, associated with the upload event.

### FR-7 — Conversation Logging
All Deal Room conversations (messages) are logged persistently, per deal, for audit purposes.
- Logs are immutable (no edit/delete that removes audit trail) — an edit or retraction, if ever supported, must be recorded as a new event, not an erasure.
- Logs are retrievable per-deal by authorized users.

### FR-8 — Deal Finalization / Funding Trigger
Once a deal is ready, a Deal Team Member (with appropriate authority) triggers a prominent, explicit completion action ("the big beautiful button").
- Triggering this action changes the deal's status and signals to the Ops Team that funds are ready to be disbursed to the borrower.
- This is a deliberate, single, explicit action — not an implicit side effect of another step.
- **Gated by FR-10:** the funding trigger is only enabled once all of a deal's required Checker point-and-call confirmations are complete. If any required checkpoint is unconfirmed, the action is disabled (not merely warned-against).

### FR-9 — Multi-Deal Concurrency
Deal Team Members and Ops Team Members work on multiple deals at the same time.
- Each Deal Room's chat, documents, and membership are strictly scoped to its own deal — no cross-deal visibility or bleed.
- Users need a way to navigate across their multiple active deals (e.g. a deal list/dashboard) — this connects to the "ops task queue / status tracker" MVP pillar already in `CLAUDE.md`.

### FR-10 — Checkers & Point-and-Call Verification ("digital shisa kanko")
A Deal Room can include one or more **Checkers** — a role distinct from Deal Team and Ops Team, focused on independent verification of critical deal data before funds move.

Modeled on *shisa kanko* (指差喚呼), the Japanese rail safety practice where an operator points at a specific gauge/signal and calls out its status aloud, engaging sight, motion, and voice to force active attention rather than a passive glance.

- The deal defines a set of **required checkpoints** — critical, high-risk data points that must be explicitly verified before funds move. Baseline checkpoint list:

  **Borrower checkpoints**
  - Borrower legal name matches the signed credit agreement (not just "close enough")
  - Borrower settlement account number
  - Borrower routing/ABA (or SWIFT, for international) number

  **Lender checkpoints** (matters more on syndicated deals with multiple lenders)
  - Each lender's settlement account/wire instructions
  - Each lender's commitment amount / pro-rata share
  - All lender shares sum to 100% of the facility (no over- or under-allocation)

  **Funding checkpoints**
  - Total funding amount matches the credit-approved amount
  - Currency is correct
  - Interest rate/pricing matches approved terms
  - Funding/value date

  **Consistency checkpoints**
  - Signed documents match what's recorded in the deal (no unapproved last-minute change)
  - All required closing documents are present — nothing missing before money moves

  **Standing instruction checkpoint** (ties back to FR-5)
  - The account details extracted automatically for the mock Loan IQ standing instruction actually match the source document — i.e. a Checker isn't trusting the extraction blindly, they're pointing-and-calling the extracted number against the original doc.

  **Recipient/payee checkpoint** (added after the real estate title-company case — see FR-12)
  - The actual intended recipient of funds matches who the system assumes it is. This is **not always the borrower** — e.g. in real estate deals, funds are sometimes contractually directed to a title company/escrow agent instead of the borrower directly. This checkpoint exists specifically to catch that mismatch before funding.

  **RESOLVED — this list must flex per loan product** (e.g. the pro-rata check only applies to syndicated deals, a real estate deal needs the recipient/payee checkpoint front-and-center). This follows directly from the deployment model in Section 5: one instance serves multiple product types concurrently, so per-product checkpoint configuration is a hard requirement, not an edge case.
- For each checkpoint, a Checker performs an explicit **point-and-call via blind re-entry**: the Checker independently **re-types** the critical value (e.g. the account number) rather than viewing and approving the auto-detected value. Configurable depth per checkpoint: full re-entry of all digits, or a partial spot-check (e.g. "re-enter the 5th digit" or "re-enter the last 3 digits"). The system compares what the Checker typed against the auto-detected/extracted value.
  - **Match** → the checkpoint is confirmed. The system posts a message visible to **all** Deal Room participants that verification for that checkpoint is complete (e.g. "Borrower account number — verified by [Checker]"), and this is logged per FR-7.
  - **Mismatch** → the checkpoint is **not** confirmed; it is flagged as a discrepancy (same handling as an explicit rejection — see below) rather than silently retried.
- **RESOLVED — auto-detection alone is not sufficient.** FR-11's document-driven auto-detection only makes a value *available* for verification; it does not by itself satisfy a checkpoint. Only a Checker's independent blind re-entry match confirms it. This preserves the actual point of shisa kanko: a human must consciously and independently re-produce the value, not just glance at and approve what the system already extracted.
- A checkpoint that a Checker cannot confirm (re-entry mismatch, or data looks wrong on inspection) must be explicitly flagged/rejected — not just left unconfirmed — so a problem is surfaced, not just silently unblocked-later.
- **This is what gates FR-8**: the funding trigger cannot be activated until every required checkpoint for the deal has a logged, Checker-confirmed (blind re-entry match) verification.

### FR-11 — Signal Board (Checkpoint Status Panel)
The Deal Room includes a **signal board**: a persistent panel (right-hand side of the UI) showing the live status of every required checkpoint (FR-10) for that deal, so anyone in the room can see at a glance what's still outstanding before the deal can be funded.

- Each checkpoint is represented as a signal indicator with (at minimum) a pending/outstanding state that draws attention (e.g. flashing) and a satisfied state (green).
- **Document-driven auto-detection:** when a document is dropped into the Deal Room and auto-arranged into a folder (FR-3), if the system detects the document contains the data required for a checkpoint (e.g. a borrower document lands in the Borrower folder and contains the account number the "Borrower settlement account number" checkpoint needs), the system extracts and matches that data automatically.
- Example (as given): an Ops Team Member drags an updated document into the Borrower folder; it contains the required borrower details; the corresponding checkpoint's signal turns green.
- **RESOLVED:** auto-detection alone does not flip a checkpoint fully green. It marks the data as "available/ready" for verification. The signal only reaches the fully-confirmed (funding-gate-satisfying) green state once the Checker independently confirms via blind re-entry (FR-10). Consider using a distinct intermediate state (e.g. amber/"ready") to visually distinguish "data found, awaiting Checker" from "Checker-confirmed."
- The signal board reflects real-time state — a new document version (FR-6) that changes previously-matched data should be reflected on the board, not leave a stale green signal.

### FR-12 — AI Discrepancy Detection & Manual Override
The default assumption that "funds go to the borrower" is not always correct — most notably in real estate deals, where closing/title documents can direct funds to a **title company or escrow agent** instead of the borrower directly. Silently funding the default assumption in that case would send money to the wrong party.

- The system uses AI to read relevant deal documents (e.g. closing instructions, title/escrow documents) and determine the **actual** intended fund recipient stated in the document.
- If the AI-detected recipient **disagrees** with the system's current assumption (e.g. document says "pay to First American Title, as escrow agent" but the deal record assumes the named Borrower), this is surfaced as a **discrepancy** — flashed/highlighted prominently (e.g. on the signal board per FR-11, and as a Deal Room alert), not silently corrected and not silently ignored.
- A flagged discrepancy **requires a manual override**: an authorized person must explicitly review the conflicting document and either (a) override the recipient to the AI-detected value, or (b) reject the AI's read and keep the original — either action is a deliberate, logged decision (per FR-7), not an automatic resolution.
- This discrepancy check applies to the **Recipient/payee checkpoint** (added to the FR-10 checklist above) and functions as a specialized case of FR-11's auto-detection — except that instead of confirming a match, it's specifically watching for a *conflict* between assumed and actual data.
- Who is authorized to perform the manual override (a Checker, an Ops Manager, or either) is an open question — see Section 6.

### FR-13 — Fund Flow Document / Settlement and Closing Document (IMPLEMENTED)

Only a **Deal Team Member** can create the deal's **Fund Flow Document** — also called the **Settlement and Closing Document** — the authoritative statement of the deal's final disbursement: which party (Borrower, each Lender, each 3rd Party Provider, any other party) is owed or paid how much at closing, plus loan details. Two ways to create it, both restricted to Deal Team and both producing the same document:
1. **Generate** — via `/generate-funding-document <loan_amount> <interest_rate> [<upfront_fee> <legal_fee> <interest_amount> <lead_agent_fee>]` in chat (a real write, handled deterministically in the backend — not routed through `ai_api`, for the same DB-access reason FR-10's blind re-entry isn't a chat command either) or the **Generate Fund Flow Document** icon in the Deal Room's left rail (Deal Team only — see FR-14). Borrower, Lender, and 3rd Party Provider names are pulled automatically from documents already on file (see the party-sourcing note below); the Deal Team member only enters the loan economics.
2. **Upload** — attach an existing settlement-and-closing PDF through the same panel; it goes through the normal FR-3 classification + FR-5 extraction pipeline like any upload, then is designated as the deal's Fund Flow Document.

Either way, the resulting document becomes the one `fund_flow_document_id` the deal points to (replacing, and versioning against — FR-6 — whichever was designated before) — visible from the **Deal Map** (FR-13a below).

**Party sourcing:** built from **documents on file** (deduplicated to current version-tree heads), not from Standing Instructions directly — a co-lender's bank details are often already on file from a *previous* deal and reused here, so this deal may never extract a fresh Standing Instruction for them even though a document proves they're a real participant. Falls back to a cleaned-up filename when a document has no Standing Instruction of its own.

**The generated PDF is two pages:**
- **Page 1 — Sources & Uses (debit/credit ledger).** Sources = each lender's contribution (split evenly across lenders present; a documented open question below). Uses are broken into **separate labeled sections**, each line naming the actual payee, not one lump figure: *Borrower Proceeds* (net proceeds to the borrower), *Upfront Fees*, *Interest* (prepaid interest, split across lenders — interest accrues to whoever funded the facility), *Lead Agent Fees*, *Legal & Professional Fees* (split across 3rd Party Providers on file). Net proceeds to the borrower is **derived** as `loan amount − upfront fee − interest − lead agent fee − legal fee`, so Sources always equals Uses by construction, not by coincidence.
- **Page 2 — Bank/wire details appendix**, grouped Borrower / Lenders / 3rd Party Providers / Other Parties (any party in the "Unfiled" folder), each entry showing full bank name, account number, and routing number, the dollar amount attributable to that party, and their Standing Instruction's status. **Deliberately unmasked** — unlike the Checker's FR-10 blind re-entry screen, this is the final settlement paperwork: it's generated on the expectation that every Standing Instruction it lists is already Checker-validated by this point, and Ops needs the real numbers to actually place the wires. The status label on every line still makes it immediately visible if something here somehow isn't validated yet, rather than silently hiding that fact — masking is a Checker-verification-time control (FR-10), not a document-at-rest control.

**Reconciliation (points 9–11 of the original ask):** whenever a Fund Flow Document exists, the system compares its text against every Standing Instruction on file for the Borrower, Lenders, and 3rd Party Providers folders — does that party's name actually appear in the document driving remittance? A generated document always matches by construction (its text *is* the party names); an uploaded one can genuinely miss or misstate a party, which is exactly the case worth catching before FR-14 lets money move. Shown per-party in the Remittances panel as confirmed / not-found, independent of and prior to the FR-14 Checker-validation gate.

**Bug fixed — two parties sharing one source document got the same (summed) amount on page 2.** `_amounts_by_document_id()` originally keyed each party's dollar amount by `document.id` — but one document can yield *multiple* parties (e.g. two co-lenders named in a single wire-instructions PDF), so both parties shared a key and their individual per-party amounts were summed together under it. Page 1's Sources/Uses split correctly showed each lender's own even share; page 2's appendix then looked up that shared key and showed the *combined* total for both lenders instead of each one's share — caught live against the real 2-lender sample deal (page 1: $6,875 interest each; page 2: $13,750 for both, before the fix). Fixed with `_party_key()`, which keys by the party's own `StandingInstruction.id` when one exists (unique per party) and only falls back to `document.id` for the no-SSI case, where a fallback party really is 1:1 with its document. See TC-13.10.

### FR-13c — Deal Financial Model (IMPLEMENTED — supersedes the even-split/plug-figure logic described above)

**The founder's own critique, verbatim:** "we cannot have different mental models for diagraming, fund document generation, and remittances." Until this pass, all three had their own arithmetic: `_build_statement()` split each lender's contribution **evenly** regardless of real pro-rata, attributed every fee to "the first lender on file" as a stand-in "lead lender," and computed borrower net proceeds as a **plug figure** (`loan amount − fees`) that balanced by construction whether or not that number was ever actually true. Meanwhile Remittances' reconciliation ran an entirely separate check — a case-insensitive substring match of party names against the generated PDF's own text.

**Replaced by one stored model, `DealFinancialLine`** (`backend/models.py`) — one row per real money-movement line item (not one row per party, since a lender is a *source* for their principal and can separately be a *use* payee for a fee): `flow` (source/use), `role` (borrower/lender/third_party/other), a free-text `category` (not an enum — "Principal", "Advisory Fee", "Upfront Fee", whatever a real document actually calls it, so a future product type never needs a schema change to introduce a category this app hasn't seen), `party_name`, `amount` (nullable — **null means genuinely unknown**, never silently derived), `amount_source` (`extracted_from_document` / `manual_entry` / `uploaded_fund_flow_document`), and links back to the source `Document` and, where one exists, the matching `StandingInstruction`.

**Population, bottom-up (no Fund Flow Document uploaded yet):**
1. **Party identity is decoupled from Standing Instructions entirely** — the founder's explicit instruction. A new `ai_api` extraction (`extract_deal_line_items()`, folder-hinted) reads each Borrower/Lenders/3rd Party Providers/Unfiled document directly for who it names and what they're owed/contributing, independent of whether that document's separate bank-detail extraction happened to succeed.
2. **Amounts are asked for, never guessed.** If a document names a party but states only a percentage share (not a dollar figure), that line stays `null` rather than the app computing a dollar amount itself — the founder's explicit call, made when this was scoped: "always ask for the $ amount." A document with genuinely no extractable amount still materializes one placeholder line per party (so they're never silently absent from the model) — this is what makes the Generate panel's form "ask only for what's missing," pre-filled with everything already known.
3. **Balance is a real check, not an assumption.** `get_deal_financial_model()` (`backend/financial_model.py`) sums Sources vs. Uses once every line has a value; a mismatch is a genuine, surfaced discrepancy (`balanced: false`) — verified live against Riverside Logistics Loan's real sample documents, where the borrower's loan agreement states the *gross* facility ($12,000,000) while ~$3.29M of separately-extracted legal fees are also owed, correctly reported as **not balanced** rather than silently plugged.

**Population, top-down (a Deal Team member uploads their own settlement PDF):** per the founder's explicit rule 5, an **uploaded** Fund Flow Document is authoritative — a second `ai_api` extraction (`extract_fund_flow_statement()`) reads the whole document's own Sources/Uses and **replaces** the deal's entire financial model, not just contributes to it (`sync_financial_lines_from_fund_flow_document()`).

**One model, three consumers, verbatim:** `build_diagram_data()` (FR-13a's diagram), `generate_funding_document()`/`_draw_funding_document_pdf()` (this section's PDF), and `get_remittance_readiness()` (FR-14) all call `get_deal_financial_model()` — nothing computes Sources/Uses independently anymore. `generate_funding_document()` now takes **no loan-economics arguments at all**; it reads the model and raises a clear error (surfaced as an HTTP 400, and in chat via `/generate-funding-document`) if anything is still missing or the books don't balance, rather than generating a document that quietly isn't true.

**The Generate Fund Flow Document panel is now a live editor of this model**, not a one-shot numeric form: every line item is listed (Sources and Uses, each showing its category and party), known amounts render read-only, missing ones render as inputs — "Save & Generate" fills in whatever was typed, then attempts generation. The old fixed six-field form (`loan_amount`/`interest_rate`/`upfront_fee`/`legal_fee`/`interest_amount`/`lead_agent_fee`) and the matching chat-command positional args are both retired — `/generate-funding-document` in chat now takes no arguments, since a single "loan amount" no longer means anything once amounts are per-party. Interest **rate** (a percentage) was dropped entirely — this app now tracks only dollar amounts per line, never a rate to multiply.

**Migration:** the 7 `Deal.fund_flow_*` columns this replaced were backed up, backfilled into `DealFinancialLine` rows for every deal that had used the old Generate form (tagged `amount_source: "manual_entry"`, since that's genuinely how those numbers arrived), verified to match byte-for-byte, and then dropped from the `deals` table.

**Borrower net proceeds is a derived residual, not an independently extracted or manually-typed figure.** The founder's explicit rule: "the fees should be deducted from the available funds and borrower's net proceeds are reduced by that amount." A loan agreement's own stated "facility amount" describes the *size of the loan* (i.e. Sources — what the lenders committed), not what the borrower actually nets after fees, so it is deliberately **not** trusted as the borrower's Use-line amount even when a document states one. `get_deal_financial_model()` computes it fresh on every read as `total_sources − sum(every non-borrower Use)`, once every source and non-borrower use is known; multiple co-borrowers split the residual evenly (a documented approximation, no per-borrower allocation is tracked). Tagged `amount_source: "derived"` in the model output, distinct from `extracted_from_document`/`manual_entry`. The Generate panel never renders an editable input for a borrower line — it shows "Pending — calculated once every other amount is known" until derivable, then the computed figure with a "(derived)" label; `fill_missing_line()` refuses to accept a manual value for a borrower-role line even via direct API call. Caught live: LFP Batteries Inc's borrower line had been extracted as the document's stated $8,000,000 "Total Facility Amount" — correctly replaced by the derived $6,917,000 ($8,000,000 − $1,083,000 in real legal fees) once this rule was implemented; Riverside Logistics Loan's borrower line similarly derives to $8,709,100 ($12,000,000 − $3,290,900 across three real legal-advisor fee statements). Because Sources always equals Uses by construction once every other line is known, `balanced` is now close to a formality in the common case — it still catches a genuine mismatch if, e.g., there is no borrower line at all yet for the model to attribute the residual to.

**Known limitation, not yet fixed:** moving a document between folders (the manual reclassification correction) only re-runs extraction if the document doesn't already have a Standing Instruction — inherited from the pre-existing move-document guard. In the narrow case where a document already has bank details extracted and is then moved between two *party* folders (e.g. Lenders → 3rd Party Providers), its financial lines keep their old `role`/`flow` until a fresh upload replaces them. Not hit by any real sample data exercised so far.

### FR-13a — Deal Map (IMPLEMENTED)

A **Deal Map** icon in the Deal Room's left rail opens a quick census of the deal: reference/product/status, member counts by role, document counts by folder (including Deleted), Standing Instruction counts by status, and the current Fund Flow Document's filename (or "not created yet"). Assembled entirely from data already available to the Deal Room — no new reasoning, just a single-glance summary standing in for what the founder calls "the deal map."

**Mirrored onto every dashboard tile, pared down to Product/Borrower/Lenders.** `GET /deals` (`DealOut`/`build_deal_out()` in `routes/deals.py`) also returns `borrower_names`/`lender_names` (via the same `_parties_for_folder()` FR-13 uses — built from documents on file, not just SSIs, so a party shows up even before it has its own Standing Instruction). `DealListPage.jsx`'s `DealSections` renders three `.sidebar-row`s — Product / Borrower / Lenders — followed by a row of member avatars, in both the card-grid and horizontal-list dashboard layouts. Status/Members/Messages-so-far/Standing-instructions rows from the first pass were deliberately removed per the founder's explicit correction (status is already the card header's pill; the counts weren't needed on the tile). Borrower/Lenders render as a **stacked, right-aligned list** — one name per line under the row label — rather than a comma-joined line, and collapse to a single "…" past 9 names rather than listing them all or a "+N more" count. The member avatar row is pinned to the **bottom** of the tile (`.deal-map-mini` as `flex: 1` inside the card's flex column, avatar row at `margin-top: auto`) so it lands at a consistent baseline regardless of how tall the party lists above it are. The card header's product-type tag and green status pill are now split to opposite ends of their row (`justify-content: space-between`) instead of sitting side by side. See TC-13a.2–13a.6.

**Visual fund-flow diagram, opened by the same Deal Map icon (IMPLEMENTED).** Clicking **Deal Map** now drives two panels at once: the existing text census in the right-hand drawer (unchanged, described above) *and* a money-flow diagram rendered in the Deal Room's center panel — the same area used for document preview/diff — modeled on the private-equity-style flow charts the founder referenced (Lenders → loan facility → Borrower/Fees/3rd Parties, connected by labeled arrows). This is deliberately **a different view of the same data**, not a second calculation: `build_diagram_data()` (`funding_document.py`) reshapes the exact `_build_statement()` output the Fund Flow PDF already uses into diagram-friendly JSON (`GET /deals/{id}/fund-flow-diagram`), and `FundFlowDiagram.jsx` computes a fully dynamic SVG layout from however many lenders/fee-lines/3rd parties a given deal actually has — nothing is hardcoded to any one deal's shape. Node color coding: blue (lender/source), near-black (loan facility hub), green (borrower), amber (fees to lenders), purple (3rd party provider) — dealops' own existing design tokens, not the reference image's palette. Long names wrap onto up to two lines (`wrapLabel()`) and fee-line party names truncate with an ellipsis rather than overflowing their box, since real party names (e.g. "Hartwell & Boyd LLP Client Trust Account") routinely exceed a single line. A deal with no *generated* Fund Flow Document (including one generated before the `Deal.fund_flow_*` persistence columns existed) shows a plain "no data yet" message instead of an empty/broken diagram. Opening/closing the diagram and switching to a document preview or diff are mutually exclusive in the center panel — selecting one always clears the other. Verified live via Playwright against real data (LFP Batteries Inc: 2 lenders, 4 fee lines, 1 legal line, all summing correctly to the $8,000,000 facility) with no encoding/mojibake issues in the "·" separator text.

### FR-13b — Dashboard To-Do Banner (IMPLEMENTED)

The Deals dashboard now surfaces, on login, exactly what the current user needs to act on — not just a per-tile badge someone has to notice on their own. `pending_task_count_for()` (`routes/deals.py`) counts a role's real pending actions per deal — today the only task type is a **Checker's** `pending_checker_review` Standing Instructions (FR-10's blind re-entry queue) — and `GET /deals` returns it as `pending_task_count` on every `DealOut`. When the sum across all visible deals is greater than zero, `TodoBanner` (`DealListPage.jsx`) renders an amber banner above the deal list: a headline count ("N Standing Instructions awaiting your review") and one clickable pill per deal with pending work, each showing that deal's own count and opening straight into it. Deliberately generic over `pending_task_count` rather than hardcoded to Checkers specifically — the banner will pick up any future task type (e.g. a different role's own pending action) the moment `pending_task_count_for()` is extended to count it, with no frontend change needed. The existing per-tile badge (`.deal-badge-task`) now also shows its own numeral count, not just an icon, for the same "how many, not just some" reason. Any role with no task type today (everyone but Checker) sees `pending_task_count: 0` for every deal and the banner renders nothing. See TC-13b.1–13b.4.

### FR-14 — Remittance (PARTIALLY IMPLEMENTED — reconciliation built, execution not yet)

A **Remittances** view in the Deal Room (its own icon in the left rail) shows, for every party in the deal's financial model (FR-13c), whether remittance to that party is currently allowed.

- **Gating rule (hard requirement, encoded in the UI today):** a party reads "Ready" only when its amount is known in the financial model **and** its Standing Instruction (FR-5) is Checker-validated (FR-10). Anything else — pending, rejected, or an amount still missing — reads "Awaiting validation" or "No SSI on file," not "Ready." This is per-party, not deal-wide: one lender being cleared doesn't move another. **No longer gated on a Fund Flow Document existing** — readiness reflects the live financial model at all times (`get_remittance_readiness()`, FR-13c), so a party can show "Ready" before anyone has generated the settlement PDF. (Superseded the original PDF-text substring-match reconciliation, which only ever ran after a Fund Flow Document existed.)
- **Not yet built:** actually executing/recording a remittance (an action + its own audit log entry) — today the panel shows readiness only. This supersedes/refines FR-8's original single "big beautiful button" framing; FR-8 should be explicitly reconciled with this (or retired in its favor) once remittance execution itself is scoped.
- Every remittance action (becoming enabled, and being executed) must be logged per FR-7, same as any other significant deal action.

### FR-15 — Ops Manager Pending Approvals Oversight (IMPLEMENTED)

An **Ops Manager** ("Deal admin") sees, on the Deals dashboard, every open approval across **every deal** — not just deals they're actively working — so they can spot a stalled item and add another Checker to unblock it. `GET /admin/pending-approvals` (Ops-Manager-only, 403 otherwise) returns every `pending_checker_review` Standing Instruction system-wide: which deal, which party, which document folder, which Checker(s) are currently members of that deal (so Omar knows who's supposed to be acting, or that no one is — "Unassigned"), when it was submitted, and how many hours it's been pending. `PendingApprovalsPanel` (`DealListPage.jsx`) renders this as a table, sorted oldest-first, with each row clickable straight into that deal (where an Ops Manager can `@mention` another Checker to add them — the existing FR-4 flow, not a new mechanism).

**Age-based urgency coloring (explicit thresholds from the founder):** a row's background is red once it's been pending **more than 8 hours**, orange between **4 and 8 hours**, and plain white under 4 hours — deliberately a loud full-row background, not just a colored badge, since the point is a stalled item should be impossible to miss while scanning the table. Verified live against real data (multiple genuinely-aged rows) and by temporarily backdating two Standing Instructions to 6h and 2h to confirm the orange and normal thresholds render correctly, then reverting those timestamps immediately after.

This is intentionally a separate view from FR-13b's `TodoBanner` — that one is personal ("what do *I* need to do"), gated to whichever role has a task type; this one is oversight ("what does *everyone* need to do, and who's behind"), gated to Ops Manager specifically. They share nothing but the underlying `pending_checker_review` data.

**Fallback assignment (implemented alongside FR-15):** a Standing Instruction created while its deal has no Checker member yet is stamped at creation with `assigned_checker` — the deal's Ops Manager (`get_fallback_ssi_assignee()`, `routes/deals.py`) — so it never shows as bare "Unassigned." This is **ownership/visibility only, not a permission grant**: the assigned Ops Manager still cannot validate it (FR-10's Checker-only gate is untouched) — the point is that someone is clearly on the hook to go staff a real Checker onto the deal, not that the Ops Manager performs the check themselves. Stamped once, at creation time, from whichever Checker(s) are on the deal at that moment — not re-evaluated later if a Checker subsequently joins. FR-15's `checkers` column falls back to this same field when the deal has no real Checker member. Visible on the SSI detail view as an "Assigned to" row.

### FR-16 — 3rd Party & Other Standing Instructions Tab (IMPLEMENTED)

A third SSI rail icon/tab, alongside the existing Borrower and Lender ones (FR-10), covers every Standing Instruction whose source document's folder is **neither** Borrower **nor** Lenders — today that means 3rd Party Providers and Unfiled, and it will automatically pick up any future folder FR-3's classifier gains without a frontend change. Visible to **every** Deal Room member, same as the Borrower/Lender tabs (not role-gated like the Remittances icons). Shares the same list/detail UI, blind re-entry validation, and evidence-highlighting as the other two SSI tabs — this is purely a different filter over the same `standing_instructions` data, not a new mechanism.

## 5. Non-Functional Notes

- **Deployment model (RESOLVED):** installed, single-tenant per bank — not multi-tenant SaaS. Each bank runs its own instance; there is no shared cloud infrastructure across banks, so cross-bank data isolation is a deployment-level property, not something the application needs to enforce via tenant scoping.
- **Multi-product support within one instance (RESOLVED — now a hard requirement):** a single installed instance must support multiple loan product types (commercial loan, real estate loan, etc.) running concurrently. This means loan product type is a first-class attribute of a Deal, and per-product configuration — notably the FR-10 checkpoint list, and potentially the FR-3 folder categories — must vary by product type within the same instance rather than being hardcoded globally.
- **Auditability**: FR-7 and FR-5's outcome visibility suggest this product sits in a compliance-sensitive context (loan funding). Treat audit-log integrity as a first-class concern once implementation begins.

## 6. Open Questions (carried from `CLAUDE.md`, plus new ones raised while spec'ing)

- Document auto-categorization logic (rules vs. content/ML classification).
- Document version-matching + diff mechanism (how do we know two files are "the same document, new version"?).
- Standing instruction extraction method (manual/structured entry vs. OCR/NLP off documents).
- **New:** Can an Ops Manager/Admin remove an Ops Team Member from a deal, or only add?
- **New:** Is the ops staffing request (FR-1) directed at a specific Ops Manager, or broadcast to any Ops Manager/Admin who can claim it?
- **New:** Retention policy for conversation logs (FR-7) and for rejected/superseded document versions (FR-6).
- **New (FR-10):** Who defines the required checkpoint list per loan product, and who can add/assign Checkers to a deal — same mechanism as Ops Team Members (Ops Manager adds them), or a separate role (e.g. Compliance) with its own assignment flow?
- **New (FR-10):** What happens when a Checker explicitly rejects a checkpoint (data looks wrong) — does it block the deal entirely, notify the Deal Team to fix and resubmit, or something else?
- **New (FR-10):** Can Checkers overlap with Ops Team Members (same person, two roles) or must they be strictly independent people, for segregation-of-duties integrity?
- ~~Does document-driven auto-detection alone satisfy a checkpoint...~~ **RESOLVED (FR-10): no — auto-detection only surfaces the value; the Checker must independently confirm via blind re-entry.**
- **New (FR-11):** What happens on the signal board if auto-detection finds *conflicting* data (e.g. two different account numbers across two documents in the Borrower folder)? Does it stay red, flag a conflict state, or surface both for a Checker to resolve? (Related to, but distinct from, FR-12's assumed-vs-actual recipient conflict, which now has an answer — see FR-12.)
- **New (FR-12):** Who is authorized to perform the manual override when the AI flags a recipient discrepancy — a Checker, an Ops Manager, either, or does it require both (four-eyes on the override itself, given how high-stakes a wrong override would be)?
- **New (FR-12):** Does the AI discrepancy check run only on a fixed set of document types (e.g. title/escrow/closing documents), or on every uploaded document? Over-flagging on irrelevant documents could cause alert fatigue that undermines the whole safety mechanism.
- **New (FR-12):** What loan products besides real estate need this kind of recipient-discrepancy check? Is this specific to real estate, or a general pattern (assumed recipient vs. actual document-stated recipient) that should be checked on every deal regardless of product type?
- **New (deployment model):** Who defines per-product-type configuration (checkpoint lists, folder categories) at a given bank's instance — is this fixed/shipped by dealops per product type, or can the bank's own admins customize it (e.g. add a new loan product type, or tweak a checkpoint list) without needing a new release?
- **New (deployment model):** Does "installed" mean fully on-prem (bank's own data center), the bank's private cloud/VPC, or either — and does this affect how updates/patches are delivered to an installed instance over time?
- ~~Is the Fund Flow Document its own folder category or filed under "Funding Docs"?~~ **RESOLVED: filed under "Funding Docs"** — the AI classifier (FR-3) already routes it there correctly; a dedicated category wasn't needed once `Deal.fund_flow_document_id` exists to mark *which* Funding Docs entry is the fund flow document.
- ~~Does the system extract per-party owed amounts automatically?~~ **RESOLVED (FR-13c): yes** — `extract_deal_line_items()` reads each Borrower/Lenders/3rd Party document directly for the party and dollar amount it states; a document naming a party with no stated dollar figure (e.g. only a percentage) is asked for explicitly rather than guessed.
- **New (FR-14):** Who is authorized to execute an enabled remittance — an Ops Team Member (per FR-8's original "ops team disburses" framing), or does this need its own explicit authorization step? (Execution itself isn't built yet — see FR-14.)
- ~~How are third-party recipients represented for remittance purposes?~~ **RESOLVED: they get a real Standing Instruction**, same as Borrower/Lenders — extraction already runs on 3rd Party Provider uploads (e.g. a law firm's fee statement with its own trust account details) exactly like any other folder.
- **New (FR-14):** Should FR-8 be retired in favor of FR-14's per-party gating, or kept as a separate deal-level "everything's ready" milestone that sits alongside per-party remittance?
- **New (FR-14):** If a party's Standing Instruction is later rejected *after* its remittance has already been executed (e.g. a mismatch discovered in a re-check), what happens — is that even possible given FR-10's flow, and if so, what's the response?
- ~~Per-party owed amounts aren't modeled~~ **RESOLVED — the generated statement now shows a dollar figure per Borrower/Lender/3rd-Party line** (page 1's labeled fee sections and page 2's bank details appendix), not just loan-level totals.
- ~~"Lead lender" / "agent bank" isn't an explicit tracked concept... Upfront Fees and Lead Agent Fees are attributed to whichever lender is first...~~ **RESOLVED (FR-13c): no more convention-based attribution.** Fee payees now come directly from what a real document states (e.g. a wire-instructions document naming the arranging bank for an upfront fee) — if no document states a fee at all, no line for it is invented. `_lead_lender()` was removed.
- ~~Lender pro-rata shares aren't tracked... split evenly across however many lenders are on file...~~ **RESOLVED (FR-13c): no more even-split.** Each lender's real contribution is extracted directly from their own document (verified against Riverside Logistics Loan's real 60/40 split — $7.2M/$4.8M on a $12M facility, not $6M/$6M). A lender document stating only a percentage (not a dollar figure) is asked for explicitly rather than computed from the split — the founder's explicit call (see FR-13c).
