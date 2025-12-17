@echo off
echo ========================================
echo BOP Test Runner - Parallel Execution
echo ========================================
echo.

REM Change to project directory
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
if errorlevel 1 (
    echo ERROR: Failed to change directory
    pause
    exit /b 1
)

echo Current directory: %CD%
echo.

REM Check if node is available
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js or add it to your PATH
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.

REM Usage: run-bop-test.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

echo Running BOP Test in Chromium (headless mode) for ALL states in PARALLEL...
echo.
echo Starting 5 parallel test workers for: DE, PA, WI, OH, MI
echo.

REM Use PowerShell to run tests in parallel within same terminal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:TEST_ENV='%ENV%'; $states = @('DE', 'PA', 'WI', 'OH', 'MI'); $jobs = @(); foreach ($state in $states) { Write-Host \"Starting test for state: $state\" -ForegroundColor Cyan; $jobs += Start-Job -ScriptBlock { param($s, $e); $env:TEST_STATE = $s; $env:TEST_ENV = $e; $output = & npx playwright test Create_BOP.test.js --project=chromium 2>&1; return @{State=$s; Output=$output; ExitCode=$LASTEXITCODE}; } -ArgumentList $state, $env:TEST_ENV; }; Write-Host \"`nAll 5 tests started in parallel. Waiting for completion...`n\" -ForegroundColor Green; $results = $jobs | Wait-Job | Receive-Job; $jobs | Remove-Job; Write-Host \"`n========================================\" -ForegroundColor Yellow; Write-Host \"TEST RESULTS SUMMARY\" -ForegroundColor Yellow; Write-Host \"========================================`n\" -ForegroundColor Yellow; $passed = 0; $failed = 0; foreach ($r in $results) { if ($r.ExitCode -eq 0) { Write-Host \"[$($r.State)] PASSED\" -ForegroundColor Green; $passed++; } else { Write-Host \"[$($r.State)] FAILED\" -ForegroundColor Red; $failed++; } }; Write-Host \"`nTotal: $($results.Count) | Passed: $passed | Failed: $failed`n\" -ForegroundColor Cyan; exit $(if ($failed -gt 0) {1} else {0})"

echo.
pause
