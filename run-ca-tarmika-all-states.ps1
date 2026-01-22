# Run CA_Tarmika test for all 19 states with email report
# This script runs the CA_Tarmika test for all states and sends an email report at the end

# Set environment variables for email
$env:TEST_STATES = 'DE,PA,WI,OH,MI,AZ,CO,IL,IA,NC,SC,NE,NM,SD,TX,UT,IN,TN,VA'
$env:EMAIL_USER = $env:EMAIL_USER -or 'your-email@gmail.com'
$env:EMAIL_PASS = $env:EMAIL_PASS -or 'your-app-password'
$env:EMAIL_TO = $env:EMAIL_TO -or 'recipient@example.com'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Running CA_Tarmika test for all states" -ForegroundColor Cyan
Write-Host "States: $($env:TEST_STATES)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Run the test
npx playwright test CA_Tarmika.test.js --headed

Write-Host "========================================" -ForegroundColor Green
Write-Host "Test execution completed" -ForegroundColor Green
Write-Host "Email with results has been sent (if configured)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
