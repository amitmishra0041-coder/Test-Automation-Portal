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

setlocal enabledelayedexpansion

REM Usage: run-bop-test.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

echo Running BOP Test in Chromium (headed mode) for all states...
echo.
for %%S in (DE PA WI OH MI) do (
    set "TEST_STATE=%%S"
    set "TEST_ENV=%ENV%"
    echo ===== State: !TEST_STATE! (ENV=!TEST_ENV!) =====
    npx playwright test Create_BOP.test.js --headed --project=chromium || goto :error
)

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
echo BOP tests completed for all states.
pause
goto :eof

:error
echo.
echo BOP test failed for state %TEST_STATE% (ENV=%ENV%).
exit /b 1
