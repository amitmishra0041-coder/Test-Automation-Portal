# cleanup-project.ps1
# Removes stale deploy scripts, old test data, logs, temp files, backups
# Keeps: all active source files, node_modules, .git, address-helper, runners

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

if (-not (Test-Path 'Create_Package.test.js')) {
    Write-Host 'ERROR: Run from Commercial Line Performance test folder' -ForegroundColor Red; exit 1
}

Write-Host 'Cleaning up stale files...' -ForegroundColor Cyan
Write-Host ''

$deleted = 0

function Del($path) {
    if (Test-Path $path) {
        Remove-Item $path -Force -Recurse -ErrorAction SilentlyContinue
        Write-Host "  Deleted: $path" -ForegroundColor Gray
        $script:deleted++
    }
}

# ── Old deploy/fix scripts (superseded by current versions) ──────────────────
Write-Host '--- Stale deploy scripts ---' -ForegroundColor Yellow
$staleScripts = @(
    'cleanup-v3.ps1',
    'deploy-bop.ps1',
    'fix-account-helper-complete.ps1',
    'fix-account-helper.ps1',
    'fix-account-qualification-complete.ps1',
    'fix-account-qualification-v2.ps1',
    'fix-create-package-complete.ps1',
    'fix-email-reporter-v2.ps1',
    'fix-email-runner.ps1',
    'fix-runner-bat.ps1',
    'fix-runner-final.ps1',
    'fix-runner-final2.ps1',
    'fix-runner-headed.ps1',
    'fix-runner-logged.ps1',
    'fix-runner-v3.ps1',
    'fix-runner-v4.ps1',
    'fix-runner-v5.ps1',
    'fix-runner-v6.ps1',
    'fix-runner.ps1',
    'fix-timeout-and-sfa.ps1',
    'run-all-states-headed.ps1',
    'run-ca-all-states.ps1',
    'Run-CA-Sequential.ps1',
    'run-ca-test.ps1',
    'Run-Package-Sequential.ps1',
    'run-package-test.ps1',
    'run-parallel-ca.ps1',
    'run-parallel-package.ps1',
    'update-account-helper-v2.ps1',
    'update-account-helper.ps1',
    'update-bop-account.ps1',
    'update-ca-test.ps1',
    'update-coverage-helper.ps1',
    'update-coverage-v2.ps1',
    'update-coverage-v4.ps1',
    'update-package-test.ps1',
    'update-package-v2.ps1',
    'update-runner.ps1',
    'send-ca-email-optimized.js',
    'send-last-ca-email.ps1'
)
foreach ($f in $staleScripts) { Del $f }

# ── Old .bat files (replaced by runners\run-states.ps1) ──────────────────────
Write-Host ''
Write-Host '--- Old bat files ---' -ForegroundColor Yellow
Del 'run-state-DE.bat'
Del 'run-state-PA.bat'

# ── Stale test-data JSON files for unused states ─────────────────────────────
Write-Host ''
Write-Host '--- Stale test-data for unused states ---' -ForegroundColor Yellow
$activeStates = @('DE', 'PA', 'MI', 'WI')
Get-ChildItem -Filter 'test-data-*.json' | ForEach-Object {
    $state = $_.BaseName -replace 'test-data-', ''
    if ($activeStates -notcontains $state) {
        Del $_.Name
    }
}

# ── Old Excel reports (keep only the most recent) ────────────────────────────
Write-Host ''
Write-Host '--- Old Excel reports ---' -ForegroundColor Yellow
$excelFiles = Get-ChildItem -Filter 'WB_Test_Report*.xlsx' | Sort-Object LastWriteTime -Descending
if ($excelFiles.Count -gt 1) {
    $excelFiles | Select-Object -Skip 1 | ForEach-Object { Del $_.Name }
}
# Delete all fallback reports
Get-ChildItem -Filter 'WB_Test_Report_Fallback*.xlsx' | ForEach-Object { Del $_.Name }

# ── Log files ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '--- Log files ---' -ForegroundColor Yellow
Del 'run-all-states-headed.log'
Del 'test-run.log'
Get-ChildItem 'logs' -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object { Del "logs\$($_.Name)" }

# ── Stale iteration/lock files ────────────────────────────────────────────────
Write-Host ''
Write-Host '--- Stale iteration and lock files ---' -ForegroundColor Yellow
Del 'iterations-data-ca.json'
Del 'iterations-data-package.json'
Del 'parallel-run-lock-package.json'

# ── test-results folder ───────────────────────────────────────────────────────
Write-Host ''
Write-Host '--- Test results ---' -ForegroundColor Yellow
Del 'test-results'

# ── Backup folder ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '--- Backup folder ---' -ForegroundColor Yellow
Del '_BACKUP_20260628_140656'

Write-Host ''
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deleted $deleted item(s)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ''

# ── Git commit ────────────────────────────────────────────────────────────────
Write-Host 'Committing cleanup to git...' -ForegroundColor Yellow
git add -A
git commit -m "Cleanup: remove stale deploy scripts, old test data, logs, backups, test-results"
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host 'Cleanup pushed to GitHub.' -ForegroundColor Green
} else {
    Write-Host 'Push failed - cleanup applied locally only.' -ForegroundColor Red
}
