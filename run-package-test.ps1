param(
    [string]$TestEnv = "qa",
    [string]$States = "",
    [switch]$Headed
)

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectPath

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Package Test Runner" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Set environment
if ([string]::IsNullOrEmpty($TestEnv)) { $TestEnv = "qa" }
Write-Host "Environment: $TestEnv" -ForegroundColor Yellow

# Set states
if ([string]::IsNullOrEmpty($States)) { $States = "DE,PA,WI,OH,MI,AZ,CO,IL,IA,NC,SC,NE,NM,SD,TX,UT,IN,TN,VA" }
Write-Host "States: $States" -ForegroundColor Yellow

# Show mode
if ($Headed) {
    Write-Host "Mode: HEADED" -ForegroundColor Green
} else {
    Write-Host "Mode: HEADLESS" -ForegroundColor Gray
}
Write-Host "`n"

# Create batch marker to defer emails
'{"inBatch": true}' | Out-File -FilePath '.batch-run-in-progress' -Force -Encoding ASCII

# Clean up old iterations for PACKAGE tests
if (Test-Path 'iterations-data-package.json') { Remove-Item 'iterations-data-package.json' -Force }
if (Test-Path '.batch-email-sent') { Remove-Item '.batch-email-sent' -Force }
# Also clean up any stale lock files and test data files from previous runs
Remove-Item -Force 'parallel-run-lock-package.json' -ErrorAction SilentlyContinue
Remove-Item -Force 'test-data-*.json' -ErrorAction SilentlyContinue

# Call parallel PowerShell runner with proper switch handling
$args = @(
    '-ExecutionPolicy', 'Bypass',
    '-File', "$projectPath\run-parallel-package.ps1",
    '-TestEnv', $TestEnv,
    '-States', $States,
    '-Project', 'chromium',
    '-KillStrays'
)
if ($Headed) { $args += '-Headed' }

& powershell.exe @args

Pop-Location
