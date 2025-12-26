@echo off
REM Package Test Runner - wrapper that calls PowerShell
REM Usage: run-package-test.bat [qa|test|prod] [state1 state2 ...] [headed]

setlocal EnableExtensions EnableDelayedExpansion

set "ENV="
set "STATES="
set "HEADED_FLAG="
set "_first=1"

REM Detect environment from first argument only if it matches known envs
set "_envCandidate=%~1"
if /I "%_envCandidate%"=="qa" (
    set "ENV=qa"
 ) else if /I "%_envCandidate%"=="test" (
    set "ENV=test"
 ) else if /I "%_envCandidate%"=="prod" (
    set "ENV=prod"
)

for %%A in (%*) do (
    if !_first! EQU 1 (
        set "_first=0"
        if defined ENV (
            REM first token was env; skip adding as state
        ) else if /I "%%A"=="headed" (
            set "HEADED_FLAG=headed"
        ) else (
            set "STATES=%%A"
        )
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

if not defined ENV set "ENV=qa"
if not defined STATES set "STATES=DE,PA,WI,OH,MI"

if /I "%HEADED_FLAG%"=="headed" (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-package-test.ps1" -TestEnv %ENV% -States "%STATES%" -Headed
) else (
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0run-package-test.ps1" -TestEnv %ENV% -States "%STATES%"
)

endlocal
pause
