# PowerShell script to run CA Tarmika tests in parallel for all states
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

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CA Tarmika Test Runner - Parallel Execution" -ForegroundColor Cyan
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
            $logBuffer += "    [$state] CA test completed (ExitCode: $exitCode, Duration: $duration s, CPU: $cpu, RAM: $mem)"
            # Print all logs for this state together
            Write-Host "" -NoNewline
            foreach ($line in $logBuffer) { Write-Host $line }
            $stateLogs.Remove($state)

            # Enrich with quote details written by the Playwright test
            $quoteRequestNumber = 'N/A'
            $insuredName = 'N/A'
            try {
                $resultFile = Join-Path $projectPath ("ca-result-" + $state + ".json")
                if (Test-Path $resultFile) {
                    $detail = Get-Content -Path $resultFile -Raw | ConvertFrom-Json -ErrorAction Stop
                    if ($detail.QuoteRequestNumber) { $quoteRequestNumber = $detail.QuoteRequestNumber }
                    if ($detail.InsuredName) { $insuredName = $detail.InsuredName }
                }
            } catch {
                Write-Host "Warning: Could not read quote details for $state - $($_.Exception.Message)" -ForegroundColor Yellow
            }

            $results += @{ State = $state; ExitCode = $exitCode; Duration = $duration; CPU = $cpu; RAM = $mem; ParallelAtStart = $procInfo.parallelAtStart; QuoteRequestNumber = $quoteRequestNumber; InsuredName = $insuredName }
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
        $logBuffer += ("Starting CA test for state: $state at $iterationStart (Parallel jobs: $parallelAtStart)")
        $cpuStart = (Get-Process -Id $PID).CPU
        $memStart = (Get-Process -Id $PID).WorkingSet64
        $logBuffer += ("    [Resource at start] CPU: $cpuStart, RAM: $memStart")
        $stateLogs[$state] = $logBuffer
        $headedFlag = if ($Headed.IsPresent) { " --headed" } else { "" }
        $outDir = "test-results\ca-$state"
        $windowStyle = "Hidden"  # Always hide cmd.exe terminal windows - browser will show in headed mode
        $envCmd = 'set "TEST_STATES=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && npx playwright test CA_Tarmika.test.js --project=' + $Project + ' --workers=1' + $headedFlag + ' --output="' + $outDir + '"'
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @('/c', $envCmd) -WorkingDirectory $projectPath -WindowStyle $windowStyle -PassThru
        $activeProcs += @{ proc = $proc; state = $state; startTime = $iterationStart; parallelAtStart = $parallelAtStart; cpuStart = $cpuStart; memStart = $memStart }
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
Write-Host "CA TARMIKA TEST RESULTS SUMMARY" -ForegroundColor Yellow
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

# Persist results to JSON for later reporting
try {
    $resultsPath = Join-Path $projectPath 'ca-parallel-results.json'
    $results | ConvertTo-Json -Depth 4 | Set-Content -Path $resultsPath -Encoding UTF8
    Write-Host "Saved results to $resultsPath" -ForegroundColor Gray
} catch {
    Write-Host "Warning: Could not save results JSON - $($_.Exception.Message)" -ForegroundColor Yellow
}

# Send consolidated email report
Write-Host "`nSending consolidated email report..." -ForegroundColor Cyan
try {
    # Write results to temp file for Node.js to read (UTF-8 without BOM)
    $tempResultsPath = Join-Path $projectPath 'ca-email-temp.json'
    $emailData = @{
        results = $results
        totalTime = "${totalMinutes}:${totalSecondsFormatted}"
        env = $TestEnv
    }
    $jsonContent = $emailData | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($tempResultsPath, $jsonContent, (New-Object System.Text.UTF8Encoding $false))
    
    # Call email reporter script
    node send-ca-email.js
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Email sent successfully`n" -ForegroundColor Green
        # Clean up temp file
        Remove-Item -Path $tempResultsPath -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "⚠️ Email sending failed (Exit Code: $LASTEXITCODE)`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ Email error: $($_.Exception.Message)`n" -ForegroundColor Yellow
}

# Exit with error code if any tests failed
if ($failed -gt 0) {
    exit 1
} else {
    # Post-run cleanup: remove transient files
    try {
        Write-Host "Cleaning up transient files..." -ForegroundColor Gray
        Remove-Item -Force (Join-Path $projectPath 'test-data-*.json') -ErrorAction SilentlyContinue
        Write-Host "Transient cleanup done" -ForegroundColor Gray
    } catch {
        Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    exit 0
}
