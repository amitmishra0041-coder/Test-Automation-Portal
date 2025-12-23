@echo off
setlocal EnableExtensions DisableDelayedExpansion
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

REM Clean up old batch markers and other suite's iteration file to ensure clean run
if exist .batch-email-sent del .batch-email-sent
if exist .batch-run-in-progress del .batch-run-in-progress
if exist iterations-data-package.json del iterations-data-package.json
echo ✓ Cleaned up old batch markers and Package iterations

REM Create batch marker file to prevent individual test runs from sending emails
echo {^"inBatch^": true} > .batch-run-in-progress
echo ✓ Created batch marker - emails will be deferred until batch completion

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

REM Usage: run-bop-test.bat [qa^|test] [DE,PA,WI,OH,MI]
set ENV=%1
if "%ENV%"=="" set ENV=qa
shift
REM Collect remaining args as STATES, rejoining with commas if they were split
set "STATES_RAW="
:collect
if "%1"=="" goto aftercollect
if defined STATES_RAW (
    set "STATES_RAW=%STATES_RAW%,%1"
) else (
    set "STATES_RAW=%1"
)
shift
goto collect
:aftercollect
set "STATES=%STATES_RAW%"

if "%STATES%"=="" set STATES=DE,PA,WI,OH,MI
echo Running BOP Test in Chromium (headless mode) for STATES: %STATES% in PARALLEL...
echo.
REM Call PowerShell script to run tests in parallel within same terminal
set "HEADED_ARG=%2"
if /I "%HEADED_ARG%"=="headed" (
    echo Running in HEADed mode
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-bop.ps1" -TestEnv %ENV% -States "%STATES%" -Headed -Project chromium
) else (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-bop.ps1" -TestEnv %ENV% -States "%STATES%" -Project chromium
)

REM Consolidated email now sent by parallel PS1 runner; skipping duplicate send here
echo.
echo ✓ Email is handled by run-parallel-bop.ps1

echo.
endlocal
pause
