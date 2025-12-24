@echo off
REM Package Test Runner - wrapper that calls PowerShell
REM Usage: run-package-test.bat [qa|test] [state1 state2 ...] [headed]

setlocal EnableExtensions EnableDelayedExpansion

set "ENV=%1"
set "STATES="
set "HEADED_FLAG="
set "_first=1"

for %%A in (%*) do (
    if !_first! EQU 1 (
        REM skip first arg (env)
        set "_first=0"
    ) else if /I "%%A"=="headed" (
        set "HEADED_FLAG=headed"
    ) else (
        if defined STATES (
            set "STATES=!STATES!,%%A"
        ) else (
            set "STATES=%%A"
        )
    )
)

if "%ENV%"=="" set ENV=qa
if not defined STATES set "STATES=DE,PA,WI,OH,MI"

if /I "%HEADED_FLAG%"=="headed" (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-package-test.ps1" -TestEnv %ENV% -States "%STATES%" -Headed
) else (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-package-test.ps1" -TestEnv %ENV% -States "%STATES%"
)

endlocal
pause
