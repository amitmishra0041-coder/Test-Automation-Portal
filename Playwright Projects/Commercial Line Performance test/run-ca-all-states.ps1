param(
    [string]$TestEnv = "qa",
    [string]$Project = "chromium"
)

$states = @("DE", "PA", "MI", "WI")
$activeProcesses = @()

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CA Test Runner - VISIBLE Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 1. Start a visible process for each state
foreach ($state in $states) {
    Write-Host "Launching visible test for $state..." -ForegroundColor Gray
    
    # We string together the environment variables and the playwright command
    $cmdString = "set `"TEST_STATE=$state`" && set `"TEST_ENV=$TestEnv`" && set `"TEST_TYPE=CA`" && npx playwright test .\Create_CA_FinalCopy.test.js --project=$Project --headed"
    
    # Start-Process opens a real window on your desktop. -PassThru lets us track it.
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmdString -WindowStyle Normal -PassThru
    
    # Save the process so we can check it later
    $activeProcesses += [PSCustomObject]@{ State = $state; Process = $proc }
}

Write-Host "`nAll browsers launched! Waiting for you to monitor and for tests to finish...`n" -ForegroundColor Yellow

# 2. Wait for all the visible command windows to close
$activeProcesses.Process | Wait-Process

# 3. Print Final Summary to the Console
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "CA TEST RESULTS SUMMARY" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

$passedCount = 0
$failedCount = 0
$results = @()

# 4. Check the exit codes to see what passed/failed
foreach ($item in $activeProcesses) {
    if ($item.Process.ExitCode -eq 0) {
        Write-Host "[$($item.State)] PASSED" -ForegroundColor Green
        $results += [PSCustomObject]@{ State = $item.State; Status = "PASSED" }
        $passedCount++
    } else {
        Write-Host "[$($item.State)] FAILED" -ForegroundColor Red
        $results += [PSCustomObject]@{ State = $item.State; Status = "FAILED" }
        $failedCount++
    }
}

Write-Host "`nTotal: $($states.Count) | Passed: $passedCount | Failed: $failedCount`n" -ForegroundColor Cyan

# 5. Prepare and Send Email Report
Write-Host "=== PREPARING EMAIL REPORT ===" -ForegroundColor Cyan
$emailResults = @()

foreach ($res in $results) {
    $state = $res.State
    $dataFile = "test-data-$state.json"
    
    # Read the data Playwright saved (or create a blank object if it crashed)
    if (Test-Path $dataFile) { 
        $testData = Get-Content $dataFile -Raw | ConvertFrom-Json 
    } else { 
        $testData = [PSCustomObject]@{ quoteNumber = "N/A"; policyNumber = "N/A" } 
    }

    $emailResults += [PSCustomObject]@{
        State        = $state
        Status       = $res.Status
        QuoteNumber  = $testData.quoteNumber
        PolicyNumber = $testData.policyNumber
        Milestones   = $testData.milestones
    }
}

$emailPayload = @{
    env       = $TestEnv
    timestamp = (Get-Date).ToString('MM/dd/yyyy HH:mm')
    passed    = $passedCount
    failed    = $failedCount
    results   = $emailResults
}

$emailPayload | ConvertTo-Json -Depth 10 | Out-File "ca-email-temp.json" -Encoding UTF8

Write-Host "Sending consolidated email via Node.js..." -ForegroundColor Yellow
node send-ca-email-optimized.js

# 6. Clean up temp files
Remove-Item "test-data-*.json" -ErrorAction SilentlyContinue
Remove-Item "ca-email-temp.json" -ErrorAction SilentlyContinue

Write-Host "Done!" -ForegroundColor Green

if ($failedCount -gt 0) { exit 1 } else { exit 0 }