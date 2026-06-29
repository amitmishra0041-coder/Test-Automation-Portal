# runners/run-states.ps1
# Consolidated runner for Package, CA and BOP suites.
# - Launches states with 60s stagger between each launch
# - Maximum 2 states running in parallel at any time
# - Waits for a slot to free up before launching next state
# - Single consolidated email after ALL states complete
# - Final summary correctly reflects pass/fail from playwright exit code
#
# Usage:
#   .\runners\run-states.ps1 -TestType PACKAGE -States "DE,PA,MI,WI"
#   .\runners\run-states.ps1 -TestType CA      -States "DE,PA"
#   .\runners\run-states.ps1 -TestType BOP     -States "DE"
#   .\runners\run-states.ps1 -TestType PACKAGE -States ALL

param(
  [Parameter(Mandatory)][ValidateSet('PACKAGE','CA','BOP')] [string]$TestType,
  [string]$States      = 'DE',
  [int]$MaxParallel    = 2,
  [int]$StaggerSeconds = 60,
  [string]$Env         = 'qa'
)

# Fix console encoding for emoji/unicode characters
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Load .env credentials
if (Test-Path ".env") {
  Get-Content ".env" | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
    $p = $_ -split '=', 2
    [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
  }
  Write-Host "Loaded .env" -ForegroundColor Gray
}

# Resolve state list
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
$lockFile    = Join-Path $PWD "parallel-run-lock-$suiteLabel.json"
$iterFile    = Join-Path $PWD "iterations-data-$suiteLabel.json"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Clean up previous run artifacts
if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

# Create batch marker BEFORE launching any state
# This tells emailReporter to skip per-state emails
"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# Capture all env vars to pass into jobs (Start-Job has isolated scope)
$envVars = @{
  TEST_ENV   = $Env
  TEST_TYPE  = $TestType
  WB_USER_DE = $env:WB_USER_DE; WB_PASS_DE = $env:WB_PASS_DE
  WB_USER_PA = $env:WB_USER_PA; WB_PASS_PA = $env:WB_PASS_PA
  WB_USER_MI = $env:WB_USER_MI; WB_PASS_MI = $env:WB_PASS_MI
  WB_USER_WI = $env:WB_USER_WI; WB_PASS_WI = $env:WB_PASS_WI
  SMTP_HOST  = $env:SMTP_HOST;  SMTP_PORT  = $env:SMTP_PORT
  FROM_EMAIL = $env:FROM_EMAIL; TO_EMAIL   = $env:TO_EMAIL
}

# ── Launch states with stagger and parallel limit ─────────────────────────────
$jobs = [System.Collections.ArrayList]@()

foreach ($state in $stateList) {

  # Wait until we have a free slot (active running jobs < MaxParallel)
  while ($true) {
    $runningCount = ($jobs | Where-Object { $_.Job.State -eq 'Running' }).Count
    if ($runningCount -lt $MaxParallel) { break }
    Write-Host "  Max parallel ($MaxParallel) reached - checking again in 10s..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
  }

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  $job = Start-Job -ScriptBlock {
    param($dir, $file, $state, $vars)
    Set-Location $dir
    # Set all env vars inside the job
    foreach ($k in $vars.Keys) {
      [System.Environment]::SetEnvironmentVariable($k, $vars[$k], 'Process')
    }
    $env:TEST_STATE = $state
    # Run playwright and capture exit code
    $output = & npx playwright test $file --project=chromium 2>&1
    $exitCode = $LASTEXITCODE
    # Return both output and exit code
    return @{
      output   = $output -join "`n"
      exitCode = $exitCode
      state    = $state
    }
  } -ArgumentList $PWD, $testFile, $state, $envVars

  $null = $jobs.Add([PSCustomObject]@{
    State     = $state
    Job       = $job
    StartTime = Get-Date
  })

  Write-Host "  $state launched (job $($job.Id))" -ForegroundColor Green

  # Stagger: wait before launching next state (skip wait after last state)
  if ($state -ne $stateList[-1]) {
    Write-Host "  Waiting ${StaggerSeconds}s before next launch..." -ForegroundColor Gray
    Start-Sleep -Seconds $StaggerSeconds
  }
}

# ── Wait for all jobs and capture real pass/fail ──────────────────────────────
Write-Host ""
Write-Host "All states launched - waiting for completion..." -ForegroundColor Cyan
Write-Host ""

$results = @{}

foreach ($entry in $jobs) {
  Write-Host "Waiting for $($entry.State)..." -ForegroundColor Gray

  $jobResult = $entry.Job | Wait-Job | Receive-Job

  # jobResult is a hashtable with output and exitCode
  $exitCode = 0
  $output   = ""

  if ($jobResult -is [hashtable]) {
    $exitCode = [int]($jobResult.exitCode)
    $output   = $jobResult.output
  } else {
    # Fallback: if job returned plain string output
    $output   = $jobResult | Out-String
    # Try to detect failure from output text
    if ($output -match '(\d+) failed' -and [int]$Matches[1] -gt 0) {
      $exitCode = 1
    } elseif ($output -match 'Error:|FAILED|failed') {
      $exitCode = 1
    }
  }

  # PASS only if playwright exit code is 0
  $passed = ($exitCode -eq 0)
  $results[$entry.State] = $passed

  $icon  = if ($passed) { "PASS" } else { "FAIL" }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $($entry.State): exit=$exitCode" -ForegroundColor $color

  # Show last 8 lines of output for quick diagnosis
  $lines = $output.Split("`n") | Where-Object { $_.Trim() }
  $tail  = $lines | Select-Object -Last 8
  foreach ($line in $tail) {
    Write-Host "    $line" -ForegroundColor Gray
  }
  Write-Host ""
}

# ── Remove batch marker ───────────────────────────────────────────────────────
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }

# ── Send consolidated email ───────────────────────────────────────────────────
Write-Host "Sending consolidated email..." -ForegroundColor Cyan

$sendScript = @"
require('dotenv').config();
const reporter = require('./emailReporter.js');
const fn = reporter.sendBatchEmailReport || (reporter.EmailReporter && reporter.EmailReporter.sendBatchEmailReport);
if (!fn) { console.error('sendBatchEmailReport not found'); process.exit(1); }
fn(['iterations-data-$suiteLabel.json'], 'WB $TestType Smoke Test Report')
  .then(() => { console.log('Consolidated email sent'); process.exit(0); })
  .catch(err => { console.error('Email failed:', err.message); process.exit(1); });
"@

$sendScript | node --input-type=commonjs
if ($LASTEXITCODE -eq 0) {
  Write-Host "Consolidated email sent successfully" -ForegroundColor Green
} else {
  Write-Host "Email failed - check SMTP settings" -ForegroundColor Red
}

# ── Final summary ─────────────────────────────────────────────────────────────
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
if ($allPassed) {
  Write-Host "  All states passed!" -ForegroundColor Green
} else {
  Write-Host "  Some states failed - check output above" -ForegroundColor Red
}
Write-Host ""
