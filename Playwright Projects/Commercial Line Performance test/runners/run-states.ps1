# runners/run-states.ps1
# Consolidated runner for Package, CA and BOP suites.
# - Max 2 states run in parallel
# - 60 second stagger between each launch
# - Single consolidated email sent AFTER all states complete
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

# Load .env credentials into current session
if (Test-Path ".env") {
  Get-Content ".env" | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
    $p = $_ -split '=', 2
    [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
  }
  Write-Host "Loaded .env" -ForegroundColor Gray
}

# Resolve state list - handle both quoted "DE,PA" and unquoted DE,PA
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
$iterFile    = Join-Path $PWD "iterations-data-$suiteLabel.json"
$batchMarker = Join-Path $PWD ".batch-run-in-progress-$suiteLabel"
$lockFile    = Join-Path $PWD "parallel-run-lock-$suiteLabel.json"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Clean up previous run artifacts ───────────────────────────────────
if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

# Generate shared runId for this batch
$runId = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

# Write lock file with shared runId so all workers use the same one
$lockData = @{ runId = $runId; states = $stateList; suite = $TestType; startTime = $runId }
$lockData | ConvertTo-Json | Set-Content $lockFile -Encoding UTF8

# ── Step 2: Create batch marker so emailReporter skips per-state emails ───────
"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# ── Step 3: Launch states with stagger and parallel limit ────────────────────
$jobs   = @()
$active = 0

foreach ($state in $stateList) {

  # If at max parallel, wait for any job to finish before launching next
  while ($active -ge $MaxParallel) {
    Start-Sleep -Seconds 5
    $active = ($jobs | Where-Object { $_.Job.State -eq 'Running' }).Count
  }

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  # Pass all env vars needed by the test and reporter
  $envVars = @{
    TEST_STATE   = $state
    TEST_ENV     = $Env
    TEST_TYPE    = $TestType
    WB_USER_DE   = $env:WB_USER_DE
    WB_PASS_DE   = $env:WB_PASS_DE
    WB_USER_PA   = $env:WB_USER_PA
    WB_PASS_PA   = $env:WB_PASS_PA
    WB_USER_MI   = $env:WB_USER_MI
    WB_PASS_MI   = $env:WB_PASS_MI
    WB_USER_WI   = $env:WB_USER_WI
    WB_PASS_WI   = $env:WB_PASS_WI
    SMTP_HOST    = $env:SMTP_HOST
    SMTP_PORT    = $env:SMTP_PORT
    FROM_EMAIL   = $env:FROM_EMAIL
    TO_EMAIL     = $env:TO_EMAIL
  }

  $job = Start-Job -ScriptBlock {
    param($dir, $file, $vars)
    Set-Location $dir
    foreach ($k in $vars.Keys) {
      [System.Environment]::SetEnvironmentVariable($k, $vars[$k], 'Process')
    }
    npx playwright test $file --project=chromium 2>&1
  } -ArgumentList $PWD, $testFile, $envVars

  $jobs += [PSCustomObject]@{ State = $state; Job = $job; StartTime = Get-Date }
  $active++

  Write-Host "  $state launched (job $($job.Id))" -ForegroundColor Green

  # Stagger: wait before launching next state (unless this is the last one)
  if ($state -ne $stateList[-1]) {
    Write-Host "  Waiting ${StaggerSeconds}s before next state..." -ForegroundColor Gray
    Start-Sleep -Seconds $StaggerSeconds
  }
}

# ── Step 4: Wait for all jobs to complete ────────────────────────────────────
Write-Host ""
Write-Host "All states launched - waiting for completion..." -ForegroundColor Cyan

$results = @{}
foreach ($entry in $jobs) {
  Write-Host "Waiting for $($entry.State)..." -ForegroundColor Gray
  $output = $entry.Job | Wait-Job | Receive-Job
  $exitOk = $entry.Job.State -eq 'Completed'
  $icon   = if ($exitOk) { "OK" } else { "FAIL" }
  Write-Host "  [$icon] $($entry.State): $($entry.Job.State)" -ForegroundColor $(if ($exitOk) { 'Green' } else { 'Red' })

  # Print last few lines of output for quick diagnosis
  $lines = ($output | Out-String).Trim().Split("`n")
  $tail  = $lines | Select-Object -Last 5
  foreach ($line in $tail) { Write-Host "    $line" -ForegroundColor Gray }

  $results[$entry.State] = $exitOk
}

# ── Step 5: Remove batch marker ───────────────────────────────────────────────
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
Write-Host ""
Write-Host "All states complete. Sending consolidated email..." -ForegroundColor Cyan

# ── Step 6: Send ONE consolidated email via Node ─────────────────────────────
$sendScript = @"
require('dotenv').config();
const { EmailReporter } = require('./emailReporter');
// Pass the specific iteration file for this suite
EmailReporter.sendBatchEmailReport(
  ['iterations-data-$suiteLabel.json'],
  'WB $TestType Smoke Test Report'
).then(() => {
  console.log('Consolidated email sent');
  process.exit(0);
}).catch(err => {
  console.error('Email failed:', err.message);
  process.exit(1);
});
"@

$sendScript | node --input-type=commonjs
if ($LASTEXITCODE -eq 0) {
  Write-Host "Consolidated email sent successfully" -ForegroundColor Green
} else {
  Write-Host "Email send failed - check SMTP settings" -ForegroundColor Red
}

# ── Step 7: Print summary ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FINAL SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
foreach ($state in $stateList) {
  $ok   = $results[$state]
  $icon = if ($ok) { "PASS" } else { "FAIL" }
  $col  = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $state" -ForegroundColor $col
}
Write-Host ""
