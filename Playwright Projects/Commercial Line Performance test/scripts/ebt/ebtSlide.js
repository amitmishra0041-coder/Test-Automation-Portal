// scripts/ebt/ebtSlide.js — the weekly EBT summary slide (layout approved 2026-11-11, right column as the user
// reworked it 2026-11-12): six tiles on top, then
// Released for EBT (Batch 1 / Batch 2) | EBT updates this week | Progress so far (by team) + JIRA by status.
// writeSlide writes a ONE-slide .pptx whose shapes are named (EBT_*). updateEbtDeck.ps1 inserts it as slide 1 the
// first time a deck is refreshed in this layout; after that it only refreshes the tiles and the week label in place,
// so the text the user edits each week in PowerPoint (batches, updates, the three left tiles) is never overwritten.
// The right column is data only and is redrawn on every refresh from rightColumn().
'use strict';

const PptxGenJS = require('pptxgenjs');

const N = '1F2A44', B = '2E5597', L = 'D9E2F3', A = 'E8A317', G = '4CAF50', T = '2A8C8C', D = '404040', GR = 'BFBFBF', RED = 'C0392B', F = 'Calibri';
const FEAT_ROWS = 4, STATUS_ROWS = 6;

// First-time text (as on the user's 11/12 slide). Edited in
// PowerPoint from then on.
const SEED = {
  batch1Head: ['Batch 1  ', 'Released - 43 of 84 items'],
  batch1: [['FNOL:', 'Intake / FNOL incl. XML upload, website, mobile'], ['Claim handling:', 'Catastrophe, Evaluation, Loss Details, Notes, Activities, Close Claim, Search'],
    ['Other:', 'Reinsurance, Subrogation, SIU, Policy Search, Contacts'], ['New 11/4:', 'Exposure & Reserve Rules'], ['Integrations:', 'Intersuite, Email, Symbility, Metro, HIMarley'], ['SmartCOMM:', '205 letter templates']],
  batch2Head: ['Batch 2  ', 'Planned 11/16'],
  batch2: [['Financials:', 'Reserves, Recovery, Recovery Reserves'], ['Claims:', 'ISO; Documents (Activity Assignment, Cotality)'], ['Integrations:', 'ImageRight, BOA, Claims Survey'], ['', 'Remaining CC document templates']],
  later: '11/23 Salvage, CCC, ERAC, Careworks  |  11/30 Payments, One Inc, Applied, Mainframe',
  updates: [['Access:', 'Cloud CC (Test) logins and roles - FNOL, queues, team view, workplan, assignments'], ['Test data:', 'policies and claims shared for WC, Property, Auto, MI PIP'],
    ['Scenarios:', 'EBT scenarios identification in progress'], ['Process:', 'tracker and DL reporting walked through'],
    ['Feedback logged:', 'Service Center FNOL, Auto, Auto Medical, Motor Vehicle']],
  target: 'all business testing and feedback complete by end of December 2026',
  tiles: [['43 of 84', 'CC / CM items released'], ['205 of 244', 'SmartCOMM templates'], ['35', 'Users participating in EBT']],
};

async function writeSlide(file) {
  const p = new PptxGenJS(); p.layout = 'LAYOUT_WIDE';
  const s = p.addSlide(); s.background = { color: 'F2F2F2' };
  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: 'F2F2F2' }, line: { color: 'F2F2F2' }, objectName: 'EBT_BG' }); // covers the host deck's master art
  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: N }, objectName: 'EBT_HDR' });
  s.addText('EBT Status Summary - ClaimCenter', { x: 0.4, y: 0.1, w: 8.5, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: 'FFFFFF', isTextBox: true, objectName: 'EBT_TITLE' });
  s.addText('Week 1', { x: 9.3, y: 0.15, w: 3.7, h: 0.5, fontFace: F, fontSize: 12, color: L, align: 'right', isTextBox: true, objectName: 'EBT_WEEK' });

  const tiles = [...SEED.tiles.map((t, i) => [...t, [N, B, T][i], ['items', 'tpl', 'users'][i]]), ['0', 'Total observations', N, 'obs'], ['0', 'JIRA reported', B, 'jira'], ['0', 'Open JIRAs', A, 'open']];
  tiles.forEach(([n, l, c, key], i) => {
    const x = 0.4 + i * 2.1, y = 0.98, w = 1.95;
    s.addShape('roundRect', { x, y, w, h: 0.95, fill: { color: 'FFFFFF' }, line: { color: GR, width: 0.75 }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: y + 0.12, w: 0.08, h: 0.71, fill: { color: c } });
    s.addText(n, { x: x + 0.2, y: y + 0.04, w: w - 0.3, h: 0.55, fontFace: F, fontSize: 24, bold: true, color: c, isTextBox: true, margin: 0, wrap: false, objectName: `EBT_KPI_${key}` });
    s.addText(l, { x: x + 0.2, y: y + 0.6, w: w - 0.3, h: 0.28, fontFace: F, fontSize: 11, color: D, isTextBox: true, margin: 0 });
  });
  const box = (x, y, w, h, t, name) => {
    s.addShape('rect', { x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: GR, width: 0.75 } });
    s.addShape('rect', { x, y, w, h: 0.36, fill: { color: B } });
    s.addText(t, { x: x + 0.12, y, w: w - 0.2, h: 0.36, fontFace: F, fontSize: 13, bold: true, color: 'FFFFFF', isTextBox: true, margin: 0, ...(name ? { objectName: name } : {}) });
  };
  const para = (x, y, w, h, items, fs, name) => {
    const out = [];
    items.forEach(([label, text], i) => {
      out.push({ text: label ? `${label} ` : '', options: { bold: true, color: N, bullet: { code: '25AA' } } });
      out.push({ text, options: { color: D, breakLine: i < items.length - 1 } });
    });
    s.addText(out, { x, y, w, h, fontFace: F, fontSize: fs, valign: 'top', paraSpaceAfter: 5, isTextBox: true, objectName: name });
  };
  const top = 2.13, H = 5.17;
  // left: releases
  box(0.4, top, 4.05, H, 'Released for EBT');
  const head = ([a, b], c, y, name) => s.addText([{ text: a, options: { bold: true, color: c } }, { text: b, options: { color: D, bold: true } }], { x: 0.5, y, w: 3.9, h: 0.32, fontFace: F, fontSize: 12, isTextBox: true, objectName: name });
  head(SEED.batch1Head, G, top + 0.42, 'EBT_TXT_batch1_head');
  para(0.5, top + 0.75, 3.88, 1.95, SEED.batch1, 10, 'EBT_TXT_batch1');
  s.addShape('line', { x: 0.55, y: top + 2.72, w: 3.75, h: 0, line: { color: GR, dashType: 'dash' } });
  head(SEED.batch2Head, A, top + 2.78, 'EBT_TXT_batch2_head');
  para(0.5, top + 3.1, 3.88, 1.15, SEED.batch2, 10, 'EBT_TXT_batch2');
  s.addShape('line', { x: 0.55, y: top + 4.3, w: 3.75, h: 0, line: { color: GR, dashType: 'dash' } });
  s.addText([{ text: 'Later:  ', options: { bold: true, color: '7F7F7F' } }, { text: SEED.later, options: { color: D } }], { x: 0.5, y: top + 4.36, w: 3.88, h: 0.7, fontFace: F, fontSize: 9.5, valign: 'top', isTextBox: true, objectName: 'EBT_TXT_later' });
  // middle: this week
  box(4.6, top, 4.25, H, 'EBT updates this week');
  para(4.7, top + 0.45, 4.08, 3.9, SEED.updates, 10.5, 'EBT_TXT_updates');
  s.addShape('rect', { x: 4.72, y: top + H - 0.72, w: 4.01, h: 0.6, fill: { color: L }, line: { color: L } });
  s.addText([{ text: 'Target: ', options: { bold: true, color: N } }, { text: SEED.target, options: { color: N } }], { x: 4.8, y: top + H - 0.72, w: 3.9, h: 0.6, fontFace: F, fontSize: 11, valign: 'middle', isTextBox: true, objectName: 'EBT_TXT_target' });
  // right: Progress so far + JIRA by status are drawn by the refresh itself (rightColumn below)
  await p.writeFile({ fileName: file });
  return file;
}

// ── right column (format of the 11/12 deck): "Progress so far" = scenarios by team and status from the teams' test
// case workbook, above "JIRA by status". It is all data, so it is drawn again on every refresh: this returns plain
// rectangles and texts (points; colours as BGR ints, what PowerPoint's COM API takes) and updateEbtDeck.ps1 clears
// the column and places them. Each team's bar is its own 100%, so a team with 10 scenarios reads as clearly as one
// with 80. Without the workbook the top panel falls back to "Top feedback areas" from the tracker.
const bgr = (hex) => parseInt(hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2), 16);
const COL = { x: 648, y: 153.4, w: 283, h: 372.2, head: 25.9, gap: 8.6, progressH: 222 };
const SEG = [['completed', 'Completed', G], ['issue', 'Issue reported', RED], ['inProgress', 'In progress', B], ['blocked', 'Blocked', '7F7F7F'], ['notStarted', 'Not started', 'D9D9D9']];
function rightColumn({ cases, feat, featTitle, status, statusTitle, note }) {
  const out = [];
  const rect = (x, y, w, h, fill, line) => out.push({ k: 'r', x, y, w, h, fill: bgr(fill), line: line ? bgr(line) : null });
  // runs: 'text' or [[text, colour, bold], ...]
  const text = (x, y, w, h, runs, size, align = 'l') => out.push({ k: 't', x, y, w, h, size, align, runs: (typeof runs === 'string' ? [[runs]] : runs).map(([t, c, b]) => ({ t: String(t), c: bgr(c || D), b: !!b })) });
  const panel = (y, h, title) => { rect(COL.x, y, COL.w, h, 'FFFFFF', GR); rect(COL.x, y, COL.w, COL.head, B); text(COL.x + 8.6, y, COL.w - 14, COL.head, [[title, 'FFFFFF', true]], 13); };
  const lx = COL.x + 8.6, inner = COL.w - 17;
  // label | bar | count rows; they close up when there are more of them than fit at the normal spacing
  const bars = (y, avail, rows, maxGap) => {
    const gap = Math.min(maxGap, avail / Math.max(1, rows.length)), bh = Math.min(15.8, gap - 4), max = Math.max(1, ...rows.map((r) => r.n));
    rows.forEach((r, i) => {
      const yy = y + i * gap, w = Math.max(9, 126 * r.n / max);
      text(lx, yy, 104, bh + 4, r.label, 10.5);
      rect(COL.x + 113, yy + 2, w, bh, r.color);
      text(COL.x + 113 + w + 5, yy, 32, bh + 4, [[r.n, N, true]], 10.5);
    });
  };

  if (cases) {
    const t = cases.total, pct = t.scenarios ? Math.round(100 * t.completed / t.scenarios) : 0;
    panel(COL.y, COL.progressH, 'Progress so far');
    text(lx, COL.y + 30, inner, 16, [[t.scenarios, N, true], [' scenarios  |  '], [t.completed, G, true], [' completed  |  '], [t.issue, RED, true], [` issue${t.issue === 1 ? '' : 's'}  |  `], [`${pct}%`, N, true], [' done']], 9.5);
    const rowH = Math.min(14.6, 146 / cases.teams.length), bx = COL.x + 116, bw = 108, bh = Math.min(9, rowH - 4);
    cases.teams.forEach((tm, i) => {
      const y = COL.y + 50 + i * rowH, by = y + (rowH - bh) / 2;
      text(lx, y, 106, rowH, tm.team.replace(/^Service Center\s+/i, ''), 9);
      if (!tm.scenarios) { rect(bx, by, bw, bh, 'FFFFFF', 'D9D9D9'); text(bx + bw + 5, y, 46, rowH, [['none yet', 'A6A6A6']], 8.5); return; }
      let x = bx;
      SEG.forEach(([key, , color]) => { const w = bw * tm[key] / tm.scenarios; if (w > 0) { rect(x, by, w, bh, color); x += w; } });
      text(bx + bw + 5, y, 46, rowH, [[tm.completed, N, true], [` of ${tm.scenarios}`]], 8.5);
    });
    // legend: only the statuses in use, so it stays on one line
    let x = lx; const ly = COL.y + COL.progressH - 17;
    SEG.filter(([key]) => t[key] || key === 'completed' || key === 'notStarted').forEach(([, label, color]) => {
      rect(x, ly + 4, 6, 6, color);
      const w = label.length * 3.5 + 3;
      text(x + 9, ly, w, 14, [[label, '7F7F7F']], 7.5); x += 9 + w + 5;
    });
  } else {
    panel(COL.y, COL.progressH, featTitle);
    bars(COL.y + COL.head + 12, COL.progressH - COL.head - 20, feat, 32);
  }
  const sTop = COL.y + COL.progressH + COL.gap, sH = COL.y + COL.h - sTop;
  panel(sTop, sH, statusTitle);
  bars(sTop + COL.head + 8, sH - COL.head - 8 - 24, status, 28);
  if (note) text(lx, sTop + sH - 23, inner, 18, [[note, '7F7F7F']], 10);
  return out;
}

// The numbers the slide shows, from the tracker entries and (cases) the test case workbook's progress by team.
const STATUS_COLOR = { Fixed: G, 'Ready for Retest': G, Closed: G, Rejected: GR, Deferred: GR, 'In Business Review': T };
const DONE = new Set(['Fixed', 'Closed', 'Rejected', 'Deferred']);
function slideData(entries, statusOrder, cases = null, now = new Date()) {
  const jira = entries.filter((e) => /^[A-Z][A-Z0-9]+-\d+$/.test(e.jiraId));
  const count = (list, f) => { const m = new Map(); for (const e of list) { const k = f(e) || 'Not set'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()]; };
  // Top feedback areas: the biggest three + everything else as one bar, so the panel never outgrows its box.
  let feat = count(entries, (e) => e.feature).sort((a, b) => b[1] - a[1]);
  if (feat.length > FEAT_ROWS) feat = [...feat.slice(0, FEAT_ROWS - 1), ['All other areas', feat.slice(FEAT_ROWS - 1).reduce((n, f) => n + f[1], 0)]];
  const idx = (st) => { const i = statusOrder.indexOf(st); return i < 0 ? 999 : i; };
  let status = count(jira, (e) => e.status).sort((a, b) => idx(a[0]) - idx(b[0]));
  if (status.length > STATUS_ROWS) status = [...status.slice(0, STATUS_ROWS - 1), ['Other', status.slice(STATUS_ROWS - 1).reduce((n, f) => n + f[1], 0)]];
  const prio = ['Critical', 'High', 'Medium', 'Low'].map((p) => [p, jira.filter((e) => e.priority === p).length]).filter(([, n]) => n);
  const start = new Date(`${process.env.EBT_START_DATE || '2026-11-09'}T00:00:00`);
  const week = Math.max(1, Math.floor((now - start) / (7 * 864e5)) + 1);
  return {
    kpi: { obs: entries.length, jira: jira.length, open: jira.filter((e) => !DONE.has(e.status)).length },
    week: `Week ${week}  |  ${now.toLocaleDateString('en-US')}`,
    region: { x: COL.x, y: COL.y },
    right: rightColumn({
      cases, note: prio.map(([p, n]) => `${p} ${n}`).join('  |  '),
      featTitle: `Top feedback areas (${entries.length})`, feat: feat.map(([label, n], i) => ({ label, n, color: label === 'All other areas' ? GR : i < 2 ? B : T })),
      statusTitle: `JIRA by status (${jira.length})`, status: status.map(([label, n]) => ({ label, n, color: STATUS_COLOR[label] || A })),
    }),
  };
}

module.exports = { writeSlide, slideData };
