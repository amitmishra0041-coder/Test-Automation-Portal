# runners/run-states.ps1
param(
  [Parameter(Mandatory)][ValidateSet('PACKAGE','CA','BOP')] [string]$TestType,
  [string]$States      = 'DE',
  [int]$MaxParallel    = 2,
  [int]$StaggerSeconds = 60,
  [string]$Env         = 'qa'
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
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }
if (Test-Path $tmpDir)      { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# Write a .env file per state into tmp dir
# This is the ONLY reliable way to pass credentials with special chars ($, @, !)
foreach ($state in $stateList) {
  $stateEnvPath = Join-Path $tmpDir "env-$state.env"
  $lines = @()
  $lines += "TEST_STATE=$state"
  $lines += "TEST_ENV=$Env"
  $lines += "TEST_TYPE=$TestType"
  $lines += "WB_USER_DE=$env:WB_USER_DE"
  $lines += "WB_PASS_DE=$env:WB_PASS_DE"
  $lines += "WB_USER_PA=$env:WB_USER_PA"
  $lines += "WB_PASS_PA=$env:WB_PASS_PA"
  $lines += "WB_USER_MI=$env:WB_USER_MI"
  $lines += "WB_PASS_MI=$env:WB_PASS_MI"
  $lines += "WB_USER_WI=$env:WB_USER_WI"
  $lines += "WB_PASS_WI=$env:WB_PASS_WI"
  $lines += "SMTP_HOST=$env:SMTP_HOST"
  $lines += "SMTP_PORT=$env:SMTP_PORT"
  $lines += "FROM_EMAIL=$env:FROM_EMAIL"
  $lines += "TO_EMAIL=$env:TO_EMAIL"
  [System.IO.File]::WriteAllLines($stateEnvPath, $lines)
  Write-Host "  Wrote env file for $state" -ForegroundColor Gray
}

$jobs = [System.Collections.ArrayList]@()

foreach ($state in $stateList) {

  # Wait for a free slot
  while ($true) {
    $running = @($jobs | Where-Object { $_.Job.State -eq 'Running' }).Count
    if ($running -lt $MaxParallel) { break }
    Write-Host "  Max parallel ($MaxParallel) reached - checking in 10s..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
  }

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  # Use Start-Job with -ArgumentList to pass everything safely
  # The job loads credentials from the env file - no escaping issues
  $job = Start-Job -ScriptBlock {
    param($workDir, $envFilePath, $testFileName, $state)

    Set-Location $workDir

    # Load env vars from file - handles $, @, ! in passwords safely
    if (Test-Path $envFilePath) {
      Get-Content $envFilePath | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
        $p = $_ -split '=', 2
        if ($p.Count -eq 2) {
          [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
        }
      }
    }

    Write-Output "Starting $state - workdir: $workDir"
    Write-Output "TEST_STATE=$env:TEST_STATE TEST_TYPE=$env:TEST_TYPE TEST_ENV=$env:TEST_ENV"

    # Run playwright - captures all output
    $output = & cmd /c "npx playwright test `"$testFileName`" --project=chromium 2>&1"
    $exitCode = $LASTEXITCODE

    Write-Output $output
    Write-Output "EXIT_CODE:$exitCode"
    return $exitCode

  } -ArgumentList $PWD.Path, (Join-Path $tmpDir "env-$state.env"), $testFile, $state

  $null = $jobs.Add([PSCustomObject]@{
    State     = $state
    Job       = $job
    StartTime = Get-Date
  })

  Write-Host "  $state launched (job $($job.Id))" -ForegroundColor Green

  if ($state -ne $stateList[-1]) {
    Write-Host "  Waiting ${StaggerSeconds}s before next launch..." -ForegroundColor Gray
    Start-Sleep -Seconds $StaggerSeconds
  }
}

# Wait for all jobs
Write-Host ""
Write-Host "All states launched - waiting for completion..." -ForegroundColor Cyan
Write-Host ""

$results = @{}

foreach ($entry in $jobs) {
  Write-Host "Waiting for $($entry.State)..." -ForegroundColor Gray

  $output = $entry.Job | Wait-Job | Receive-Job

  # Extract exit code from output
  $exitCode = 1  # default to fail
  $outputText = $output | Out-String

  # Look for our EXIT_CODE marker
  if ($outputText -match 'EXIT_CODE:(\d+)') {
    $exitCode = [int]$Matches[1]
  } elseif ($outputText -match '(\d+) passed' -and $outputText -notmatch '\d+ failed') {
    $exitCode = 0
  } elseif ($outputText -match '0 failed') {
    $exitCode = 0
  }

  $passed = ($exitCode -eq 0)
  $results[$entry.State] = $passed

  $icon  = if ($passed) { "PASS" } else { "FAIL" }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $($entry.State): exit=$exitCode" -ForegroundColor $color

  # Show last 10 lines of output
  $lines = ($outputText -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 10
  foreach ($line in $lines) { Write-Host "    $line" -ForegroundColor Gray }
  Write-Host ""
}

# Cleanup
if (Test-Path $tmpDir)      { Remove-Item $tmpDir -Recurse -Force }
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
if ($LASTEXITCODE -eq 0) { Write-Host "Email sent" -ForegroundColor Green }
else { Write-Host "Email failed" -ForegroundColor Red }

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
else            { Write-Host "  Some states failed" -ForegroundColor Red }
Write-Host ""
