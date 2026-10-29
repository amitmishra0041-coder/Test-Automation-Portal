// Generates the QA Sprint Status deck (PowerPoint) from Jira and, when JIRA_REPORT_EMAIL_TO is set, emails it.
//
// Slide 1 "QA Status Summary - ClaimCenter": ClaimCenter (incl. enhancements) | SMARTCOMM | OneInc columns (completed this
//   sprint, in progress, spillovers), SmartCOMM's design/execution summary, and the open-defects table.
// Slide 2 "Day-by-Day Progress": per track, the items completed and started on each of the last 5 working days.
// Slide 3 "Week-by-Week Progress": the same per Friday–Thursday week, the last 6 weeks.
// No per-person reporting (per the QA lead's direction); Nautilus/Other is not included.
//
// Data (read-only):
//   - jiraReport.js's own ClaimCenter, Enhancement and SmartComm JQLs (TRACK_DEFS) — open work, hours = remaining
//     estimate. Enhancement items named "OneInc"/"One Inc" form the OneInc area; the rest count under ClaimCenter.
//   - the same JQLs with status Closed/Done in the open sprint — "completed this sprint".
//   - the SmartComm JQL without its status filter — the overall design/execution progress table.
//   - DEFECTS_JQL (the QA lead's defect filter: GCCM, GCMDT, GCMDW, GCMR + SMART) — the open-defects table.
// Spillover ≈ current-sprint work that won't fit in the working days left at HOURS_PER_DAY per assignee (computed
// per assignee but only shown per area); impeded work counts in full.
//
// Run directly:  node scripts/jiraStatusDeck.js [outputPath.pptx]
// Or from the runner's "Jira Sprint Report" tab (Report type: Sprint status deck).
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PptxGenJS = require('pptxgenjs');
const { TRACK_DEFS } = require('./jiraReport');
const statusNotes = require('./statusNotes');

const JIRA_SITE = process.env.JIRA_SITE;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const DEFECTS_JQL = 'project IN (GCCM, GCMDT, GCMDW, GCMR, SMART) AND type IN (Bug, Defect) AND status NOT IN (Closed, Rejected) ORDER BY assignee ASC, created DESC';
const SEVERITY_FIELD = 'customfield_10137'; // "Severity" (GCCM / SMART bugs) — the open-defects table counts by it
const HOURS_PER_DAY =Number(process.env.STATUS_DECK_HOURS_PER_DAY) || 8;
const FIELDS = ['summary', 'issuetype', 'assignee', 'status', 'timeestimate', 'timeoriginalestimate', 'timespent', 'customfield_10020', 'priority', 'resolutiondate', SEVERITY_FIELD];

async function search(jql) {
  const issues = [];
  let nextPageToken;
  for (let page = 0; page < 50; page++) {
    let resp;
    try {
      resp = await axios.post(`https://${JIRA_SITE}/rest/api/3/search/jql`, { jql, fields: FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }, {
        auth: { username: JIRA_EMAIL, password: JIRA_API_TOKEN }, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(`Jira search failed for JQL "${jql.slice(0, 80)}...": ${e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message}`);
    }
    issues.push(...(resp.data.issues || []));
    if (!resp.data.nextPageToken) break;
    nextPageToken = resp.data.nextPageToken;
  }
  return issues.map((i) => {
    const f = i.fields;
    return {
      key: i.key, summary: f.summary || '', status: (f.status && f.status.name) || '',
      assignee: f.assignee ? f.assignee.displayName : 'Unassigned', priority: f.priority ? f.priority.name : '',
      rem: (f.timeestimate || 0) / 3600, orig: (f.timeoriginalestimate || 0) / 3600, spent: (f.timespent || 0) / 3600,
      sprints: (f.customfield_10020 || []).filter(Boolean).map((s) => ({ name: s.name, state: s.state, start: s.startDate, end: s.endDate })),
      resolved: f.resolutiondate || null,
      severity: f[SEVERITY_FIELD] ? (f[SEVERITY_FIELD].value || f[SEVERITY_FIELD].name || String(f[SEVERITY_FIELD])) : '',
    };
  });
}
const withoutStatusFilter = (jql) => jql.replace(/\s+AND\s+status\s+NOT\s+IN\s*\([^)]*\)/i, '');
// Jira's openSprints() means the ACTIVE sprint only — next-sprint work finished early sits in futureSprints() (2026-10-15:
// nine SMART items done in Sprint 6 were missing from "picked up early" and "completed this week").
const doneInOpenSprint = (jql) => `${withoutStatusFilter(jql)} AND status IN (Closed, Done) AND (sprint in openSprints() OR sprint in futureSprints())`;

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────
const h = (n) => `${Math.round(n * 10) / 10} h`;
const sum = (a) => a.reduce((x, i) => x + (i.rem || 0), 0);
const doneH = (i) => i.orig || i.spent || 0;
const isImpeded = (i) => /impeded|blocked/i.test(i.status);
const inProg = (i) => /in progress|in review/i.test(i.status);
const readyQa = (i) => /ready for qa/i.test(i.status);
const isOneInc = (i) => /one\s*inc/i.test(i.summary);
const phase = (s) => (/test[ _-]*design/i.test(s) ? 'Design' : /test[ _-]*exec/i.test(s) ? 'Execution' : '');
// Readable item names: drop the "CC_Test Execution_OneInc_" / "Test Execution - Integration - " scaffolding.
function nice(s) {
  return String(s)
    .replace(/^CC_Test[ _](Execution|Design)_(OneInc_)?/i, '')
    .replace(/^CC_Test_Execution_/i, '')
    .replace(/^Test[ _-]*(execution|design)\s*-\s*(Integration|Feature|Common)\s*-\s*/i, '$2: ')
    .replace(/^Test[ _-]*(execution|design)\s*-\s*/i, '')
    .replace(/_Test[_ ](Execution|Design)$/i, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
function groupOf(i) {
  const t = i.summary;
  if (i.area === 'SmartComm') return /^DIG\s*\d/i.test(t) ? 'DIG letter templates' : /delivery channel/i.test(t) ? 'Delivery channels' : /^BC_|statement|notice|invoice|dunning|EFT|deposit|bill/i.test(t) ? 'Billing notices (BC)' : 'CC/BC features';
  if (i.area === 'OneInc') return nice(t).replace(/\s*part\s*\d+$/i, '');
  if (/regression/i.test(t)) return 'Regression';
  if (/performance/i.test(t)) return 'Performance';
  if (/financials/i.test(t)) return 'Financials';
  if (/careworks|erac|imageright|image right|smartcomm|cotality|document/i.test(t)) return 'Enhancement integrations';
  if (/integration/i.test(t)) return 'Integrations';
  return 'Features, rules & carry-over';
}
const groupHours = (list) => { const m = new Map(); for (const i of list) m.set(groupOf(i), (m.get(groupOf(i)) || 0) + i.rem); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const groupCounts = (list) => { const m = new Map(); for (const i of list) m.set(groupOf(i), (m.get(groupOf(i)) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const workDays = (from, to) => { let n = 0; const d = new Date(from); d.setHours(0, 0, 0, 0); while (d < to) { if (d.getDay() % 6) n++; d.setDate(d.getDate() + 1); } return n; };
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const sprintNo = (name) => { const m = String(name || '').match(/sprint\s*(\d+)/i); return m ? Number(m[1]) : null; };

// Status history for the day-by-day / week-by-week slides: every track item touched in the last HISTORY_DAYS, with
// when it was STARTED (first move into In Progress, or straight into In Review — "Ready for QA" only means ready to
// start) and when it was COMPLETED (its last move into Done/Closed, counted only while it's still done).
const HISTORY_DAYS = 45;
async function searchHistory(jql) {
  const out = [];
  let nextPageToken;
  for (let page = 0; page < 50; page++) {
    let resp;
    try {
      resp = await axios.post(`https://${JIRA_SITE}/rest/api/3/search/jql`, { jql, fields: ['summary', 'status'], expand: 'changelog', maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }, {
        auth: { username: JIRA_EMAIL, password: JIRA_API_TOKEN }, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(`Jira history search failed for JQL "${jql.slice(0, 80)}...": ${e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message}`);
    }
    for (const i of resp.data.issues || []) {
      const moves = ((i.changelog && i.changelog.histories) || [])
        .flatMap((hh) => hh.items.filter((it) => it.field === 'status').map((it) => ({ at: new Date(hh.created), to: it.toString || '' })))
        .sort((a, b) => a.at - b.at);
      const startMove = moves.find((m) => /in progress|in review/i.test(m.to));
      const doneNow = /^(done|closed)$/i.test((i.fields.status && i.fields.status.name) || '');
      const doneMove = doneNow ? [...moves].reverse().find((m) => /^(done|closed)$/i.test(m.to)) : null;
      out.push({ key: i.key, summary: i.fields.summary || '', started: startMove ? startMove.at : null, completed: doneMove ? doneMove.at : null });
    }
    if (!resp.data.nextPageToken) break;
    nextPageToken = resp.data.nextPageToken;
  }
  return out;
}

async function collect() {
  const areaOf = (q, i) => (q === 'SmartComm' ? 'SmartComm' : isOneInc(i) ? 'OneInc' : 'ClaimCenter');
  const items = []; const doneItems = []; const history = [];
  for (const q of ['ClaimCenter', 'Enhancement', 'SmartComm']) {
    const jql = TRACK_DEFS[q].jql;
    for (const i of await search(jql)) items.push({ ...i, area: areaOf(q, i), track: q, current: i.sprints.some((s) => s.state === 'active') });
    for (const i of await search(doneInOpenSprint(jql))) doneItems.push({ ...i, area: areaOf(q, i) });
    for (const i of await searchHistory(`${withoutStatusFilter(jql)} AND updated >= -${HISTORY_DAYS}d`)) history.push({ ...i, area: areaOf(q, i) });
  }
  const scAll = await search(withoutStatusFilter(TRACK_DEFS.SmartComm.jql));
  const bugs = await search(DEFECTS_JQL);
  return { items, doneItems, scAll, bugs, history };
}

function buildDeck({ items, doneItems, scAll, bugs, history = [], notes = {}, deckText = {} }) {
  // This week's blocker / dependency notes from the QA lead's status email (statusNotes.js), by Jira key.
  const noteOf = (i) => (notes[i.key] && notes[i.key].note) || '';
  const firstLine = (t) => String(t).split('\n')[0];
  const NOW = new Date();
  // Current (active) and next (future) sprint, from the items' own sprint data.
  const all = items.flatMap((i) => i.sprints);
  const active = all.filter((s) => s.state === 'active' && s.end).sort((a, b) => new Date(a.end) - new Date(b.end))[0];
  const future = all.filter((s) => s.state === 'future' && s.start).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  if (!active) throw new Error('No active sprint found on any item — nothing to report for the current sprint.');
  const cur = sprintNo(active.name); const nxt = future ? sprintNo(future.name) : (cur ? cur + 1 : null);
  const S = cur ? `Sprint ${cur}` : 'Current sprint'; const SS = cur ? `S${cur}` : 'Cur.';
  const N = nxt ? `Sprint ${nxt}` : 'Next sprint';
  const curEnd = new Date(active.end);
  const daysLeft = Math.max(0, workDays(NOW, curEnd) - (NOW.getHours() >= 12 ? 0.5 : 0));

  // Potential spillover = the impeded work in the current sprint (per the QA lead: what's blocked won't finish).
  const spill = (list) => sum(list.filter(isImpeded));
  // "This week" = since Monday 00:00 (local time of the machine generating the deck).
  const weekStart = new Date(NOW); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const inActive = (i) => i.sprints.some((s) => s.state === 'active');
  const area = (key) => {
    const c = items.filter((i) => i.area === key && i.current);
    const n = items.filter((i) => i.area === key && !i.current);
    const done = doneItems.filter((i) => i.area === key);
    const d5 = done.filter(inActive); // completed current-sprint work
    return {
      s5: c, s6: n, d5, spill: spill(c), imp: c.filter(isImpeded),
      week: done.filter((i) => i.resolved && new Date(i.resolved) >= weekStart), // completed this week (any open sprint)
      // Next-sprint work already picked up: finished early, or in progress / in review now.
      pickedDone: done.filter((i) => !inActive(i)), pickedProg: n.filter(inProg),
    };
  };
  const A = { ClaimCenter: area('ClaimCenter'), SmartComm: area('SmartComm'), OneInc: area('OneInc') };
  const curAll = items.filter((i) => i.current); const nextAll = items.filter((i) => !i.current);
  const spillAll = A.ClaimCenter.spill + A.SmartComm.spill + A.OneInc.spill;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  const NAVY = '1F3864'; const FONT = 'Calibri';
  const COL = { ClaimCenter: '2E5597', SmartComm: '2C8C8C', OneInc: '4CAF50' };

  const titleBar = (slide, title, sub) => {
    slide.background = { color: '1B2A47' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.6, fill: { color: '2E5597' } });
    slide.addText(title, { x: 0, y: 0, w: 13.33, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: 'FFFFFF', align: 'center' });
    if (sub) slide.addText(sub, { x: 0.15, y: 0.62, w: 13.0, h: 0.52, fontFace: FONT, fontSize: 12, color: 'FFFFFF', valign: 'middle' });
  };
  const strip = (slide, x, y, w, a) => {
    const cells = [[`${S} remaining`, h(sum(a.s5)), NAVY], ['(impeded)', h(a.spill), NAVY]];
    const cw = w / cells.length;
    cells.forEach(([label, val, c], n) => {
      slide.addText([{ text: val, options: { bold: true, fontSize: 12, color: c, breakLine: true } }, { text: label, options: { fontSize: 8, color: '555555' } }],
        { x: x + n * cw, y, w: cw, h: 0.5, fontFace: FONT, align: 'center', valign: 'middle', fill: { color: 'FFFFFF' }, line: { color: 'D0D0D0', width: 0.5 } });
    });
  };
  // Column: coloured header + body (hours strip on top) with bullet sections [{ head, lines: [{ t, level, bold, color }] }].
  const column = (slide, x, y, w, hgt, title, color, sections, fontSize, a, textHgt = hgt) => {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.42, fill: { color }, line: { color: 'FFFFFF', width: 1 } });
    slide.addText(title, { x, y, w, h: 0.42, fontFace: FONT, fontSize: 17, bold: true, color: 'FFFFFF', align: 'center' });
    // Full lists, so pick the largest font (down to 6 pt) whose estimated wrapped height fits the column body.
    const secs = sections.filter((z) => z.lines.length);
    const bodyPt = (textHgt - (a ? 1.07 : 0.57)) * 72;
    const usedPt = (fs) => {
      const charsPerLine = Math.max(10, ((w - 0.5) * 72) / (fs * 0.47));
      let lines = 0;
      for (const z of secs) { lines += Math.ceil(z.head.length / charsPerLine) + 0.25; for (const l of z.lines) lines += Math.ceil(String(l.t).length / charsPerLine); }
      return lines * fs * 1.2;
    };
    const fits = (fs) => usedPt(fs) <= bodyPt;
    let fsz = fontSize;
    while (fsz > 6 && !fits(fsz)) fsz -= 0.5;
    fontSize = fsz;
    const runs = [];
    for (const s of secs) {
      runs.push({ text: s.head, options: { bold: true, breakLine: true, fontSize: fontSize + 0.5, color: '000000', paraSpaceBefore: 3 } });
      for (const l of s.lines) runs.push({ text: l.t, options: { bullet: l.plain ? false : { indent: l.level ? 12 : 10 }, indentLevel: l.level || 0, bold: !!l.bold, color: l.color || '222222', breakLine: true, fontSize } });
    }
    slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.42, w, h: hgt - 0.42, fill: { color: 'F5F5F5' }, line: { color: 'D0D0D0', width: 0.75 } });
    // No hours strip when `a` is null (the progress slides) — the text starts right under the header.
    const top = a ? 0.97 : 0.47;
    slide.addText(runs.length ? runs : [{ text: 'Nothing to report.', options: { fontSize, color: '666666' } }], { x, y: y + top, w, h: textHgt - top, fontFace: FONT, valign: 'top', margin: [2, 6, 4, 6] });
    if (a) strip(slide, x + 0.04, y + 0.45, w - 0.08, a);
    return y + top + usedPt(fontSize) / 72 + 0.08; // estimated bottom of the text (inches)
  };
  const cap = (list, n, fmt) => list.map(fmt); // full lists (no "+N more") — column() shrinks the text to fit
  // SmartCOMM lists: every DIG template in one compact bullet ("DIG letter templates (13): 242, 241 ..."),
  // other items one per line — the full list stays readable on one slide.
  const digNo = (i) => { const m = i.summary.match(/^DIG\s*(\d+[A-Z]?)/i); return m ? m[1].toUpperCase() : null; };
  // One line per outstanding item: "(not started)" for To Do, "— impeded" (+ the weekly note's first line) for impeded.
  const outstanding = (i) => {
    if (isImpeded(i)) return { t: `${nice(i.summary)} — impeded${noteOf(i) ? `: ${firstLine(noteOf(i))}` : ''}` };
    return { t: `${nice(i.summary)}${/to do/i.test(i.status) ? ' (not started)' : ''}` };
  };
  const compactDigs = (list) => {
    const digs = list.filter(digNo); const rest = list.filter((i) => !digNo(i));
    const out = rest.map(outstanding);
    const open = digs.filter((i) => !isImpeded(i)); const imp = digs.filter(isImpeded);
    if (open.length) out.push({ t: `DIG letter templates (${open.length}): ${[...new Set(open.map(digNo))].join(', ')}` });
    if (imp.length) out.push({ t: `DIG letter templates — impeded (${imp.length}): ${[...new Set(imp.map(digNo))].join(', ')}` });
    return out;
  };
  const picked = (a) => [...a.pickedDone.map((i) => ({ t: `${nice(i.summary)} — done` })), ...a.pickedProg.map((i) => ({ t: `${nice(i.summary)} — ${i.status.toLowerCase()}` }))];
  const withPhase = (i) => ({ t: `${nice(i.summary)}${phase(i.summary) ? ` (${phase(i.summary).toLowerCase()})` : ''}` });
  // "Item – status" lines as the QA lead writes them: impeded items carry the weekly note (what they're awaiting, ETA).
  const statusText = (i) => {
    const note = noteOf(i) ? firstLine(noteOf(i)) : '';
    if (isImpeded(i)) return `Impeded${note ? `; ${note}` : ''}`;
    const st = inProg(i) ? `${(phase(i.summary) || 'testing').replace(/^Design$/, 'design').replace(/^Execution$/, 'execution')} in progress`
      : /to do/i.test(i.status) ? 'not started' : readyQa(i) ? 'ready for QA' : i.status.toLowerCase();
    return `${st.charAt(0).toUpperCase()}${st.slice(1)}${note ? `; ${note}` : ''}`;
  };
  const lineOf = (i) => ({ t: `${nice(i.summary)} – ${statusText(i)}` });
  const hdr = { bold: true, fill: { color: 'D9E2F3' } };
  const tableOpts = { fontFace: FONT, color: '222222', fill: { color: 'FFFFFF' }, border: { type: 'solid', color: 'BFBFBF', pt: 0.5 } };

  // ── Slide 1: QA Status Summary ──
  {
    const s = pptx.addSlide();
    // Header objective + per-area "Risk & Dependencies" are the QA lead's own words, saved on the Jira tab
    // (statusNotes.saveDeckText); {sprint} / {next} become the current / next sprint names.
    const fill = (t) => String(t || '').replace(/\{sprint\}/gi, S).replace(/\{next\}/gi, N);
    const risk = (k) => fill((deckText.risks || {})[k]);
    const riskSection = (k) => ({ head: 'Risk & Dependencies:', lines: risk(k) ? [{ t: risk(k), plain: true }] : [] });
    titleBar(s, 'QA Status Summary - ClaimCenter', deckText.objective ? fill(deckText.objective) :
      `${S} (ends ${fmtDate(curEnd)}, ${daysLeft} working day(s) left): ${A.ClaimCenter.week.length + A.SmartComm.week.length + A.OneInc.week.length} items completed this week, ${h(sum(curAll))} remaining (${h(spillAll)} impeded — potential spillover into ${N}). ${N}${future ? ` (${fmtDate(new Date(future.start))}–${fmtDate(new Date(future.end))})` : ''} has ${h(sum(nextAll))} planned across ClaimCenter, SmartCOMM and OneInc.`);
    const Y = 1.16; const H = 6.3;
    const X1 = 0, W1 = 4.3, X2 = 4.36, W2 = 4.42, X3 = 8.84, W3 = 4.46; // ClaimCenter | SMARTCOMM | OneInc

    const cc = A.ClaimCenter;
    column(s, X1, Y, W1, H, 'ClaimCenter', COL.ClaimCenter, [
      { head: 'Completed this week:', lines: cc.week.map(withPhase) },
      { head: 'In progress:', lines: cc.s5.filter((i) => i.track !== 'Enhancement' && inProg(i)).sort((a, b) => b.rem - a.rem).map(lineOf) },
      { head: 'Enhancement:', lines: cc.s5.filter((i) => i.track === 'Enhancement').sort((a, b) => b.rem - a.rem).map(lineOf) },
      { head: 'Blockers:', lines: cc.imp.map((i) => ({ t: `${nice(i.summary)} — ${noteOf(i) ? firstLine(noteOf(i)) : 'Impeded'}` })) },
      riskSection('ClaimCenter'),
    ], 9.5, cc);

    // SmartCOMM overall progress, counted by TEMPLATE (each has a design and an execution task): a DIG letter or a
    // letterhead is a ClaimCenter template; any other named letter/notice is a BillingCenter template; CC_/BC_/QA_
    // feature work, requirements prep and governance aren't templates. Retired work is excluded.
    const sc = A.SmartComm;
    const live = scAll.filter((i) => !/retired/i.test(i.status));
    const isDone = (i) => /^(done|closed)$/i.test(i.status);
    const templateOf = (t) => {
      const m = t.match(/^DIG\s*(\d+[A-Z]*)/i);
      if (m) return { sys: 'ClaimCenter', id: `DIG${m[1].toUpperCase()}` };
      if (/^(CC|BC|QA)[_ ]|^QA (Prep|Exec)|smartcomm|^smartcomm-lob/i.test(t)) return null;
      const id = t.replace(/[_ -]*(Test[_ ]?(Design|Execution|Planning)|QA[_ ]?(Exec|Prep)).*$/i, '').trim();
      return { sys: /letterhead/i.test(t) ? 'ClaimCenter' : 'BillingCenter', id };
    };
    const tally = (system) => {
      const byT = new Map();
      for (const i of live) { const t = templateOf(i.summary); if (!t || t.sys !== system) continue; if (!byT.has(t.id)) byT.set(t.id, []); byT.get(t.id).push(i); }
      const n = (p) => [...byT.values()].filter((a) => a.some((i) => phase(i.summary) === p)).length;
      const d = (p) => [...byT.values()].filter((a) => a.some((i) => phase(i.summary) === p && isDone(i))).length;
      return { total: byT.size, design: `${d('Design')} / ${n('Design')}`, exec: `${d('Execution')} / ${n('Execution')}` };
    };
    const bcT = tally('BillingCenter'); const ccT = tally('ClaimCenter');
    // Outstanding work as counted summary lines per template system ("45 DIG letter templates – Blocked due to
    // defects", "Testing for 10 CC templates in progress"); non-template work (CC_/BC_/QA_ features) one per line.
    const scOutstanding = [];
    const nTemplates = (list, sys) => new Set(list.map((i) => templateOf(i.summary)).filter((t) => t && t.sys === sys).map((t) => t.id)).size;
    const open5 = sc.s5.filter((i) => !isImpeded(i));
    for (const [sys, lbl, blockedLbl] of [['ClaimCenter', 'CC', 'DIG letter'], ['BillingCenter', 'BC', 'BC']]) {
      const lines = [
        [nTemplates(sc.imp, sys), (n) => `${n} ${blockedLbl} templates – Blocked due to defects`],
        [nTemplates(open5.filter((i) => inProg(i) && phase(i.summary) === 'Execution'), sys), (n) => `Testing for ${n} ${lbl} templates in progress`],
        [nTemplates(open5.filter((i) => inProg(i) && phase(i.summary) === 'Design'), sys), (n) => `Test design for ${n} ${lbl} templates in progress`],
        [nTemplates(open5.filter((i) => !inProg(i)), sys), (n) => `${n} ${lbl} templates not started / awaiting dev`],
      ];
      for (const [n, text] of lines) if (n) scOutstanding.push({ t: text(n) });
    }
    scOutstanding.push(...sc.s5.filter((i) => !templateOf(i.summary)).sort((a, b) => b.rem - a.rem).map(lineOf));
    const scRisk = risk('SmartComm');
    const scTail = scRisk ? 1.75 : 1.2; // room under the column for the summary table (+ risk text)
    const scTextEnd = column(s, X2, Y, W2, H, 'SMARTCOMM', COL.SmartComm, [
      { head: 'Completed this week:', lines: [
        { t: `${sc.week.length} items — ${sc.week.filter((i) => phase(i.summary) === 'Design').length} test design, ${sc.week.filter((i) => phase(i.summary) === 'Execution').length} test execution.` },
      ] },
      { head: `Outstanding work (${S}):`, lines: scOutstanding },
    ], 9.5, sc, H - scTail);
    const tblTop = Math.min(scTextEnd + 0.1, Y + H - scTail);
    s.addText('Overall Summary — templates (done / total):',{ x: X2, y: tblTop + 0.04, w: W2, h: 0.22, fontFace: FONT, fontSize: 10, bold: true, color: '000000', margin: [2, 6, 0, 6] });
    s.addTable([
      [{ text: '', options: hdr }, { text: 'Total', options: hdr }, { text: 'Test design', options: hdr }, { text: 'Test execution', options: hdr }],
      ['BillingCenter', String(bcT.total), bcT.design, bcT.exec],
      ['ClaimCenter', String(ccT.total), ccT.design, ccT.exec],
    ], { ...tableOpts, x: X2 + 0.05, y: tblTop + 0.28, w: W2 - 0.1, colW: [1.32, 0.7, 1.15, 1.15], fontSize: 9.5, rowH: 0.24 });
    if (scRisk) {
      s.addText([{ text: 'Risk & Dependencies: ', options: { bold: true } }, { text: scRisk }],
        { x: X2, y: tblTop + 1.12, w: W2, h: 0.64, fontFace: FONT, fontSize: 9.5, color: '222222', valign: 'top', margin: [2, 6, 2, 6] });
    }

    const oi = A.OneInc;
    column(s, X3, Y, W3, 3.45, 'OneInc', COL.OneInc, [
      ...[['Design', 'Test Design', 'Reviewed'], ['Execution', 'Test Execution', 'Tested'], ['', 'Other work', 'Done']].map(([p, head, verb]) => ({
        head: `${head}:`,
        lines: [...oi.week.filter((i) => phase(i.summary) === p).map((i) => ({ t: `${nice(i.summary)} – ${verb} and Closed` })),
          ...oi.s5.filter((i) => phase(i.summary) === p).sort((a, b) => b.rem - a.rem).map(lineOf)],
      })),
      { head: `Ready for QA (${N}):`, lines: oi.s6.filter(readyQa).map((i) => nice(i.summary))
        .reduce((acc, name, n) => { if (n % 2) acc[acc.length - 1].t += `, ${name}`; else acc.push({ t: name }); return acc; }, []) },
      riskSection('OneInc'),
    ], 9, oi);

    const prio = (p) => { const t = String(p || '').toLowerCase(); return /must|critical|highest|blocker/.test(t) ? 'Critical' : /high/.test(t) ? 'High' : /medium/.test(t) ? 'Medium' : /low/.test(t) ? 'Low' : 'Unranked'; };
    // Counted by the bug's Severity; a bug with no severity falls back to its priority. "None" only shows if needed.
    const sevOf = (b) => prio(b.severity) !== 'Unranked' ? prio(b.severity) : prio(b.priority);
    const PR = ['Critical', 'High', 'Medium', 'Low', ...(bugs.some((b) => sevOf(b) === 'Unranked') ? ['Unranked'] : [])];
    const statuses = [...new Set(bugs.map((b) => b.status))].sort((a, b) => bugs.filter((x) => x.status === b).length - bugs.filter((x) => x.status === a).length);
    s.addShape(pptx.ShapeType.rect, { x: X3, y: Y + 3.5, w: W3, h: 0.36, fill: { color: 'E8A100' } });
    s.addText(`Open Defects (CC & SmartComm) — ${bugs.length}`, { x: X3, y: Y + 3.5, w: W3, h: 0.36, fontFace: FONT, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center' });
    const rows = [[{ text: 'Status', options: hdr }, ...PR.map((p) => ({ text: { Critical: 'Crit.', High: 'High', Medium: 'Med.', Low: 'Low', Unranked: 'None' }[p], options: hdr })), { text: 'Total', options: hdr }]];
    for (const st of statuses.slice(0, 8)) {
      const b = bugs.filter((x) => x.status === st);
      rows.push([st, ...PR.map((p) => { const n = b.filter((x) => sevOf(x) === p).length; return n ? String(n) : ''; }), String(b.length)]);
    }
    if (statuses.length > 8) {
      const b = bugs.filter((x) => !statuses.slice(0, 8).includes(x.status));
      rows.push(['Other', ...PR.map((p) => { const n = b.filter((x) => sevOf(x) === p).length; return n ? String(n) : ''; }), String(b.length)]);
    }
    rows.push([{ text: 'Grand Total', options: { bold: true } }, ...PR.map((p) => ({ text: String(bugs.filter((x) => sevOf(x) === p).length), options: { bold: true } })), { text: String(bugs.length), options: { bold: true } }]);
    s.addTable(rows, { ...tableOpts, x: X3, y: Y + 3.86, w: W3, colW: PR.length === 5 ? [1.4, 0.5, 0.52, 0.52, 0.47, 0.5, 0.55] : [1.6, 0.55, 0.55, 0.55, 0.55, 0.66], fontSize: 9, margin: [1, 5, 1, 5], valign: 'middle', rowH: Math.min(0.3, (H - 3.86 - 0.12) / rows.length) });
  }

  // ── Slides 2 & 3: day-by-day and week-by-week progress (per the QA lead, 2026-10-17) ──
  // Per track, what the team COMPLETED and STARTED in each period (see searchHistory), with the previous period's
  // counts beside it. Days = the last 5 working days; weeks = Friday–Thursday, the last 6 including this one.
  {
    const TZ = 'America/New_York';
    const dayKey = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD in ET
    const fromKey = (k) => new Date(`${k}T12:00:00`);
    const dayLabel = (k) => fromKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const todayKey = dayKey(NOW);
    const days = [];
    for (const d = fromKey(todayKey); days.length < 6; d.setDate(d.getDate() - 1)) if (d.getDay() % 6) days.push(dayKey(d));
    days.reverse(); // oldest first; the oldest of the 6 is only there as the first shown day's "previous day"
    // Friday that starts the Fri–Thu week containing a given day key.
    const weekOf = (k) => { const d = fromKey(k); d.setDate(d.getDate() - ((d.getDay() + 2) % 7)); return dayKey(d); };
    const weeks = [];
    for (let w = 0, d = fromKey(weekOf(todayKey)); w < 7; w++, d.setDate(d.getDate() - 7)) weeks.push(dayKey(d));
    weeks.reverse();
    const weekLabel = (k) => { const e = fromKey(k); e.setDate(e.getDate() + 6); return `${dayLabel(k)} – ${dayLabel(dayKey(e))}${k === weekOf(todayKey) ? ' (this week so far)' : ''}`; };

    // One compact line for a list of items: DIG templates collapsed into one entry, the rest by readable name.
    const names = (list) => {
      const digs = [...new Set(list.map(digNo).filter(Boolean))];
      const rest = list.filter((i) => !digNo(i)).map((i) => nice(i.summary));
      return [...rest, ...(digs.length ? [`DIG templates (${digs.length}): ${digs.join(', ')}`] : [])];
    };
    const TITLE = { ClaimCenter: 'ClaimCenter', SmartComm: 'SMARTCOMM', OneInc: 'OneInc' };
    // detailPeriods: how many of the newest periods list their items; older ones show just the counts (the weekly
    // slide lists every item for this week and last week only — six full weeks don't fit legibly).
    const progressSlide = (title, sub, periods, labelOf, bucketOf, prevWord, detailPeriods = Infinity) => {
      const s = pptx.addSlide();
      titleBar(s, title, sub);
      ['ClaimCenter', 'SmartComm', 'OneInc'].forEach((k, n) => {
        const mine = history.filter((i) => i.area === k);
        const sections = [];
        let prev = null;
        // Newest period first on the slide, but the comparison is always with the period before it.
        const rows = periods.map((p) => {
          const done = mine.filter((i) => i.completed && bucketOf(dayKey(i.completed)) === p);
          const started = mine.filter((i) => i.started && bucketOf(dayKey(i.started)) === p);
          const row = { p, done, started, prev };
          prev = { done: done.length, started: started.length };
          return row;
        }).slice(1).reverse(); // drop the comparison-only oldest period
        const earlier = []; // counts-only lines for periods past detailPeriods
        rows.forEach((r, idx) => {
          const vs = r.prev ? ` (${prevWord}: ${r.prev.done} / ${r.prev.started})` : '';
          const head = `${labelOf(r.p)} — ${r.done.length} completed, ${r.started.length} started${vs}`;
          if (idx >= detailPeriods) { earlier.push({ t: head, plain: true }); return; }
          const lines = [];
          if (r.done.length) lines.push({ t: `Completed: ${names(r.done).join('; ')}`, color: '2E7D32' });
          if (r.started.length) lines.push({ t: `Started: ${names(r.started).join('; ')}` });
          if (!lines.length) lines.push({ t: 'No items completed or started.', color: '777777', plain: true });
          sections.push({ head: `${head}:`, lines });
        });
        if (earlier.length) sections.push({ head: 'Earlier weeks (completed / started):', lines: earlier });
        column(s, 0.08 + n * 4.42, 1.25, 4.33, 5.9, TITLE[k], COL[k], sections, 10, null);
      });
      s.addText(`Live from Jira, ${NOW.toLocaleString('en-US', { timeZone: TZ })} ET · started = first move to In Progress / In Review (Ready for QA is not started) · completed = moved to Done / Closed and still done · OneInc = enhancement items named "OneInc".`,
        { x: 0.1, y: 7.18, w: 13.1, h: 0.28, fontFace: FONT, fontSize: 8, color: 'C9D3E6' });
    };
    const total = (bucketOf, p, field) => history.filter((i) => i[field] && bucketOf(dayKey(i[field])) === p).length;
    const dayBucket = (k) => k;
    const lastDay = days[days.length - 1]; const prevDay = days[days.length - 2];
    progressSlide('Day-by-Day Progress',
      `Last 5 working days, newest first. ${dayLabel(lastDay)}: ${total(dayBucket, lastDay, 'completed')} completed, ${total(dayBucket, lastDay, 'started')} started across all tracks (${dayLabel(prevDay)}: ${total(dayBucket, prevDay, 'completed')} / ${total(dayBucket, prevDay, 'started')}).`,
      days, dayLabel, dayBucket, 'prev. day');
    const thisWeek = weeks[weeks.length - 1]; const lastWeek = weeks[weeks.length - 2];
    progressSlide('Week-by-Week Progress (Friday – Thursday)',
      `Last 6 weeks, newest first. This week so far: ${total(weekOf, thisWeek, 'completed')} completed, ${total(weekOf, thisWeek, 'started')} started across all tracks (last week: ${total(weekOf, lastWeek, 'completed')} / ${total(weekOf, lastWeek, 'started')}).`,
      weeks, weekLabel, weekOf, 'prev. week', 2);
  }

  const summary = {
    sprint: S, next: N, daysLeft, done: doneItems.length, total: doneItems.length + curAll.length,
    curHours: sum(curAll), spill: spillAll, nextHours: sum(nextAll), defects: bugs.length,
    areas: Object.fromEntries(Object.entries(A).map(([k, a]) => [k, { done: a.d5.length, left: sum(a.s5), spill: a.spill, next: sum(a.s6) }])),
  };
  return { pptx, summary };
}

async function sendEmail(outputPath, sm, to) {
  const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_SMTP_HOST;
  const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM;
  if (!smtpHost || !fromEmail) { console.log('SMTP_HOST / FROM_EMAIL not set; email skipped (deck still saved locally)'); return; }
  const transporter = nodemailer.createTransport({ host: smtpHost, port: Number(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT) || 25, secure: false, tls: { rejectUnauthorized: false } });
  const cell = 'padding:6px 10px;border:1px solid #ddd;';
  const LABEL = { ClaimCenter: 'ClaimCenter', SmartComm: 'SMARTCOMM', OneInc: 'OneInc' };
  const rows = Object.entries(sm.areas).map(([k, a]) => `<tr><td style="${cell}">${LABEL[k]}</td><td style="${cell}text-align:right;">${a.done}</td><td style="${cell}text-align:right;">${h(a.left)}</td><td style="${cell}text-align:right;">${h(a.spill)}</td><td style="${cell}text-align:right;">${h(a.next)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:720px;">
<h2 style="color:#1F3864;">QA Sprint Status — ${sm.sprint} / ${sm.next}</h2>
<p>${sm.sprint}: <b>${sm.done} of ${sm.total} items done</b>, ${h(sm.curHours)} left with ${sm.daysLeft} working day(s) to go (≈ ${h(sm.spill)} likely to spill). ${sm.next}: ${h(sm.nextHours)} planned. Open defects: ${sm.defects}. The full deck is attached.</p>
<table style="border-collapse:collapse;font-size:13px;"><tr style="background:#1F3864;color:#fff;"><th style="${cell}">Area</th><th style="${cell}">Done this sprint</th><th style="${cell}">Left</th><th style="${cell}">Spillover ≈</th><th style="${cell}">${sm.next}</th></tr>${rows}</table></div>`;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const subject = `QA Sprint Status - ${sm.sprint} - ${today}`;
  await transporter.sendMail({ from: fromEmail, to, subject, html, attachments: [{ filename: path.basename(outputPath), path: outputPath }] });
  console.log(`Deck emailed to ${to}: ${subject}`);
}

async function generateStatusDeck(outputPath, { emailTo } = {}) {
  if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('Jira credentials missing: enter your Jira email + API token on the runner\'s Settings tab, or set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN in .env.');
  }
  console.log('Pulling from Jira (ClaimCenter, Enhancement, SmartComm queries; completed this sprint; SmartComm progress; open defects)...');
  const data = await collect();
  console.log(`Open items: ${data.items.length}, done this sprint: ${data.doneItems.length}, SmartComm overall: ${data.scAll.length}, open defects: ${data.bugs.length}`);
  const saved = statusNotes.load();
  if (saved.count) console.log(`Weekly notes: ${saved.count} item(s), saved ${saved.savedAt}`);
  const { pptx, summary } = buildDeck({ ...data, notes: saved.notes || {}, deckText: saved.deckText || {} });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await pptx.writeFile({ fileName: outputPath });
  console.log(`Deck written: ${outputPath}`);
  if (emailTo) {
    try { await sendEmail(outputPath, summary, emailTo); } catch (e) { throw new Error(`Deck was saved to ${outputPath} but emailing it to ${emailTo} failed: ${e.message}`); }
  }
  return { outputPath, summary };
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'reports', 'jira', 'QA_Sprint_Status.pptx');
  generateStatusDeck(out, { emailTo: process.env.JIRA_REPORT_EMAIL_TO }).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { generateStatusDeck, DEFECTS_JQL };
