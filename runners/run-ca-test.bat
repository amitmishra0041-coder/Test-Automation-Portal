@echo off
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
setlocal enabledelayedexpansion

REM Usage: run-ca-test.bat [qa|test]
set ENV=%1
if "%ENV%"=="" set ENV=qa

echo Running CA Test in Chromium (headed mode) for all states...
for %%S in (DE PA WI OH MI) do (
	set "TEST_STATE=%%S"
	set "TEST_ENV=%ENV%"
	echo ===== State: !TEST_STATE! (ENV=!TEST_ENV!) =====
	npx playwright test .\Create_CA.test.js --project=chromium --headed || goto :error
)
echo.
echo CA test completed for all states!
pause
goto :eof

:error
echo.
echo CA test failed for state %TEST_STATE% (ENV=%ENV%).
exit /b 1
