# runners/run-states.ps1
param(
  [Parameter(Mandatory)][ValidateSet('PACKAGE','CA','BOP')] [string]$TestType,
  [string]$States      = 'DE',
  [int]$MaxParallel    = 2,
  [int]$StaggerSeconds = 60,
  [string]$Env         = 'qa',
  [switch]$Headless    = $false
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (Test-Path ".env") {
  Get-Content ".env" | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
    $p = $_ -split '=', 2
    [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
  }
  Write-Host "Loaded .env" -ForegroundColor Gray
}

$rawStates = $States -split ','
$stateList = if ($rawStates -contains 'ALL' -or $States -eq 'ALL') {
  @('DE', 'PA', 'MI', 'WI')
} else {
  $rawStates | ForEach-Object { $_.Trim().ToUpper() } | Where-Object { $_ }
}

$testFile = switch ($TestType) {
  'PACKAGE' { 'Create_Package.test.js' }
  'CA'      { 'Create_CA.test.js' }
  'BOP'     { 'Create_BOP.test.js' }
}

$suiteLabel  = $TestType.ToLower()
$projectPath = $PWD.Path
$batchMarker = Join-Path $projectPath ".batch-run-in-progress-$suiteLabel"
$iterFile    = Join-Path $projectPath "iterations-data-$suiteLabel.json"
$lockFile    = Join-Path $projectPath "parallel-run-lock-$suiteLabel.json"
$logsDir     = Join-Path $projectPath "logs"

# Create logs directory
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s | Headed: $(-not $Headless)" -ForegroundColor Cyan
Write-Host "  Logs: $logsDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Clean up
if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

# Write shared runId
$sharedRunId = [DateTime]::UtcNow.ToString('o')
$lockData    = @{ runId = $sharedRunId; suite = $TestType; states = $stateList; startTime = $sharedRunId }
$lockData | ConvertTo-Json -Compress | Set-Content $lockFile -Encoding UTF8
Write-Host "Shared runId: $sharedRunId" -ForegroundColor Gray

"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

$headedFlag  = if ($Headless) { "" } else { "--headed" }
$activeProcs = [System.Collections.ArrayList]@()
$results     = @{}
$lastStart   = $null
$pendingStates = [System.Collections.ArrayList]@($stateList)

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {

  $stillRunning = [System.Collections.ArrayList]@()
  foreach ($entry in $activeProcs) {
    if (-not $entry.Process.HasExited) {
      $null = $stillRunning.Add($entry)
    } else {
      $passed = $false
      try {
        if (Test-Path $iterFile) {
          $iters     = Get-Content $iterFile -Raw | ConvertFrom-Json
          $stateIter = $iters | Where-Object { $_.state -eq $entry.State -and $_.runId -eq $sharedRunId } | Select-Object -Last 1
          if ($stateIter) { $passed = ($stateIter.status -eq 'PASSED') }
          else { $passed = ($entry.Process.ExitCode -eq 0) }
        }
      } catch { $passed = ($entry.Process.ExitCode -eq 0) }

      $results[$entry.State] = $passed
      $icon  = if ($passed) { "PASS" } else { "FAIL" }
      $color = if ($passed) { 'Green' } else { 'Red' }
      $logFile = Join-Path $logsDir "$suiteLabel-$($entry.State).log"
      Write-Host "  [$icon] $($entry.State) finished (exit=$($entry.Process.ExitCode))" -ForegroundColor $color
      Write-Host "  Log: $logFile" -ForegroundColor Gray

      # Show last 15 lines of log on failure
      if (-not $passed -and (Test-Path $logFile)) {
        Write-Host "  --- Last lines of $($entry.State) log ---" -ForegroundColor Yellow
        Get-Content $logFile | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        Write-Host "  --- End of log ---" -ForegroundColor Yellow
      }
    }
  }
  $activeProcs = $stillRunning

  $canLaunch = ($activeProcs.Count -lt $MaxParallel) -and ($pendingStates.Count -gt 0)
  $staggerOk = $true
  if ($lastStart -and $StaggerSeconds -gt 0) {
    $elapsed = [int]([DateTime]::Now - $lastStart).TotalSeconds
    if ($elapsed -lt $StaggerSeconds) {
      $staggerOk = $false
      if ($canLaunch) { Write-Host "  Stagger: waiting $($StaggerSeconds - $elapsed)s..." -ForegroundColor Gray }
    }
  }

  if ($canLaunch -and $staggerOk) {
    $state = $pendingStates[0]
    $pendingStates.RemoveAt(0)
    Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

    $outputDir = "test-results\$suiteLabel-$state"
    $logFile   = Join-Path $logsDir "$suiteLabel-$state.log"

    # Delete old log
    if (Test-Path $logFile) { Remove-Item $logFile -Force }

    # Build env vars
    $envVars = @(
      "TEST_STATE=$state",
      "TEST_ENV=$Env",
      "TEST_TYPE=$TestType",
      "WB_USER_DE=$env:WB_USER_DE",
      "WB_PASS_DE=$env:WB_PASS_DE",
      "WB_USER_PA=$env:WB_USER_PA",
      "WB_PASS_PA=$env:WB_PASS_PA",
      "WB_USER_MI=$env:WB_USER_MI",
      "WB_PASS_MI=$env:WB_PASS_MI",
      "WB_USER_WI=$env:WB_USER_WI",
      "WB_PASS_WI=$env:WB_PASS_WI",
      "SMTP_HOST=$env:SMTP_HOST",
      "SMTP_PORT=$env:SMTP_PORT",
      "FROM_EMAIL=$env:FROM_EMAIL",
      "TO_EMAIL=$env:TO_EMAIL",
      "PLAYWRIGHT_BROWSERS_PATH=0"
    )

    $setCommands   = ($envVars | ForEach-Object { 'set "' + $_ + '"' }) -join ' && '
    # Redirect ALL output (stdout + stderr) to log file AND show in window
    $playwrightCmd = 'npx playwright test "' + $testFile + '" --project=chromium --workers=1 --output="' + $outputDir + '" ' + $headedFlag + ' > "' + $logFile + '" 2>&1'
    $envCmd        = $setCommands + ' && ' + $playwrightCmd

    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @('/c', $envCmd) `
      -WorkingDirectory $projectPath `
      -WindowStyle Normal `
      -PassThru

    $null = $activeProcs.Add([PSCustomObject]@{
      State   = $state
      Process = $proc
      LogFile = $logFile
      Start   = [DateTime]::Now
    })
    $lastStart = [DateTime]::Now
    Write-Host "  $state launched (PID $($proc.Id)) -> log: $logFile" -ForegroundColor Green
    Write-Host "  Watch live: Get-Content '$logFile' -Wait" -ForegroundColor Gray
  }

  Start-Sleep -Seconds 5
}

if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }

# Send consolidated email
Write-Host ""
Write-Host "All states complete. Sending consolidated email..." -ForegroundColor Cyan
$sendScript = @"
require('dotenv').config();
const r = require('./emailReporter.js');
const fn = r.sendBatchEmailReport || (r.EmailReporter && r.EmailReporter.sendBatchEmailReport);
if (!fn) { console.error('sendBatchEmailReport not found'); process.exit(1); }
fn(['iterations-data-$suiteLabel.json'], 'WB $TestType Smoke Test Report')
  .then(() => { console.log('Consolidated email sent'); process.exit(0); })
  .catch(err => { console.error('Email failed:', err.message); process.exit(1); });
"@
$sendScript | node --input-type=commonjs
if ($LASTEXITCODE -eq 0) { Write-Host "Email sent" -ForegroundColor Green }
else { Write-Host "Email failed" -ForegroundColor Red }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FINAL SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$pass = 0; $fail = 0
foreach ($state in $stateList) {
  $ok    = $results[$state]
  $icon  = if ($ok) { "PASS" } else { "FAIL" }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $state" -ForegroundColor $color
  if ($ok) { $pass++ } else { $fail++ }
}
Write-Host ""
Write-Host "  Total: $($stateList.Count) | Passed: $pass | Failed: $fail" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Logs saved to: $logsDir" -ForegroundColor Cyan
Write-Host "  To view a log: Get-Content logs\$suiteLabel-DE.log" -ForegroundColor Gray
Write-Host ""
