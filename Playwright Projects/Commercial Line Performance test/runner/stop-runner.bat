@echo off
REM Stops the Playwright Test Runner - see stop-runner.ps1.
REM (Window stays visible here, unlike start-runner.bat, so you can see the
REM confirmation message before it closes.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-runner.ps1"
pause
