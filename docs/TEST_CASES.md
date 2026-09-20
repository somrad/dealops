# dealops — Required Test Cases

> Status: pre-implementation. Derived from `SPECIFICATIONS.md`. These are **acceptance-level test cases** to validate against once a stack and UI exist — not unit tests for code that doesn't exist yet. IDs are stable references; update this file as requirements evolve rather than renumbering.

Legend: **Role** = who performs the action. **Expected** = observable outcome.

## FR-1 — Ops Staffing Request

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-1.1 | Happy path staffing request | Deal Team Member | Open a deal's Deal Room; post an ops staffing request as a chat message | Ops Manager/Admin (already having standing access to the room) sees the request immediately in the chat, without a separate notification system |
| TC-1.1b | Manager responds in-chat | Ops Manager/Admin | Reply to the staffing request message by assigning an Ops Team Member | Assignment is posted in the same chat thread; assigned member gains Deal Room access (per FR-4); full exchange is logged (FR-7) |
| TC-1.2 | Deal Team Member cannot self-assign ops staff | Deal Team Member | Attempt to directly add an Ops Team Member to the deal | Action is blocked/not available; only a request is possible |
| TC-1.3 | Duplicate request handling | Deal Team Member | Submit a second staffing request while one is already pending | System does not silently create confusing duplicates (either merges, updates, or clearly shows both) |
| TC-1.4 | Request on a deal team member has no access to | Deal Team Member (not on this deal) | Attempt to submit a staffing request for a deal they're not a member of | Blocked — unauthorized |

## FR-2 — Drag-and-Drop Document Upload

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-2.1 | Single document drop | Deal Team Member | Drag and drop one document into the Deal Room | Document is accepted, appears in chat and in document set |
| TC-2.2 | Batch document drop | Deal Team Member | Drag and drop 5+ documents at once | All documents are individually accepted and processed |
| TC-2.3 | Unsupported file type | Deal Team Member | Drop a file type the system doesn't support (e.g. .exe) | Upload is rejected with a clear error, not silently dropped |
| TC-2.4 | Upload by non-member | Non-member of the deal | Attempt to drop a document into a Deal Room they don't belong to | Blocked — unauthorized |
| TC-2.5 | Ops Team Member uploads a document | Ops Team Member | Drag and drop a document into a Deal Room they're a member of | **RESOLVED (implemented):** accepted — upload is not restricted to Deal Team, any deal member can upload |

## FR-3 — Automatic Document Folder Arrangement

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-3.1 | Clearly-classifiable document | Deal Team Member | Upload a document clearly identifiable as a borrower doc | Document is auto-filed into the "Borrower" folder |
| TC-3.2 | Ambiguous/unclassifiable document | Deal Team Member | Upload a document with no clear category signal | Document lands in "Unfiled"/"Needs Review," not silently dropped or wrongly filed |
| TC-3.3 | Multiple categories represented in one batch | Deal Team Member | Drop a mixed batch (borrower doc + lender doc + funding doc together) | Each document is filed into its own correct folder independently |
| TC-3.4 | Folder visibility | Any Deal Room member | View the deal's document set | Folder structure and each document's assigned folder are visible |

## FR-4 — Ops Team Membership Management

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-4.1 | Admin adds ops member | Ops Manager/Admin | Add an Ops Team Member to a deal | Member gains access to that deal's Deal Room (chat + docs + status) |
| TC-4.2 | Non-admin cannot add ops member | Ops Team Member (non-admin) | Attempt to add another Ops Team Member to a deal | Blocked — unauthorized |
| TC-4.3 | Deal Team cannot add ops member directly | Deal Team Member | Attempt to add an Ops Team Member directly (bypassing FR-1 request) | Blocked — unauthorized |
| TC-4.4 | Newly added member sees history | Ops Manager/Admin, then new Ops Team Member | Add a member to a deal that already has chat/document history | New member can see prior Deal Room history (confirm this is intended vs. only-forward-visibility) |
| TC-4.5 | Add same member twice | Ops Manager/Admin | Add an Ops Team Member who is already on the deal | No duplicate membership / clear no-op or clear error |

## FR-5 — Standing Instruction Extraction & Mock Loan IQ Submission

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-5.1 | Successful extraction and submission | System (background) | Sufficient borrower + lender account details are present in deal documents/data | Standing instruction is created via mock Loan IQ API; success status visible in Deal Room |
| TC-5.2 | Missing/incomplete account details | System (background) | Borrower or lender account details are incomplete | Extraction surfaces a "needs review" state rather than submitting incomplete/incorrect data |
| TC-5.3 | Mock API failure | System (background) | Mock Loan IQ API returns an error/timeout | Failure is surfaced in the Deal Room (not silently swallowed); retry or manual-intervention path exists |
| TC-5.4 | Non-blocking behavior | Deal Team Member / Ops Team Member | Continue working in the Deal Room while extraction runs in background | Extraction does not block chat, uploads, or other deal actions |

## FR-6 — Document Version Diffing

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-6.1 | New version of existing lender document | Deal Team Member | Upload a lender document, then upload a modified version of the same document | System recognizes it as a new version and shows a diff against the prior version |
| TC-6.2 | Unrelated document with similar name | Deal Team Member | Upload a document with a similar filename but unrelated content | System does not incorrectly treat it as a new version (or flags low-confidence match for review) |
| TC-6.3 | First upload has no prior version | Deal Team Member | Upload a lender document for the first time | No diff is shown (nothing to compare against); no error |
| TC-6.4 | Diff visibility to Ops Team | Ops Team Member | View a document that has multiple versions | Diff between versions is viewable, not just to the uploader |
| TC-6.5 | Non-lender document versioning | Deal Team Member | Upload a new version of a non-lender document (e.g. a borrower doc) | Confirm with founder whether diffing applies only to lender docs (per requirement wording) or all document types; test accordingly |

## FR-7 — Conversation Logging

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-7.1 | Message is logged | Any Deal Room member | Send a chat message in a Deal Room | Message appears in the persistent audit log for that deal |
| TC-7.2 | Document/system events are logged | System | A document is uploaded / ops member added / staffing requested | These events also appear in the audit log, not just free-text chat |
| TC-7.3 | Log immutability | Any Deal Room member | Attempt to delete or alter a past message | Original log entry is preserved; any edit/retraction is recorded as a new event |
| TC-7.4 | Log retrieval by authorized user | Deal Team Member / Ops Team Member on the deal | Request the full conversation log for a deal | Full, ordered log is retrievable |
| TC-7.5 | Log access by non-member | Non-member of the deal | Attempt to retrieve the conversation log | Blocked — unauthorized |

## FR-8 — Deal Finalization / Funding Trigger

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-8.1 | Happy path funding trigger | Deal Team Member | Press the funding/completion action on a deal that's ready | Deal status changes; Ops Team is notified/enabled to disburse funds |
| TC-8.2 | Trigger before deal is ready | Deal Team Member | Attempt to press the funding action while prerequisites are incomplete (e.g. missing standing instructions, unresolved documents) | Action is blocked or requires explicit override, not silently allowed |
| TC-8.3 | Unauthorized trigger | Ops Team Member | Attempt to press the deal-team-only funding trigger | Blocked — unauthorized (confirm role restriction with founder) |
| TC-8.4 | Duplicate trigger | Deal Team Member | Press the funding action twice on the same deal | Second press is a no-op or clearly blocked (no double-disbursement signal) |
| TC-8.5 | Blocked by incomplete checkpoints | Deal Team Member | Attempt to press the funding action while one or more required Checker checkpoints (FR-10) are unconfirmed | Action is disabled/blocked; deal cannot be funded until all checkpoints are confirmed |
| TC-8.6 | Enabled once all checkpoints confirmed | Deal Team Member | Press the funding action after all required checkpoints have logged Checker confirmations | Action succeeds; deal status changes; Ops Team notified to disburse |

## FR-9 — Multi-Deal Concurrency

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-9.1 | No cross-deal document bleed | Deal Team Member on Deal A and Deal B | Upload a document to Deal A | Document does not appear in Deal B's document set |
| TC-9.2 | No cross-deal chat bleed | Deal Team Member on Deal A and Deal B | Send a message in Deal A's Deal Room | Message does not appear in Deal B's Deal Room |
| TC-9.3 | Membership isolation | Ops Team Member on Deal A only | Attempt to view Deal B (not a member) | Blocked — unauthorized; Deal B not visible in their deal list |
| TC-9.4 | Navigating across active deals | Deal Team Member / Ops Team Member on 3+ deals | Open the deal list/dashboard | All deals the user is a member of are listed; selecting one opens the correct, isolated Deal Room |
| TC-9.5 | Concurrent activity across deals | Two users, each active in a different deal at the same time | Both perform actions (upload, chat) simultaneously in their respective deals | Each deal's state updates independently and correctly; no race condition mixes data between deals |

## FR-10 — Checkers & Point-and-Call Verification

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-10.1 | Happy path — full blind re-entry match | Checker | Enter Deal Room via invitation; for a required checkpoint (e.g. borrower account number), independently re-type the full value | Re-typed value matches the auto-detected value; checkpoint is confirmed; confirmation logged with checker identity, timestamp, and checkpoint (FR-7) |
| TC-10.1b | Happy path — partial digit spot-check | Checker | For a checkpoint configured for partial re-entry, re-type only the requested digits (e.g. "the last 3 digits") | System validates only the requested positions against the extracted value; match confirms the checkpoint |
| TC-10.1c | Broadcast on confirmation | Checker, then all other Deal Room members | Complete a checkpoint's blind re-entry successfully | All other Deal Room participants receive a system message that verification for that checkpoint is complete |
| TC-10.1d | Re-entry mismatch | Checker | Re-type a value that does not match the auto-detected value | Checkpoint is **not** confirmed; it is flagged as a discrepancy (same handling as an explicit rejection), not silently retried or ignored |
| TC-10.1e | Auto-detection alone does not confirm | System (auto-detect), then any Deal Room member | A document is auto-matched to a checkpoint per FR-11, but no Checker has performed blind re-entry yet | Checkpoint is not counted as confirmed toward the FR-8 funding gate — it shows as "available/ready," not "confirmed" |
| TC-10.2 | All checkpoints confirmed unlocks funding | Checker (multiple), then Deal Team Member | Confirm every required checkpoint via blind re-entry, then attempt the FR-8 funding trigger | Funding trigger becomes enabled only after the last required checkpoint is Checker-confirmed |
| TC-10.3 | Checker rejects a checkpoint outright | Checker | Flag a checkpoint as incorrect/rejected without attempting re-entry (e.g. data looks wrong on inspection) | Checkpoint is marked rejected (not just left unconfirmed); Deal Team is notified; funding trigger remains blocked |
| TC-10.4 | Non-checker cannot confirm | Deal Team Member or Ops Team Member (not a Checker on this deal) | Attempt to perform blind re-entry confirmation for a checkpoint | Blocked — unauthorized; only assigned Checkers can confirm |
| TC-10.6 | Checker sees only assigned deal's checkpoints | Checker on Deal A only | View checkpoint list | Only Deal A's checkpoints are visible; no bleed from other deals (ties to FR-9) |
| TC-10.7 | Re-verification after document change | Checker | A previously-confirmed checkpoint's underlying document is replaced with a new version (FR-6) | Confirm with founder whether the checkpoint confirmation is invalidated and requires re-confirmation, or stays valid |

## FR-11 — Signal Board (Checkpoint Status Panel)

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-11.1 | Board shows all checkpoints as pending initially | Any Deal Room member | Open a newly created deal's Deal Room | Signal board lists every required checkpoint (FR-10) in a pending/flashing state |
| TC-11.2 | Auto-detection flips a checkpoint on correct document drop | Ops Team Member | Drag an updated document containing the borrower's account number into the Borrower folder | The "Borrower settlement account number" checkpoint's signal turns green (or the appropriate intermediate state, per the auto-vs-manual open question) |
| TC-11.3 | Wrong folder does not trigger auto-detection | Ops Team Member | Drag a document with borrower account details into the Lender folder | Borrower checkpoint is not auto-satisfied by a misfiled document |
| TC-11.4 | Conflicting data across documents | Ops Team Member | Upload two Borrower-folder documents with different account numbers | Signal board does not silently show green; conflict is surfaced (exact behavior TBD — see open questions) |
| TC-11.5 | New document version invalidates a stale green | Deal Team Member | Upload a new version (FR-6) of a document that changes previously-matched checkpoint data | Signal board updates to reflect the new data — no stale green left showing outdated info |
| TC-11.6 | Board updates in real time for all viewers | Two Deal Room members viewing simultaneously | One member's action (document drop or Checker confirmation) changes a checkpoint's state | Both viewers see the updated signal board state without manually refreshing |
| TC-11.7 | Board is scoped to its own deal | Any Deal Room member on multiple deals | View Deal A's signal board, then Deal B's | Each board reflects only its own deal's checkpoints (ties to FR-9 — no cross-deal bleed) |

## FR-12 — AI Discrepancy Detection & Manual Override

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-12.1 | Happy path — no discrepancy | System (AI) | Upload a standard closing document where funds go directly to the named Borrower | AI-detected recipient matches assumed recipient; recipient/payee checkpoint proceeds normally (no discrepancy flagged) |
| TC-12.2 | Title company discrepancy detected | System (AI) | Upload a real estate closing/title document directing funds to a title company/escrow agent instead of the Borrower | Discrepancy is flagged prominently (signal board + Deal Room alert); recipient checkpoint does NOT auto-confirm |
| TC-12.3 | Manual override — accept AI's reading | Authorized reviewer | Review the flagged discrepancy and override the recipient to the AI-detected title company | Recipient is updated; override decision is logged (who, when, from what, to what) per FR-7; checkpoint can now proceed to Checker confirmation with the corrected recipient |
| TC-12.4 | Manual override — reject AI's reading | Authorized reviewer | Review the flagged discrepancy and determine the AI misread the document (recipient should remain the Borrower) | Original recipient is kept; the rejection decision is logged, not just the flag disappearing silently |
| TC-12.5 | Unauthorized override attempt | Non-authorized Deal Room member | Attempt to resolve a flagged discrepancy | Blocked — unauthorized (exact authorized role(s) TBD, see open questions) |
| TC-12.6 | No silent auto-resolution | System (AI) | A discrepancy is detected | System never auto-corrects or auto-dismisses the discrepancy on its own — it always waits for a human decision |
| TC-12.7 | Funding gate blocked pending override | Deal Team Member | Attempt the FR-8 funding trigger while a recipient discrepancy is still unresolved | Blocked — an unresolved discrepancy prevents funding, same as any other unconfirmed required checkpoint |

## FR-13 — Fund Flow Document / Settlement and Closing Document

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-13.1 | Happy path — generate | Deal Team Member | Enter loan amount/rate/fees and generate the Fund Flow Document | PDF is created, filed under Funding Docs, and set as `deal.fund_flow_document_id`; reconciliation shows every existing Borrower/Lender/3rd-party SSI as confirmed (verified live: 4 borrower + 6 lender entries, all `confirmed: true`) |
| TC-13.2 | Happy path — upload | Deal Team Member | Upload an existing settlement/closing PDF through the Remittances panel | Goes through normal FR-3 classification + FR-5 extraction, then is set as the deal's Fund Flow Document (verified live: a legal-fee statement correctly classified to 3rd Party Providers, extracted its trust account as a new SSI, and reconciliation showed `confirmed: true` for that party and `false` for every unrelated Borrower/Lender SSI) |
| TC-13.3 | Non-Deal-Team blocked | Ops Team Member, Checker, Ops Manager | Attempt to generate or upload the Fund Flow Document | 403 — verified live (Checker got 403 on generate; only `deal_team` role may call either endpoint) |
| TC-13.4 | Replacing the Fund Flow Document | Deal Team Member | Generate or upload again after one already exists | The new document replaces the old one as `fund_flow_document_id` (verified live); the prior document itself is untouched, just no longer designated |
| TC-13.5 | Reconciliation catches a real mismatch | Deal Team Member | Upload a Fund Flow Document that doesn't mention one of the existing SSI parties | That party's reconciliation entry reads `confirmed: false`, distinct from parties actually named in the document |
| TC-13.6 | Statement balances with all fee types set | Deal Team Member | Generate with upfront fee, legal fee, interest amount, and lead agent fee all nonzero | Page 1's Total Sources equals Total Uses exactly (verified live: $5,000,000 = $5,000,000 with all four fee types populated); "BALANCED" is printed |
| TC-13.7 | Uses are broken into separate labeled sections | Deal Team Member | Generate with multiple fee types set | Page 1 shows distinct "Upfront Fees" / "Interest" / "Lead Agent Fees" / "Legal & Professional Fees" sections, each line naming the actual payee — not one lump fee figure (verified live via rendered PDF image) |
| TC-13.8 | Page 2 shows full bank details, not masked | Deal Team Member | Generate the statement, open page 2 | Full account number and routing number are printed per party (Borrower, Lenders, 3rd Party Providers), each with a Checker-validation status label and the dollar amount attributable to them (verified live via rendered PDF image) — this is intentionally different from FR-10's masked blind re-entry screen; see FR-13's note on why |
| TC-13.9 | PDF text uses only base-font-safe characters | Deal Team Member | Generate the statement | No missing/substituted glyphs anywhere in the PDF (caught live: an em-dash rendered as a stray middle-dot because Helvetica's base-14 encoding doesn't include it — fixed by using a plain hyphen in all PDF-drawn text; em-dashes are still fine in chat messages, which render through a real web font) |
| TC-13.10 | Two parties sharing one source document get independent amounts on page 2 | Deal Team Member | Generate the statement for a deal where one Lenders-folder document names two lenders (e.g. one wire-instructions PDF listing two co-lenders) | Each lender's page-2 "Source Amount"/"Interest Due"/"Lead Agent Fee" matches their OWN per-lender share from page 1's Sources/Uses split, not the combined total of both lenders (caught live: `_amounts_by_document_id` keyed by `document.id`, which isn't unique per party when one document yields multiple parties — both lenders showed the same summed total on page 2 while page 1 correctly showed their even split; fixed by keying on `_party_key()`, which uses the party's own `StandingInstruction.id` when one exists) |

## FR-13a — Deal Map

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-13a.1 | Census matches live data | Any Deal Room member | Open the Deal Map panel | Member/document/SSI counts match what the Documents explorer and SSI panels show; Fund Flow Document line shows its filename or "not created yet" |
| TC-13a.2 | Dashboard tile mirrors a pared-down Deal Map | Any Deal Room member | Open the Deals dashboard, in either card (grid) or list view | Every deal tile shows Product / Borrower / Lenders rows (Status/Members/Messages so far/Standing instructions were deliberately dropped — Status is already the card header pill, the rest weren't needed on the tile), followed by a row of member avatars pinned to the bottom of the tile, sourced from `GET /deals`' `borrower_names`/`lender_names` fields (verified live via Playwright screenshot against 5 real deals in both view modes) |
| TC-13a.3 | Borrower/Lenders list is built from documents, not SSIs | Any Deal Room member | View a dashboard tile for a deal with a Lenders-folder document naming a party that has no extracted Standing Instruction yet | That party's name still appears in the tile's Lenders row (reuses `_parties_for_folder` from `funding_document.py` — same "a document proves participation even without an SSI" rule FR-13 already uses) |
| TC-13a.4 | Party list renders stacked and right-aligned | Any Deal Room member | View a dashboard tile for a deal with multiple borrowers or lenders | Each name renders on its own line, right-aligned under the row label (verified live: "Mention Test Deal" showing 6 stacked lender lines) — not a comma-joined single line |
| TC-13a.5 | Party list collapses past 9 names | Any Deal Room member | View a dashboard tile for a deal with more than 9 borrowers or lenders in one folder | Row shows a single "…" instead of listing all names or truncating with a count |
| TC-13a.6 | Status pill right-aligned in the card header | Any Deal Room member | View a dashboard tile's header meta row | The product type tag sits left, the green status pill sits right (`.deal-card-meta` uses `justify-content: space-between`), not both left-aligned together |

## FR-13b — Dashboard To-Do Banner

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-13b.1 | Checker sees a to-do banner on login | Checker with pending Standing Instructions across multiple deals | Log in and land on the Deals dashboard | An amber banner above the deal list shows the total pending count and one clickable pill per deal with its own count (verified live: Chen — "15 Standing Instructions awaiting your review", broken down 3 / 11 / 1 across three real deals) |
| TC-13b.2 | Banner pill opens the right deal | Checker | Click one of the banner's per-deal pills | Navigates directly into that deal's Deal Room (verified live via Playwright: clicking the SomDeal2026 pill navigated to `/deals/1`) |
| TC-13b.3 | No pending work, no banner | Checker with zero `pending_checker_review` Standing Instructions anywhere | Log in and land on the Deals dashboard | No banner renders — not an empty/zero-state banner, nothing at all |
| TC-13b.4 | Role with no task type sees no banner | Deal Team, Ops Manager, Ops Team Member | Log in and land on the Deals dashboard | No banner renders, regardless of how many Standing Instructions are pending elsewhere — `pending_task_count` is 0 for every deal for these roles (verified live: Dana sees no banner) |
| TC-13b.5 | Per-tile badge shows a real count, not just an icon | Checker | View a dashboard tile for a deal with pending Standing Instructions | The task badge on the tile carries a small numeral showing the exact pending count, matching the banner's per-deal pill for that same deal |

## FR-14 — Remittance

TC-14.1–14.5 are verifiable today against the readiness *display* in the Remittances panel (built); TC-14.6–14.7 require remittance *execution*, which isn't built yet.

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-14.1 | Remittance enabled for a validated party | Ops Team Member | View the Remittance panel for a party whose Standing Instruction is Checker-validated | Remittance to that party is shown as enabled/available |
| TC-14.2 | Remittance disabled — pending Checker review | Ops Team Member | View the Remittance panel for a party whose Standing Instruction is still pending Checker review | Remittance to that party is disabled — cannot be initiated |
| TC-14.3 | Remittance disabled — rejected Standing Instruction | Ops Team Member | View the Remittance panel for a party whose Standing Instruction was rejected (FR-10 mismatch) | Remittance to that party is disabled — cannot be initiated |
| TC-14.4 | Mixed deal — some parties cleared, some not | Ops Team Member | On a deal with multiple lenders where only some are Checker-validated | Remittance is independently enabled for the validated lenders and disabled for the rest — one party's status never unblocks or blocks another's |
| TC-14.5 | Third-party recipient follows the same gate | Ops Team Member | View the Remittance panel for a non-borrower recipient (e.g. a title company per FR-12) | Same validated-Standing-Instruction gating rule applies — no special bypass for third parties |
| TC-14.6 | Remittance amount matches the Fund Flow Document | Ops Team Member | View the amount shown for an enabled remittance | Amount matches what FR-13's Fund Flow Document states for that party, not a value from elsewhere |
| TC-14.7 | Blocked remittance attempt is logged as blocked, not silently ignored | Ops Team Member | Attempt to execute a remittance that is currently disabled | Action is refused with a clear reason (Standing Instruction not yet validated); attempt is not silently dropped |
| TC-14.8 | Executed remittance is logged | Ops Team Member | Execute an enabled remittance | Action is logged per FR-7 (who, when, party, amount) |

## FR-15 — Ops Manager Pending Approvals Oversight

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-15.1 | Ops Manager sees every pending approval, across every deal | Ops Manager | Log in and view the Deals dashboard | A table lists every `pending_checker_review` Standing Instruction system-wide (not just deals the Ops Manager is an explicit member of), each row showing deal, party, folder, assigned Checker(s), submitted date, and age (verified live: Omar saw 15 rows spanning 3 different deals) |
| TC-15.2 | Non-Ops-Manager blocked | Deal Team, Ops Team Member, Checker | Call `GET /admin/pending-approvals` directly | 403 (verified live: Chen got 403) |
| TC-15.3 | Rows sorted oldest-first | Ops Manager | View the approvals table | The longest-pending item is the first row, not the most recently submitted one |
| TC-15.4 | Row background turns red past 8 hours pending | Ops Manager | View a row whose Standing Instruction has been `pending_checker_review` for more than 8 hours | Row renders with a red background and red age text (verified live against real aged data, all >13h) |
| TC-15.5 | Row background turns orange between 4 and 8 hours | Ops Manager | View a row pending between 4 and 8 hours | Row renders with an orange background and orange age text (verified live by temporarily backdating one Standing Instruction's `submitted_at` to 6 hours ago, then reverting it) |
| TC-15.6 | Row stays plain under 4 hours | Ops Manager | View a row pending less than 4 hours | Row renders with no urgency background (verified live by temporarily backdating one Standing Instruction's `submitted_at` to 2 hours ago, then reverting it) |
| TC-15.7 | Clicking a row opens the right deal | Ops Manager | Click any row in the approvals table | Navigates directly into that Standing Instruction's Deal Room, where the Ops Manager can `@mention` another Checker to add them (the existing FR-4 flow) |
| TC-15.8 | Checker-less deal shows its fallback assignee, not bare "Unassigned" | Ops Manager | View a row whose Standing Instruction was created while the deal had no Checker member | Checker(s) column reads the fallback Ops Manager's name (e.g. "Omar (Ops Manager)") rather than an empty cell — see FR-15's fallback-assignment note. A Standing Instruction predating this feature (created before `assigned_checker` existed, still no real Checker on the deal) still reads "Unassigned," since the field is only ever stamped at creation time |
| TC-15.9 | Panel absent for non-Ops-Manager roles | Deal Team, Ops Team Member, Checker | Log in and view the Deals dashboard | No approvals table renders — this is Ops-Manager-only oversight, distinct from the Checker's own personal to-do banner (FR-13b) |
| TC-15.10 | New Standing Instruction in a Checker-less deal is stamped with a fallback assignee | Deal Team Member | Upload a document that extracts to a Standing Instruction, in a deal with no Checker member | The new SSI's `assigned_checker` is the deal's Ops Manager; the agent's chat message reads "Awaiting review by {name} — no Checker is on this deal yet." instead of "Awaiting Checker validation." (verified live: uploading into "Riverside Logistics Loan," which has no Checker member, produced an SSI assigned to Omar with the correct chat wording) |
| TC-15.11 | Real Checker present means no fallback stamp | Deal Team Member | Upload a document that extracts to a Standing Instruction, in a deal that already has a Checker member | The new SSI's `assigned_checker` is null; the agent's chat message reads "Awaiting Checker validation." unchanged |
| TC-15.12 | Fallback assignment is not a permission grant | Ops Manager assigned as fallback | Attempt to call the validate endpoint for a Standing Instruction assigned to them | Still 403 — only a `checker`-role user may validate, regardless of `assigned_checker` |
| TC-15.13 | Assigned-to row visible on the SSI detail view | Any Deal Room member | Open the detail view of a Standing Instruction with a fallback `assigned_checker` set | An "Assigned to" row shows the fallback Ops Manager's name; absent entirely for SSIs with no fallback assignment |

## FR-16 — 3rd Party & Other Standing Instructions Tab

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-16.1 | Tab shows every non-Borrower, non-Lender SSI | Any Deal Room member | Open the "SSI — 3rd Party & Other" rail icon | Lists every Standing Instruction whose source document's folder isn't Borrower or Lenders — verified live: "Riverside Logistics Loan" showed all 4 3rd Party Providers-folder SSIs (3 pending + 1 superseded) under this tab |
| TC-16.2 | Rail badge shows pending count for this tab specifically | Any Deal Room member | View the rail icon without opening it | A red badge shows the count of `pending_checker_review` SSIs in this tab's scope only, independent of the Borrower/Lender tabs' own badges |
| TC-16.3 | Tab visible to every role | Deal Team, Ops Manager, Ops Team Member, Checker | Open any Deal Room | The "SSI — 3rd Party & Other" icon is present for all of them, same as the Borrower/Lender icons — unlike the role-gated Remittances icons |
| TC-16.4 | Detail view, evidence, and blind re-entry validation work identically to the other two tabs | Checker | Open a Standing Instruction from this tab and validate it | Same masked re-entry flow as Borrower/Lender SSIs — no separate code path |

## Deployment Model & Multi-Product Support

| ID | Scenario | Role | Steps | Expected |
|---|---|---|---|---|
| TC-DM.1 | Different checkpoint lists per product, same instance | Deal Team Member | Create a Commercial Loan deal and a Real Estate Loan deal in the same instance | Each deal's signal board (FR-11) shows the checkpoint list appropriate to its product type (e.g. real estate includes the recipient/payee checkpoint; a simple bilateral commercial loan doesn't show the pro-rata check) |
| TC-DM.2 | Product-type switch does not corrupt an existing deal | Deal Team Member | Attempt to change an existing deal's product type after checkpoints are already partially confirmed | Confirm with founder whether this is even allowed; if allowed, previously-confirmed checkpoints not relevant to the new product type should not silently carry over as "confirmed" for requirements they were never actually verified against |
| TC-DM.3 | No cross-bank data path exists | N/A (architecture-level) | Review the deployment architecture | No API, database, or shared service connects one bank's installed instance to another's — isolation is structural, not access-controlled |

## Coverage Gaps (flag before implementation)

- No test cases yet for multi-tenancy (bank-to-bank data isolation) — depends on resolving that open question in `SPECIFICATIONS.md` §5.
- No test cases yet for the document auto-categorization *algorithm's* accuracy — depends on resolving the rules-vs-ML open question.
- No test cases yet for how "same document, new version" is determined in FR-6 — depends on resolving the version-matching open question.
- No test cases yet for who defines the required checkpoint list per loan product (FR-10) — depends on resolving that open question.
- No test cases yet for Checker/Ops Team role overlap rules (FR-10 segregation-of-duties question).
- No test cases yet for who is authorized to perform an FR-12 manual override (Checker, Ops Manager, both/four-eyes) — depends on resolving that open question.
- No test cases yet for which document types trigger the FR-12 AI discrepancy check, or how alert-fatigue from over-flagging is avoided.
- No test cases yet for how per-product-type configuration is managed (bank-admin-editable vs. fixed by dealops) — depends on resolving that open question.
