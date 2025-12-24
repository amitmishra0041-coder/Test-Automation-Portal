@echo off
setlocal EnableExtensions EnableDelayedExpansion
echo ========================================
echo Package Test Runner - Parallel Execution
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
if exist iterations-data-bop.json del iterations-data-bop.json
echo ✓ Cleaned up old batch markers and BOP iterations

REM Create batch marker file to prevent individual test runs from sending emails
echo {"inBatch": true} > .batch-run-in-progress
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

REM Usage: run-package-test.bat [qa|test] [states] [headed]
set ENV=%1
if "%ENV%"=="" set ENV=qa

REM Check all args for 'headed' flag and build states list
set "HAS_HEADED=0"
set "STATES_RAW="
for %%A in (%*) do (
    if /I "%%A"=="headed" (
        set "HAS_HEADED=1"
    ) else if /I "%%A"=="%ENV%" (
        REM Skip the first arg (ENV)
    ) else (
        if defined STATES_RAW (
            set "STATES_RAW=!STATES_RAW!,%%A"
        ) else (
            set "STATES_RAW=%%A"
        )
    )
)

set "STATES=%STATES_RAW%"
if "%STATES%"=="" set STATES=DE,PA,WI,OH,MI

if %HAS_HEADED%==1 (
    echo Running Package Test in Chromium (HEADED mode) for STATES: %STATES% in PARALLEL...
) else (
    echo Running Package Test in Chromium (headless mode) for STATES: %STATES% in PARALLEL...
)
echo.

REM Call PowerShell script to run tests in parallel within same terminal
if %HAS_HEADED%==1 (
    echo Running in HEADed mode
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-package.ps1" -TestEnv %ENV% -States "%STATES%" -Headed -Project chromium -KillStrays
) else (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-package.ps1" -TestEnv %ENV% -States "%STATES%" -Project chromium -KillStrays
)

REM Consolidated email now sent by parallel PS1 runner; skipping duplicate send here
echo.
echo ✓ Email is handled by run-parallel-package.ps1

echo.
endlocal
pause
