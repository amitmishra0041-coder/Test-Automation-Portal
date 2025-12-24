# Test-Automation-Portal — Commands Cheat Sheet (PowerShell)

This cheat sheet collects all useful commands we've used in the past 7–9 days to run and maintain the Playwright test suites on Windows PowerShell.

## Setup

```powershell
# Navigate to project root (suite lives in Test-Automation-Portal)
cd "C:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"

# Install dependencies and browsers
npm install
npx playwright install
```

## Environment variables

```powershell
# Set per-session environment (resets when you close the shell)
$env:TEST_USER = "your_username"
$env:TEST_PASS = "your_password"
$env:TEST_ENV  = "qa"        # or "test"
$env:TEST_STATE = "PA"        # DE|MI|OH|PA|WI when running single-state directly
$env:TEST_TYPE  = "BOP"       # BOP|PACKAGE used by reporter
```

## Run single tests directly (Playwright CLI)

```powershell
# BOP (Chromium; headless)
npx playwright test Create_BOP.test.js --project=chromium

# BOP (headed)
npx playwright test Create_BOP.test.js --headed --project=chromium

# Package (Chromium; headless)
npx playwright test Create_Package.test.js --project=chromium

# Package (headed)
npx playwright test Create_Package.test.js --headed --project=chromium

# Account creation only (if needed)
npx playwright test Create_Account.test.js --project=chromium

# CA flow
npx playwright test Create_CA.test.js --project=chromium
```

## Batch (.bat) wrappers

```powershell
# BOP — parallel across states (default DE,PA,WI,OH,MI)
.\run-bop-test.bat qa

# BOP — specific states (comma-separated)
.\run-bop-test.bat qa DE,PA
.\run-bop-test.bat test WI,OH,MI

# BOP — headed mode (add the word 'headed')
.\run-bop-test.bat qa DE,PA headed

# Package — parallel across states (default DE,PA,WI,OH,MI)
.\run-package-test.bat qa

# Package — specific states
.\run-package-test.bat qa PA,OH

# Package — headed mode
.\run-package-test.bat qa PA,OH headed

# Trigger both (headed) via one file
.\run-all-tests.bat qa

# Sequential: run BOP then Package (Chromium; headless)
.\run-bop-then-package.bat
```

Notes:
- `run-bop-test.bat` and `run-package-test.bat` call PowerShell runners that execute each state in parallel and send a consolidated email at the end.
- Add `headed` as the final argument to switch UI-on mode for the parallel runners.

## PowerShell parallel runners (called by .bat)

```powershell
# BOP (headless)
powershell.exe -ExecutionPolicy Bypass -File \
  .\run-parallel-bop.ps1 -TestEnv qa -States "DE,PA,WI,OH,MI" -Project chromium

# BOP (headed)
powershell.exe -ExecutionPolicy Bypass -File \
  .\run-parallel-bop.ps1 -TestEnv qa -States "PA,OH" -Project chromium -Headed

# Package (headless)
powershell.exe -ExecutionPolicy Bypass -File \
  .\run-parallel-package.ps1 -TestEnv qa -States "DE,PA,WI,OH,MI" -Project chromium

# Package (headed)
powershell.exe -ExecutionPolicy Bypass -File \
  .\run-parallel-package.ps1 -TestEnv qa -States "DE" -Project chromium -Headed
```

## Cleaning output and artifacts

```powershell
# From Test-Automation-Portal directory
cd "C:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"

# Per-state logs (BOP & Package)
Remove-Item .\test-run-output-*.txt -Force -ErrorAction SilentlyContinue
Remove-Item .\test-run-output-package-*.txt -Force -ErrorAction SilentlyContinue

# Iteration summary JSONs (used by email reporter)
Remove-Item .\iterations-data-bop.json -Force -ErrorAction SilentlyContinue
Remove-Item .\iterations-data-package.json -Force -ErrorAction SilentlyContinue

# Batch markers and parallel lock files
Remove-Item .\.batch-run-in-progress -Force -ErrorAction SilentlyContinue
Remove-Item .\.batch-email-sent -Force -ErrorAction SilentlyContinue
Remove-Item .\parallel-run-lock-bop.json -Force -ErrorAction SilentlyContinue
Remove-Item .\parallel-run-lock-package.json -Force -ErrorAction SilentlyContinue

# Transient test data
Remove-Item .\test-data.json -Force -ErrorAction SilentlyContinue

# Playwright test artifacts
Remove-Item .\test-results -Recurse -Force -ErrorAction SilentlyContinue

# Optional: unzip traces/resources from prior runs
Remove-Item .\trace-unzip -Recurse -Force -ErrorAction SilentlyContinue
```

### One-click cleanup script

```powershell
# From Test-Automation-Portal directory
./clean-artifacts.ps1          # normal cleanup
./clean-artifacts.ps1 -DryRun  # show what would be removed
```

## Quick examples

```powershell
# Run BOP for PA and OH in headed mode
.\run-bop-test.bat qa PA,OH headed

# Run Package for MI (headless)
.\run-package-test.bat qa MI

# Run BOP single test directly (headed)
$env:TEST_ENV='qa'; $env:TEST_STATE='PA'; $env:TEST_TYPE='BOP'; \
  npx playwright test Create_BOP.test.js --headed --project=chromium

# Clean logs & artifacts after a batch run
Remove-Item .\test-run-output-*.txt, .\test-run-output-package-*.txt, \
  .\iterations-data-*.json, .\.batch-*-in-progress, \
  .\parallel-run-lock-*.json -Force -ErrorAction SilentlyContinue
```

## Reports & outputs

- Consolidated email: sent automatically by `run-parallel-*.ps1` when all jobs finish.
- Per-state logs: `test-run-output-*.txt` and `test-run-output-package-*.txt`.
- Iteration JSON: `iterations-data-bop.json`, `iterations-data-package.json`.

---
Keep this file handy for future runs; it captures the exact commands we use across individual and parallel executions, headed/headless modes, and cleanup steps.
