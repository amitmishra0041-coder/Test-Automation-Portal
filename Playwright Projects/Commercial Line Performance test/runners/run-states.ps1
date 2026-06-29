# runners/run-states.ps1
# Uses cmd.exe to launch tests - same approach as the original working runner
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

$suiteLabel   = $TestType.ToLower()
$projectPath  = $PWD.Path
$batchMarker  = Join-Path $projectPath ".batch-run-in-progress-$suiteLabel"
$iterFile     = Join-Path $projectPath "iterations-data-$suiteLabel.json"
$lockFile     = Join-Path $projectPath "parallel-run-lock-$suiteLabel.json"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $TestType | States: $($stateList -join ', ')" -ForegroundColor Cyan
Write-Host "  Max Parallel: $MaxParallel | Stagger: ${StaggerSeconds}s | Headed: $(-not $Headless)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Clean up previous run
if (Test-Path $iterFile)    { Remove-Item $iterFile    -Force }
if (Test-Path $batchMarker) { Remove-Item $batchMarker -Force }
if (Test-Path $lockFile)    { Remove-Item $lockFile    -Force }

# Create batch marker BEFORE launching any state
"batch-in-progress" | Set-Content $batchMarker -Encoding UTF8
Write-Host "Batch marker created - per-state emails suppressed" -ForegroundColor Gray

# Headed flag
$headedFlag = if ($Headless) { "" } else { "--headed" }

# Track active processes
$activeProcs   = [System.Collections.ArrayList]@()
$results       = @{}
$lastStartTime = $null

$pendingStates = [System.Collections.ArrayList]@($stateList)

while ($pendingStates.Count -gt 0 -or $activeProcs.Count -gt 0) {

  # Check for finished processes
  $stillRunning = [System.Collections.ArrayList]@()
  foreach ($entry in $activeProcs) {
    if (-not $entry.Process.HasExited) {
      $null = $stillRunning.Add($entry)
    } else {
      $exitCode            = $entry.Process.ExitCode
      $passed              = ($exitCode -eq 0)
      $results[$entry.State] = $passed
      $icon  = if ($passed) { "PASS" } else { "FAIL" }
      $color = if ($passed) { 'Green' } else { 'Red' }
      Write-Host "  [$icon] $($entry.State) finished: exit=$exitCode" -ForegroundColor $color
    }
  }
  $activeProcs = $stillRunning

  # Launch next state if slot available and stagger elapsed
  $canLaunch = ($activeProcs.Count -lt $MaxParallel) -and ($pendingStates.Count -gt 0)

  $staggerOk = $true
  if ($lastStartTime -and $StaggerSeconds -gt 0) {
    $elapsed = [int]([DateTime]::Now - $lastStartTime).TotalSeconds
    if ($elapsed -lt $StaggerSeconds) {
      $staggerOk = $false
      if ($canLaunch) {
        $remaining = $StaggerSeconds - $elapsed
        Write-Host "  Stagger: waiting ${remaining}s..." -ForegroundColor Gray
      }
    }
  }

  if ($canLaunch -and $staggerOk) {
    $state = $pendingStates[0]
    $pendingStates.RemoveAt(0)

    Write-Host "Starting $state ($TestType)..." -ForegroundColor Yellow

    # Build cmd command exactly like the original working runner
    # Use set to pass env vars inline - cmd handles $ in values correctly
    $outDir  = "test-results\$suiteLabel-$state"

    # Get state-specific credentials
    $wbUser = [System.Environment]::GetEnvironmentVariable("WB_USER_$state")
    $wbPass = [System.Environment]::GetEnvironmentVariable("WB_PASS_$state")
    if (-not $wbUser) { $wbUser = $env:WB_USER_DE }
    if (-not $wbPass) { $wbPass = $env:WB_PASS_DE }

    $envCmd = 'set "TEST_STATE=' + $state + '" && ' +
              'set "TEST_ENV=' + $Env + '" && ' +
              'set "TEST_TYPE=' + $TestType + '" && ' +
              'set "WB_USER_' + $state + '=' + $wbUser + '" && ' +
              'set "WB_PASS_' + $state + '=' + $wbPass + '" && ' +
              'set "WB_USER_DE=' + $env:WB_USER_DE + '" && ' +
              'set "WB_PASS_DE=' + $env:WB_PASS_DE + '" && ' +
              'set "WB_USER_PA=' + $env:WB_USER_PA + '" && ' +
              'set "WB_PASS_PA=' + $env:WB_PASS_PA + '" && ' +
              'set "WB_USER_MI=' + $env:WB_USER_MI + '" && ' +
              'set "WB_PASS_MI=' + $env:WB_PASS_MI + '" && ' +
              'set "WB_USER_WI=' + $env:WB_USER_WI + '" && ' +
              'set "WB_PASS_WI=' + $env:WB_PASS_WI + '" && ' +
              'set "SMTP_HOST=' + $env:SMTP_HOST + '" && ' +
              'set "SMTP_PORT=' + $env:SMTP_PORT + '" && ' +
              'set "FROM_EMAIL=' + $env:FROM_EMAIL + '" && ' +
              'set "TO_EMAIL=' + $env:TO_EMAIL + '" && ' +
              'npx playwright test "' + $testFile + '" --project=chromium --workers=1 ' + $headedFlag

    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @('/c', $envCmd) `
      -WorkingDirectory $projectPath `
      -WindowStyle Normal `
      -PassThru

    $null = $activeProcs.Add([PSCustomObject]@{
      State     = $state
      Process   = $proc
      StartTime = [DateTime]::Now
    })

    $lastStartTime = [DateTime]::Now
    Write-Host "  $state launched (PID $($proc.Id))" -ForegroundColor Green
  }

  Start-Sleep -Seconds 5
}

# Remove batch marker
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

# Final summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FINAL SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allPassed = $true
$passed    = 0
$failed    = 0
foreach ($state in $stateList) {
  $ok    = $results[$state]
  $icon  = if ($ok) { "PASS" } else { "FAIL" }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "  [$icon] $state" -ForegroundColor $color
  if ($ok) { $passed++ } else { $failed++; $allPassed = $false }
}
Write-Host ""
Write-Host "  Total: $($stateList.Count) | Passed: $passed | Failed: $failed" -ForegroundColor Cyan
Write-Host ""
if ($allPassed) { Write-Host "  All states passed!" -ForegroundColor Green }
else            { Write-Host "  Some states failed" -ForegroundColor Red }
Write-Host ""
