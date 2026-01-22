param(
    [string]$Env = "QA"
)

# Send consolidated email for the last completed CA parallel run.
# Prefers JSON persisted by run-parallel-ca.ps1; falls back to parsing per-state logs.

$projectPath = Split-Path -Parent $PSCommandPath
$resultsPath = Join-Path $projectPath 'ca-parallel-results.json'

function Build-ResultsFromLogs {
    param([string]$dir)
    $arr = @()
    $files = Get-ChildItem -Path $dir -Filter 'test-run-output-ca-*.txt' -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        $name = $f.Name
        if ($name -match 'test-run-output-ca-(?<state>[A-Z]{2})\.txt') {
            $state = $Matches.state
        } else {
            continue
        }
        $content = Get-Content -Path $f.FullName -ErrorAction SilentlyContinue | Out-String
        $exitCode = 1
        # Heuristics: if 'failed' appears, mark failed; if 'passed' appears and 'failed' does not, mark passed
        if ($content -match '(?i)failed') {
            $exitCode = 1
        } elseif ($content -match '(?i)passed') {
            $exitCode = 0
        }
        $arr += @{ State = $state; ExitCode = $exitCode; Duration = $null; CPU = $null; RAM = $null; ParallelAtStart = $null; QuoteRequestNumber = 'N/A'; InsuredName = 'N/A' }
    }
    return $arr
}

$results = $null
if (Test-Path $resultsPath) {
    try {
        $results = Get-Content -Path $resultsPath -Raw | ConvertFrom-Json
        Write-Host "Loaded results from $resultsPath" -ForegroundColor Gray
    } catch {
        Write-Host "Failed to parse results JSON, falling back to logs: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $results) {
    $results = Build-ResultsFromLogs -dir $projectPath
}

if (-not $results -or $results.Count -eq 0) {
    Write-Host "No results found to email. Ensure logs or results JSON exist." -ForegroundColor Yellow
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
