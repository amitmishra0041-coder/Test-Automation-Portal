# WB BOP Standard workflow — Playwright tests

Quick notes to run the existing Playwright test(s) in this repository.

Prerequisites
- Node.js (v18+ recommended)
- Git/Editor (optional)

Install dependencies and browsers
```powershell
cd "C:\Users\amitmish\Playwright Projects\WB BOP Standard workflow"
npm install
npx playwright install
```

Environment variables (recommended)
- The tests expect `TEST_USER` and `TEST_PASS` to be present. Setting them avoids committing credentials.

PowerShell (current session)
```powershell
$env:TEST_USER = "your_username"
$env:TEST_PASS = "your_password"
npm test
```

PowerShell (one line)
```powershell
$env:TEST_USER="your_username"; $env:TEST_PASS="your_password"; npm test
```

Make them persistent (not recommended for secrets)
```powershell
setx TEST_USER "your_username"
setx TEST_PASS "your_password"
# open new PowerShell to use them
```

Useful npm scripts
- `npm test` — run all tests (uses `playwright.config.js` projects)
- `npm run test:headed` — run tests in headed mode
- `npm run test:chromium` — run tests only in the `chromium` project

Notes
- Tests were migrated to use environment variables to avoid keeping secrets in source. See `BOP.test.js` for the example login test.
- If you want CI integration, set `TEST_USER` and `TEST_PASS` in your CI provider's secret store and run `npm test`.

If you'd like, I can add a `test:ci` script that runs with different reporters or integrate with GitHub Actions.
