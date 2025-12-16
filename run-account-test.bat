@echo off
cd /d "c:\Users\amitmish\Playwright Projects\WB BOP Standard workflow\Automation_Portal\Test-Automation-Portal"
echo Running Account Test in Chromium (headed mode)...
echo.
npx playwright test .\Create_Account.test.js --project=chromium --headed
echo.
echo Test completed!
pause
