@echo off
echo ========================================
echo BOP Test Runner
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

echo Running BOP Test in Chromium (headed mode)...
echo.
$states = @('PA', 'DE', 'MD', 'OH', 'MI')
foreach ($state in $states) {
    Start-Job -ScriptBlock {
        $env:TEST_STATE = $using:state
        Write-Host "Running tests for state: $using:state"
        npx playwright test Create_BOP.test.js --headed --project=chromium
    }
}

if errorlevel 1 (
    echo.
    echo ========================================
    echo TEST FAILED!
    echo ========================================
) else (
    echo.
    echo ========================================
    echo TEST PASSED!
    echo ========================================
)

echo.
pause
