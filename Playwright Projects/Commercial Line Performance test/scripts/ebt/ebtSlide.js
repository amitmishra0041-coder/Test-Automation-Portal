// scripts/ebt/ebtSlide.js — the weekly EBT summary slide (layout approved 2026-11-11): six tiles on top, then
// Released for EBT (Batch 1 / Batch 2) | EBT updates this week | Top feedback areas + JIRA by status.
// Writes a ONE-slide .pptx whose shapes are named (EBT_*). updateEbtDeck.ps1 inserts it as slide 1 the first time a
// deck is refreshed in this layout; after that it only refreshes the named data shapes in place, so the text the
// user edits each week in PowerPoint (batches, updates, the three left tiles) is never overwritten.
// The bar rows here are placeholders (FEAT_ROWS / STATUS_ROWS of them) — the .ps1 fills, sizes and hides them.
'use strict';

const PptxGenJS = require('pptxgenjs');

const N = '1F2A44', B = '2E5597', L = 'D9E2F3', A = 'E8A317', G = '4CAF50', T = '2A8C8C', D = '404040', GR = 'BFBFBF', F = 'Calibri';
const FEAT_ROWS = 4, STATUS_ROWS = 6;
const BAR = { x: 9.12, labelW: 1.45, maxW: 1.75, gap: 0.45 }; // inches; the .ps1 gets these in points

// First-time text (week of 11/11/2026, from the user's own slide and the 11/5 EBT readiness deck). Edited in
// PowerPoint from then on.
const SEED = {
  batch1Head: ['Batch 1  ', 'Released - 43 of 84 items'],
  batch1: [['FNOL:', 'Intake / FNOL incl. XML upload, website, mobile'], ['Claim handling:', 'Catastrophe, Evaluation, Loss Details, Notes, Activities, Close Claim, Search'],
    ['Other:', 'Reinsurance, Subrogation, SIU, Policy Search, Contacts'], ['New 11/4:', 'Exposure & Reserve Rules'], ['Integrations:', 'Intersuite, Email, Symbility, Metro, HIMarley'], ['SmartCOMM:', '205 letter templates']],
  batch2Head: ['Batch 2  ', 'Planned 11/16'],
  batch2: [['Financials:', 'Reserves, Recovery, Recovery Reserves'], ['Claims:', 'ISO; Documents (Activity Assignment, Cotality)'], ['Integrations:', 'Verisk, ImageRight, Reporting, Cotality, WSAP, BOA, Survey API']],
  later: '11/23 Salvage, CCC, ERAC, Careworks  |  11/30 Payments, One Inc, SmartCOMM, Applied, Mainframe',
  updates: [['Access:', 'Cloud CC (Test) logins and roles - FNOL, queues, team view, workplan, assignments'], ['Test data:', 'policies and claims shared for WC, Property, Auto, MI PIP'],
    ['Scenarios:', 'teams picking first scenarios; deck examples as a guide'], ['Process:', 'tracker and DL reporting walked through'],
    ['Feedback logged:', 'Service Center FNOL, Auto, Auto Medical, Motor Vehicle'], ['Starting this week:', 'Property, BI / GLPD, Subrogation, Workers Comp, Reinsurance, Claims Team'],
    ['Risk:', 'teams test alongside daily claim work; weekly targets keep progress visible']],
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
      out.push({ text: `${label} `, options: { bold: true, color: N, bullet: { code: '25AA' } } });
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
  // right: the two graphs (placeholder rows)
  const rows = (g, y, n) => {
    for (let i = 1; i <= n; i++) {
      const yy = y + (i - 1) * BAR.gap;
      s.addText('-', { x: BAR.x, y: yy, w: BAR.labelW, h: 0.3, fontFace: F, fontSize: 10.5, color: D, isTextBox: true, margin: 0, wrap: false, objectName: `EBT_${g}_L${i}` });
      s.addShape('rect', { x: BAR.x + BAR.labelW, y: yy + 0.04, w: 0.5, h: 0.22, fill: { color: B }, line: { color: 'FFFFFF', width: 0 }, objectName: `EBT_${g}_B${i}` });
      s.addText('0', { x: BAR.x + BAR.labelW + 0.6, y: yy, w: 0.45, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: N, isTextBox: true, margin: 0, objectName: `EBT_${g}_V${i}` });
    }
  };
  box(9.0, top, 3.93, 2.5, 'Top feedback areas', 'EBT_feat_T'); rows('feat', top + 0.55, FEAT_ROWS);
  box(9.0, top + 2.67, 3.93, 2.5, 'JIRA by status', 'EBT_status_T'); rows('status', top + 3.17, STATUS_ROWS);
  s.addText('-', { x: BAR.x, y: top + 4.82, w: 3.7, h: 0.28, fontFace: F, fontSize: 10, color: '7F7F7F', isTextBox: true, margin: 0, objectName: 'EBT_status_N' });
  await p.writeFile({ fileName: file });
  return file;
}

// The numbers the slide shows, from the tracker entries. Colours are BGR ints (what PowerPoint's COM API takes).
const bgr = (hex) => parseInt(hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2), 16);
const STATUS_COLOR = { Fixed: G, 'Ready for Retest': G, Closed: G, Rejected: GR, Deferred: GR, 'In Business Review': T };
const DONE = new Set(['Fixed', 'Closed', 'Rejected', 'Deferred']);
function slideData(entries, statusOrder, now = new Date()) {
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
    feat: { avail: 1.85 * 72, title: `Top feedback areas (${entries.length})`, rows: feat.map(([label, n], i) => ({ label, n, color: bgr(label === 'All other areas' ? GR : i < 2 ? B : T) })) },
    status: { avail: 1.6 * 72, title: `JIRA by status (${jira.length})`, note: prio.map(([p, n]) => `${p} ${n}`).join('  |  '), rows: status.map(([label, n]) => ({ label, n, color: bgr(STATUS_COLOR[label] || A) })) },
    bar: { maxW: BAR.maxW * 72, gap: BAR.gap * 72 },
  };
}

module.exports = { writeSlide, slideData };
