# Weekly ClaimCenter EBT status: builds the e-mail (weeklyStatus.js) and saves it as an Outlook DRAFT with the two
# charts embedded. Nothing is sent. Scheduled every Sunday ("EBT weekly status draft" in Task Scheduler).
#   powershell -ExecutionPolicy Bypass -File scripts\ebt\weeklyStatusDraft.ps1 [-Date 2026-11-22]
param([string]$Date = '')
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$log = Join-Path $env:USERPROFILE '.claimcenter-runner\ebt-weekly\draft.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
try {
  Push-Location $repo
  $nodeArgs = @('scripts\ebt\weeklyStatus.js'); if ($Date) { $nodeArgs += @('--date', $Date) }
  $out = (& node @nodeArgs | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$out\email.html")) { throw "weeklyStatus.js failed: $out" }
  Pop-Location
  $meta = Get-Content "$out\meta.json" -Raw | ConvertFrom-Json
  $ol = New-Object -ComObject Outlook.Application
  $m = $ol.CreateItem(0)
  $m.Subject = $meta.subject
  # the workbook goes along so teams can update it ("the sheet above"), like the 11/16 e-mail
  if ($meta.workbook -and (Test-Path $meta.workbook)) { $m.Attachments.Add($meta.workbook) | Out-Null }
  foreach ($id in @('areas')) {
    $a = $m.Attachments.Add("$out\$id.png", 1, 0)
    $a.PropertyAccessor.SetProperty('http://schemas.microsoft.com/mapi/proptag/0x3712001F', "$id.png")
  }
  # opening the inspector makes Outlook insert the default signature; keep it under our body
  $null = $m.GetInspector
  $sig = $m.HTMLBody
  $body = [IO.File]::ReadAllText("$out\email.html")
  $sm = [regex]::Match($sig, '(?s)<body[^>]*>(.*)</body>')
  if ($sm.Success) { $body = $body -replace '</body>', ($sm.Groups[1].Value.Replace('$', '$$') + '</body>') }
  $m.HTMLBody = $body
  $m.Save()
  Add-Content $log "$(Get-Date -Format s) draft saved: $($meta.subject) ($out)"
  "draft saved: $($meta.subject) ($out)"
} catch {
  Add-Content $log "$(Get-Date -Format s) FAILED: $($_.Exception.Message)"
  throw
}
