# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: pre-implementation.** This repository is currently empty — no code, no stack has been chosen yet. This file captures the product vision agreed with the founder so far. Once implementation begins, this file should be updated to add build/lint/test commands and real architecture notes (see "Next Steps" below).

## Product Vision

**dealops** is a product for commercial lending teams that bridges the gap between deal **origination** and deal **servicing/structuring** — specifically the manual handoff that happens today between systems like **nCino** and **Loan IQ**.

### Background: the two systems being bridged

- **nCino** — cloud banking platform built on Salesforce. Used mostly front-office, for origination: loan pipeline management, credit approvals, underwriting, deposit account opening.
- **Loan IQ** — Finastra's platform for syndicated and commercial lending. Used mostly back-office/servicing: deal structuring, loan servicing, agency/trading functions for the secondary loan market, payments, accruals, positions.

Today, moving a deal from origination (nCino) into servicing/structuring (Loan IQ) is a largely manual process done by the **deal team** and **operations team** — rekeying deal terms, chasing documents, reconciling covenants/pricing/parties between the two systems.

### The product

dealops does **not** require access to actual nCino or Loan IQ instances. It's a standalone UI/workflow layer that sits conceptually between the two, designed to be pitched and sold as a product to banks (multi-bank, not a single in-house tool).

**Deployment model (confirmed):** **installed, single-tenant per bank — not multi-tenant SaaS.** Each bank runs its own instance; there is no shared cloud infrastructure across banks. This sidesteps cross-bank data isolation as an application-level concern entirely (each bank's data is already physically/logically separate by deployment, not by application-level tenant scoping). One installed instance at a given bank supports **multiple loan product types concurrently** (commercial loan, real estate loan, etc.) — a bank doesn't need a separate install per product line. This means product type is a first-class, configurable dimension of the system: things like the FR-10 checkpoint list and FR-3 folder categories need to vary by loan product type within the same running instance, not just in theory.

**Target users:** the deal team and the operations team at a bank, working across **different commercial loan products** (not a single loan type — the product needs to generalize across product types).

### MVP scope (agreed: all three, together)

1. **Deal handoff & field mapping** — take a deal record's terms/parties/covenants (shaped like an nCino export) and map/transform them into Loan IQ-shaped fields, with a review screen for the ops team to confirm before "sending."
2. **Document packaging & routing** — collect, tag, and route closing docs/credit agreements from origination into the servicing team's checklist in Loan IQ.
3. **Ops task queue / status tracker** — a queue-and-status dashboard showing which deals are "in transit" between systems, what's blocked, and who owns the next step.

### "Slack-like" collaboration — RESOLVED into the Deal Room concept

The founder's boss suggested the product should be "like Slack." This is now resolved: **not** a global company-wide chat, but a **per-deal workspace ("Deal Room")** — one scoped chat + file space + membership list per deal, similar in feel to a Slack channel but purpose-built around a single deal's lifecycle. Both deal team members and ops team members work **multiple deals concurrently**, so each user needs to move between many Deal Rooms, with no cross-deal bleed of documents, chat, or membership.

Deal Room capabilities agreed so far (see `docs/SPECIFICATIONS.md` for the full functional spec and `docs/TEST_CASES.md` for test coverage):

1. **Ops staffing request** — a deal team member can request, from within the Deal Room, that an ops manager/admin assign ops team member(s) to the deal.
2. **Drag-and-drop document upload** — deal team members drag and drop a batch of loan documents directly into the Deal Room chat.
3. **Auto-arrangement into folders** — uploaded documents are automatically sorted into categorized folders (e.g. Borrower, Lenders, Credit Verification, Funding Docs).
4. **Ops membership management** — an ops admin/manager adds ops team members into the deal, which grants them access to that Deal Room's chat and documents.
5. **Background extraction → mock Loan IQ standing instructions** — borrower and lender account details are extracted from deal data/documents and sent to a **mock Loan IQ API** to create standing instructions.
6. **Document version diffing** — when a new version of a lender document is dropped into the Deal Room, the system shows a diff against the previous version.
7. **Conversation logging** — all Deal Room conversations are logged for audit purposes.
8. **Funding trigger ("the big beautiful button")** — once a deal is ready, the deal team presses a prominent completion action, which hands off to the ops team to disburse funds to the borrower.
9. **Checkers & digital "shisa kanko" (point-and-call) verification** — Deal Rooms can include a **Checker** role (distinct from Deal Team and Ops Team) whose job is to explicitly verify critical deal data before funding. Modeled on the Japanese rail safety practice *shisa kanko* (指差喚呼, "pointing and calling"), where an operator points at a specific gauge/signal and calls out its status aloud — engaging sight, motion, and voice together to force real attention rather than a passive glance. In dealops, a Checker points at a specific critical field (e.g. borrower account number, lender account number, loan amount) and posts an explicit confirmation call-out in the Deal Room chat (e.g. "Borrower account ...1234 — confirmed"), logged with checker identity and timestamp. **The FR-8 funding trigger is gated on all required point-and-call confirmations being complete** — this is the guardrail that stops the deal from being funded before it's actually been checked. Goal: catch errors before they "wreck the deal train."

**Checkpoint list (confirmed baseline)** and **Signal Board (new)**: the Checker's point-and-call targets are now a defined checklist — borrower identity/account/routing details, each lender's account + pro-rata share (summing to 100%), funding amount/currency/rate/date, document consistency, a check that auto-extracted standing-instruction data matches the source document, and a **recipient/payee checkpoint** (funds don't always go to the borrower — see below). A **signal board** panel (right-hand side of the Deal Room UI) shows each checkpoint's live status — flashing while pending, green once satisfied — and auto-detects when a matching document lands in the right folder (e.g. an updated borrower document dropped into the Borrower folder with the right account details makes that data available). Full checklist in `docs/SPECIFICATIONS.md` (FR-10, FR-11).

**RESOLVED — auto-detect does not equal confirmed:** auto-detection only surfaces a value as available; it does **not** satisfy a checkpoint by itself. A Checker must independently confirm via **blind re-entry** — re-typing the critical value themselves (all digits, or a partial spot-check like "the 5th digit" or "the last 3 digits") rather than just viewing and approving the extracted value. The system compares what the Checker typed against the extracted value; a match confirms the checkpoint and broadcasts a completion message to every Deal Room participant, logged per FR-7. This preserves the actual point of shisa kanko — a human has to consciously reproduce the value, not rubber-stamp it.

**AI discrepancy detection (new — FR-12):** funds aren't always meant for the borrower directly — e.g. in real estate deals, closing/title documents sometimes direct funds to a **title company/escrow agent** instead. The system uses AI to read relevant documents, and if the AI-detected recipient conflicts with the assumed recipient, that's flashed as a discrepancy (not silently auto-corrected, not silently ignored) and requires an authorized person to manually review and override — a deliberate, logged decision either way.

**Ops Manager visibility (confirmed):** Ops Managers/Admins have standing access to *every* Deal Room (oversight role), even before any Ops Team Member is assigned — so when a Deal Team Member posts a staffing request in-chat, the Ops Manager already sees it and can respond/assign right there. The entire staffing request → assignment flow happens **in the chat itself**, not through a separate ticket form; the assignment action is what grants the assigned Ops Team Member access to that Deal Room.

## Tech Stack (confirmed — POC)

- **Backend:** Python + FastAPI
- **Database:** SQLite (POC only — a real installed deployment would likely move to PostgreSQL/SQL Server later, not yet decided)
- **Frontend:** React
- **Code style:** deliberately kept very simple and readable — small single-purpose files, descriptive names, minimal abstraction, so the codebase stays approachable to a non-expert reader.
- **Users:** demo users are hardcoded/seeded directly into the database — POC only, not a real auth system. Currently: Dana (Deal Team), Omar (Ops Manager), Priya (Ops Team), Chen (Checker), Som (Ops Team), Kamal (Checker) — `username`/`password123` for each, listed in `backend/seed_data.py` and as one-click login buttons on the login page.
- **UI:** minimalist, white background, generous whitespace, icons used liberally as visual hints (folder icons, signal-board status dots, upload/lock icons, etc.).
- **Agentic AI isolation:** anywhere AI is used (document folder classification per FR-3, borrower/lender detail extraction per FR-5, discrepancy detection per FR-12) lives in its own isolated backend module, called through a plain function interface — so the POC's simple rule-based mock logic can later be swapped for a real model without touching the rest of the app. Concretely, this is the `backend/ai/` folder — see "Proposed Repository Structure" below.

### Repository Structure (implemented — auth, deals, chat)

`backend/` and `frontend/` now contain **working code** for the foundation slice: login, deal creation, and Deal Room chat (documents/signal board/checkpoints/AI modules are not built yet — see "Not Yet Decided" and the FR list in `docs/SPECIFICATIONS.md` for what's next). Two real-world gotchas hit and fixed during setup, worth knowing before touching this code:

- **`passlib` was dropped.** It doesn't work with modern `bcrypt` package versions (`AttributeError: module 'bcrypt' has no attribute '__about__'`). Password hashing now calls the `bcrypt` library directly via `hash_password`/`verify_password` in `backend/security.py` — simpler code anyway.
- **Vite is pinned to `^5.4.11`** (not the newest major). Vite 8's default bundler (rolldown) needs a native binary this machine's Node version (20.16) doesn't get automatically, and needs Node ^20.19/22.12+ to avoid warnings. `@vitejs/plugin-react` is pinned to `^4.3.4` to match. A clean `rm -rf node_modules && npm install` has been verified to work with no manual steps.

To run it: see "How to run it" — backend needs a venv + `pip install -r requirements.txt` + `python seed_data.py`; frontend needs `npm install`. Both dev servers were running at the end of this session (backend on :8000, frontend on :5173).

**Bug fixed — Ops Manager visibility was documented but not implemented.** The first backend pass gated deal visibility purely on explicit `DealMember` rows, so an Ops Manager couldn't see a deal (or its staffing request) until someone added them — contradicting the standing-visibility rule already written into this file. Fixed in `backend/routes/deals.py`: both `list_my_deals` and `require_deal_membership` now special-case `role == "ops_manager"` to bypass the membership check entirely. Backend now runs with `--reload` so future route edits apply without a manual restart.

**@mention autocomplete + mention-triggers-membership (FR-1/FR-4 now implemented):** typing `@` in the chat input opens a live dropdown (backed by `GET /users`) showing every user, with a "not in deal" tag for people who aren't members yet. When an **Ops Manager** sends a message mentioning `@username`, the backend (`backend/routes/chat.py`) doesn't just render it as text — it actually adds that user as a `DealMember` if they weren't one, and posts an automatic confirmation message ("X was added to this deal.") visible to everyone in the room. A Deal Team Member's `@mention` is decorative only (highlighted in the message) — only an Ops Manager's mention grants access, matching FR-4's "only Ops Managers/Admins may add Ops Team Members" rule. New endpoints: `GET /users` (full user list, for the mention dropdown) and `GET /deals/{id}/members` (current Deal Room roster, shown in the sidebar). Chat rendering also switched to Slack's actual layout — avatar + name + timestamp on every message, no left/right bubble split by "mine vs. theirs" — since the founder was asking specifically about Slack parity, not a WhatsApp-style bubble UI.

**Bug fixed — Ops Manager's standing access wasn't reflected in the members list.** The `@mention` dropdown was tagging Omar "not in deal" because `/deals/{id}/members` only returned explicit `DealMember` rows, ignoring the standing-access rule. Fixed with one shared helper, `get_deal_members()` in `backend/routes/deals.py` — explicit members ∪ every Ops Manager, deduplicated — now used by the members endpoint, the mention dropdown's "not in deal" check, and the new deal dashboard's member avatars, so there's one source of truth instead of three places that could disagree.

**Dashboard redesign — vertical summary bars.** `DealListPage` no longer shows a grid of plain cards; each deal is now a full-width horizontal bar (stacked vertically in a list) showing, at a glance: summary (icon/title/reference/status), a member avatar stack, a documents section (currently a static "No documents yet" placeholder — there's no document feature yet, so this isn't backed by fake data, just reserved layout for when FR-2/FR-3 exist), and a live last-chat-message preview. `GET /deals` now returns richer `DealOut` objects (`members`, `last_message_text`, `last_message_at`, `last_message_user`) computed per-deal in `build_deal_out()`.

**Working agreement: the founder creates deals through the UI — deals are never created via curl/backend for testing.** Test deals created earlier via curl (`Riverside Logistics Loan`, `Mention Test Deal`) were deleted from the dev database, keeping only the founder's real `SomDeal2026`. Future backend verification uses read-only `GET` calls against real data instead.

**Background agent identity (new).** Every deal now gets its own synthetic "agent" user, created lazily the first time it's needed: `get_or_create_deal_agent()` in `backend/routes/deals.py`, name `f"{deal.title}_agent"`, `role: "agent"`, linked via `User.agent_for_deal_id`. All automated/background messages — today, the "X was added to this deal" confirmation after an Ops Manager's mention — are authored by this agent instead of the human who triggered them, so the log distinguishes what a person said from what the system did. **This is the established convention going forward**: FR-3 (auto-foldering), FR-5 (extraction), FR-11 (signal board updates), and FR-12 (discrepancy flags) should all post as the deal's agent too. Agents are excluded from `GET /users` (mention suggestions) and from `get_deal_members()` — they're not staffable people. Frontend: `Avatar` takes a `role` prop and renders a robot icon (`FaRobot`, `#4b5563` background) instead of colored initials when `role === "agent"`.

Adding `agent_for_deal_id` (FK `users.id → deals.id`) alongside the existing `Deal.created_by_id` (FK `deals.id → users.id`) created two foreign-key paths between the `deals` and `users` tables, which broke SQLAlchemy's ability to infer `Deal.created_by` — fixed by making that relationship explicit: `relationship("User", foreign_keys=[created_by_id])`. Worth remembering if another cross-referencing FK gets added later.

**Working agreement (reaffirmed):** the founder creates deals through the UI. The two test deals deleted earlier (`Riverside Logistics Loan`, `Mention Test Deal`) were restored at the founder's request — deletion turned out to be the wrong call even for curl-created test data; ask before removing data rather than assuming it's disposable.

**Agents are now real Deal Room members, and you can chat with them.** `get_deal_members()` (`backend/routes/deals.py`) eagerly creates the deal's agent on first access and includes it in the returned member list — so it shows up in the sidebar, the dashboard avatar stack, and the member count, same as any human. Any deal member (not just Ops Managers) can mention the agent — e.g. `@SomDeal2026_agent describe` — and get a reply, via a small command registry in the new `backend/agent.py`: `AGENT_COMMANDS = {"describe": ...}`. A bare mention with no recognized command returns a numbered menu of what's currently available. **Adding a capability later is just adding an entry to `AGENT_COMMANDS`** — nothing else about the mention-handling needs to change. `handle_agent_mention()` in `backend/routes/chat.py` wires this into `post_message`; a mention of the agent always resolves before the (separate, Ops-Manager-only) mention-grants-membership check, and that check now explicitly skips agent mentions so an Ops Manager can't accidentally "add" one as staff.

**Bug fixed — the agent's username didn't match what people actually type.** Originally the agent's `username` was an internal token (`agent_deal_1`) while its display `name` was `SomDeal2026_agent`; since mentions match on `username` and the frontend inserts `@{username}`, typing the name everyone actually sees never worked. Fixed by setting `username = name` for agents (mentions match on username elsewhere in the app precisely because it's guaranteed collision-free for humans — for agents, deal titles are assumed unique enough for a POC; a title collision would violate the `username` unique constraint, a known edge case, not yet handled). Existing agent rows were migrated in place (`agent_deal_1` → `SomDeal2026_agent`, etc.) rather than recreated, so message history stayed intact.

**Dashboard: card grid is now the default, list view is one click away.** No more "+N" truncation anywhere — member avatars wrap onto as many lines as needed (`avatar-wrap`, `flex-wrap: wrap`) instead of being cut off. Deals now render as **vertical cards, 3 per row** (`deal-card-grid`, 2/row under 900px, 1/row under 600px) by default; a burger icon (top-right of the dashboard) opens a small menu to switch to the original horizontal list layout and back. Both layouts share one `DealSections` component (members/documents/last-message) in `DealListPage.jsx` so they can't drift apart — only the surrounding card/bar wrapper differs.

**Deal Room restructured.** `deal-top-bar` (icon/title/reference/status, no back arrow — back navigation is via the navbar's "dealops" logo) now sits above a two-column body: a `doc-explorer` placeholder on the left (the FR-3 folder categories — Borrower, Lenders, Credit Verification, Funding Docs — each showing 0, ready for the drag-and-drop feature going in next) and the chat panel filling the rest of the width. Deal Info and Members moved out of a right sidebar and into a slide-out drawer (`AccordionItem` component, new) opened via a burger icon in the top bar — first section is "Deal Detail" (reference/product/status/members, real data), followed by three placeholder sections (Signal Board, Standing Instructions, Activity Log) establishing the pattern for future FRs. **Interpretation call:** the founder said "burger menu next to profile" — placed it in the Deal Room's own top bar rather than the global navbar, since the drawer content is deal-specific; flag if that's not what was meant. Chat's auto-scroll now only fires when already near the bottom (checks `scrollHeight - scrollTop - clientHeight`), so a background poll no longer yanks the view down while reading older messages. Page `<title>` now shows the deal's name while in its Deal Room, reset to "dealops" on leaving. Navbar's user info (name/role/logout) is now a dropdown off the profile avatar instead of always-visible inline text.

**Two quick UI corrections.** The Deal Room top bar's title/reference/status now sit on one line (dropped the wrapping `<div>` that forced the title and subtitle onto separate rows). The dashboard's card/list toggle is no longer a burger-triggered dropdown — it's two always-visible icon buttons in a segmented control (`view-toggle`), one click each, no menu to open first. (Note: this was specifically the dashboard's layout toggle — the Deal Room's own burger, which opens the deal-details drawer, is unrelated and unchanged.)

**Top bar height halved.** `.deal-top-bar` padding `1rem` → `0.5rem`, icon `44px` → `30px`, title font-size `1.15rem` → `1rem` — a slimmer strip instead of a tall header.

**Mention dropdown: deal's own agent sorted first.** `mentionSuggestions` in `DealRoomPage.jsx` now sorts `role === "agent"` entries to the top before slicing to 6 — the agent used to land wherever insertion order happened to put it (often off-screen past the 6-item cutoff on deals with several members).

**FR-2/FR-3 implemented — documents, drag-and-drop, and auto-foldering.** `backend/routes/documents.py` handles upload (`POST /deals/{id}/documents`, multipart, any deal member — not just Deal Team, resolving TC-2.5), listing, and a secured download (`GET .../download`, membership-checked, streams from `backend/storage/deal_{id}/` which is never web-served directly). Files are saved under a random UUID filename — the original filename is stored in the DB for display only, never used as a path, so there's no path-traversal surface. Every upload writes two chat messages, same pattern as the mention flow: the human's "Uploaded X," then the deal's agent's "Filed X under Y" — so the log shows what a person did vs. what the system did. Classification itself lives in `backend/ai/document_classifier.py` (`classify_document()`), simple keyword matching against filename + extracted PDF text (`pypdf`) — swappable for a real model later since nothing outside this file contains classification logic. Frontend: `react-dropzone` wraps the whole Deal Room body (`noClick: true` so it doesn't hijack normal clicks — only actual drag-and-drop, or the explicit upload button, trigger it), and the left Documents Explorer now shows real per-folder counts and file lists (click a file to download) via `AccordionItem`, reusing the same component as the deal-details drawer.

**Known limitation, found during testing — not yet fixed:** the keyword classifier misfiled the real estate `title_company_closing_instructions.pdf` sample as "Borrower," because the document contains the word "borrower" (in a sentence saying funds should *NOT* go to the borrower). This is an honest demonstration of keyword matching's ceiling, not a bug to quietly patch — it's exactly the kind of case FR-12 (AI discrepancy detection) exists to catch later. Left as-is rather than papering over it with a brittle keyword tweak that would just move the failure elsewhere.

**Bug fixed — the dropzone's hidden input broke the grid layout.** `react-dropzone`'s `<input {...getInputProps()} />` is a direct child of `.deal-room-body-v2` (`display: grid; grid-template-columns: 220px 1fr`) — and in this version it wasn't actually rendering `display: none`, so it silently became a real grid item. That consumed the 220px column, pushing `doc-explorer` into the wide `1fr` column and wrapping `chat-panel-v2` onto a second row in the narrow column — the "documents box huge, chat tiny and misplaced" look the founder saw. Fixed two ways: `getInputProps({ style: { display: "none" } })` to force it explicitly, plus a defensive `.deal-room-body-v2 > input { display: none; }` CSS rule so a library behavior change can't silently break this layout again.

**Documents Explorer polish.** Each folder row now has a `FaFolder` icon (dropped when I switched to `AccordionItem`, since its `title` prop had been passed a plain string) — `AccordionItem`'s `title` already accepted any ReactNode, so passing an icon+text span was enough. Fixed the two-line wrapping too: `.doc-explorer`'s own padding plus `.accordion-header`'s own padding were compounding to leave barely 130px for text — removed the header's left/right padding specifically inside `.doc-explorer` (its outer padding already provides the inset) and widened that column 220px → 250px. Folder text now truncates with an ellipsis on overflow instead of wrapping.

**Four fixes/upgrades in one pass.** (1) Bug: the dashboard's document count was a hardcoded "No documents yet" stub left over from before the documents feature existed — `GET /deals` never actually counted them. Added `document_count` to `DealOut`/`build_deal_out()`, wired the dashboard card to show it. (2)+(3) Deal Room is now a real three-pane layout: Documents Explorer (left, 250px) → Document Preview (center, flexible, the new default focus) → Chat (right, 380px). Clicking a document now **previews it inline** (`fetchDocumentBlob()` → `<iframe src={blobURL}>`) instead of forcing a download — a download button still lives in the preview header for when you actually want the file. Panels now fill real viewport height (`calc(100vh - 110px)`) instead of a fixed 480px box, which matters a lot for actually reading a PDF. (4) The drawer now has a `var(--color-surface)` background (previously plain white, indistinguishable from the page), and its burger trigger (`.drawer-trigger`) carries a standing soft glow (`box-shadow` halo) so it reads as a distinct, important action rather than just another icon button.

**Second agent command (`docs`), plus command autocomplete.** `list_deal_documents()` in `backend/agent.py` lists every document in the deal grouped by folder — registered in `AGENT_COMMANDS` alongside `describe`, so `@AgentName docs` works immediately (verified against the 5-document test deal, including the earlier misclassified title-company doc showing up correctly under Borrower). New `GET /agent-commands` endpoint exposes the registry itself, so the frontend's command-autocomplete stays in sync automatically as commands are added — no hardcoded list to maintain on both sides. Frontend: typing `@AgentName ` now shows a second dropdown (same `mention-dropdown` styling, reusing the pattern) listing available commands with their `help` text — detected via a regex matching `@<agent's own username>\s+(\w*)$` right before the cursor, checked before the general mention-detection so it takes priority once you've actually mentioned the agent specifically.

**Icon rail added — Documents panel is now collapsible.** A slim 56px `icon-rail` sits leftmost in the Deal Room (Documents icon first, room for more later — Signal Board, etc.), and clicking it toggles the Documents Explorer open/closed rather than it always taking up a fixed column. Implementation trick worth remembering: the `.doc-explorer` grid track is **always present**, just `0` width when collapsed (`.with-doc-panel` class switches it to `250px`) — grid-template-columns animates smoothly via CSS transition only when the track *count* stays constant, so conditionally un-mounting the column would have broken the slide animation. Defaults open (`showDocPanel: true`) to match prior behavior — the new capability is that it can now collapse, not that it starts collapsed.

**Icon rail follow-up (first attempt didn't fully land).** The founder reported the grey color and the collapse were both still wrong after the previous fix. Grey: `var(--color-surface)` (`#f9fafb`) is only a hair off white — practically invisible as "grey" — swapped for an actually-visible `#e5e7eb`. Collapse: `min-width: 0` alone didn't fully resolve the sliver (some residual grid-track sizing edge case), so made it robust instead of chasing the exact cause further — `.deal-room-body-v2:not(.with-doc-panel) .doc-explorer` now explicitly strips border/padding and fades to `opacity: 0` (plus `pointer-events: none`) when collapsed, so even if a pixel or two of width lingers from a grid quirk, there's nothing left to render or click.

**Icon rail: three fixes.** (1) Grey background (`var(--color-surface)`) instead of white, so it reads as a distinct dock rather than another content card. (2) Pulled out of `.deal-room-body-v2`'s own padded/centered grid into a new wrapping `.deal-room-layout` (flex row: rail + body) — the rail is no longer subject to the body's `padding`/`max-width`/`margin: 0 auto`, so it now sits flush against the actual window edge instead of floating with a gap on either side. (3) **Bug fixed:** collapsing the Documents panel only hid it partially — a sliver of accordion chevrons stayed visible. Classic CSS Grid/Flexbox gotcha: a grid item's default `min-width: auto` refuses to let it shrink below its *content's* intrinsic width, even when the track itself is set to `0`. Fixed with an explicit `min-width: 0` on `.doc-explorer`.

**Known POC limitation:** login tokens are in-memory (`backend/security.py`), so restarting the backend invalidates every active browser session — expect to need to log in again after a backend restart during development.

**UI design note:** the first pass was too literally "minimalist" — plain stacked boxes, no real layout. Revised to an actual app shell: a sticky `Navbar` (logo, user avatar, role badge, logout), a `Modal` component for the "New Deal" form instead of an inline collapsing box, a deal grid with per-product icons and status pills instead of a plain list, and a two-column Deal Room (chat + a right-hand info sidebar) instead of one stacked column — that sidebar is also where the FR-11 Signal Board will live once built, so the layout was chosen with that in mind. Still white background, still icon-forward, per the original ask — "minimalist" now means restrained color/decoration, not absence of layout. Design system lives in `frontend/src/App.css` as CSS variables (`--color-primary`, `--radius`, `--shadow-md`, etc.); shared pieces (`Avatar`, `Navbar`, `Modal`) live in `frontend/src/components/`.

### Proposed Repository Structure

```
dealops/
  backend/
    main.py                  — FastAPI app entrypoint
    models.py                — SQLAlchemy classes: User, Deal, DealRoom, Document, Message, Checkpoint
    schemas.py                — Pydantic request/response shapes
    database.py               — SQLite connection setup
    seed_data.py               — inserts the hardcoded demo users (and demo deals) on first run
    routes/
      auth.py                  — login endpoint
      deals.py                  — create/list/view deals
      documents.py               — upload, download, folder listing (access-checked)
      chat.py                    — Deal Room messages (incl. WebSocket for live updates)
      checkpoints.py              — signal board state, Checker blind re-entry confirmation
    ai/                        — ALL agentic/AI logic lives here, nowhere else
      document_classifier.py      — FR-3: which folder does a document belong in
      detail_extractor.py          — FR-5: pull borrower/lender account details
      discrepancy_detector.py       — FR-12: does the document's stated recipient conflict with the assumed one
    storage/                    — uploaded documents saved here (NOT web-served directly)
  frontend/
    src/
      pages/                    — LoginPage, DealListPage, DealRoomPage
      components/                — ChatPanel, DropZone, SignalBoard, DocumentDiffView
      api.js                     — fetch calls to the backend
      App.jsx, App.css
  sample_documents/            — the fictional test PDFs (already created)
  docs/                        — SPECIFICATIONS.md, TEST_CASES.md, CONVERSATION_LOG.md
```

Every file under `backend/ai/` is the *only* place that "AI" logic is allowed to live — `routes/documents.py` calls `ai.document_classifier.classify(...)`, it never contains classification logic itself. This is what makes "swap the mock logic for a real model later" actually true rather than aspirational.
- **Document security:** uploaded documents are stored outside any public web path and served only through an authenticated endpoint that checks Deal Room membership; Deal Room conversations are logged per FR-7 (append-only, no edit/delete that erases history).
- **Sample test documents:** fictional dummy deal documents live in `sample_documents/` at the repo root — intentionally outside the application source, for manually testing uploads, foldering, diffing (FR-6), and the FR-12 discrepancy case.

## Not Yet Decided

These were deliberately deferred until the vision is fully documented:

- **Data source strategy** — mock/seed fixtures shaped like nCino/Loan IQ objects vs. CSV/file upload from real exports vs. designing against a real-API-shaped interface now (stubbed for later).
- **Tech stack** — no framework/language chosen yet.
- **Document auto-categorization logic** — rule-based (filename/metadata heuristics) vs. content-based/ML classification into folders (Borrower, Lenders, Credit Verification, Funding Docs, ...).
- **Document diffing approach** — text-extraction diff (e.g. for text-based/OCR'd PDFs) vs. structured field-level diff vs. visual/redline diff; also how similarly-named documents are matched as "versions of each other."
- **Standing instruction extraction** — how account details are reliably extracted from documents/data (manual entry, structured fields, OCR/NLP) before being sent to the mock Loan IQ API.

## Next Steps

When implementation begins:
1. Resolve the "Not Yet Decided" items above with the founder.
2. Replace this vision-only file with one that also documents build/lint/test commands and real architecture, once a stack exists.
3. Keep the Product Vision section — update it as scope evolves rather than deleting history.
