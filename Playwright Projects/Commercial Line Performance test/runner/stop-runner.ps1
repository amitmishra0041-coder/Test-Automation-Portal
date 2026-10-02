# Stops the Playwright Test Runner server started by start-runner.ps1/.bat.
# Needed because the server now runs fully hidden (no console window to close).

$ErrorActionPreference = 'SilentlyContinue'

$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'runner[\\/]server\.js' -or $_.CommandLine -match 'npm-cli\.js.*run.*runner' }

if (-not $procs) {
    Write-Host "Playwright Test Runner is not running."
    exit 0
}

foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force
}
Write-Host "Playwright Test Runner stopped."
