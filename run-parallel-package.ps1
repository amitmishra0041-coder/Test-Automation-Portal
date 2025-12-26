# PowerShell script to run Package tests in parallel for all states
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [switch]$Headed,
    [string]$Project = "chromium",
    [switch]$KillStrays
)

# Allow overriding states from parameter for quick testing
if ($States -and $States.Count -gt 0) {
    # Support comma-separated string passed as a single argument
    if ($States.Count -eq 1 -and $States[0] -match ',') {
        $states = $States[0].Split(',') | ForEach-Object { $_.Trim() }
    } else {
        $states = $States
    }
} else {
    $states = @('DE', 'PA', 'WI', 'OH', 'MI')
}
$allowed = @('DE','MI','OH','PA','WI')
# Normalize and enforce allowed state list
$states = $states | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -contains $_ }
if ($states.Count -eq 0) {
    Write-Host "⚠️ No valid states provided. Defaulting to: $($allowed -join ', ')" -ForegroundColor Yellow
    $states = $allowed
} elseif ($States -and ($states.Count -lt $States.Count)) {
    # Some provided states were filtered out
    $invalid = $States | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -notcontains $_ }
    if ($invalid.Count -gt 0) {
        Write-Host "⚠️ Filtering out unsupported states: $($invalid -join ', ')" -ForegroundColor Yellow
    }
}
$jobs = @()
$projectPath = Split-Path -Parent $PSCommandPath
$lockFilePkg = Join-Path $projectPath 'parallel-run-lock-package.json'
$iterationsBop = Join-Path $projectPath 'iterations-data-bop.json'
$iterationsPkg = Join-Path $projectPath 'iterations-data-package.json'
$testDataFile = Join-Path $projectPath 'test-data.json'
$batchMarker = Join-Path $projectPath '.batch-run-in-progress'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Package Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment: $TestEnv" -ForegroundColor Yellow
Write-Host "States: $($states -join ', ')" -ForegroundColor Yellow
Write-Host "Project: $Project | Headed: $Headed" -ForegroundColor Yellow
Write-Host "Project Path: $projectPath`n" -ForegroundColor Yellow

# Optionally stop stray Playwright runs (gentle): only Node processes running Playwright CLI
if ($KillStrays) {
    try {
        Write-Host "Checking for stray Playwright runs..." -ForegroundColor Yellow
        $playProcs = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'playwright\s+test' -or $_.CommandLine -match 'npx\s+playwright' }
        $count = 0
        foreach ($p in $playProcs) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
                $count++
            } catch {}
        }
        Write-Host "Stopped $count Playwright-related processes" -ForegroundColor Gray
    } catch {
        Write-Host "Could not query/stop stray processes: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Initialize lock and clean previous artifacts
try {
    # Clean own artifacts only; do not delete BOP files to avoid cross-suite interference
    if (Test-Path $lockFilePkg) { Remove-Item $lockFilePkg -Force -ErrorAction SilentlyContinue }
    if (Test-Path $iterationsPkg) { Remove-Item $iterationsPkg -Force -ErrorAction SilentlyContinue }
    if (Test-Path $testDataFile) { Remove-Item $testDataFile -Force -ErrorAction SilentlyContinue }

    # Create runId once for entire batch
    $runId = [DateTime]::Now.ToString('o')
    
    $lockData = [ordered]@{
        runId = $runId
        targetStates = $states
        completedStates = @()
        startTime = $runId
    }
    $lockJson = $lockData | ConvertTo-Json -Depth 3 -Compress
    # Use UTF8 without BOM to prevent JSON parsing issues in Node.js
    [System.IO.File]::WriteAllText($lockFilePkg, $lockJson, [System.Text.UTF8Encoding]$false)
    Write-Host "Initialized parallel run lock (Package suite) with runId: $runId" -ForegroundColor Green
    Write-Host "Target states: $($states -join ', ')" -ForegroundColor Green
    Write-Host ""

    if (-not (Test-Path $batchMarker)) {
        '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
        Write-Host "Batch marker created to defer per-iteration emails" -ForegroundColor Gray
    }
    
    # Small delay to ensure batch marker is fully written before jobs start
    Start-Sleep -Milliseconds 500
} catch {
    Write-Host "⚠️ Failed to initialize lock or clean artifacts: $($_.Exception.Message)" -ForegroundColor Yellow
}


# Run each state sequentially (no background jobs)
$results = @()
$startTime = [DateTime]::Now
foreach ($state in $states) {
    Write-Host "Starting Package test for state: $state" -ForegroundColor Green
    Set-Location $projectPath
    $env:TEST_STATE = $state
    $env:TEST_ENV = $TestEnv
    $env:TEST_TYPE = 'PACKAGE'
    Write-Host "[$state] Running Package test from: $(Get-Location)" -ForegroundColor Cyan
    $logPath = Join-Path $projectPath ("test-run-output-package-" + $state + ".txt")
    $headedFlag = if ($Headed.IsPresent) { "--headed" } else { "" }
    & npx playwright test Create_Package.test.js --project=$Project $headedFlag 2>&1 | Tee-Object -FilePath $logPath
    $exitCode = $LASTEXITCODE
    $results += @{ State = $state; ExitCode = $exitCode }
    if ($exitCode -eq 0) {
        Write-Host "    [$state] Package test PASSED" -ForegroundColor Green
    } else {
        Write-Host "    [$state] Package test FAILED" -ForegroundColor Red
    }
}
$now = [DateTime]::Now
$totalTime = ($now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalTime / 60)
$totalSecs = [int][Math]::Floor($totalTime % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

# Display results
$now = [DateTime]::Now
$totalTime = ($now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalTime / 60)
$totalSecs = [int][Math]::Floor($totalTime % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "PACKAGE TEST RESULTS SUMMARY" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

Write-Host "Total Execution Time: ${totalMinutes}:${totalSecondsFormatted}s" -ForegroundColor Cyan

$passed = 0
$failed = 0

foreach ($result in $results) {
    if ($result.ExitCode -eq 0) {
        Write-Host "[$($result.State)] PASSED" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[$($result.State)] FAILED" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nTotal: $($results.Count) | Passed: $passed | Failed: $failed`n" -ForegroundColor Cyan

    # Clean up lock file after all tests complete so next run starts fresh
try {
    if (Test-Path $lockFilePkg) {
        Remove-Item $lockFilePkg -Force -ErrorAction SilentlyContinue
        Write-Host "Lock file cleaned up" -ForegroundColor Gray
        Write-Host ""
    }
} catch {
    Write-Host "Could not clean lock file: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
}

# Send consolidated email report and clean batch marker
try {
    Write-Host "Sending consolidated email report..." -ForegroundColor Cyan
    Push-Location $projectPath
    & node -e "const EmailReporter = require('./emailReporter.js'); EmailReporter.sendBatchEmailReport(['iterations-data-package.json'], 'WB Package Test Report');"
    Pop-Location
    Write-Host "Consolidated email sent" -ForegroundColor Green

    if (Test-Path $batchMarker) {
        Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue
        Write-Host "Batch marker cleaned" -ForegroundColor Gray
        Write-Host ""
    }
} catch {
    Write-Host "Failed to send consolidated email: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Exit with error code if any tests failed (email handled by batch wrapper)
if ($failed -gt 0) {
    exit 1
} else {
    exit 0
}
