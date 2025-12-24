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
if ([string]::IsNullOrEmpty($States)) { $States = "DE,PA,WI,OH,MI" }
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

# Clean up old iterations
if (Test-Path 'iterations-data-bop.json') { Remove-Item 'iterations-data-bop.json' -Force }
if (Test-Path '.batch-email-sent') { Remove-Item '.batch-email-sent' -Force }

# Call parallel PowerShell runner
$headedArg = if ($Headed) { "-Headed" } else { "" }
& powershell.exe -ExecutionPolicy Bypass -File "$projectPath\run-parallel-package.ps1" -TestEnv $TestEnv -States $States -Project chromium -KillStrays $headedArg

Pop-Location
