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

REM Call PowerShell script to run tests in parallel within same terminal
powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-bop.ps1" -TestEnv %ENV%

echo.
pause
