# PowerShell script to run BOP tests in parallel for all states
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
    $states = @('DE', 'PA', 'WI', 'OH', 'MI', 'AZ', 'CO', 'IL', 'IA', 'NC', 'SC', 'NE', 'NM', 'SD', 'TX', 'UT', 'IN', 'TN', 'VA')
}
$allowed = @('DE','MI','OH','PA','WI','AZ','CO','IL','IA','NC','SC','NE','NM','SD','TX','UT','IN','TN','VA')
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
    
    # Small delay to ensure batch marker is fully written before jobs start
    Start-Sleep -Milliseconds 500
} catch {
    Write-Host "⚠️ Failed to initialize lock or clean artifacts: $($_.Exception.Message)" -ForegroundColor Yellow
}


# Match package runner: true parallelism, resource logging, per-iteration timing
$results = @()
$startTime = [DateTime]::Now
$maxParallel = 3
$pendingStates = $states.Clone()
$activeProcs = @()
$lastStartTime = $null

# Buffer to store per-state logs until completion
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
            # Log resource usage at end
            $procStats = $null
            try {
                $procStats = Get-Process -Id $procInfo.proc.Id -ErrorAction SilentlyContinue
            } catch {}
            $cpu = $procStats.CPU
            $mem = $procStats.WorkingSet64

            # Compose all logs for this state
            $state = $procInfo.state
            $logBuffer = $stateLogs[$state]
            if (-not $logBuffer) { $logBuffer = @() }
            $logBuffer += "    [$state] BOP test completed (ExitCode: $exitCode, Duration: $duration s, CPU: $cpu, RAM: $mem)"
            # Print all logs for this state together
            Write-Host "" -NoNewline
            foreach ($line in $logBuffer) { Write-Host $line }
            $stateLogs.Remove($state)

            $results += @{ State = $state; ExitCode = $exitCode; Duration = $duration; CPU = $cpu; RAM = $mem; ParallelAtStart = $procInfo.parallelAtStart }
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
        # Buffer logs for this state
        $logBuffer = @()
        $logBuffer += ("Starting BOP test for state: $state at $iterationStart (Parallel jobs: $parallelAtStart)")
        $cpuStart = (Get-Process -Id $PID).CPU
        $memStart = (Get-Process -Id $PID).WorkingSet64
        $logBuffer += ("    [Resource at start] CPU: $cpuStart, RAM: $memStart")
        $stateLogs[$state] = $logBuffer
        $logPath = Join-Path $projectPath ("test-run-output-" + $state + ".txt")
        $headedFlag = if ($Headed.IsPresent) { " --headed" } else { "" }
        $outDir = "test-results\bop-$state"
        $windowStyle = "Hidden"  # Always hide cmd.exe terminal windows - browser will show in headed mode
        # Use cmd's 2>&1 redirection since PowerShell Start-Process doesn't allow same file for both streams
        $envCmd = 'set "TEST_STATE=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && set "TEST_TYPE=BOP" && (npx playwright test Create_BOP.test.js --project=' + $Project + $headedFlag + ' --output="' + $outDir + '") > "' + $logPath + '" 2>&1'
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @('/c', $envCmd) -WorkingDirectory $projectPath -WindowStyle $windowStyle -PassThru
        $activeProcs += @{ proc = $proc; state = $state; log = $logPath; startTime = $iterationStart; parallelAtStart = $parallelAtStart; cpuStart = $cpuStart; memStart = $memStart }
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
Write-Host "BOP TEST RESULTS SUMMARY" -ForegroundColor Yellow
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

# Send consolidated email report (guarded) and clean markers
try {
    $batchEmailSent = Join-Path $projectPath '.batch-email-sent'
    if (Test-Path $batchEmailSent) {
        Write-Host "Batch email already sent; skipping" -ForegroundColor Gray
    } else {
        Write-Host "Sending consolidated email report..." -ForegroundColor Cyan
        Push-Location $projectPath
        & node -e "const EmailReporter = require('./emailReporter.js'); EmailReporter.sendBatchEmailReport(['iterations-data-bop.json'], 'WB BOP Test Report');"
        Pop-Location
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

# Exit with error code if any tests failed (email handled by batch wrapper)
if ($failed -gt 0) {
    exit 1
} else {
    # Post-run cleanup: remove transient files
    try {
        Write-Host "Cleaning up transient files..." -ForegroundColor Gray
        Remove-Item -Force (Join-Path $projectPath 'iterations-data-bop.json') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'test-data-*.json') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'pw-*.out.log') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'pw-*.err.log') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $projectPath 'WB_Test_Report_*.xlsx') -ErrorAction SilentlyContinue
        Write-Host "Transient cleanup done" -ForegroundColor Gray
    } catch {
        Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    exit 0
}
