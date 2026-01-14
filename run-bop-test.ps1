param(
    [string]$TestEnv = "qa",
    [string]$States = "",
    [switch]$Headed
)

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectPath

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BOP Test Runner" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Set environment
if ([string]::IsNullOrEmpty($TestEnv)) { $TestEnv = "qa" }
Write-Host "Environment: $TestEnv" -ForegroundColor Yellow

# Set states (default to all 19 BOP states)
if ([string]::IsNullOrEmpty($States)) {
    $States = "DE,PA,WI,OH,MI,AZ,CO,IL,IA,NC,SC,NE,NM,SD,TX,UT,IN,TN,VA"
}
Write-Host "States: $States" -ForegroundColor Yellow

# Show mode
if ($Headed) {
    Write-Host "Mode: HEADED" -ForegroundColor Green
} else {
    Write-Host "Mode: HEADLESS" -ForegroundColor Gray
}
Write-Host "`n"

# Call parallel PowerShell runner with proper switch handling
$args = @(
    '-ExecutionPolicy', 'Bypass',
    '-File', "$projectPath\run-parallel-bop.ps1",
    '-TestEnv', $TestEnv,
    '-States', $States,
    '-Project', 'chromium',
    '-KillStrays'
)
if ($Headed) { $args += '-Headed' }

& powershell.exe @args

Pop-Location
