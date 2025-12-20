# Parallel Test Execution Guide

## Why Tests Fail in Parallel but Pass Individually

When running tests via `.bat` files with 5 states in parallel, you may experience failures that don't occur when running states individually. This is normal and expected due to:

### Root Causes

1. **Server Load & Contention**
   - 5 browser instances hitting the same server simultaneously
   - Server responses are slower under load
   - Database locks and race conditions

2. **Dialog Timing Issues**
   - Address validation dialogs appear at unpredictable times
   - Modal overlays block clicks on underlying elements
   - Static waits (800ms, 1000ms) insufficient under load

3. **Resource Competition**
   - CPU and memory shared across 5 Chromium instances
   - Network bandwidth divided among parallel requests
   - Playwright's own resource management

## Solutions Implemented

### 1. Dialog Overlay Detection & Retry
```javascript
// State dropdown click - retry if blocked by dialog overlay
for (let attempt = 1; attempt <= 3 && !stateClickSuccess; attempt++) {
  try {
    // Check for blocking dialog overlay
    const overlay = page.locator('.ui-widget-overlay');
    if (await overlay.isVisible()) {
      await overlay.waitFor({ state: 'hidden', timeout: 3000 });
    }
    await page.locator('.ui-xcontrols > .ui-combobox > .ui-widget').first().click();
    // ... success
  } catch (e) {
    // Retry logic
  }
}
```

### 2. Modal Dialog Cleanup
```javascript
// Wait for dialogs to fully close before proceeding
await page.waitForTimeout(2000);
const modalOverlay = page.locator('.ui-widget-overlay');
if (await modalOverlay.isVisible()) {
  await modalOverlay.waitFor({ state: 'hidden', timeout: 5000 });
}
```

### 3. Extended Timeouts
- Global test timeout: 1200000ms (20 minutes)
- Click timeout: 10000ms (10 seconds)
- Dialog wait: 5000ms (5 seconds)

## Best Practices

### Running Parallel Tests

**Full Suite (All 5 States):**
```batch
run-bop-test.bat          # Runs DE, PA, WI, OH, MI in parallel
run-package-test.bat      # Runs DE, PA, WI, OH, MI in parallel
```

**Specific States Only:**
```batch
run-bop-test.bat qa DE,PA          # Just 2 states
run-package-test.bat test WI,OH    # Just 2 states
```

**Single State (Most Reliable):**
```batch
run-bop-test.bat qa DE
run-package-test.bat qa DE
```

### Reducing Failures

If you experience high failure rates in parallel runs:

1. **Reduce Parallelism** - Run fewer states at once:
   ```batch
   # Instead of 5 states at once
   run-bop-test.bat qa DE,PA
   run-bop-test.bat qa WI,OH,MI
   ```

2. **Increase Server Resources** - Talk to infrastructure team about:
   - Dedicated test environment
   - Increased database connection pool
   - Better server specs for test environment

3. **Run During Off-Hours** - Schedule parallel runs when server load is low

4. **Retry Failed Tests** - The email report shows which states failed:
   ```batch
   # Re-run just the failed state
   run-bop-test.bat qa WI
   ```

## Understanding Test Reports

### Email Report Structure
- **Summary Table**: Shows Line of Business, Quote, Policy, Status per iteration
- **Excel Attachment**: Detailed milestone breakdown for each iteration
- **Batch Mode**: 1 combined email after all tests complete

### Interpreting Failures

**Timeout on State Dropdown:**
```
TimeoutError: locator.click: Timeout 60000ms exceeded
at accountCreationHelper.js:45:95
```
- **Cause**: Address validation dialog blocked the click
- **Solution**: Retry logic now handles this (3 attempts)

**"Accept As-Is" Not Found:**
```
⚠️ "Accept As-Is" not found - retrying with new client info
```
- **Cause**: Address validation returned "Use Suggested" instead
- **Solution**: Retry with different address (up to 5 attempts)

## Monitoring Parallel Runs

### Progress Tracking
The PowerShell scripts show real-time progress:
```
Still running... Elapsed: 3:45s | Active jobs: 3
Job [Package-Test-WI] finished with state: Completed (after 421s)
```

### Log Files
Each state generates its own log:
- `test-run-output-DE.txt`
- `test-run-output-PA.txt`
- `test-run-output-WI.txt`
- `test-run-output-OH.txt`
- `test-run-output-MI.txt`

Check these for detailed error information.

## Performance Expectations

| Scenario | Duration | Failure Rate |
|----------|----------|--------------|
| Single state (individual) | 5-8 min (BOP), 12-15 min (Package) | ~5% |
| 2 states parallel | 5-8 min (BOP), 12-15 min (Package) | ~10% |
| 5 states parallel | 5-8 min (BOP), 12-15 min (Package) | ~20-30% |

**Note:** Parallel runs take the same time as single runs (tests run simultaneously), but have higher failure rates due to server contention.

## Troubleshooting

### All Tests Fail Immediately
- Check if server/application is running
- Verify credentials in `.env` file
- Check network connectivity

### Random Timeouts
- Normal in parallel runs
- Retry the failed state individually
- Consider reducing parallelism

### Consistent Failures on Specific State
- May indicate state-specific data issue
- Run that state individually to debug
- Check state configuration in `stateConfig.js`

## Contact

For issues or questions about parallel test execution:
- Check test logs in `test-run-output-*.txt`
- Review Excel report for milestone details
- Contact automation team for infrastructure issues
