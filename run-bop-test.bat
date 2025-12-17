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
set STATES=%2

if "%STATES%"=="" goto ALL
echo Running BOP Test in Chromium (headless mode) for STATES: %STATES% in PARALLEL...
set PSARGS=-TestEnv %ENV% -States "%STATES%"
goto RUN

:ALL
echo Running BOP Test in Chromium (headless mode) for ALL states in PARALLEL...
set PSARGS=-TestEnv %ENV%

:RUN
echo.
REM Call PowerShell script to run tests in parallel within same terminal
powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-bop.ps1" %PSARGS%

echo.
endlocal
pause
