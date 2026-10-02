# One-click launcher for the Playwright Test Runner UI.
# Starts runner/server.js (via `npm run runner`) if it isn't already
# listening on port 3000 - so double-clicking twice doesn't spawn a second
# server - then opens the browser to it either way.

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Url = 'http://localhost:3000/'

function Test-RunnerUp {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('localhost', 3000)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-RunnerUp)) {
    Start-Process -FilePath "npm.cmd" -ArgumentList "run runner" -WorkingDirectory $ProjectDir -WindowStyle Hidden
    while (-not (Test-RunnerUp)) {
        Start-Sleep -Seconds 1
    }
}

Start-Process $Url
