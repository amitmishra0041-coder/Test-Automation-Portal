# Run Create_CA test for all 19 states with email reporting
param(
    [string]$TestEnv = "qa",
    [switch]$Headed = $false,
    [switch]$SendEmail = $true
)

$ErrorActionPreference = "Stop"
$workingDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# States from stateConfig.js TARGET_STATES (temporary subset)
$states = @("DE", "PA", "MI", "WI")

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Create_CA Test Runner - All 19 States (from stateConfig.js)" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Environment: $TestEnv | Headed: $(if ($Headed) { 'YES' } else { 'NO' }) | Email: $(if ($SendEmail) { 'YES' } else { 'NO' })"
Write-Host "Total States: $($states.Count)"
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

$playwrightCmd = "npx playwright test .\Create_CA.test.js --project=chromium"
if ($Headed) { $playwrightCmd += " --headed" }

$startTime = Get-Date
$passedStates = @()
$failedStates = @()
$stateResults = @()

foreach ($state in $states) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Testing State: $state..." -ForegroundColor Yellow
    
    $stateStartTime = Get-Date
    $env:TEST_ENV = $TestEnv
    $env:TEST_STATE = $state
    
    try {
        $process = Start-Process -FilePath "cmd" -ArgumentList "/c `"cd `"$workingDir`" && $playwrightCmd`"" -NoNewWindow -PassThru -Wait
        
        if ($process.ExitCode -eq 0) {
            $status = "PASSED"
            $passedStates += $state
            $color = "Green"
        } else {
            $status = "FAILED"
            $failedStates += $state
            $color = "Red"
        }
    } catch {
        $status = "ERROR"
        $failedStates += $state
        $color = "Red"
    }
    
    $duration = ((Get-Date) - $stateStartTime).TotalSeconds
    Write-Host "  Result: $status ($('{0:F2}' -f $duration)s)" -ForegroundColor $color
    
    $stateResults += @{ State = $state; Status = $status; Duration = $duration }
}

$totalDuration = ((Get-Date) - $startTime).TotalSeconds

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Passed: $($passedStates.Count)" -ForegroundColor Green
Write-Host "Failed: $($failedStates.Count)" -ForegroundColor Red
Write-Host "Total Time: $('{0:F2}' -f ($totalDuration/60)) minutes"
Write-Host "========================================================================" -ForegroundColor Cyan

if ($SendEmail) {
    Write-Host ""
    Write-Host "Sending email report..." -ForegroundColor Cyan
    
    try {
        $reportData = @{
            subject = "CA Test Report: $($passedStates.Count)/$($states.Count) PASSED"
            environment = $TestEnv
            passedCount = $passedStates.Count
            failedCount = $failedStates.Count
            totalStates = $states.Count
            successRate = [math]::Round(($passedStates.Count/$states.Count)*100, 2)
            totalMinutes = [math]::Round($totalDuration/60, 2)
            executionDate = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            states = @($stateResults | ForEach-Object {
                @{
                    state = $_.State
                    status = $_.Status
                    seconds = [math]::Round($_.Duration, 2)
                }
            })
        }
        
        $reportFile = Join-Path $env:TEMP ("ca-report-" + (Get-Date).Ticks + ".json")
        $reportData | ConvertTo-Json -Depth 10 | Set-Content -Path $reportFile -Encoding UTF8
        
        $emailScript = Join-Path $workingDir "send-email-final.js"
        if (Test-Path $emailScript) {
            & node $emailScript $reportFile 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Email sent successfully!" -ForegroundColor Green
            }
            Remove-Item -Path $reportFile -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Host "Email error: $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Completed!" -ForegroundColor Cyan
exit $(if ($failedStates.Count -gt 0) { 1 } else { 0 })

