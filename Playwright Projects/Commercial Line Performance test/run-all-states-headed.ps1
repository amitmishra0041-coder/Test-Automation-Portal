# Run Create_CA_FinalCopy.test.js in headed mode for all U.S. states
$states = @('DE', 'PA', 'MI', 'WI')

$projectPath = Get-Location
$totalStates = $states.Count
$passedCount = 0
$failedCount = 0
$failedStates = @()

Write-Host "[INFO] Starting Create_CA_FinalCopy.test.js run for all $totalStates states in headed mode..." -ForegroundColor Cyan
Write-Host "Project Path: $projectPath" -ForegroundColor Gray
Write-Host ""

$startTime = Get-Date

foreach ($state in $states) {
    $stateIndex = $states.IndexOf($state) + 1
    Write-Host "[$stateIndex/$totalStates] Running test for state: $state" -ForegroundColor Yellow
    
    try {
        # Set environment variable for state
        $env:TEST_STATE = $state
        $env:TEST_TYPE = 'CA'
        
        # Run Playwright test in headed mode for this state
        $testStartTime = Get-Date
        & npx playwright test .\Create_CA_FinalCopy.test.js --project=chromium --headed 2>&1
        $testExitCode = $LASTEXITCODE
        $testDuration = ((Get-Date) - $testStartTime).TotalSeconds
        
        if ($testExitCode -eq 0) {
            Write-Host "[PASS] $state PASSED (${testDuration}s)" -ForegroundColor Green
            $passedCount++
        } else {
                Write-Host "[FAIL] $state FAILED (${testDuration}s)" -ForegroundColor Red
            $failedCount++
            $failedStates += $state
        }
    } catch {
            Write-Host "[ERROR] $state ERROR: $_" -ForegroundColor Red
        $failedCount++
        $failedStates += $state
    }
    
    Write-Host ""
}

$totalDuration = ((Get-Date) - $startTime).TotalSeconds

# Print summary
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "[SUMMARY] TEST SUMMARY" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Total States: $totalStates" -ForegroundColor Gray
Write-Host "[SUMMARY] Passed: $passedCount" -ForegroundColor Green
Write-Host "[SUMMARY] Failed: $failedCount" -ForegroundColor Red
Write-Host "Total Duration: ${totalDuration}s (~$([math]::Round($totalDuration / 60, 2)) minutes)" -ForegroundColor Gray

if ($failedStates.Count -gt 0) {
    Write-Host ""
    Write-Host "[SUMMARY] Failed States:" -ForegroundColor Red
    $failedStates | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

Write-Host ""
Write-Host "[INFO] Test data saved to test-data-*.json files" -ForegroundColor Gray
Write-Host "[INFO] Email reports sent via emailReporter.js" -ForegroundColor Gray
Write-Host ""

# Exit with failure code if any tests failed
exit $failedCount
