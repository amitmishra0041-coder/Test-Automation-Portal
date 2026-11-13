# scripts/ebt/updateEbtDeck.ps1 - refresh the weekly status deck: slide 1 = weekly QA status, slide 2 = EBT status.
# Called by scripts/ebt/deckUpdate.js with the numbers as JSON. Works on a COPY ($Out); the source deck is only read.
#
# EBT slide (layout of scripts/ebt/ebtSlide.js, shapes named EBT_*):
#   - found anywhere in the deck by its EBT_TITLE shape and kept: only the data is refreshed (the three tracker
#     tiles, the week label, and the right column - Progress so far / JIRA by status - which is redrawn), so the
#     batch / updates text edited in PowerPoint stays as it is
#   - a deck without one gets it from $EbtFrom (slide $EbtIndex of the newest deck that has one), else the blank
#     layout in $SlideFile
# Weekly QA status slide (layout of scripts/jiraStatusOnePage.js, shapes named QA_*):
#   - found by its "QA Status Summary" title and kept: the three column texts stay as edited in PowerPoint; only the
#     hours tiles, the SMARTCOMM summary table and the open-defects title + table are refreshed. A slide made by
#     hand from an earlier deck has its shapes named here first (Adopt-Weekly).
#   - a deck without one (or with one in the pre-11/13 format) gets the freshly built slide in $WeeklyFile
#   - without $WeeklyFile the slide is left exactly as it is
# "EBT Feedback Log" slides from earlier refreshes are removed (no longer part of the deck).
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$DataJson, [Parameter(Mandatory)][string]$SlideFile,
  [string]$WeeklyFile = '', [string]$EbtFrom = '', [int]$EbtIndex = 0)
$ErrorActionPreference = 'Stop'
$data = Get-Content -Raw -Encoding UTF8 $DataJson | ConvertFrom-Json

Copy-Item -LiteralPath $Source -Destination $Out -Force
$pp = New-Object -ComObject PowerPoint.Application
try {
  $deck = $pp.Presentations.Open($Out, $false, $false, $false)
  function Named($slide, $name) { foreach ($sh in $slide.Shapes) { if ($sh.Name -eq $name) { return $sh } }; return $null }
  function TextOf($sh) { if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { return [string]$sh.TextFrame.TextRange.Text }; return '' }
  function SetText($slide, $name, $text) { $sh = Named $slide $name; if ($sh) { $sh.TextFrame.TextRange.Text = [string]$text } }

  for ($i = $deck.Slides.Count; $i -ge 1; $i--) { if (Named $deck.Slides.Item($i) 'EBT_LOG_TABLE') { $deck.Slides.Item($i).Delete() } }

  # -- EBT slide --
  $s1 = $null
  foreach ($sl in $deck.Slides) { if (Named $sl 'EBT_TITLE') { $s1 = $sl; break } }
  $ebt = 'kept'
  if (-not $s1) {
    $n = $deck.Slides.Count
    if ($EbtFrom -and $EbtIndex -gt 0) { [void]$deck.Slides.InsertFromFile($EbtFrom, $n, $EbtIndex, $EbtIndex); $ebt = 'copied' }
    else { [void]$deck.Slides.InsertFromFile($SlideFile, $n, 1, 1); $ebt = 'new' }
    $s1 = $deck.Slides.Item($n + 1)
  }
  SetText $s1 'EBT_KPI_obs' $data.slide.kpi.obs
  SetText $s1 'EBT_KPI_jira' $data.slide.kpi.jira
  SetText $s1 'EBT_KPI_open' $data.slide.kpi.open
  SetText $s1 'EBT_WEEK' $data.slide.week

  # right column: cleared and drawn again from the rectangles / texts ebtSlide.js worked out
  # (everything in that column is data: panels, bars, a chart pasted in from the test case workbook)
  $old = @(); foreach ($sh in $s1.Shapes) { if ($sh.Left -ge $data.slide.region.x - 2 -and $sh.Top -ge $data.slide.region.y - 2) { $old += $sh } }
  foreach ($sh in $old) { $sh.Delete() }
  $n = 0
  foreach ($p in @($data.slide.right)) {
    $n++
    if ($p.k -eq 'r') {
      $sh = $s1.Shapes.AddShape(1, [single]$p.x, [single]$p.y, [single]$p.w, [single]$p.h)
      # plain flat shape: the deck's default shape style brings a gradient and a shadow
      $sh.Fill.Solid(); $sh.Fill.ForeColor.RGB = [int]$p.fill; $sh.Shadow.Visible = 0
      if ($null -ne $p.line) { $sh.Line.ForeColor.RGB = [int]$p.line; $sh.Line.Weight = 0.75 } else { $sh.Line.Visible = 0 }
    } else {
      $sh = $s1.Shapes.AddTextbox(1, [single]$p.x, [single]$p.y, [single]$p.w, [single]$p.h)
      $tf = $sh.TextFrame
      $tf.WordWrap = 0; $tf.AutoSize = 0; $tf.MarginLeft = 0; $tf.MarginRight = 0; $tf.MarginTop = 0; $tf.MarginBottom = 0; $tf.VerticalAnchor = 3
      $sh.Width = [single]$p.w; $sh.Height = [single]$p.h
      foreach ($r in @($p.runs)) {
        $tr = $tf.TextRange.InsertAfter([string]$r.t)
        $tr.Font.Name = 'Calibri'; $tr.Font.Size = [single]$p.size; $tr.Font.Bold = [int][bool]$r.b; $tr.Font.Color.RGB = [int]$r.c
      }
      $tf.TextRange.ParagraphFormat.Alignment = $(if ($p.align -eq 'r') { 3 } else { 1 })
    }
    $sh.Name = "EBT_R_$n"
  }

  # -- weekly QA status slide --
  # Names the shapes of a slide that was edited by hand from an earlier deck: tiles and column texts left to right.
  function Adopt-Weekly($sl) {
    $kpi = @(); $txt = @()
    foreach ($sh in $sl.Shapes) {
      if ($sh.Name -like 'QA_*') { continue }
      if ($sh.HasTable) { $sh.Name = $(if ($sh.Table.Cell(1, 1).Shape.TextFrame.TextRange.Text.Trim() -eq 'Status') { 'QA_DEF_TABLE' } else { 'QA_SC_TABLE' }); continue }
      $t = TextOf $sh
      if (-not $t) { continue }
      if ($t -like 'QA Status Summary*') { $sh.Name = 'QA_TITLE' }
      elseif ($t -like 'Open Defects*') { $sh.Name = 'QA_DEF_T' }
      elseif ($t -match '^\s*[\d,]+\s*h\s*$') { $kpi += $sh }
      elseif ($sh.Top -gt 170 -and $sh.Height -gt 120) { $txt += $sh }
    }
    if ($kpi.Count -eq 4) { $k = 0; foreach ($sh in ($kpi | Sort-Object { $_.Left })) { $sh.Name = 'QA_KPI_' + @('cc', 'sc', 'oneinc', 'total')[$k]; $k++ } }
    if ($txt.Count -eq 3) { $k = 0; foreach ($sh in ($txt | Sort-Object { $_.Left })) { $sh.Name = 'QA_TXT_' + @('cc', 'sc', 'oneinc')[$k]; $k++ } }
    # the defects table pasted as a picture, right under its title
    $dt = Named $sl 'QA_DEF_T'
    if ($dt -and -not (Named $sl 'QA_DEF_TABLE')) {
      foreach ($sh in $sl.Shapes) { if ($sh.Type -eq 13 -and $sh.Top -ge $dt.Top -and $sh.Top -le $dt.Top + 60 -and [Math]::Abs($sh.Left - $dt.Left) -lt 30) { $sh.Name = 'QA_DEF_TABLE'; break } }
    }
  }
  # A table from its description. One that is already a table of the same size keeps its look and only gets the new
  # values; anything else in its place (a picture, a table with other rows) is replaced where it stands.
  function Put-Table($sl, $spec) {
    if (-not $spec) { return }
    $rows = @($spec.rows); $nr = $rows.Count; $nc = @($rows[0]).Count
    $x = [single]$spec.x; $y = [single]$spec.y; $w = [single]$spec.w
    $oldT = Named $sl $spec.name
    if ($oldT) {
      if ($oldT.HasTable -and $oldT.Table.Rows.Count -eq $nr -and $oldT.Table.Columns.Count -eq $nc) {
        for ($r = 1; $r -le $nr; $r++) { for ($c = 1; $c -le $nc; $c++) { $oldT.Table.Cell($r, $c).Shape.TextFrame.TextRange.Text = [string]@($rows[$r - 1])[$c - 1].t } }
        return
      }
      $x = $oldT.Left; $y = $oldT.Top; $w = $oldT.Width; $oldT.Delete()
    }
    $tbl = $sl.Shapes.AddTable($nr, $nc, $x, $y, $w, [single]($nr * $spec.rowH))
    $tbl.Name = $spec.name
    $T = $tbl.Table
    $T.ApplyStyle('{2D5ABB26-0587-4C30-8999-92F81FD0307C}') # No Style, No Grid
    $sum = 0; foreach ($cw in @($spec.colW)) { $sum += $cw }
    for ($c = 1; $c -le $nc; $c++) { $T.Columns.Item($c).Width = [single]($w * @($spec.colW)[$c - 1] / $sum) }
    for ($r = 1; $r -le $nr; $r++) {
      for ($c = 1; $c -le $nc; $c++) {
        $d = @($rows[$r - 1])[$c - 1]
        $cell = $T.Cell($r, $c); $tf = $cell.Shape.TextFrame; $tr = $tf.TextRange
        $tr.Text = [string]$d.t
        $tr.Font.Name = 'Calibri'; $tr.Font.Size = [single]$spec.size; $tr.Font.Bold = [int][bool]$d.b; $tr.Font.Color.RGB = [int]$d.c
        $tr.ParagraphFormat.Alignment = $(if ($d.align -eq 'l') { 1 } else { 2 })
        $tf.MarginTop = 1; $tf.MarginBottom = 1; $tf.MarginLeft = 5; $tf.MarginRight = 5; $tf.VerticalAnchor = 3
        $cell.Shape.Fill.Solid(); $cell.Shape.Fill.ForeColor.RGB = [int]$d.fill
        foreach ($b in 1..4) {
          $bd = $cell.Borders.Item($b); $bd.Visible = -1
          if ($null -ne $spec.border) { $bd.ForeColor.RGB = [int]$spec.border; $bd.Weight = 0.5 } else { $bd.ForeColor.RGB = 0xFFFFFF; $bd.Weight = 1 }
        }
      }
    }
    for ($r = 1; $r -le $nr; $r++) { $T.Rows.Item($r).Height = [single]$spec.rowH }
  }

  $wk = $null
  foreach ($sl in $deck.Slides) {
    if ($sl.SlideID -eq $s1.SlideID) { continue }
    foreach ($sh in $sl.Shapes) { if ((TextOf $sh) -like 'QA Status Summary*') { $wk = $sl; break } }
    if ($wk) { break }
  }
  $weekly = $(if ($wk) { 'kept as it was' } else { 'none' })
  if ($WeeklyFile -and $data.weekly) {
    # a slide from before the 11/13 format (it still has the "Hours are Jira remaining estimates" footnote) is replaced
    if ($wk) { foreach ($sh in $wk.Shapes) { if ((TextOf $sh) -like 'Hours are Jira remaining estimates*') { $wk.Delete(); $wk = $null; break } } }
    if (-not $wk) {
      [void]$deck.Slides.InsertFromFile($WeeklyFile, 0, 1, 1)
      $wk = $deck.Slides.Item(1)
      # its own plain background, whatever the host deck's master carries
      $wk.FollowMasterBackground = 0; $wk.Background.Fill.Solid(); $wk.Background.Fill.ForeColor.RGB = 0xF2F2F2; $wk.DisplayMasterShapes = 0
      $weekly = 'new'
    } else {
      Adopt-Weekly $wk
      foreach ($k in @('cc', 'sc', 'oneinc', 'total')) { SetText $wk "QA_KPI_$k" $data.weekly.kpi.$k }
      if ($data.weekly.defTable) { SetText $wk 'QA_DEF_T' $data.weekly.defTitle }
      Put-Table $wk $data.weekly.scTable
      Put-Table $wk $data.weekly.defTable
      $weekly = 'numbers refreshed'
    }
  }

  # weekly first, then EBT
  if ($wk) { $wk.MoveTo(1); $s1.MoveTo(2) } else { $s1.MoveTo(1) }
  $deck.Save()
  $deck.Close()
  Write-Output "OK ebt=$ebt; weekly=$weekly"
} finally {
  # Leave PowerPoint running when the user has other decks open in it.
  if ($pp.Presentations.Count -eq 0) { $pp.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
}
