# PowerShell script to run BOP tests in parallel for all states
param(
    [string]$TestEnv = "qa"
)

$states = @('DE', 'PA', 'WI', 'OH', 'MI')
$jobs = @()
$projectPath = Split-Path -Parent $PSCommandPath

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "BOP Test Runner - Parallel Execution" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Environment: $TestEnv" -ForegroundColor Yellow
Write-Host "States: $($states -join ', ')" -ForegroundColor Yellow
Write-Host "Project Path: $projectPath`n" -ForegroundColor Yellow

# Start a job for each state
foreach ($state in $states) {
    Write-Host "Starting test for state: $state" -ForegroundColor Green
    
    $jobs += Start-Job -ScriptBlock {
        param($s, $e, $projPath)
        
        # Change to project directory in this job's context
        Set-Location $projPath
        
        $env:TEST_STATE = $s
        $env:TEST_ENV = $e
        
        Write-Host "[$s] Running test from: $(Get-Location)" -ForegroundColor Cyan
        
        # Run the test and capture output
        $output = & npx playwright test Create_BOP.test.js --project=chromium 2>&1 | Out-String
        
        return @{
            State = $s
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    } -ArgumentList $state, $TestEnv, $projectPath
}

Write-Host "`nAll 5 tests started in parallel. Waiting for completion..." -ForegroundColor Cyan
Write-Host "This may take several minutes...`n" -ForegroundColor Yellow

# Wait for all jobs to complete and get results
$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job

# Display results
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TEST RESULTS SUMMARY" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

$passed = 0
$failed = 0

foreach ($result in $results) {
    if ($result.ExitCode -eq 0) {
        Write-Host "[$($result.State)] PASSED" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[$($result.State)] FAILED" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nTotal: $($results.Count) | Passed: $passed | Failed: $failed`n" -ForegroundColor Cyan

# Exit with error code if any tests failed
if ($failed -gt 0) {
    exit 1
} else {
    exit 0
}
