# runners/run-daily-all.ps1
# Runs Package, CA, and BOP suites sequentially, headless. Intended to be invoked
# by a Windows Task Scheduler job (daily, 8 AM) with no arguments.
# Defaults to Training (per QA lead, 2026-10-19: the daily run no longer needs QA).
# Training's producer is only licensed in DE/PA/MI of our four states - WI is
# skipped by the tests there - so the default state list leaves WI out.
# For QA: -Env qa -States ALL
param(
  [string]$Env    = 'training',
  [string]$States = 'DE,PA,MI'
)

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# Clear every previous run's logs before this run starts - run-states.ps1
# (called below) already deletes each state's own log right before
# rewriting it, but that only clears the specific file about to be reused
# and leaves anything one-off (a stale diagnostic log, an old dated
# daily-run-*.log) sitting around forever. This is the one place all three
# suites funnel through once a day, so it's the right spot for a wholesale
# sweep - done first, before today's own summary log below is created, so
# it never wipes out what it just wrote. Only this env's own prior logs are
# cleared (env is now part of every log's filename below) so running two
# envs back to back the same day doesn't wipe out the first one's results.
Get-ChildItem -Path $logsDir -Filter "*-$Env.log" -ErrorAction SilentlyContinue | Remove-Item -Force

$summaryLog = Join-Path $logsDir ("daily-run-$Env-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
"Daily run started ($Env): $(Get-Date -Format o)" | Out-File $summaryLog -Encoding UTF8

foreach ($type in @('PACKAGE', 'CA', 'BOP')) {
  "=== Starting $type ($Env) ===" | Tee-Object -FilePath $summaryLog -Append | Write-Host
  & (Join-Path $PSScriptRoot "run-states.ps1") -TestType $type -States $States -Env $Env -Headless
  "=== Finished $type ($Env, exit=$LASTEXITCODE) ===" | Tee-Object -FilePath $summaryLog -Append | Write-Host
}

"Daily run finished ($Env): $(Get-Date -Format o)" | Out-File $summaryLog -Append -Encoding UTF8
