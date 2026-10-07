# Test Runner — Team Setup

This is the shared Playwright test runner UI (Policy suite, Claims/ClaimCenter-Automation
suite, and the ClaimCenter Migration Reconciliation tool), packaged so anyone on the team
can run their own local copy from the shared drive.

**There is no shared server** — each person runs this on their own machine and opens it in
their own browser at `http://localhost:3000`. Nothing you run is visible to anyone else's
copy, and nothing anyone else runs shows up in yours.

## What's in this package

Three sibling folders, copied together on purpose — the runner expects all three to sit
next to each other exactly like this:

```
<some folder>/
├── Commercial Line Performance test/   <- start the runner from here
├── ClaimCenter-Automation/
└── cc-migration-reconciliation/
```

Each one already has a `.env` file with the credentials needed to log into ClaimCenter /
Workbench (dev and test tiers). **Treat this whole folder as sensitive** — those `.env`
files contain real passwords in plain text. Don't upload this folder anywhere outside the
team drive, don't attach it to an email, don't put it in a public or personal repo.

## One-time setup (a few minutes, first run only)

1. Copy all three folders above from the shared drive to somewhere on your own machine —
   **not** a synced/cloud folder (OneDrive, etc.) if you can avoid it; `npm install` and
   Playwright work better on a plain local path. Keep the three folders as siblings, same
   layout as above.

2. Open a terminal in **each** of the three folders and run:
   ```
   npm install
   ```

3. Install the Playwright browser (only needs doing once per machine, from any one of the
   three folders):
   ```
   npx playwright install chromium
   ```

4. Start the runner from the `Commercial Line Performance test` folder:
   ```
   npm run runner
   ```
   You should see:
   ```
   Test runner UI: http://localhost:3000
     Policy suite dir: ...
     Claims suite dir: ...
     Reconciliation project dir: ...
   ```

5. Open **http://localhost:3000** in your browser (Chrome/Edge). Leave the terminal
   running — that's the server the page talks to.

## Every time after that

Just step 4 and 5 — open a terminal in `Commercial Line Performance test` and run
`npm run runner`, then open http://localhost:3000. Ctrl+C in the terminal stops it.

## Getting updates later

This is a snapshot, not a live sync — if the tool changes, someone needs to re-copy the
three folders from the shared drive (or just the changed one) onto your machine. There's
no automatic update.

## Known limitations of "everyone runs their own copy"

- **Everything logs in as the same shared ClaimCenter/Workbench account** (the credentials
  baked into the `.env` files). Actions taken through this tool won't be attributable to
  the individual who ran them — anything logged in ClaimCenter will show that shared
  account, not you personally.
- **You're each hitting the same dev/test ClaimCenter and Workbench environments
  independently.** If several people kick off runs at the same time, expect the shared
  dev/test tiers themselves to be the bottleneck (same as today when one person runs
  things), not this tool.
- If credentials change (password rotation, etc.), everyone needs a fresh copy of the
  `.env` files — there's no central place that updates automatically.
