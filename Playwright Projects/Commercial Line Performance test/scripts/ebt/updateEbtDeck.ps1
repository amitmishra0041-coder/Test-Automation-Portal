# scripts/ebt/updateEbtDeck.ps1 - refresh the weekly "EBT Status Summary" deck from the EBT feedback tracker.
# Called by scripts/ebt/deckUpdate.js with the tracker entries as JSON. Works on a COPY ($Out); the source deck is
# only read. Slide 1: "Total observations", "JIRA reported" and the "JIRA by Status" table in the EBT Feedback
# panel. After slide 1: "EBT Feedback Log" slide(s) listing every tracker entry (14 per slide), replacing any log
# slides an earlier refresh added.
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$DataJson)
$ErrorActionPreference = 'Stop'
$data = Get-Content -Raw -Encoding UTF8 $DataJson | ConvertFrom-Json
$entries = @($data.entries)
$LOG_TAG = 'EBT Feedback Log'
$PER_SLIDE = 14

Copy-Item -LiteralPath $Source -Destination $Out -Force
$pp = New-Object -ComObject PowerPoint.Application
try {
  $deck = $pp.Presentations.Open($Out, $false, $false, $false)
  $s1 = $deck.Slides.Item(1)
  $shapes = @(); foreach ($sh in $s1.Shapes) { $shapes += $sh }
  function Text-Of($sh) { if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $sh.TextFrame.TextRange.Text } else { '' } }
  function Find-Text($re) { $shapes | Where-Object { (Text-Of $_) -match $re } | Select-Object -First 1 }

  # ── stat tiles: first paragraph is the number ──
  $jiraCount = @($entries | Where-Object { $_.jiraId -match '^[A-Z][A-Z0-9]+-\d+$' }).Count
  foreach ($pair in @(@('Total observations', $entries.Count), @('JIRA reported', $jiraCount))) {
    $tile = Find-Text $pair[0]
    if ($tile) { $tile.TextFrame.TextRange.Paragraphs(1).Characters(1, ($tile.TextFrame.TextRange.Paragraphs(1).Text.TrimEnd("`r").Length)).Text = [string]$pair[1] }
  }

  # ── JIRA by Status table (rows = statuses in tracker order, cols = priorities present) ──
  # Only feedback that became a JIRA counts here (observations closed without a JIRA, e.g. "N/A", are left out).
  $allEntries = $entries
  $entries = @($allEntries | Where-Object { $_.jiraId -match '^[A-Z][A-Z0-9]+-\d+$' })
  $hdr = Find-Text '^JIRA by Status'
  if ($hdr) { $r = $hdr.TextFrame.TextRange; $r.Text = ($r.Text -replace '\d+\s*$', [string]$entries.Count) }
  $tblShape = $shapes | Where-Object { $_.HasTable } | Select-Object -First 1
  if ($tblShape -and $entries.Count) {
    $t = $tblShape.Table
    $statusOrder = @($data.statusOrder)
    $statuses = @($entries | ForEach-Object { $_.status } | Where-Object { $_ } | Select-Object -Unique | Sort-Object { $i = [array]::IndexOf($statusOrder, $_); if ($i -lt 0) { 999 } else { $i } })
    $prioOrder = @('Critical', 'High', 'Medium', 'Low', 'Trivial')
    $prios = @($prioOrder | Where-Object { $p = $_; $entries | Where-Object { $_.priority -eq $p } })
    if (-not $prios.Count) { $prios = @('High', 'Medium') }
    $label = @{ Critical = 'Crit.'; High = 'High'; Medium = 'Med.'; Low = 'Low'; Trivial = 'Triv.' }
    # columns: Status | prios... | Total
    $want = $prios.Count + 2
    while ($t.Columns.Count -lt $want) { [void]$t.Columns.Add(2) }
    while ($t.Columns.Count -gt $want) { $t.Columns.Item(2).Delete() }
    # rows: header | statuses... | Grand Total
    $wantRows = $statuses.Count + 2
    while ($t.Rows.Count -lt $wantRows) { [void]$t.Rows.Add(2) }
    while ($t.Rows.Count -gt $wantRows) { $t.Rows.Item(2).Delete() }
    $w = $tblShape.Width; $first = [Math]::Round($w * 0.34)
    $t.Columns.Item(1).Width = $first
    for ($c = 2; $c -le $want; $c++) { $t.Columns.Item($c).Width = ($w - $first) / ($want - 1) }
    # Blank cells in the source carry no font size; give every cell the table's own (from the Status header).
    $refSize = $t.Cell(1, 1).Shape.TextFrame.TextRange.Font.Size
    function SetCell($r, $c, $v) { $tr = $t.Cell($r, $c).Shape.TextFrame.TextRange; $tr.Text = [string]$v; $tr.Font.Size = $refSize }
    SetCell 1 1 'Status'
    for ($i = 0; $i -lt $prios.Count; $i++) { SetCell 1 ($i + 2) $label[$prios[$i]] }
    SetCell 1 $want 'Total'
    for ($r = 0; $r -lt $statuses.Count; $r++) {
      $st = $statuses[$r]; SetCell ($r + 2) 1 $st
      for ($i = 0; $i -lt $prios.Count; $i++) {
        $n = @($entries | Where-Object { $_.status -eq $st -and $_.priority -eq $prios[$i] }).Count
        SetCell ($r + 2) ($i + 2) $(if ($n) { $n } else { '' })
      }
      SetCell ($r + 2) $want @($entries | Where-Object { $_.status -eq $st }).Count
    }
    SetCell $wantRows 1 'Grand Total'
    for ($i = 0; $i -lt $prios.Count; $i++) { SetCell $wantRows ($i + 2) @($entries | Where-Object { $_.priority -eq $prios[$i] }).Count }
    SetCell $wantRows $want $entries.Count
    # keep "Next steps" just under the table
    $next = Find-Text '^Next steps'
    if ($next) { $next.Top = $tblShape.Top + $tblShape.Height + 6 }
  }

  $entries = $allEntries

  # ── EBT Feedback Log slide(s) ──
  for ($i = $deck.Slides.Count; $i -ge 2; $i--) {
    $sl = $deck.Slides.Item($i)
    if (@($sl.Shapes | Where-Object { $_.Name -eq 'EBT_LOG_TABLE' }).Count) { $sl.Delete() }
  }
  $titleShape = Find-Text '^EBT Status Summary'
  $bandShape = $shapes | Where-Object { $_.Top -lt 60 -and -not $_.HasTextFrame -or ($_.Top -lt 60 -and -not (Text-Of $_)) } | Where-Object { $_.Width -gt 900 -and $_.Height -lt 60 } | Select-Object -First 1
  $blue = if ($bandShape) { $bandShape.Fill.ForeColor.RGB } else { 0x9C5A2E }
  $chunks = [Math]::Max(1, [Math]::Ceiling($entries.Count / $PER_SLIDE))
  $open = @($entries | Where-Object { $_.status -notin @('Closed', 'Rejected', 'Deferred') }).Count
  for ($k = 0; $k -lt $chunks; $k++) {
    $part = @($entries | Select-Object -Skip ($k * $PER_SLIDE) -First $PER_SLIDE)
    $sl = $s1.Duplicate().Item(1)
    $sl.MoveTo(2 + $k)
    $keep = @()
    foreach ($sh in @($sl.Shapes)) {
      $txt = Text-Of $sh
      if ($sh.Top -lt 100 -and $sh.Width -gt 900) { $keep += $sh } else { $sh.Delete() }
    }
    foreach ($sh in $keep) {
      $txt = Text-Of $sh
      if ($txt -match '^EBT Status Summary') { $sh.TextFrame.TextRange.Text = $LOG_TAG + ' - ClaimCenter' + $(if ($chunks -gt 1) { " ($($k + 1) of $chunks)" } else { '' }) }
      elseif ($txt) { $sh.TextFrame.TextRange.Text = "$($entries.Count) observations logged  |  $jiraCount in JIRA  |  $open open  -  from the GW CC-CM EBT Feedback Tracker, refreshed $($data.refreshed)" }
    }
    $cols = @(@('Feedback ID', 95), @('Reported', 62), @('Feature', 110), @('Description', 300), @('Priority', 55), @('JIRA', 70), @('Reporter', 110), @('Status', 70))
    $tw = 0; $cols | ForEach-Object { $tw += $_[1] }
    $tbl = $sl.Shapes.AddTable($part.Count + 1, $cols.Count, 7, 101, 945, 20)
    $tbl.Name = 'EBT_LOG_TABLE'
    $T = $tbl.Table
    for ($c = 1; $c -le $cols.Count; $c++) { $T.Columns.Item($c).Width = 945 * $cols[$c - 1][1] / $tw }
    for ($r = 1; $r -le $part.Count + 1; $r++) {
      for ($c = 1; $c -le $cols.Count; $c++) {
        $cell = $T.Cell($r, $c)
        $tr = $cell.Shape.TextFrame.TextRange
        if ($r -eq 1) { $v = $cols[$c - 1][0] } else {
          $e = $part[$r - 2]
          $v = switch ($c) { 1 { $e.id } 2 { $e.reported } 3 { $e.feature } 4 { $e.description -replace '^EBT\.GCCM\.FD\.\d+:\s*', '' } 5 { $e.priority } 6 { $e.jiraId } 7 { $e.reporter } 8 { $e.status } }
        }
        $tr.Text = [string]$v
        $tr.Font.Size = 11
        $tr.Font.Bold = [int]($r -eq 1)
        $cell.Shape.TextFrame.MarginTop = 3; $cell.Shape.TextFrame.MarginBottom = 3
        if ($r -eq 1) { $cell.Shape.Fill.ForeColor.RGB = $blue; $tr.Font.Color.RGB = 0xFFFFFF }
        else {
          $cell.Shape.Fill.ForeColor.RGB = $(if ($r % 2) { 0xF7F2EE } else { 0xFFFFFF })
          $tr.Font.Color.RGB = 0x262626
          if ($c -eq 6 -and $v -match '^[A-Z][A-Z0-9]+-\d+$') { $tr.ActionSettings.Item(1).Hyperlink.Address = "https://$($data.jiraSite)/browse/$v" }
        }
      }
    }
  }
  $deck.Save()
  $deck.Close()
  Write-Output "OK $Out"
} finally { $pp.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp) }
