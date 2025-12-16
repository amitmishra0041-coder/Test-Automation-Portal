@echo off
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
echo Running All Tests in Chromium (headed mode)...
echo.
npx playwright test --project=chromium --headed
echo.
echo All tests completed!
pause
