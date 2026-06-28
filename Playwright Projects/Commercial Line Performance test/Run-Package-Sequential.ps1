# Run Create_Package.test.js tests in parallel (max 3 workers, 30s stagger, always headed)
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [switch]$NoEmail,
    [Nullable[bool]]$SendEmail = $null
)

$emailEnabled = if ($null -ne $SendEmail) { [bool]$SendEmail } else { -not $NoEmail }

$ErrorActionPreference = "Continue"
$workingDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PWD.Path }

# Verify test file exists
$testFile = Join-Path $workingDir "Create_Package.test.js"
if (-not (Test-Path $testFile)) {
    Write-Host "ERROR: Test file not found: $testFile" -ForegroundColor Red
    exit 1
}

# Resolve states and FORCE uniqueness to prevent double-runs
$allowed = @('DE', 'PA', 'MI', 'WI')
if ($States -and $States.Count -gt 0) {
    if ($States.Count -eq 1 -and $States[0] -match ',') {
        $states = $States[0].Split(',') | ForEach-Object { $_.Trim().ToUpper() }
    } else {
        $states = $States | ForEach-Object { $_.ToUpper() }
    }
    $states = $states | Where-Object { $allowed -contains $_ } | Select-Object -Unique
} else {
    $states = $allowed | Select-Object -Unique
}

if ($states.Count -eq 0) {
    Write-Host "No valid states. Using all: $($allowed -join ', ')" -ForegroundColor Yellow
    $states = $allowed
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Package Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "Environment  : $TestEnv"                  -ForegroundColor Yellow
Write-Host "States       : $($states -join ', ')"     -ForegroundColor Yellow
Write-Host "Headed       : YES (browser only)"        -ForegroundColor Yellow
Write-Host "Max Parallel : 2 workers, 60s stagger"    -ForegroundColor Yellow
Write-Host "Working Dir  : $workingDir"               -ForegroundColor Yellow
Write-Host "Test File    : $testFile`n"               -ForegroundColor Yellow

# Clean up previous run artifacts
$lockFile = Join-Path $workingDir 'parallel-run-lock-package.json'
$iterationsFile = Join-Path $workingDir 'iterations-data-package.json'
$batchMarker = Join-Path $workingDir '.batch-run-in-progress'
$batchEmailSent = Join-Path $workingDir '.batch-email-sent'

foreach ($f in @($lockFile, $iterationsFile, $batchEmailSent)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

$runId = [DateTime]::Now.ToString('o')
$lockData = [ordered]@{ runId = $runId; targetStates = $states; completedStates = @(); startTime = $runId }
[System.IO.File]::WriteAllText($lockFile, ($lockData | ConvertTo-Json -Depth 3 -Compress))
Write-Host "Run ID: $runId" -ForegroundColor Green

if (-not (Test-Path $batchMarker)) {
    '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
}

# Parallel loop
$results = @()
$startTime = [DateTime]::Now
$maxParallel = 2
$staggerSeconds = 30 # Real stagger time
$pendingStates = [System.Collections.Generic.List[string]]::new($states)
$activeProcs = @()
$lastStartTime = $null

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {

    # Collect finished processes
    $stillRunning = @()
    foreach ($procInfo in $activeProcs) {
        if (-not $procInfo.proc.HasExited) {
            $stillRunning += $procInfo
        } else {
            $procInfo.proc.Refresh()
            $exitCode = $procInfo.proc.ExitCode
            if ($null -eq $exitCode -or [string]::IsNullOrWhiteSpace([string]$exitCode)) {
                if ($procInfo.exitCodeFile -and (Test-Path $procInfo.exitCodeFile)) {
                    $rawExitCode = (Get-Content $procInfo.exitCodeFile -First 1 -ErrorAction SilentlyContinue).Trim()
                    if ($rawExitCode -match '^-?\d+$') {
                        $exitCode = [int]$rawExitCode
                    }
                }
            }
            if ($null -eq $exitCode -or [string]::IsNullOrWhiteSpace([string]$exitCode)) {
                $exitCode = 1
            }
            $duration = if ($procInfo.startTime) { ([DateTime]::Now - $procInfo.startTime).TotalSeconds } else { 0 }
            $state = $procInfo.state

            if ($exitCode -eq 0) {
                $stateDataFile = Join-Path $workingDir ("test-data-" + $state + ".json")
                if (Test-Path $stateDataFile) {
                    try {
                        $stateData = Get-Content $stateDataFile -Raw | ConvertFrom-Json
                        $hasFailedMilestones = $stateData.milestones -and ($stateData.milestones | Where-Object { ($_.status + '') -eq 'FAILED' } | Measure-Object).Count -gt 0
                        if ($hasFailedMilestones) {
                            $exitCode = 1
                        }
                    } catch {
                    }
                }
            }

            $log = @("    [$state] Completed - ExitCode: $exitCode, Duration: $([math]::Round($duration,2))s")
            if ($exitCode -ne 0) {
                foreach ($logFile in @($procInfo.stderrLog, $procInfo.stdoutLog)) {
                    if ($logFile -and (Test-Path $logFile)) {
                        $tail = Get-Content $logFile -Tail 20 -ErrorAction SilentlyContinue
                        foreach ($line in $tail) {
                            if (-not [string]::IsNullOrWhiteSpace($line)) {
                                $label = if ($logFile -match 'stderr') { 'stderr' } else { 'stdout' }
                                $log += "    [$state][$label] $line"
                            }
                        }
                    }
                }
            }

            Write-Host ""
            foreach ($line in $log) { Write-Host $line }
            $results += [PSCustomObject]@{ State = $state; ExitCode = $exitCode; Duration = $duration }
        }
    }
    $activeProcs = $stillRunning

    # Start next state if slot available and timing allows
    $canStart = $activeProcs.Count -lt $maxParallel -and $pendingStates.Count -gt 0
    
    # Calculate if enough time has passed since the last browser launch
    $enoughTimeElapsed = ($null -eq $lastStartTime) -or (([DateTime]::Now - $lastStartTime).TotalSeconds -ge $staggerSeconds)

    if ($canStart -and $enoughTimeElapsed) {
        $state = $pendingStates[0]
        $pendingStates.RemoveAt(0)

        $iterationStart = [DateTime]::Now
        
        # Print logs IMMEDIATELY so you know what is happening
        Write-Host "[$state] Launching headed browser..." -ForegroundColor Cyan
        Write-Host "    [$state] Starting at $iterationStart (active workers: $($activeProcs.Count + 1))" -ForegroundColor DarkCyan

        $outDir = Join-Path $workingDir "test-results\package-$state"
        if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
        $stdoutLog = Join-Path $outDir 'stdout.log'
        $stderrLog = Join-Path $outDir 'stderr.log'
        $exitCodeFile = Join-Path $outDir 'exitcode.txt'
        $envCmd = 'set "TEST_STATE=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && set "TEST_TYPE=PACKAGE" && npx playwright test .\Create_Package.test.js --project=chromium --workers=1 --headed --output="' + $outDir + '" & set "PW_EXIT=%ERRORLEVEL%" & echo %PW_EXIT% > "' + $exitCodeFile + '" & exit /b %PW_EXIT%'

        $proc = Start-Process -FilePath "cmd.exe" `
            -ArgumentList @('/c', $envCmd) `
            -WorkingDirectory $workingDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru

        $activeProcs += [PSCustomObject]@{
            proc      = $proc
            state     = $state
            startTime = $iterationStart
            stdoutLog = $stdoutLog
            stderrLog = $stderrLog
            exitCodeFile = $exitCodeFile
        }
        $lastStartTime = $iterationStart
    }

    Start-Sleep -Seconds 1
}

# Summary
$totalDuration = ([DateTime]::Now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalDuration / 60)
$totalSecs = [int][Math]::Floor($totalDuration % 60)
$totalSecondsFormatted = $totalSecs.ToString("00")

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "PACKAGE TEST RESULTS SUMMARY"             -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow
Write-Host "Total Time: ${totalMinutes}m ${totalSecondsFormatted}s" -ForegroundColor Cyan

$passed = 0
$failed = 0
foreach ($result in $results) {
    if ($result.ExitCode -eq 0) {
        Write-Host "[$($result.State)] PASSED ($([math]::Round($result.Duration,2))s)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[$($result.State)] FAILED ($([math]::Round($result.Duration,2))s)" -ForegroundColor Red
        $failed++
    }
}
Write-Host "`nTotal: $($results.Count) | Passed: $passed | Failed: $failed`n" -ForegroundColor Cyan

if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }

# Email
if ($emailEnabled) {
    Write-Host "Sending consolidated email report..." -ForegroundColor Cyan

    $emailScript = Join-Path $workingDir "send-ca-email-optimized.js"
    if (-not (Test-Path $emailScript)) {
        Write-Host "Email script not found: $emailScript" -ForegroundColor Yellow
    } else {
        try {
            $emailResults = @()
            foreach ($state in $states) {
                $stateDataFile = Join-Path $workingDir "test-data-$state.json"
                $testData = $null
                if (Test-Path $stateDataFile) {
                    $testData = Get-Content $stateDataFile -Raw | ConvertFrom-Json
                }
                $resultForState = $results | Where-Object { $_.State -eq $state } | Select-Object -First 1
                $emailResults += [PSCustomObject]@{
                    State                = $state
                    StateName            = if ($testData) { $testData.stateName } else { $state }
                    Status               = if ($resultForState -and $resultForState.ExitCode -eq 0) { "PASSED" } else { "FAILED" }
                    Duration             = if ($resultForState) { [math]::Round($resultForState.Duration, 2) } else { 0 }
                    QuoteNumber          = if ($testData) { $testData.quoteNumber } else { "N/A" }
                    PolicyNumber         = if ($testData) { $testData.policyNumber } else { "N/A" }
                    Milestones           = if ($testData) { $testData.milestones } else { @() }
                    coverageChanges      = if ($testData) { $testData.coverageChanges } else { @() }
                    coverageSectionStats = if ($testData) { $testData.coverageSectionStats } else { @() }
                    addCoverageTimings   = if ($testData) { $testData.addCoverageTimings } else { @() }
                }
            }

            $emailPayload = @{
                results   = $emailResults
                env       = $TestEnv
                totalTime = "${totalMinutes}:${totalSecondsFormatted}"
                timestamp = (Get-Date -Format 'o')
                passed    = $passed
                failed    = $failed
            }

            $emailTempPath = Join-Path $workingDir 'ca-email-temp.json'
            [System.IO.File]::WriteAllText($emailTempPath, ($emailPayload | ConvertTo-Json -Depth 20))

            & node $emailScript
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Email sent successfully" -ForegroundColor Green
            } else {
                Write-Host "Email script exited with code $LASTEXITCODE" -ForegroundColor Yellow
            }

            Remove-Item $emailTempPath -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "Email error: $_" -ForegroundColor Yellow
        }
    }
}

# Cleanup
foreach ($f in @($batchMarker, $batchEmailSent)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

if ($failed -eq 0) {
    Remove-Item (Join-Path $workingDir 'iterations-data-package.json') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $workingDir 'test-data-*.json')          -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $workingDir 'WB_CA_Test_Report_*.xlsx') -Force -ErrorAction SilentlyContinue
}

Write-Host "Done." -ForegroundColor Cyan
exit $(if ($failed -gt 0) { 1 } else { 0 })