# PowerShell script to run CA tests in parallel for all states
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [string]$Project = "chromium",
    [switch]$KillStrays
)

# CA states
if ($States -and $States.Count -gt 0) {
    if ($States.Count -eq 1 -and $States[0] -match ',') {
        $states = $States[0].Split(',') | ForEach-Object { $_.Trim() }
    } else {
        $states = $States
    }
} else {
    $states = @('DE', 'PA', 'MI', 'WI')
}
$allowed = @('DE', 'PA', 'MI', 'WI')

# Normalize and enforce allowed state list
$states = $states | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -contains $_ }
if ($states.Count -eq 0) {
    Write-Host "No valid states provided. Defaulting to: $($allowed -join ', ')" -ForegroundColor Yellow
    $states = $allowed
}

# Resolve project path â€” works whether run as .ps1 file or pasted into terminal
$projectPath = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $PWD.Path }

$lockFile        = Join-Path $projectPath 'parallel-run-lock-ca.json'
$iterationsFile  = Join-Path $projectPath 'iterations-data-ca.json'
$testDataFile    = Join-Path $projectPath 'test-data.json'
$batchMarker     = Join-Path $projectPath '.batch-run-in-progress-ca'
$testFile        = Join-Path $projectPath 'Create_CA_FinalCopy.test.js'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CA Test Runner - Parallel Execution"      -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment  : $TestEnv"                          -ForegroundColor Yellow
Write-Host "States       : $($states -join ', ')"             -ForegroundColor Yellow
Write-Host "Project      : $Project | Headed: YES (Always)"   -ForegroundColor Yellow
Write-Host "Max Parallel : 3 Workers"                         -ForegroundColor Yellow
Write-Host "Project Path : $projectPath"                      -ForegroundColor Yellow
Write-Host "Test File    : $testFile"                         -ForegroundColor Yellow
Write-Host "Test File Exists: $(Test-Path $testFile)`n"       -ForegroundColor Yellow

# Abort early if the test file is missing
if (-not (Test-Path $testFile)) {
    Write-Host "ERROR: Test file not found at $testFile" -ForegroundColor Red
    Write-Host "Make sure you are running this script from the correct directory," -ForegroundColor Red
    Write-Host "or that Create_CA_FinalCopy.test.js exists in: $projectPath"      -ForegroundColor Red
    exit 1
}

# Initialize lock and clean previous artifacts
try {
    if (Test-Path $lockFile)       { Remove-Item $lockFile       -Force -ErrorAction SilentlyContinue }
    if (Test-Path $iterationsFile) { Remove-Item $iterationsFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $testDataFile)   { Remove-Item $testDataFile   -Force -ErrorAction SilentlyContinue }

    $batchEmailSentFile = Join-Path $projectPath '.batch-email-sent-ca'
    if (Test-Path $batchEmailSentFile) { Remove-Item $batchEmailSentFile -Force -ErrorAction SilentlyContinue }

    $runId    = [DateTime]::Now.ToString('o')
    $lockData = [ordered]@{
        runId           = $runId
        targetStates    = $states
        completedStates = @()
        startTime       = $runId
    }
    $lockJson = $lockData | ConvertTo-Json -Depth 3 -Compress
    [System.IO.File]::WriteAllText($lockFile, $lockJson, [System.Text.UTF8Encoding]$false)
    Write-Host "Initialized parallel run lock with runId: $runId" -ForegroundColor Green
    Write-Host "Target states: $($states -join ', ')"             -ForegroundColor Green

    if (-not (Test-Path $batchMarker)) {
        '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
        Write-Host "Batch marker created to defer per-iteration emails" -ForegroundColor Gray
    }

    Start-Sleep -Milliseconds 500
} catch {
    Write-Host "Failed to initialize lock: $($_.Exception.Message)" -ForegroundColor Yellow
}

# â”€â”€ Parallel execution loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$results       = @()
$startTime     = [DateTime]::Now
$maxParallel   = 3
$pendingStates = $states.Clone()
$activeProcs   = @()
$lastStartTime = $null
$stateLogs     = @{}

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {

    # â”€â”€ Collect finished processes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    $stillRunning = @()
    foreach ($procInfo in $activeProcs) {
        if (!$procInfo.proc.HasExited) {
            $stillRunning += $procInfo
        } else {
            $endTime   = Get-Date
            $exitCode  = $procInfo.proc.ExitCode
            $duration  = if ($procInfo.startTime) { ($endTime - $procInfo.startTime).TotalSeconds } else { $null }
            $state     = $procInfo.state
            $logBuffer = if ($stateLogs[$state]) { $stateLogs[$state] } else { @() }

            $logBuffer += "    [$state] CA test completed (ExitCode: $exitCode, Duration: $([math]::Round($duration, 2)) s)"

            if ($exitCode -ne 0) {
                if ($procInfo.stderrLog -and (Test-Path $procInfo.stderrLog)) {
                    $stderrTail = Get-Content $procInfo.stderrLog -Tail 20 -ErrorAction SilentlyContinue
                    foreach ($line in $stderrTail) {
                        if (-not [string]::IsNullOrWhiteSpace($line)) { $logBuffer += "    [$state][stderr] $line" }
                    }
                }
                if ($procInfo.stdoutLog -and (Test-Path $procInfo.stdoutLog)) {
                    $stdoutTail = Get-Content $procInfo.stdoutLog -Tail 20 -ErrorAction SilentlyContinue
                    foreach ($line in $stdoutTail) {
                        if (-not [string]::IsNullOrWhiteSpace($line)) { $logBuffer += "    [$state][stdout] $line" }
                    }
                }
            }

            Write-Host ""
            foreach ($line in $logBuffer) { Write-Host $line }
            $stateLogs.Remove($state)

            $results += [PSCustomObject]@{ State = $state; ExitCode = $exitCode; Duration = $duration }
        }
    }
    $activeProcs = $stillRunning

    # â”€â”€ Start next state if slot available and timing allows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    $canStart    = $activeProcs.Count -lt $maxParallel -and $pendingStates.Count -gt 0
    $isFirstRun  = $null -eq $lastStartTime
    $enoughTimeElapsed = $isFirstRun -or ([int]([DateTime]::Now - $lastStartTime).TotalSeconds -ge 30)

    if ($canStart -and $enoughTimeElapsed) {
        $state = $pendingStates[0]
        if ($pendingStates.Count -eq 1) {
            $pendingStates = @()
        } else {
            $pendingStates = $pendingStates[1..($pendingStates.Count - 1)]
        }

        $iterationStart  = Get-Date
        $parallelAtStart = $activeProcs.Count + 1
        $logBuffer       = @("Starting CA test for state: $state at $iterationStart (Parallel jobs: $parallelAtStart)")
        $stateLogs[$state] = $logBuffer

        $outDir     = "test-results\ca-$state"
        $outDirFull = Join-Path $projectPath $outDir
        if (-not (Test-Path $outDirFull)) { New-Item -ItemType Directory -Path $outDirFull -Force | Out-Null }

        $stdoutLog = Join-Path $outDirFull 'stdout.log'
        $stderrLog = Join-Path $outDirFull 'stderr.log'

        # Use full absolute path to test file to avoid working-directory ambiguity
        $envCmd = 'set "TEST_STATE=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && set "TEST_TYPE=CA" && npx playwright test "' + $testFile + '" --project=' + $Project + ' --workers=1 --headed --output="' + $outDirFull + '"'

        Write-Host "Launching [$state]: $envCmd" -ForegroundColor DarkGray

        $proc = Start-Process -FilePath "cmd.exe" `
            -ArgumentList @('/c', $envCmd) `
            -WorkingDirectory $projectPath `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError  $stderrLog `
            -PassThru

        $activeProcs  += [PSCustomObject]@{
            proc           = $proc
            state          = $state
            startTime      = $iterationStart
            parallelAtStart = $parallelAtStart
            stdoutLog      = $stdoutLog
            stderrLog      = $stderrLog
        }
        $lastStartTime = $iterationStart
    }

    Start-Sleep -Seconds 1
}

# â”€â”€ Results summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$now                  = [DateTime]::Now
$totalTime            = ($now - $startTime).TotalSeconds
$totalMinutes         = [int][Math]::Floor($totalTime / 60)
$totalSecs            = [int][Math]::Floor($totalTime % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "CA TEST RESULTS SUMMARY"                   -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow
Write-Host "Total Execution Time: ${totalMinutes}m ${totalSecondsFormatted}s" -ForegroundColor Cyan

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

# â”€â”€ Clean up lock file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
try {
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
        Write-Host "Lock file cleaned up" -ForegroundColor Gray
    }
} catch {
    Write-Host "Could not clean lock file: $($_.Exception.Message)" -ForegroundColor Yellow
}

# â”€â”€ Send consolidated email report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
try {
    $batchEmailSent = Join-Path $projectPath '.batch-email-sent-ca'
    if (Test-Path $batchEmailSent) {
        Write-Host "Batch email already sent; skipping" -ForegroundColor Gray
    } else {
        Write-Host "Sending consolidated email report..." -ForegroundColor Cyan

        $emailResults = @()
        foreach ($state in $states) {
            $stateDataFile = Join-Path $projectPath "test-data-$state.json"
            if (Test-Path $stateDataFile) {
                $testData       = Get-Content $stateDataFile -Raw | ConvertFrom-Json
                $resultForState = $results | Where-Object { $_.State -eq $state } | Select-Object -First 1
                $emailResults  += [PSCustomObject]@{
                    State               = $state
                    StateName           = $testData.stateName
                    Status              = if ($resultForState -and $resultForState.ExitCode -eq 0) { "PASSED" } else { "FAILED" }
                    Duration            = if ($resultForState) { [math]::Round($resultForState.Duration, 2) } else { 0 }
                    QuoteNumber         = $testData.quoteNumber
                    PolicyNumber        = $testData.policyNumber
                    Milestones          = $testData.milestones
                    coverageChanges     = $testData.coverageChanges
                    coverageSectionStats = $testData.coverageSectionStats
                    addCoverageTimings  = $testData.addCoverageTimings
                }
            }
        }

        $emailTempPath = Join-Path $projectPath 'ca-email-temp.json'
        $emailPayload  = @{
            results   = $emailResults
            env       = $TestEnv
            totalTime = "${totalMinutes}:${totalSecondsFormatted}"
            timestamp = (Get-Date -Format 'o')
            passed    = $passed
            failed    = $failed
        }
        [System.IO.File]::WriteAllText($emailTempPath, ($emailPayload | ConvertTo-Json -Depth 20))
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

# â”€â”€ Exit code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ($failed -gt 0) {
    exit 1
} else {
    try {
        Write-Host "Cleaning up transient files..." -ForegroundColor Gray
        Remove-Item -Force (Join-Path $projectPath 'iterations-data-ca.json')  -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'test-data-*.json')          -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'WB_CA_Test_Report_*.xlsx') -ErrorAction SilentlyContinue
        Write-Host "Transient cleanup done" -ForegroundColor Gray
    } catch {
        Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    exit 0
}
