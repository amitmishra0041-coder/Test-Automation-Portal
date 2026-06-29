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

if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }
if (Test-Path $tmpDir)      { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

$headedFlag = if ($Headless) { "" } else { "--headed" }

# Snapshot env vars NOW (before jobs start)
# Use literal string values — no interpolation issues
$envSnapshot = @{
  TEST_ENV   = [string]$Env
  TEST_TYPE  = [string]$TestType
  WB_USER_DE = [string]$env:WB_USER_DE
  WB_PASS_DE = [string]$env:WB_PASS_DE
  WB_USER_PA = [string]$env:WB_USER_PA
  WB_PASS_PA = [string]$env:WB_PASS_PA
  WB_USER_MI = [string]$env:WB_USER_MI
  WB_PASS_MI = [string]$env:WB_PASS_MI
  WB_USER_WI = [string]$env:WB_USER_WI
  WB_PASS_WI = [string]$env:WB_PASS_WI
  SMTP_HOST  = [string]$env:SMTP_HOST
  SMTP_PORT  = [string]$env:SMTP_PORT
  FROM_EMAIL = [string]$env:FROM_EMAIL
  TO_EMAIL   = [string]$env:TO_EMAIL
}

$procs = [System.Collections.ArrayList]@()

foreach ($state in $stateList) {

  # Wait for a free slot
  while ($true) {
    $running = @($procs | Where-Object { -not $_.Process.HasExited }).Count
    if ($running -lt $MaxParallel) { break }
    Write-Host "  Max parallel ($MaxParallel) reached - checking in 10s..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
  }

  Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

  # Write temp .env file for this state - avoids ALL escaping issues
  # Each state gets its own .env file with its credentials
  $stateEnvFile = Join-Path $tmpDir "env-$state.env"
  $stateEnvContent = @()
  $stateEnvContent += "TEST_STATE=$state"
  foreach ($k in $envSnapshot.Keys) {
    if ($envSnapshot[$k]) {
      $stateEnvContent += "$k=$($envSnapshot[$k])"
    }
  }
  $stateEnvContent | Set-Content $stateEnvFile -Encoding UTF8

  # Write launcher script that loads env from file - no variable expansion issues
  $scriptPath = Join-Path $tmpDir "run-$state.ps1"
  $pwdEscaped = $PWD.Path.Replace("'", "''")
  $testFileEscaped = $testFile.Replace("'", "''")
  $envFileEscaped = $stateEnvFile.Replace("'", "''")

  $scriptContent = @"
Set-Location '$pwdEscaped'
Write-Host 'Starting $state ($TestType)...' -ForegroundColor Yellow
Write-Host 'Working directory: ' (Get-Location)
Write-Host 'Test file: $testFileEscaped'

# Load env vars from state-specific env file (avoids dollar sign escaping issues)
Get-Content '$envFileEscaped' | Where-Object { `$_ -match '^\s*[^#].*=.*' } | ForEach-Object {
  `$p = `$_ -split '=', 2
  [System.Environment]::SetEnvironmentVariable(`$p[0].Trim(), `$p[1].Trim(), 'Process')
}

Write-Host "TEST_STATE=`$env:TEST_STATE TEST_ENV=`$env:TEST_ENV TEST_TYPE=`$env:TEST_TYPE"

npx playwright test '$testFileEscaped' --project=chromium $headedFlag
`$exitCode = `$LASTEXITCODE
Write-Host ''
Write-Host '$state completed - exit code: ' `$exitCode -ForegroundColor `$(if (`$exitCode -eq 0) { 'Green' } else { 'Red' })
Write-Host 'Press any key to close this window...'
pause
"@

  $scriptContent | Set-Content $scriptPath -Encoding UTF8

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

  if ($state -ne $stateList[-1]) {
    Write-Host "  Waiting ${StaggerSeconds}s before next launch..." -ForegroundColor Gray
    Start-Sleep -Seconds $StaggerSeconds
  }
}

# Wait for all processes
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

# Cleanup
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }

# Consolidated email
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

# Summary
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
