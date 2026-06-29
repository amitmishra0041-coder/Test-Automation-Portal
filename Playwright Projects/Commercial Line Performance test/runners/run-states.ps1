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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s | Headed: $(-not $Headless)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Clean up
if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

# Write shared runId BEFORE launching any state
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

  # Check finished processes
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
      Write-Host "  [$icon] $($entry.State) finished (exit=$($entry.Process.ExitCode))" -ForegroundColor $color
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

    # Unique output dir per state prevents test-results folder contention
    $outputDir = "test-results\$suiteLabel-$state"

    # Build env vars string for cmd.exe
    # Using set "KEY=VALUE" pattern which handles $ correctly in cmd.exe
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

    # Build the cmd /c command string
    $setCommands = ($envVars | ForEach-Object { 'set "' + $_ + '"' }) -join ' && '
    $playwrightCmd = 'npx playwright test "' + $testFile + '" --project=chromium --workers=1 --output="' + $outputDir + '" ' + $headedFlag

    $envCmd = $setCommands + ' && ' + $playwrightCmd

    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @('/c', $envCmd) `
      -WorkingDirectory $projectPath `
      -WindowStyle Normal `
      -PassThru

    $null = $activeProcs.Add([PSCustomObject]@{
      State   = $state
      Process = $proc
      Start   = [DateTime]::Now
    })
    $lastStart = [DateTime]::Now
    Write-Host "  $state launched (PID $($proc.Id))" -ForegroundColor Green
  }

  Start-Sleep -Seconds 5
}

# Cleanup
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
