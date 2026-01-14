@echo off
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
setlocal enabledelayedexpansion

REM Usage: run-all-tests.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

REM Check for HEADED mode parameter
set HEADED_FLAG=
if /I "%2"=="HEADED" set HEADED_FLAG=-Headed
if /I "%2"=="headed" set HEADED_FLAG=-Headed

REM Run both suites in parallel across all states using PowerShell runners
echo ==== Starting BOP (parallel) ====
powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-bop.ps1" -TestEnv %ENV% -States "DE,PA,WI,OH,MI,AZ,CO,IL,IA,NC,SC,NE,NM,SD,TX,UT,IN,TN,VA" -Project chromium %HEADED_FLAG%
echo ==== Starting Package (parallel) ====
powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-parallel-package.ps1" -TestEnv %ENV% -States "DE,PA,WI,OH,MI,AZ,CO,IL,IA,NC,SC,NE,NM,SD,TX,UT,IN,TN,VA" -Project chromium %HEADED_FLAG%

echo All parallel runs triggered. Monitor the terminal for progress.
goto :eof
