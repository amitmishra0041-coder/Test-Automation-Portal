@echo off
REM One-click launcher for the Playwright Test Runner UI - see start-runner.ps1.
REM -WindowStyle Hidden hides this driver script's own window; the server
REM process it spawns still opens its own (minimized) console.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-runner.ps1"
