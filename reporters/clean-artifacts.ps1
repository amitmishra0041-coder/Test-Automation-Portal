param(
    [switch]$DryRun
)

# Windows PowerShell 5.1 compatible cleanup script for test artifacts
$ErrorActionPreference = 'SilentlyContinue'

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectPath

Write-Host "`nTest-Automation-Portal cleanup" -ForegroundColor Cyan
Write-Host "Path: $projectPath" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "Mode: DRY RUN (no deletions)" -ForegroundColor Yellow }
Write-Host "" 

function Remove-Targets {
    param(
        [string[]]$Targets,
        [switch]$Recurse
    )
    foreach ($t in $Targets) {
        $items = Get-ChildItem -LiteralPath $t -Force -ErrorAction SilentlyContinue
        if (-not $items) {
            # Try wildcard search if literal not found
            $items = Get-ChildItem $t -Force -ErrorAction SilentlyContinue
        }
        if ($items) {
            foreach ($i in $items) {
                $path = $i.FullName
                if ($DryRun) {
                    Write-Host "Would remove: $path" -ForegroundColor Yellow
                } else {
                    if ($Recurse) {
                        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
                    } else {
                        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
                    }
                    Write-Host "Removed: $path" -ForegroundColor DarkYellow
                }
            }
        } else {
            Write-Host "Skip (not found): $t" -ForegroundColor DarkGray
        }
    }
}

# Files (wildcards supported)
$files = @(
    '.\test-run-output-*.txt',
    '.\test-run-output-package-*.txt',
    '.\iterations-data-bop.json',
    '.\iterations-data-package.json',
    '.\\.batch-run-in-progress',
    '.\\.batch-email-sent',
    '.\parallel-run-lock-bop.json',
    '.\parallel-run-lock-package.json',
    '.\test-data.json'
)
Remove-Targets -Targets $files

# Directories
$dirs = @(
    '.\test-results',
    '.\trace-unzip'
)
Remove-Targets -Targets $dirs -Recurse

Write-Host "" 
Write-Host "Cleanup complete." -ForegroundColor Green

Pop-Location
exit 0
