param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [switch]$Headed,
    [string]$Project = "chromium"
)

# -------------------------------
# State setup
# -------------------------------
$allowedStates = @('DE','MI','OH','PA','WI')

if ($States -and $States.Count -gt 0) {
    if ($States.Count -eq 1 -and $States[0] -match ',') {
        $states = $States[0].Split(',') | ForEach-Object { $_.Trim().ToUpper() }
    } else {
        $states = $States | ForEach-Object { $_.ToUpper() }
    }
} else {
    $states = $allowedStates
}

$states = $states | Where-Object { $allowedStates -contains $_ }
if ($states.Count -eq 0) {
    Write-Host "No valid states provided. Defaulting to all allowed states." -ForegroundColor Yellow
    $states = $allowedStates
}

# -------------------------------
# Execution controls
# -------------------------------
$maxParallel = 3
$startDelaySeconds = 30
$pendingStates = [System.Collections.Generic.Queue[string]]::new()
$states | ForEach-Object { $pendingStates.Enqueue($_) }

$activeRuns = @()
$lastStartTime = $null
$results = @()
$startTime = Get-Date

# Buffer to store per-state logs until completion
$stateLogs = @{}

Write-Host "`nStarting Package Playwright Tests" -ForegroundColor Cyan
Write-Host "Environment : $TestEnv"
Write-Host "States      : $($states -join ', ')"
Write-Host "Max Parallel: $maxParallel"
Write-Host "Start Delay : $startDelaySeconds seconds`n"

# -------------------------------
# Main loop
# -------------------------------
while ($pendingStates.Count -gt 0 -or $activeRuns.Count -gt 0) {

    # ---- Cleanup completed runs ----
    $stillRunning = @()
    foreach ($run in $activeRuns) {
        if (-not $run.Process.HasExited) {
            $stillRunning += $run
        } else {
            $end = Get-Date
            $duration = ($end - $run.StartTime).TotalSeconds
            $exitCode = $run.Process.ExitCode
            $exitCodeStr = if ($null -eq $exitCode) { 'N/A' } else { $exitCode.ToString() }

            # Compose all logs for this state
            $state = $run.State
            $logBuffer = $stateLogs[$state]
            if (-not $logBuffer) { $logBuffer = @() }
            $logBuffer += "    [$state] Package test completed (ExitCode=$exitCodeStr, Duration=$([int]$duration)s)"
            # Print all logs for this state together
            Write-Host "" -NoNewline
            foreach ($line in $logBuffer) { Write-Host $line }
            $stateLogs.Remove($state)

            $results += @{
                State    = $run.State
                ExitCode = $exitCode
                Duration = $duration
            }
        }
    }
    $activeRuns = $stillRunning

    # ---- Can we start a new run? ----
    $canStart = ($activeRuns.Count -lt $maxParallel) -and ($pendingStates.Count -gt 0)
    $delayOk = $true

    try {
        if ($lastStartTime -ne $null -and $lastStartTime -is [DateTime]) {
            $elapsed = (Get-Date - $lastStartTime).TotalSeconds
            if ($elapsed -lt $startDelaySeconds) {
                $delayOk = $false
            }
        }
    } catch {}

    if ($canStart -and $delayOk) {
        $state = $pendingStates.Dequeue()
        $now = Get-Date
        $parallelCount = $activeRuns.Count + 1

        # Buffer logs for this state
        $logBuffer = @()
        $logBuffer += ("Starting Package test for state: $state at $now (Parallel jobs: $parallelCount)")
        $cpuStart = (Get-Process -Id $PID).CPU
        $memStart = (Get-Process -Id $PID).WorkingSet64
        $logBuffer += ("    [Resource at start] CPU: $cpuStart, RAM: $memStart")
        $stateLogs[$state] = $logBuffer

        # Environment variables for Playwright
        $env:TEST_STATE = $state
        $env:TEST_ENV   = $TestEnv
        $env:TEST_TYPE  = "PACKAGE"

        $args = @(
            "playwright", "test",
            "Create_Package.test.js",
            "--project=$Project"
        )

        if ($Headed) {
            $args += "--headed"
        }

        $cmdArgs = "/c npx $($args -join ' ')"
        $proc = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList $cmdArgs `
            -WorkingDirectory (Get-Location) `
            -PassThru `
            -WindowStyle Hidden `
            -RedirectStandardOutput "pw-$state.out.log" `
            -RedirectStandardError  "pw-$state.err.log"

        $activeRuns += @{
            State     = $state
            Process   = $proc
            StartTime = $now
        }

        $lastStartTime = $now
    }

    Start-Sleep -Seconds 1
}

# -------------------------------
# Summary
# -------------------------------
$passed = ($results | Where-Object ExitCode -eq 0).Count
$failed = ($results | Where-Object ExitCode -ne 0).Count
$totalTime = (Get-Date - $startTime)

Write-Host "`n===============================" -ForegroundColor Yellow
Write-Host "PACKAGE TEST SUMMARY" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Yellow
Write-Host "Total Time : $([int]$totalTime.TotalMinutes)m $([int]$totalTime.Seconds)s"
Write-Host "Passed     : $passed"
Write-Host "Failed     : $failed`n"

if ($failed -gt 0) {
    exit 1
}
exit 0
