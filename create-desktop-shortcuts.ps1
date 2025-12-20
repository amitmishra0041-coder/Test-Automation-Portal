# PowerShell script to create desktop shortcuts for test runners
$desktopPath = [Environment]::GetFolderPath("Desktop")
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`nCreating Desktop Shortcuts..." -ForegroundColor Cyan
Write-Host "Desktop Path: $desktopPath`n" -ForegroundColor Yellow

# Create Package Test Runner shortcut
$packageShortcut = "$desktopPath\Package Test Runner (All States).lnk"
$packageBat = Join-Path $scriptDir "run-package-test.bat"

$WScriptShell = New-Object -ComObject WScript.Shell
$shortcut = $WScriptShell.CreateShortcut($packageShortcut)
$shortcut.TargetPath = $packageBat
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "Run Package tests for all 5 states in parallel"
$shortcut.IconLocation = "C:\Windows\System32\shell32.dll,165"
$shortcut.Save()

Write-Host "Created: Package Test Runner (All States)" -ForegroundColor Green
Write-Host "  Location: $packageShortcut" -ForegroundColor Gray

# Create BOP Test Runner shortcut
$bopShortcut = "$desktopPath\BOP Test Runner (All States).lnk"
$bopBat = Join-Path $scriptDir "run-bop-test.bat"

$shortcut = $WScriptShell.CreateShortcut($bopShortcut)
$shortcut.TargetPath = $bopBat
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "Run BOP tests for all 5 states in parallel"
$shortcut.IconLocation = "C:\Windows\System32\shell32.dll,165"
$shortcut.Save()

Write-Host "Created: BOP Test Runner (All States)" -ForegroundColor Green
Write-Host "  Location: $bopShortcut" -ForegroundColor Gray

Write-Host "`nAll shortcuts created successfully!" -ForegroundColor Green
Write-Host "`nUsage:" -ForegroundColor Cyan
Write-Host "  - Double-click shortcuts to run tests" -ForegroundColor Gray
Write-Host "  - Tests will run for all 5 states: DE, PA, WI, OH, MI" -ForegroundColor Gray
Write-Host "  - Combined email report sent after completion`n" -ForegroundColor Gray

[System.Runtime.Interopservices.Marshal]::ReleaseComObject($WScriptShell) | Out-Null
