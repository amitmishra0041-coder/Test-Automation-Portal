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

# Write one .env file per state using WriteAllLines (no $ interpretation)
foreach ($state in $stateList) {
  $lines = [System.Collections.Generic.List[string]]@()
  $lines.Add("TEST_STATE=$state")
  $lines.Add("TEST_ENV=$Env")
  $lines.Add("TEST_TYPE=$TestType")
  $lines.Add("WB_USER_DE=$env:WB_USER_DE")
  $lines.Add("WB_PASS_DE=$env:WB_PASS_DE")
  $lines.Add("WB_USER_PA=$env:WB_USER_PA")
  $lines.Add("WB_PASS_PA=$env:WB_PASS_PA")
  $lines.Add("WB_USER_MI=$env:WB_USER_MI")
  $lines.Add("WB_PASS_MI=$env:WB_PASS_MI")
  $lines.Add("WB_USER_WI=$env:WB_USER_WI")
  $lines.Add("WB_PASS_WI=$env:WB_PASS_WI")
  $lines.Add("SMTP_HOST=$env:SMTP_HOST")
  $lines.Add("SMTP_PORT=$env:SMTP_PORT")
  $lines.Add("FROM_EMAIL=$env:FROM_EMAIL")
  $lines.Add("TO_EMAIL=$env:TO_EMAIL")
  [System.IO.File]::WriteAllLines((Join-Path $tmpDir "env-$state.env"), $lines)
}

# Write one launcher .ps1 per state
# KEY FIX: script reads its own env file — no inline variable expansion
foreach ($state in $stateList) {
  $envFile  = Join-Path $tmpDir "env-$state.env"
  $lines    = [System.Collections.Generic.List[string]]@()
  $lines.Add('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
  $lines.Add("Set-Location '" + $PWD.Path.Replace("'","''") + "'")
  $lines.Add('Get-Content "' + $envFile.Replace('"','""') + '" | Where-Object { $_ -match "^\s*[^#].*=.*" } | ForEach-Object {')
  $lines.Add('  $p = $_ -split "=", 2')
  $lines.Add('  if ($p.Count -eq 2) { [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), "Process") }')
  $lines.Add('}')
  $lines.Add('Write-Host "=== ' + $state + ' ($TypeType) ===" -ForegroundColor Cyan')
  $lines.Add('Write-Host "Dir: $(Get-Location)"')
  $lines.Add('Write-Host "State: $env:TEST_STATE | Type: $env:TEST_TYPE | Env: $env:TEST_ENV"')
  $lines.Add('Write-Host ""')
  if ($headedFlag) {
    $lines.Add('npx playwright test "' + $testFile + '" --project=chromium ' + $headedFlag)
  } else {
    $lines.Add('npx playwright test "' + $testFile + '" --project=chromium')
  }
  $lines.Add('$exitCode = $LASTEXITCODE')
  $lines.Add('Write-Host ""')
  $lines.Add('if ($exitCode -eq 0) { Write-Host "' + $state + ' PASSED" -ForegroundColor Green }')
  $lines.Add('else { Write-Host "' + $state + ' FAILED (exit $exitCode)" -ForegroundColor Red }')
  $lines.Add('Write-Host "Press any key to close..."')
  $lines.Add('pause')
  $scriptPath = Join-Path $tmpDir "run-$state.ps1"
  [System.IO.File]::WriteAllLines($scriptPath, $lines)
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

  $scriptPath = Join-Path $tmpDir "run-$state.ps1"

  # Launch with Start-Process using -File and quoting via array args
  # This correctly handles spaces in the path
  $proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $scriptPath
    ) `
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

# Wait for all
Write-Host ""
Write-Host "All states launched - waiting for completion..." -ForegroundColor Cyan
Write-Host ""

$results = @{}

foreach ($entry in $procs) {
  Write-Host "Waiting for $($entry.State) (PID $($entry.Process.Id))..." -ForegroundColor Gray
  $entry.Process.WaitForExit()
  $exitCode          = $entry.Process.ExitCode
  $passed            = ($exitCode -eq 0)
  $results[$entry.State] = $passed
  $icon  = if ($passed) { "PASS" } else { "FAIL" }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $($entry.State): exit=$exitCode" -ForegroundColor $color
  Write-Host ""
}

# Cleanup tmp dir
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
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
