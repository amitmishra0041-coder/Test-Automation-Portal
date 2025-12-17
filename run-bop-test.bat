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

setlocal enabledelayedexpansion

REM Usage: run-bop-test.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

echo Running BOP Test in Chromium (headed mode) for ALL states in PARALLEL...
echo.
echo Starting 5 parallel test workers for: DE, PA, WI, OH, MI
echo.

REM Launch all states in parallel using separate command windows
start "DE Test" cmd /C "set TEST_STATE=DE& set TEST_ENV=%ENV%& npx playwright test Create_BOP.test.js --project=chromium"
start "PA Test" cmd /C "set TEST_STATE=PA& set TEST_ENV=%ENV%& npx playwright test Create_BOP.test.js --project=chromium"
start "WI Test" cmd /C "set TEST_STATE=WI& set TEST_ENV=%ENV%& npx playwright test Create_BOP.test.js --project=chromium"
start "OH Test" cmd /C "set TEST_STATE=OH& set TEST_ENV=%ENV%& npx playwright test Create_BOP.test.js --project=chromium"
start "MI Test" cmd /C "set TEST_STATE=MI& set TEST_ENV=%ENV%& npx playwright test Create_BOP.test.js --project=chromium"

echo.
echo ========================================
echo All 5 parallel test workers started!
echo ========================================
echo.
echo Each state runs in its own browser window:
echo   - DE (Delaware)
echo   - PA (Pennsylvania)
echo   - WI (Wisconsin)
echo   - OH (Ohio)
echo   - MI (Michigan)
echo.
echo You can monitor each window for progress or errors.
echo Tests will continue to run independently.
echo.
pause
endlocal
