@echo off
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
setlocal enabledelayedexpansion

REM Usage: run-all-tests.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

REM States configured: DE PA WI OH MI
for %%S in (DE PA WI OH MI) do (
	set "TEST_STATE=%%S"
	set "TEST_ENV=%ENV%"
	echo ===== Running all tests for state !TEST_STATE! (ENV=!TEST_ENV!) =====
	npx playwright test --project=chromium || goto :error
)

echo All states completed.
goto :eof

:error
echo Test run failed for state %TEST_STATE% (ENV=%ENV%).
exit /b 1
echo All tests completed!
pause
echo.
echo All tests completed!
pause
