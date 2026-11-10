# ClaimCenter regression suite — handoff

This branch carries everything for the Regression (ClaimCenter) work:

1. **Runner tab** — already applied on this branch:
   `Playwright Projects/Commercial Line Performance test/runner/server.js` and `index.html`
   (new "Regression (ClaimCenter)" tab, `/api/regression/*` endpoints, `regression` suite).

2. **ClaimCenter-Automation changes** — a patch, because that repo (`amitmish0041/ClaimCenter-Automation`)
   could not be pushed to from the session that built this:

   ```
   cd "<path to>/ClaimCenter-Automation"
   git checkout -b regression-suite
   git apply --check "<path to>/regression-handoff/ClaimCenter-Automation_regression.patch"
   git apply "<path to>/regression-handoff/ClaimCenter-Automation_regression.patch"
   ```

   It adds `tests/Regression/*.regression.test.js` (108 cases), `helpers/regression/` (catalog.json,
   regressionSteps.js, policyCenter.js, soapClient.js), `scripts/regressionCatalog.js`, a `Regression`
   Playwright project + npm scripts, and small opt-in additions to `helpers/fnolHelper.js` and
   `helpers/e2eSteps.js` (existing callers unchanged).

3. **Regression_Automation_Coverage_V1.1.xlsx** — per-case automation status, steps left manual,
   test data / switches each case needs, validation report.

## Run

Restart the Runner, open the **Regression (ClaimCenter)** tab, tier TEST, 1 browser, and run the
**Intake FNOL** feature first (it files the claims the other cases reuse from
`results/regression/claim-pool.json`). Or from ClaimCenter-Automation:

```
REG_GREP="RG-TC0(0[7-9]|1[0-9])\b" npm run regression:test
```

Status: statically validated only (syntax, lint, helper-contract check, unit tests, test listing).
Nothing has been run against ClaimCenter yet — expect selector fixes on screens marked
"not yet live-verified" in the catalog.
