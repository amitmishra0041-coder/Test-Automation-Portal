@echo off
setlocal enabledelayedexpansion
echo ========================================
echo Run BOP Test Then Package Test
echo ========================================
echo.

cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"

REM Run BOP test
echo.
echo [1/2] Running BOP Test...
echo ========================================
call npx playwright test Create_BOP.test.js --project=chromium --headed

REM Check if BOP test passed
if errorlevel 1 (
    echo BOP test failed
) else (
    echo BOP test completed
)

REM Run Package test
echo.
echo [2/2] Running Package Test...
echo ========================================
call npx playwright test Create_Package.test.js --project=chromium --headed

REM Check if Package test passed
if errorlevel 1 (
    echo Package test failed
) else (
    echo Package test completed
)

echo.
echo ========================================
echo Both tests completed!
echo ========================================
pause
