# PowerShell script to run BOP tests in parallel for all states
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [switch]$Headed,
    [string]$Project = "chromium"
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
} elseif ($states.Count -lt ($States.Count)) {
    # Some provided states were filtered out
    $invalid = $States | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -notcontains $_ }
    if ($invalid.Count -gt 0) {
        Write-Host "⚠️ Filtering out unsupported states: $($invalid -join ', ')" -ForegroundColor Yellow
    }
}
$jobs = @()
$projectPath = Split-Path -Parent $PSCommandPath
$lockFile = Join-Path $projectPath 'parallel-run-lock-bop.json'
$iterationsFile = Join-Path $projectPath 'iterations-data-bop.json'
$testDataFile = Join-Path $projectPath 'test-data.json'
$batchMarker = Join-Path $projectPath '.batch-run-in-progress'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "BOP Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment: $TestEnv" -ForegroundColor Yellow
Write-Host "States: $($states -join ', ')" -ForegroundColor Yellow
Write-Host "Project: $Project | Headed: $Headed" -ForegroundColor Yellow
Write-Host "Project Path: $projectPath`n" -ForegroundColor Yellow

# Initialize lock and clean previous artifacts; also create batch marker so reporter defers per-iteration emails
try {
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $iterationsFile) { Remove-Item $iterationsFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $testDataFile) { Remove-Item $testDataFile -Force -ErrorAction SilentlyContinue }

    $runId = [DateTime]::Now.ToString('o')
    $lockData = [ordered]@{
        runId = $runId
        targetStates = $states
        completedStates = @()
        startTime = $runId
    }
    $lockJson = $lockData | ConvertTo-Json -Depth 3 -Compress
    # Use UTF8 without BOM to prevent JSON parsing issues in Node.js
    [System.IO.File]::WriteAllText($lockFile, $lockJson, [System.Text.UTF8Encoding]$false)
    Write-Host "Initialized parallel run lock (BOP suite) with runId: $runId" -ForegroundColor Green
    Write-Host "Target states: $($states -join ', ')" -ForegroundColor Green

    if (-not (Test-Path $batchMarker)) {
        '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
        Write-Host "Batch marker created to defer per-iteration emails" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️ Failed to initialize lock or clean artifacts: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Start a job for each state
foreach ($state in $states) {
    Write-Host "Starting test for state: $state" -ForegroundColor Green
    
    $jobs += Start-Job -Name "Test-$state" -ScriptBlock {
        param($s, $e, $projPath, $proj, $isHeaded)
        
        # Change to project directory in this job's context
        Set-Location $projPath
        
        $env:TEST_STATE = $s
        $env:TEST_ENV = $e
        $env:TEST_TYPE = 'BOP'
        
        Write-Host "[$s] Running test from: $(Get-Location)" -ForegroundColor Cyan
        
        # Run the test and tee output to per-state log
        $logPath = Join-Path $projPath ("test-run-output-" + $s + ".txt")
        $headedFlag = if ($isHeaded) { "--headed" } else { "" }
        & npx playwright test Create_BOP.test.js --project=$proj $headedFlag 2>&1 | Tee-Object -FilePath $logPath
        
        return @{
            State = $s
            ExitCode = $LASTEXITCODE
        }
    } -ArgumentList $state, $TestEnv, $projectPath, $Project, $Headed.IsPresent
}

Write-Host "`nAll $($states.Count) tests started in parallel. Showing real-time output below...`n" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "Progress Monitor:" -ForegroundColor Cyan
Write-Host "   - Tests will run in background PowerShell jobs" -ForegroundColor Gray
Write-Host "   - Completion status will update every 30 seconds" -ForegroundColor Gray
Write-Host "   - Each test takes ~5-8 minutes" -ForegroundColor Gray
Write-Host "   - Total expected time: 5-8 minutes (running in parallel)" -ForegroundColor Gray
Write-Host "============================================================`n" -ForegroundColor Yellow

# Stream output from all jobs as they complete
$completedJobs = @()
$allComplete = $false
$startTime = [DateTime]::Now
$checkCount = 0
$results = @()

while (-not $allComplete) {
    $checkCount++
    $now = [DateTime]::Now
    $elapsedSeconds = ($now - $startTime).TotalSeconds
    
    # Show progress every 30 seconds
    if ($checkCount % 15 -eq 0) {
        $activeJobs = $jobs | Where-Object { $_.State -eq 'Running' }
        $minutes = [int][Math]::Floor($elapsedSeconds / 60)
        $secs = [int][Math]::Floor($elapsedSeconds % 60)
        $secondsFormatted = $secs.ToString("00")
        Write-Host "Still running... Elapsed: ${minutes}:${secondsFormatted}s | Active jobs: $($activeJobs.Count)" -ForegroundColor Yellow
    }
    
    foreach ($job in $jobs) {
        if ($job -notin $completedJobs) {
            if ($job.State -eq 'Completed' -or $job.State -eq 'Failed') {
                $now = [DateTime]::Now
                $elapsedForJob = ($now - $startTime).TotalSeconds
                Write-Host "`nJob [$($job.Name)] finished with state: $($job.State) (after $([Math]::Round($elapsedForJob))s)" -ForegroundColor Yellow
                
                $jobOutput = Receive-Job -Job $job -ErrorAction SilentlyContinue
                
                # Extract only the hashtable result (State and ExitCode), ignore verbose output
                $result = $jobOutput | Where-Object { $_ -is [hashtable] -and $_.State -and $null -ne $_.ExitCode } | Select-Object -First 1
                
                if ($result) {
                    Write-Host "    [$($result.State)] Test completed" -ForegroundColor Cyan
                    $results += $result
                }
                
                $completedJobs += $job
            }
        }
    }
    
    if ($completedJobs.Count -eq $jobs.Count) {
        $allComplete = $true
    } else {
        Start-Sleep -Seconds 2
    }
}

$jobs | Remove-Job

# Display results
$now = [DateTime]::Now
$totalTime = ($now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalTime / 60)
$totalSecs = [int][Math]::Floor($totalTime % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TEST RESULTS SUMMARY" -ForegroundColor Yellow
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
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
        Write-Host "🗑️ Lock file cleaned up`n" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️ Could not clean lock file: $($_.Exception.Message)`n" -ForegroundColor Yellow
}

# Send consolidated email report and clean batch marker
try {
    Write-Host "Sending consolidated email report..." -ForegroundColor Cyan
    Push-Location $projectPath
    & node -e "const EmailReporter = require('./emailReporter.js'); EmailReporter.sendBatchEmailReport(['iterations-data-bop.json'], 'WB BOP Test Report');"
    Pop-Location
    Write-Host "Consolidated email sent" -ForegroundColor Green

    if (Test-Path $batchMarker) {
        Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue
        Write-Host "Batch marker cleaned" -ForegroundColor Gray
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
