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
$batchMarker = Join-Path $PWD ".batch-run-in-progress-$suiteLabel"
$iterFile    = Join-Path $PWD "iterations-data-$suiteLabel.json"
$lockFile    = Join-Path $PWD "parallel-run-lock-$suiteLabel.json"
$tmpDir      = Join-Path $PWD ".runners-tmp"

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
if (Test-Path $tmpDir)      { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# Build headed flag
$headedFlag = if ($Headless) { "" } else { "--headed" }

# Snapshot current env vars for injection into scripts
$envSnapshot = @{
  TEST_ENV   = $Env
  TEST_TYPE  = $TestType
  WB_USER_DE = "$env:WB_USER_DE"; WB_PASS_DE = "$env:WB_PASS_DE"
  WB_USER_PA = "$env:WB_USER_PA"; WB_PASS_PA = "$env:WB_PASS_PA"
  WB_USER_MI = "$env:WB_USER_MI"; WB_PASS_MI = "$env:WB_PASS_MI"
  WB_USER_WI = "$env:WB_USER_WI"; WB_PASS_WI = "$env:WB_PASS_WI"
  SMTP_HOST  = "$env:SMTP_HOST";  SMTP_PORT  = "$env:SMTP_PORT"
  FROM_EMAIL = "$env:FROM_EMAIL"; TO_EMAIL   = "$env:TO_EMAIL"
}

# Track launched processes
$procs = [System.Collections.ArrayList]@()

foreach ($state in $stateList) {

  # Wait for a free slot
  while ($true) {
    # Remove finished processes from tracking
    $running = @($procs | Where-Object { -not $_.Process.HasExited })
    if ($running.Count -lt $MaxParallel) { break }
    Write-Host "  Max parallel ($MaxParallel) reached - checking in 10s..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
  }

  # Write a dedicated launcher script for this state
  # This avoids command-line length limits and quoting issues
  $scriptPath = Join-Path $tmpDir "run-$state.ps1"
  $scriptLines = @()
  $scriptLines += "Set-Location '$PWD'"
  $scriptLines += "`$env:TEST_STATE = '$state'"
  foreach ($k in $envSnapshot.Keys) {
    $v = $envSnapshot[$k]
    if ($v) { $scriptLines += "`$env:$k = '$v'" }
  }
  $scriptLines += "Write-Host 'Starting $state ($TestType)...' -ForegroundColor Yellow"
  $scriptLines += "Write-Host 'Working directory: ' (Get-Location)"
  $scriptLines += "Write-Host 'Test file: $testFile'"
  $scriptLines += "Write-Host 'Headed: $(-not $Headless)'"
  $scriptLines += ""
  if ($headedFlag) {
    $scriptLines += "npx playwright test '$testFile' --project=chromium $headedFlag"
  } else {
    $scriptLines += "npx playwright test '$testFile' --project=chromium"
  }
  $scriptLines += "`$exitCode = `$LASTEXITCODE"
  $scriptLines += "Write-Host ''"
  $scriptLines += "Write-Host '$state completed with exit code: ' `$exitCode -ForegroundColor `$(if (`$exitCode -eq 0) { 'Green' } else { 'Red' })"
  $scriptLines += "Write-Host 'Press any key to close...'"
  $scriptLines += "pause"
  $scriptLines | Set-Content $scriptPath -Encoding UTF8

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  # Launch in a new visible PowerShell window
  $proc = Start-Process powershell.exe `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath `
    -PassThru `
    -WindowStyle Normal

  $null = $procs.Add([PSCustomObject]@{
    State     = $state
    Process   = $proc
    Script    = $scriptPath
    StartTime = Get-Date
  })

  Write-Host "  $state launched (PID $($proc.Id))" -ForegroundColor Green

  # Stagger before next launch
  if ($state -ne $stateList[-1]) {
    Write-Host "  Waiting ${StaggerSeconds}s before next launch..." -ForegroundColor Gray
    Start-Sleep -Seconds $StaggerSeconds
  }
}

# Wait for all processes to finish
Write-Host ""
Write-Host "All states launched - waiting for completion..." -ForegroundColor Cyan
Write-Host ""

$results = @{}

foreach ($entry in $procs) {
  Write-Host "Waiting for $($entry.State) (PID $($entry.Process.Id))..." -ForegroundColor Gray
  $entry.Process.WaitForExit()
  $exitCode = $entry.Process.ExitCode
  $passed   = ($exitCode -eq 0)
  $results[$entry.State] = $passed

  $icon  = if ($passed) { "PASS" } else { "FAIL" }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $($entry.State): exit code = $exitCode" -ForegroundColor $color
  Write-Host ""
}

# Clean up tmp scripts
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }

# Remove batch marker
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }

# Send consolidated email
Write-Host "Sending consolidated email..." -ForegroundColor Cyan
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
if ($LASTEXITCODE -eq 0) { Write-Host "Email sent successfully" -ForegroundColor Green }
else { Write-Host "Email failed - check SMTP settings" -ForegroundColor Red }

# Final summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FINAL SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allPassed = $true
foreach ($state in $stateList) {
  $passed = $results[$state]
  $icon   = if ($passed) { "PASS" } else { "FAIL" }
  $color  = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $state" -ForegroundColor $color
  if (-not $passed) { $allPassed = $false }
}
Write-Host ""
if ($allPassed) { Write-Host "  All states passed!" -ForegroundColor Green }
else            { Write-Host "  Some states failed - check the browser windows above" -ForegroundColor Red }
Write-Host ""
