# scripts/ebt/updateEbtDeck.ps1 - refresh the weekly "EBT Status Summary" deck from the EBT feedback tracker.
# Called by scripts/ebt/deckUpdate.js with the tracker entries + slide numbers as JSON. Works on a COPY ($Out); the
# source deck is only read.
# Slide 1 (layout of scripts/ebt/ebtSlide.js, shapes named EBT_*):
#   - a deck still in the old layout gets the new slide ($SlideFile) in place of its slide 1
#   - a deck already in the new layout keeps its slide: only the data shapes are refreshed (the three tracker
#     tiles, the week label, the two bar graphs), so the batch / updates text edited in PowerPoint stays as it is
# After slide 1: "EBT Feedback Log" slide(s) listing every tracker entry (14 per slide), replacing any log slides
# an earlier refresh added.
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$DataJson, [Parameter(Mandatory)][string]$SlideFile)
$ErrorActionPreference = 'Stop'
$data = Get-Content -Raw -Encoding UTF8 $DataJson | ConvertFrom-Json
$entries = @($data.entries)
$LOG_TAG = 'EBT Feedback Log'
$PER_SLIDE = 14

Copy-Item -LiteralPath $Source -Destination $Out -Force
$pp = New-Object -ComObject PowerPoint.Application
try {
  $deck = $pp.Presentations.Open($Out, $false, $false, $false)
  function Named($slide, $name) { foreach ($sh in $slide.Shapes) { if ($sh.Name -eq $name) { return $sh } }; return $null }

  # ── slide 1: bring in the new layout once ──
  $converted = $false
  if (-not (Named $deck.Slides.Item(1) 'EBT_TITLE')) {
    [void]$deck.Slides.InsertFromFile($SlideFile, 0, 1, 1)
    $deck.Slides.Item(2).Delete()
    $converted = $true
  }
  $s1 = $deck.Slides.Item(1)
  function SetText($name, $text) { $sh = Named $s1 $name; if ($sh) { $sh.TextFrame.TextRange.Text = [string]$text } }

  # ── tiles + week label ──
  SetText 'EBT_KPI_obs' $data.slide.kpi.obs
  SetText 'EBT_KPI_jira' $data.slide.kpi.jira
  SetText 'EBT_KPI_open' $data.slide.kpi.open
  SetText 'EBT_WEEK' $data.slide.week

  # ── bar graphs: one label / bar / value per row; rows the data doesn't need are hidden, not deleted ──
  function Fill-Bars($g, $block) {
    SetText "EBT_${g}_T" $block.title
    $rows = @($block.rows)
    $max = 1; foreach ($r in $rows) { if ($r.n -gt $max) { $max = $r.n } }
    $first = Named $s1 "EBT_${g}_L1"
    if (-not $first) { return }
    $top = $first.Top
    # Rows close up when there are more of them than fit at the normal spacing.
    $gap = [Math]::Min($data.slide.bar.gap, $block.avail / [Math]::Max(1, $rows.Count))
    for ($i = 1; $i -le 12; $i++) {
      $lab = Named $s1 "EBT_${g}_L$i"; $bar = Named $s1 "EBT_${g}_B$i"; $val = Named $s1 "EBT_${g}_V$i"
      if (-not $lab) { break }
      $show = $i -le $rows.Count
      foreach ($sh in @($lab, $bar, $val)) { if ($sh) { $sh.Visible = $(if ($show) { -1 } else { 0 }) } }
      if (-not $show) { continue }
      $r = $rows[$i - 1]
      $y = $top + ($i - 1) * $gap
      $lab.Top = $y; $lab.TextFrame.TextRange.Text = [string]$r.label
      $bar.Top = $y + 3; $bar.Width = [Math]::Max(9, $data.slide.bar.maxW * $r.n / $max); $bar.Fill.ForeColor.RGB = [int]$r.color
      $val.Top = $y; $val.Left = $bar.Left + $bar.Width + 5; $val.TextFrame.TextRange.Text = [string]$r.n
    }
  }
  Fill-Bars 'feat' $data.slide.feat
  Fill-Bars 'status' $data.slide.status
  SetText 'EBT_status_N' $data.slide.status.note

  # ── EBT Feedback Log slide(s) ──
  for ($i = $deck.Slides.Count; $i -ge 2; $i--) {
    $sl = $deck.Slides.Item($i)
    if (Named $sl 'EBT_LOG_TABLE') { $sl.Delete() }
  }
  $jiraCount = $data.slide.kpi.jira
  $blue = 0x97552E # 2E5597, the panel-header blue (COM colours are BGR)
  $chunks = [Math]::Max(1, [Math]::Ceiling($entries.Count / $PER_SLIDE))
  $open = @($entries | Where-Object { $_.status -notin @('Closed', 'Rejected', 'Deferred') }).Count
  for ($k = 0; $k -lt $chunks; $k++) {
    $part = @($entries | Select-Object -Skip ($k * $PER_SLIDE) -First $PER_SLIDE)
    $sl = $s1.Duplicate().Item(1)
    $sl.MoveTo(2 + $k)
    foreach ($sh in @($sl.Shapes)) { if ($sh.Name -notin @('EBT_BG', 'EBT_HDR', 'EBT_TITLE')) { $sh.Delete() } }
    (Named $sl 'EBT_TITLE').TextFrame.TextRange.Text = $LOG_TAG + ' - ClaimCenter' + $(if ($chunks -gt 1) { " ($($k + 1) of $chunks)" } else { '' })
    $sub = $sl.Shapes.AddTextbox(1, 7, 64, 945, 26)
    $sub.TextFrame.TextRange.Text = "$($entries.Count) observations logged  |  $jiraCount in JIRA  |  $open open  -  from the GW CC-CM EBT Feedback Tracker, refreshed $($data.refreshed)"
    $sub.TextFrame.TextRange.Font.Size = 12; $sub.TextFrame.TextRange.Font.Name = 'Calibri'; $sub.TextFrame.TextRange.Font.Color.RGB = 0x404040
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
          $v = switch ($c) { 1 { $e.id } 2 { $e.reported } 3 { $e.feature } 4 { $e.description -replace '^(\s*EBT\.GCCM\.FD\.\d+:\s*)+', '' } 5 { $e.priority } 6 { $e.jiraId } 7 { $e.reporter } 8 { $e.status } }
        }
        $tr.Text = [string]$v
        $tr.Font.Size = 11
        $tr.Font.Name = 'Calibri'
        $tr.Font.Bold = [int]($r -eq 1)
        $cell.Shape.TextFrame.MarginTop = 3; $cell.Shape.TextFrame.MarginBottom = 3
        if ($r -eq 1) { $cell.Shape.Fill.ForeColor.RGB = $blue; $tr.Font.Color.RGB = 0xFFFFFF }
        else {
          $cell.Shape.Fill.ForeColor.RGB = $(if ($r % 2) { 0xF3E2D9 } else { 0xFFFFFF })
          $tr.Font.Color.RGB = 0x262626
          if ($c -eq 6 -and $v -match '^[A-Z][A-Z0-9]+-\d+$') { $tr.ActionSettings.Item(1).Hyperlink.Address = "https://$($data.jiraSite)/browse/$v" }
        }
      }
    }
  }
  $deck.Save()
  $deck.Close()
  Write-Output "OK $Out converted=$converted"
} finally {
  # Leave PowerPoint running when the user has other decks open in it.
  if ($pp.Presentations.Count -eq 0) { $pp.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
}
