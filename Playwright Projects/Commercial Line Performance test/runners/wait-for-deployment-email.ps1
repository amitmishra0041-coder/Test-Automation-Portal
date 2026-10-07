# runners/wait-for-deployment-email.ps1
# Polls the "ReadReciept" Outlook folder (NOT the Inbox - this deployment notice is
# routed there) for the "AppInt Release Notes (QA Environment)" email from
# donotreply@donegalgroup.com, sent once code is deployed to QA. This email can
# arrive the evening BEFORE the test day (e.g. Tue 8:45 PM covers Wed's run), so this
# does not filter by calendar day - it tracks the last email it already acted on
# (by ReceivedTime) in a persistent state file, and only triggers on a NEWER one.
# Once a newer deployment email is found, triggers the WB Daily Regression task.
# NOTE: Outlook COM automation requires an interactive desktop session - this script
# will not work if run under a "logged off" background session.

$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir     = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$stateFile = Join-Path $logsDir "last-deployment-email.state"
$pollLog   = Join-Path $logsDir ("deployment-poll-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Log($msg) {
  "$(Get-Date -Format 'HH:mm:ss')  $msg" | Tee-Object -FilePath $pollLog -Append | Write-Host
}

$lastProcessed = $null
if (Test-Path $stateFile) {
  $raw = Get-Content $stateFile -Raw
  if ($raw) { $lastProcessed = [DateTime]::Parse($raw.Trim()) }
}

try {
  $outlook = New-Object -ComObject Outlook.Application
  $ns      = $outlook.GetNamespace("MAPI")
  $store   = $ns.Folders.Item("AmitMishra@donegalgroup.com")
  $folder  = $store.Folders.Item("ReadReciept")
  $items   = $folder.Items
  $items.Sort("[ReceivedTime]", $true)  # newest first

  # Restrict to the last few days server-side first - this folder has ~12k items,
  # and an unbounded per-item COM scan over that is what caused the original
  # dry-run to hang for minutes. Restrict() is fast regardless of folder size.
  $cutoff     = (Get-Date).AddDays(-3).ToString("MM/dd/yyyy HH:mm")
  $candidates = $items.Restrict("[ReceivedTime] > '$cutoff'")

  $found = $null
  foreach ($item in $candidates) {
    if ($item.Subject -match 'AppInt Release Notes \(QA Environment\)') {
      $found = $item
      break  # newest matching email only (already sorted descending)
    }
  }

  if (-not $found) {
    Log "No deployment email found in ReadReciept (last 3 days)."
  } elseif ($lastProcessed -and $found.ReceivedTime -le $lastProcessed) {
    Log "Newest deployment email ($($found.ReceivedTime)) already processed - no new deployment."
  } else {
    Log "New deployment email found: '$($found.Subject)' received $($found.ReceivedTime)"
    $found.ReceivedTime.ToString('o') | Set-Content $stateFile
    Log "Starting WB Daily Regression task..."
    Start-ScheduledTask -TaskName "WB Daily Regression"
    Log "Task started."
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
