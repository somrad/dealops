# dealops end-to-end tests

Playwright tests that drive the real running app through an actual browser —
not unit tests. They exercise the backend, ai_api, and frontend together,
the same way every feature in this project has been manually verified.

## Prerequisites

All three dev services must already be running (see the root `CLAUDE.md`):

- `ai_api` on :8001
- `backend` on :8000
- `frontend` on :5173

## Setup (first time)

```bash
cd tests
npm install
npx playwright install chromium
```

## Run

```bash
npm test              # headless
npm run test:headed   # watch it happen in a real, visible browser window
```

## Notes

- Tests log in as one of the seeded demo users (`dana`/`omar`/`priya`/`chen`/`som`/`kamal`,
  password `<name>123`) via the login page's one-click buttons — see `helpers/auth.js`.
- Tests run against the **existing** `SomDeal2026` deal rather than creating
  their own — per this project's working agreement, deals are only ever
  created through the UI, never programmatically for testing.
- Not parallel (`workers: 1` in `playwright.config.js`) — tests share real
  backend state (chat messages, standing instructions), so serial execution
  avoids one test's side effects interfering with another's.
