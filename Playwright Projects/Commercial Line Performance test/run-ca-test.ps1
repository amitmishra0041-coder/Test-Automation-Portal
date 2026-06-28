# Run Create_CA_FinalCopy test for all states with email reporting
param(
    [string]$TestEnv = "qa",
    [bool]$Headed = $true,
    [Nullable[bool]]$SendEmail = $null,
    [switch]$NoEmail
)

$emailEnabled = if ($null -ne $SendEmail) { [bool]$SendEmail } else { -not $NoEmail }

$ErrorActionPreference = "Continue"
$workingDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PWD.Path }

# Verify test file exists before doing anything
$testFile = Join-Path $workingDir "Create_CA_FinalCopy.test.js"
if (-not (Test-Path $testFile)) {
    Write-Host "ERROR: Test file not found: $testFile" -ForegroundColor Red
    exit 1
}

# States to run
$states = @("DE", "PA", "MI", "WI") | Select-Object -Unique

# Mark as batch run to prevent per-iteration reporter emails
$batchMarker = Join-Path $workingDir ".batch-run-in-progress-ca"
if (-not (Test-Path $batchMarker)) {
    '{"inBatch": true}' | Out-File -FilePath $batchMarker -Encoding ASCII -Force
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Create_CA_FinalCopy Test Runner" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Environment : $TestEnv | Headed: $(if ($Headed) { 'YES' } else { 'NO' }) | Email: $(if ($emailEnabled) { 'YES' } else { 'NO' })"
Write-Host "Total States: $($states.Count)"
Write-Host "Working Dir : $workingDir"
Write-Host "Test File   : $testFile"
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# Build playwright command
$playwrightCmd = "npx playwright test `"$testFile`" --project=chromium --workers=1"
if ($Headed) { $playwrightCmd += " --headed" }

$startTime     = Get-Date
$passedStates  = @()
$failedStates  = @()
$stateResults  = @()

foreach ($state in $states) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Testing State: $state..." -ForegroundColor Yellow

    $stateStartTime    = Get-Date
    $env:TEST_ENV      = $TestEnv
    $env:TEST_STATE    = $state
    $env:TEST_TYPE     = "CA"

    try {
        $fullCmd = "cd `"$workingDir`" && set TEST_STATE=$state && set TEST_ENV=$TestEnv && set TEST_TYPE=CA && $playwrightCmd"
        $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$fullCmd`"" -NoNewWindow -PassThru -Wait

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
        $status = "ERROR: $_"
        $failedStates += $state
        $color = "Red"
    }

    $duration = ((Get-Date) - $stateStartTime).TotalSeconds
    Write-Host "  Result: $status ($([math]::Round($duration, 2))s)" -ForegroundColor $color

    $stateResults += @{ State = $state; Status = $status; Duration = $duration }
}

$totalDuration = ((Get-Date) - $startTime).TotalSeconds

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Passed    : $($passedStates.Count)" -ForegroundColor Green
Write-Host "Failed    : $($failedStates.Count)" -ForegroundColor Red
Write-Host "Total Time: $([math]::Round($totalDuration/60, 2)) minutes"
Write-Host "========================================================================" -ForegroundColor Cyan

# Send email using send-ca-email-optimized.js
if ($emailEnabled) {
    Write-Host ""
    Write-Host "Sending email report..." -ForegroundColor Cyan

    $emailScript = Join-Path $workingDir "send-ca-email-optimized.js"
    if (-not (Test-Path $emailScript)) {
        Write-Host "Email script not found: $emailScript" -ForegroundColor Yellow
    } else {
        try {
            # Build email payload matching what send-ca-email-optimized.js expects
            $emailResults = @()
            foreach ($r in $stateResults) {
                $stateDataFile = Join-Path $workingDir "test-data-$($r.State).json"
                $testData = $null
                if (Test-Path $stateDataFile) {
                    $testData = Get-Content $stateDataFile -Raw | ConvertFrom-Json
                }
                $emailResults += [PSCustomObject]@{
                    State               = $r.State
                    StateName           = if ($testData) { $testData.stateName } else { $r.State }
                    Status              = $r.Status
                    Duration            = [math]::Round($r.Duration, 2)
                    QuoteNumber         = if ($testData) { $testData.quoteNumber } else { "N/A" }
                    PolicyNumber        = if ($testData) { $testData.policyNumber } else { "N/A" }
                    Milestones          = if ($testData) { $testData.milestones } else { @() }
                    coverageChanges     = if ($testData) { $testData.coverageChanges } else { @() }
                    coverageSectionStats = if ($testData) { $testData.coverageSectionStats } else { @() }
                    addCoverageTimings  = if ($testData) { $testData.addCoverageTimings } else { @() }
                }
            }

            $totalMinutes = [int][Math]::Floor($totalDuration / 60)
            $totalSecs    = [int][Math]::Floor($totalDuration % 60)

            $emailPayload = @{
                results   = $emailResults
                env       = $TestEnv
                totalTime = "${totalMinutes}:$($totalSecs.ToString('00'))"
                timestamp = (Get-Date -Format 'o')
                passed    = $passedStates.Count
                failed    = $failedStates.Count
            }

            $emailTempPath = Join-Path $workingDir "ca-email-temp.json"
            [System.IO.File]::WriteAllText($emailTempPath, ($emailPayload | ConvertTo-Json -Depth 20))

            & node $emailScript
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Email sent successfully!" -ForegroundColor Green
            } else {
                Write-Host "Email script exited with code $LASTEXITCODE" -ForegroundColor Yellow
            }

            Remove-Item $emailTempPath -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "Email error: $_" -ForegroundColor Yellow
        }
    }
}

if (Test-Path $batchMarker) {
    Remove-Item $batchMarker -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Completed!" -ForegroundColor Cyan
exit $(if ($failedStates.Count -gt 0) { 1 } else { 0 })
