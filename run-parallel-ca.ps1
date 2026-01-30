# PowerShell script to run CA tests in parallel for all states
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [string]$Project = "chromium",
    [switch]$KillStrays
)

# CA states from stateConfig.js TARGET_STATES
if ($States -and $States.Count -gt 0) {
    if ($States.Count -eq 1 -and $States[0] -match ',') {
        $states = $States[0].Split(',') | ForEach-Object { $_.Trim() }
    } else {
        $states = $States
    }
} else {
    $states = @('CO', 'DE', 'PA', 'WI', 'OH', 'MI', 'AZ', 'IL', 'IA', 'NC', 'SC', 'NE', 'NM', 'SD', 'TX', 'UT', 'IN', 'TN', 'VA')
}
$allowed = @('CO', 'DE', 'PA', 'WI', 'OH', 'MI', 'AZ', 'IL', 'IA', 'NC', 'SC', 'NE', 'NM', 'SD', 'TX', 'UT', 'IN', 'TN', 'VA')

# Normalize and enforce allowed state list
$states = $states | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -contains $_ }
if ($states.Count -eq 0) {
    Write-Host "No valid states provided. Defaulting to: $($allowed -join ', ')" -ForegroundColor Yellow
    $states = $allowed
}

$projectPath = Split-Path -Parent $PSCommandPath
$lockFile = Join-Path $projectPath 'parallel-run-lock-ca.json'
$iterationsFile = Join-Path $projectPath 'iterations-data-ca.json'
$testDataFile = Join-Path $projectPath 'test-data.json'
$batchMarker = Join-Path $projectPath '.batch-run-in-progress-ca'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CA Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment: $TestEnv" -ForegroundColor Yellow
Write-Host "States: $($states -join ', ')" -ForegroundColor Yellow
Write-Host "Project: $Project | Headed: YES (Always)" -ForegroundColor Yellow
Write-Host "Max Parallel: 3 Workers" -ForegroundColor Yellow
Write-Host "Project Path: $projectPath`n" -ForegroundColor Yellow

# Initialize lock and clean previous artifacts
try {
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $iterationsFile) { Remove-Item $iterationsFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $testDataFile) { Remove-Item $testDataFile -Force -ErrorAction SilentlyContinue }
    $batchEmailSentFile = Join-Path $projectPath '.batch-email-sent-ca'
    if (Test-Path $batchEmailSentFile) { Remove-Item $batchEmailSentFile -Force -ErrorAction SilentlyContinue }

    $runId = [DateTime]::Now.ToString('o')
    $lockData = [ordered]@{
        runId = $runId
        targetStates = $states
        completedStates = @()
        startTime = $runId
    }
    $lockJson = $lockData | ConvertTo-Json -Depth 3 -Compress
    [System.IO.File]::WriteAllText($lockFile, $lockJson, [System.Text.UTF8Encoding]$false)
    Write-Host "Initialized parallel run lock (CA suite) with runId: $runId" -ForegroundColor Green
    Write-Host "Target states: $($states -join ', ')" -ForegroundColor Green

    if (-not (Test-Path $batchMarker)) {
        '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
        Write-Host "Batch marker created to defer per-iteration emails" -ForegroundColor Gray
    }

    Start-Sleep -Milliseconds 500
} catch {
    Write-Host "Failed to initialize lock: $($_.Exception.Message)" -ForegroundColor Yellow
}

# True parallelism with 3 workers
$results = @()
$startTime = [DateTime]::Now
$maxParallel = 3
$pendingStates = $states.Clone()
$activeProcs = @()
$lastStartTime = $null
$stateLogs = @{}

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {
    # Remove finished processes
    $stillRunning = @()
    foreach ($procInfo in $activeProcs) {
        if (!$procInfo.proc.HasExited) {
            $stillRunning += $procInfo
        } else {
            $endTime = Get-Date
            $exitCode = $procInfo.proc.ExitCode
            $duration = $null
            if ($procInfo.startTime) {
                $duration = ($endTime - $procInfo.startTime).TotalSeconds
            }
            $state = $procInfo.state
            $logBuffer = $stateLogs[$state]
            if (-not $logBuffer) { $logBuffer = @() }
            $logBuffer += "    [$state] CA test completed (ExitCode: $exitCode, Duration: $([math]::Round($duration, 2)) s)"
            Write-Host ""
            foreach ($line in $logBuffer) { Write-Host $line }
            $stateLogs.Remove($state)

            $results += @{ State = $state; ExitCode = $exitCode; Duration = $duration }
        }
    }
    $activeProcs = $stillRunning

    $canStart = $activeProcs.Count -lt $maxParallel -and $pendingStates.Count -gt 0
    $enoughTimeElapsed = $true
    if ($lastStartTime) {
        $elapsed = [int]([DateTime]::Now - $lastStartTime).TotalSeconds
        if ($elapsed -lt 30) { $enoughTimeElapsed = $false }
    }
    if ($canStart -and $enoughTimeElapsed) {
        $state = $pendingStates[0]
        if ($pendingStates.Count -eq 1) {
            $pendingStates = @()
        } else {
            $pendingStates = $pendingStates[1..($pendingStates.Count-1)]
        }
        $iterationStart = Get-Date
        $parallelAtStart = $activeProcs.Count + 1
        $logBuffer = @()
        $logBuffer += "Starting CA test for state: $state at $iterationStart (Parallel jobs: $parallelAtStart)"
        $stateLogs[$state] = $logBuffer

        $outDir = "test-results\ca-$state"
        $windowStyle = "Hidden"
        $envCmd = 'set "TEST_STATE=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && set "TEST_TYPE=CA" && npx playwright test Create_CA.test.js --project=' + $Project + ' --workers=1 --headed --output="' + $outDir + '"'
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @('/c', $envCmd) -WorkingDirectory $projectPath -WindowStyle $windowStyle -PassThru
        $activeProcs += @{ proc = $proc; state = $state; startTime = $iterationStart; parallelAtStart = $parallelAtStart }
        $lastStartTime = $iterationStart
    }
    Start-Sleep -Seconds 1
}

# Display results
$now = [DateTime]::Now
$totalTime = ($now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalTime / 60)
$totalSecs = [int][Math]::Floor($totalTime % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "CA TEST RESULTS SUMMARY" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

Write-Host "Total Execution Time: ${totalMinutes}:${totalSecondsFormatted}s" -ForegroundColor Cyan

$passed = 0
$failed = 0

foreach ($result in $results) {
    if ($result.ExitCode -eq 0) {
        Write-Host "[$($result.State)] PASSED (Duration: $([math]::Round($result.Duration, 2))s)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[$($result.State)] FAILED (Duration: $([math]::Round($result.Duration, 2))s)" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nTotal: $($results.Count) | Passed: $passed | Failed: $failed`n" -ForegroundColor Cyan

# Clean up lock file
try {
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
        Write-Host "Lock file cleaned up" -ForegroundColor Gray
    }
} catch {
    Write-Host "Could not clean lock file: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Send consolidated email report
try {
    $batchEmailSent = Join-Path $projectPath '.batch-email-sent-ca'
    if (Test-Path $batchEmailSent) {
        Write-Host "Batch email already sent; skipping" -ForegroundColor Gray
    } else {
        Write-Host "Sending consolidated email report..." -ForegroundColor Cyan
        
        $emailResults = @()
        foreach ($state in $states) {
            $testDataFile = Join-Path $projectPath "test-data-$state.json"
            if (Test-Path $testDataFile) {
                $testData = Get-Content $testDataFile -Raw | ConvertFrom-Json
                $resultForState = $results | Where-Object { $_.State -eq $state } | Select-Object -First 1
                $emailResults += @{
                    State = $state
                    StateName = $testData.stateName
                    Status = if ($resultForState -and $resultForState.ExitCode -eq 0) { "PASSED" } else { "FAILED" }
                    Duration = if ($resultForState) { [math]::Round($resultForState.Duration, 2) } else { 0 }
                    QuoteNumber = $testData.quoteNumber
                    PolicyNumber = $testData.policyNumber
                    Milestones = $testData.milestones
                    coverageChanges = $testData.coverageChanges
                    coverageSectionStats = $testData.coverageSectionStats
                    addCoverageTimings = $testData.addCoverageTimings
                }
            }
        }
        
        $emailTempPath = Join-Path $projectPath 'ca-email-temp.json'
        $emailPayload = @{
            results = $emailResults
            env = $TestEnv
            totalTime = "${totalMinutes}:${totalSecondsFormatted}"
            timestamp = (Get-Date -Format 'o')
            passed = $passed
            failed = $failed
        }
        $jsonString = $emailPayload | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($emailTempPath, $jsonString)

        Write-Host "Email data prepared: $emailTempPath" -ForegroundColor Gray

        $sendEmailScript = Join-Path $projectPath 'send-ca-email-optimized.js'
        if (Test-Path $sendEmailScript) {
            & node $sendEmailScript
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Email report sent successfully" -ForegroundColor Green
            } else {
                Write-Host "Email script exited with code $LASTEXITCODE" -ForegroundColor Yellow
            }
            Remove-Item $emailTempPath -Force -ErrorAction SilentlyContinue
        } else {
            Write-Host "send-ca-email-optimized.js not found at $sendEmailScript" -ForegroundColor Yellow
        }

        'sent' | Out-File -FilePath $batchEmailSent -Force -Encoding ASCII
        Write-Host "Consolidated email sent" -ForegroundColor Green
    }

    if (Test-Path $batchMarker) {
        Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue
        Write-Host "Batch marker cleaned" -ForegroundColor Gray
    }
} catch {
    Write-Host "Failed to send consolidated email: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Exit with error code if any tests failed
if ($failed -gt 0) {
    exit 1
} else {
    try {
        Write-Host "Cleaning up transient files..." -ForegroundColor Gray
        Remove-Item -Force (Join-Path $projectPath 'iterations-data-ca.json') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'test-data-*.json') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'WB_CA_Test_Report_*.xlsx') -ErrorAction SilentlyContinue
        Write-Host "Transient cleanup done" -ForegroundColor Gray
    } catch {
        Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    exit 0
}
