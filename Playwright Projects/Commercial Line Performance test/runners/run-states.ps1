# runners/run-states.ps1
# Consolidated runner - replaces 5 separate PS1 scripts.
# Usage:
#   .\runners\run-states.ps1 -TestType PACKAGE -States DE,PA,MI,WI
#   .\runners\run-states.ps1 -TestType CA -States ALL

param(
  [Parameter(Mandatory)][ValidateSet('PACKAGE','CA')] [string]$TestType,
  [string]$States      = 'DE',
  [int]$MaxParallel    = 2,
  [int]$StaggerSeconds = 60,
  [string]$Env         = 'qa'
)

if (Test-Path ".env") {
  Get-Content ".env" | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
    $p = $_ -split '=', 2
    [System.Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
  }
  Write-Host "Loaded .env"
}

$stateList = if ($States -eq 'ALL') { @('DE','PA','MI','WI') } else { $States -split ',' | ForEach-Object { $_.Trim().ToUpper() } }
$testFile  = if ($TestType -eq 'PACKAGE') { 'Create_Package.test.js' } else { 'Create_CA.test.js' }

Write-Host "Running $TestType for states: $($stateList -join ', ')"

$jobs = @()
$running = 0

foreach ($state in $stateList) {
  if ($running -ge $MaxParallel) {
    Write-Host "Waiting ${StaggerSeconds}s before next launch..."
    Start-Sleep -Seconds $StaggerSeconds
  }
  Write-Host "Starting $state..."
  $job = Start-Job -ScriptBlock {
    param($s, $f, $e, $t)
    $env:TEST_STATE = $s
    $env:TEST_ENV   = $e
    $env:TEST_TYPE  = $t
    Set-Location $using:PWD
    npx playwright test $f --project=chromium 2>&1
  } -ArgumentList $state, $testFile, $Env, $TestType
  $jobs += [PSCustomObject]@{ State = $state; Job = $job }
  $running++
}

$jobs | ForEach-Object {
  $_.Job | Wait-Job | Out-Null
  $icon = if ($_.Job.State -eq 'Completed') { 'DONE' } else { 'FAILED' }
  Write-Host "$icon $($_.State): $($_.Job.State)"
}
Write-Host "All states complete."
