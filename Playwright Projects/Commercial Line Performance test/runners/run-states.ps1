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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s | Headed: $(-not $Headless)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# Build playwright args
$pwArgs = @('playwright', 'test', $testFile, '--project=chromium')
if (-not $Headless) { $pwArgs += '--headed' }

# Collect all env vars to pass into jobs
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

$jobs = [System.Collections.ArrayList]@()

foreach ($state in $stateList) {

  # Wait for a free slot
  while ($true) {
    $running = ($jobs | Where-Object { $_.Job.State -eq 'Running' }).Count
    if ($running -lt $MaxParallel) { break }
    Write-Host "  Max parallel ($MaxParallel) reached - checking in 10s..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
  }

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  $job = Start-Job -ScriptBlock {
    param($dir, $pwArgs, $state, $vars, $headed)
    Set-Location $dir

    foreach ($k in $vars.Keys) {
      [System.Environment]::SetEnvironmentVariable($k, $vars[$k], 'Process')
    }
    $env:TEST_STATE = $state

    # When headed, use Start-Process so a real visible window opens
    if ($headed) {
      # Write a small launcher script so the browser window gets its own console
      $launchScript = "cd '$dir'; `$env:TEST_STATE='$state';"
      foreach ($k in $vars.Keys) {
        if ($vars[$k]) { $launchScript += "`$env:$k='$($vars[$k])';" }
      }
      $launchScript += "npx $($pwArgs -join ' '); exit `$LASTEXITCODE"

      $proc = Start-Process powershell.exe `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$launchScript`"" `
        -PassThru `
        -WindowStyle Normal

      $proc.WaitForExit()
      $exitCode = $proc.ExitCode
      return @{ output = "State $state completed"; exitCode = $exitCode; state = $state }
    } else {
      $output   = & npx @pwArgs 2>&1
      $exitCode = $LASTEXITCODE
      return @{ output = ($output -join "`n"); exitCode = $exitCode; state = $state }
    }
  } -ArgumentList $PWD, $pwArgs, $state, $envVars, (-not $Headless)

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

  $jobResult = $entry.Job | Wait-Job | Receive-Job

  $exitCode = 0
  $output   = ""

  if ($jobResult -is [hashtable]) {
    $exitCode = [int]($jobResult.exitCode)
    $output   = $jobResult.output
  } else {
    $output = $jobResult | Out-String
    if ($output -match '(\d+) failed' -and [int]$Matches[1] -gt 0) { $exitCode = 1 }
    elseif ($output -match 'Error:|FAILED') { $exitCode = 1 }
  }

  $passed            = ($exitCode -eq 0)
  $results[$entry.State] = $passed

  $icon  = if ($passed) { "PASS" } else { "FAIL" }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $($entry.State): exit=$exitCode" -ForegroundColor $color

  if ($output) {
    $lines = $output.Split("`n") | Where-Object { $_.Trim() }
    $tail  = $lines | Select-Object -Last 6
    foreach ($line in $tail) { Write-Host "    $line" -ForegroundColor Gray }
  }
  Write-Host ""
}

# Remove batch marker and send email
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }

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
else            { Write-Host "  Some states failed - check above" -ForegroundColor Red }
Write-Host ""
