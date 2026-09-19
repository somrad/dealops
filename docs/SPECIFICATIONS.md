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

Only a **Deal Team Member** can create the deal's **Fund Flow Document** — also called the **Settlement and Closing Document** — the authoritative statement of the deal's final disbursement: which party (Borrower, each Lender, any third-party recipient such as a title/escrow agent per FR-12) is owed how much at closing, plus loan details and upfront fees (origination, legal). Two ways to create it, both restricted to Deal Team:
1. **Generate** — via `/generate-funding-document` in chat (which reports status and points here — the actual generation is a write action, so it happens through the dedicated UI, not chat text, for the same reason FR-10's blind re-entry isn't a chat command) or the **Remittances** icon in the Deal Room's left rail. The Deal Team member enters loan amount, interest rate, and upfront/legal fees; Borrower, Lender, and 3rd Party Provider names are pulled automatically from standing instructions already on file. The system assembles a PDF and files it under Funding Docs.
2. **Upload** — drag/attach an existing settlement-and-closing PDF through the same Remittances panel; it goes through the normal FR-3 classification + FR-5 extraction pipeline like any upload, then is designated as the deal's Fund Flow Document.

Either way, the resulting document becomes the one `fund_flow_document_id` the deal points to (replacing whichever was designated before, if any) — visible from the **Deal Map** (FR-13a below).

**Reconciliation (points 9–11 of the original ask):** whenever a Fund Flow Document exists, the system compares its text against every Standing Instruction on file for the Borrower, Lenders, and 3rd Party Providers folders — does that party's name actually appear in the document driving remittance? A generated document always matches by construction (its text *is* the SSI names); an uploaded one can genuinely miss or misstate a party, which is exactly the case worth catching before FR-14 lets money move. Shown per-party in the Remittances panel as confirmed / not-found, independent of and prior to the FR-14 Checker-validation gate.

### FR-13a — Deal Map (IMPLEMENTED)

A **Deal Map** icon in the Deal Room's left rail opens a quick census of the deal: reference/product/status, member counts by role, document counts by folder (including Deleted), Standing Instruction counts by status, and the current Fund Flow Document's filename (or "not created yet"). Assembled entirely from data already available to the Deal Room — no new reasoning, just a single-glance summary standing in for what the founder calls "the deal map."

### FR-14 — Remittance (PARTIALLY IMPLEMENTED — reconciliation built, execution not yet)

A **Remittances** view in the Deal Room (its own icon in the left rail) shows, for every party with a Standing Instruction in the Borrower/Lenders/3rd Party Providers folders, whether remittance to that party is currently allowed.

- **Gating rule (hard requirement, encoded in the UI today):** a party reads "Ready" only when its Standing Instruction (FR-5) is Checker-validated (FR-10) **and** it's confirmed present in the Fund Flow Document (FR-13's reconciliation). Anything else — pending, rejected, or simply not mentioned in the document — reads "Awaiting validation" or "Not in document," not "Ready." This is per-party, not deal-wide: one lender being cleared doesn't move another.
- **Not yet built:** actually executing/recording a remittance (an action + its own audit log entry) — today the panel shows readiness only. This supersedes/refines FR-8's original single "big beautiful button" framing; FR-8 should be explicitly reconciled with this (or retired in its favor) once remittance execution itself is scoped.
- Every remittance action (becoming enabled, and being executed) must be logged per FR-7, same as any other significant deal action.

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
- ~~Does the system extract per-party owed amounts automatically?~~ **RESOLVED: no dollar-amount-per-party extraction** — loan amount and fees are entered once at generation time; per-party amounts aren't modeled yet (open item below).
- **New (FR-14):** Who is authorized to execute an enabled remittance — an Ops Team Member (per FR-8's original "ops team disburses" framing), or does this need its own explicit authorization step? (Execution itself isn't built yet — see FR-14.)
- ~~How are third-party recipients represented for remittance purposes?~~ **RESOLVED: they get a real Standing Instruction**, same as Borrower/Lenders — extraction already runs on 3rd Party Provider uploads (e.g. a law firm's fee statement with its own trust account details) exactly like any other folder.
- **New (FR-14):** Should FR-8 be retired in favor of FR-14's per-party gating, or kept as a separate deal-level "everything's ready" milestone that sits alongside per-party remittance?
- **New (FR-14):** If a party's Standing Instruction is later rejected *after* its remittance has already been executed (e.g. a mismatch discovered in a re-check), what happens — is that even possible given FR-10's flow, and if so, what's the response?
- **New (FR-13):** Per-party owed *amounts* aren't modeled yet — the generated document currently lists loan-level totals and fees, not a dollar figure per Borrower/Lender/3rd-party line. Needed before remittance execution can know how much to move per party.
