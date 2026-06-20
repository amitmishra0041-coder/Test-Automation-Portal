param(
    [string]$Env = "QA"
)

# Send consolidated email for the last completed CA parallel run.
# Uses JSON persisted by run-parallel-ca.ps1

$projectPath = Split-Path -Parent $PSCommandPath
$resultsPath = Join-Path $projectPath 'ca-parallel-results.json'

$results = $null
if (Test-Path $resultsPath) {
    try {
        $results = Get-Content -Path $resultsPath -Raw | ConvertFrom-Json
        Write-Host "Loaded results from $resultsPath" -ForegroundColor Gray
    } catch {
        Write-Host "Failed to parse results JSON: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $results -or $results.Count -eq 0) {
    Write-Host "No results found to email. Ensure ca-parallel-results.json exists." -ForegroundColor Yellow
    exit 1
}

# Compute minimal total time (unknown for fallback)
$summary = "unknown"
if (Test-Path $resultsPath) {
    $summary = "n/a"
}

# Write to temp file for Node.js to read (UTF-8 without BOM)
$tempResultsPath = Join-Path $projectPath 'ca-email-temp.json'
$emailData = @{
    results = $results
    totalTime = $summary
    env = $Env
}
$jsonContent = $emailData | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($tempResultsPath, $jsonContent, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Sending email for last run..." -ForegroundColor Cyan
node send-ca-email.js

if ($LASTEXITCODE -eq 0) {
    # Clean up temp file
    Remove-Item -Path $tempResultsPath -Force -ErrorAction SilentlyContinue
}

exit $LASTEXITCODE
