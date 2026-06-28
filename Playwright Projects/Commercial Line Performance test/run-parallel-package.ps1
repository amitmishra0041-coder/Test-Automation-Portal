# PowerShell script to run Package tests in parallel for selected states
param(
    [string]$TestEnv = "qa",
    [string[]]$States,
    [string]$Project = "chromium",
    [switch]$KillStrays,
    [switch]$NoEmail
)

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

$states = $states | ForEach-Object { $_.ToUpper() } | Where-Object { $allowed -contains $_ }
if ($states.Count -eq 0) {
    Write-Host "No valid states provided. Defaulting to: $($allowed -join ', ')" -ForegroundColor Yellow
    $states = $allowed
}

$projectPath = Split-Path -Parent $PSCommandPath
$lockFile = Join-Path $projectPath 'parallel-run-lock-package.json'
$iterationsFile = Join-Path $projectPath 'iterations-data-package.json'
$testDataFile = Join-Path $projectPath 'test-data.json'
$batchMarker = Join-Path $projectPath '.batch-run-in-progress'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Package Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment: $TestEnv" -ForegroundColor Yellow
Write-Host "States: $($states -join ', ')" -ForegroundColor Yellow
Write-Host "Project: $Project | Headed: YES (Always)" -ForegroundColor Yellow
Write-Host "Max Parallel: 3 Workers" -ForegroundColor Yellow
Write-Host "Project Path: $projectPath`n" -ForegroundColor Yellow

try {
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $iterationsFile) { Remove-Item $iterationsFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $testDataFile) { Remove-Item $testDataFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue }

    $runId = [DateTime]::Now.ToString('o')
    $lockData = [ordered]@{
        runId = $runId
        targetStates = $states
        completedStates = @()
        startTime = $runId
    }
    $lockJson = $lockData | ConvertTo-Json -Depth 3 -Compress
    [System.IO.File]::WriteAllText($lockFile, $lockJson, [System.Text.UTF8Encoding]$false)

    if (-not (Test-Path $batchMarker)) {
        '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
    }
} catch {
    Write-Host "Failed to initialize lock: $($_.Exception.Message)" -ForegroundColor Yellow
}

$results = @()
$startTime = [DateTime]::Now
$maxParallel = 3
$pendingStates = $states.Clone()
$activeProcs = @()
$lastStartTime = $null
$stateLogs = @{}

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {
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
            $logBuffer += "    [$state] Package test completed (ExitCode: $exitCode, Duration: $([math]::Round($duration, 2)) s)"
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
        $logBuffer += "Starting Package test for state: $state at $iterationStart (Parallel jobs: $parallelAtStart)"
        $stateLogs[$state] = $logBuffer

        $outDir = "test-results\package-$state"
        $windowStyle = "Hidden"
        $envCmd = 'set "TEST_STATE=' + $state + '" && set "TEST_ENV=' + $TestEnv + '" && set "TEST_TYPE=PACKAGE" && npx playwright test Create_Package.test.js --project=' + $Project + ' --workers=1 --headed --output="' + $outDir + '"'
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @('/c', $envCmd) -WorkingDirectory $projectPath -WindowStyle $windowStyle -PassThru
        $activeProcs += @{ proc = $proc; state = $state; startTime = $iterationStart; parallelAtStart = $parallelAtStart }
        $lastStartTime = $iterationStart
    }
    Start-Sleep -Seconds 1
}

$now = [DateTime]::Now
$totalTime = ($now - $startTime).TotalSeconds
$totalMinutes = [int][Math]::Floor($totalTime / 60)
$totalSecs = [int][Math]::Floor($totalTime % 60)

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "PACKAGE TEST RESULTS SUMMARY" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow
Write-Host "Total Execution Time: ${totalMinutes}:$($totalSecs.ToString('00'))s" -ForegroundColor Cyan

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

try {
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $batchMarker) {
        Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
}

if ($failed -gt 0) { exit 1 } else { exit 0 }