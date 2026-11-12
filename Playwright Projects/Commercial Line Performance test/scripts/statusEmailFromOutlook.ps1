# scripts/statusEmailFromOutlook.ps1 - the newest QA daily-status email in the Outlook inbox, as JSON
# { received, subject, html } (or {} when there is none). Read-only; used by scripts/jiraStatusOnePage.js for the
# blocker comments Jira doesn't hold. -From / -Subject are "contains" matches; only the last -Days are searched.
param([string]$From = 'Vimal', [string]$Subject = 'Daily status', [int]$Days = 10, [Parameter(Mandatory)][string]$OutJson)
$ErrorActionPreference = 'Stop'
$ol = New-Object -ComObject Outlook.Application
$inbox = $ol.GetNamespace('MAPI').GetDefaultFolder(6)
$since = (Get-Date).AddDays(-$Days).ToString('MM/dd/yyyy')
$filter = '@SQL="urn:schemas:httpmail:fromname" LIKE ''%' + $From.Replace("'", "''") + '%'' AND "urn:schemas:httpmail:subject" LIKE ''%' + $Subject.Replace("'", "''") + '%'' AND "urn:schemas:httpmail:datereceived" >= ''' + $since + ''''
$hits = $inbox.Items.Restrict($filter)
$hits.Sort('[ReceivedTime]', $true)
$out = @{}
foreach ($m in $hits) { $out = @{ received = $m.ReceivedTime.ToString('s'); subject = $m.Subject; html = $m.HTMLBody }; break }
$out | ConvertTo-Json -Compress | Out-File -Encoding utf8 $OutJson
