// Generates the QA Sprint Status deck (PowerPoint) from Jira and, when JIRA_REPORT_EMAIL_TO is set, emails it.
//
// Slide 1 "QA Status Summary - ClaimCenter": ClaimCenter (incl. enhancements) | SMARTCOMM | OneInc columns (completed this
//   sprint, in progress, spillovers), SmartCOMM's design/execution summary, and the open-defects table.
// Slide 2 "Sprint N Wrap-up & Sprint N+1 Outlook": per area, completed / remaining (with likely spillover) for the
//   current sprint and the planned work for the next one.
// No per-person reporting (per the QA lead's direction); Nautilus/Other is not included.
//
// Data (read-only):
//   - jiraReport.js's own ClaimCenter, Enhancement and SmartComm JQLs (TRACK_DEFS) — open work, hours = remaining
//     estimate. Enhancement items named "OneInc"/"One Inc" form the OneInc area; the rest count under ClaimCenter.
//   - the same JQLs with status Closed/Done in the open sprint — "completed this sprint".
//   - the SmartComm JQL without its status filter — the overall design/execution progress table.
//   - DEFECTS_JQL (the QA lead's defect filter) — the open-defects table.
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
const DEFECTS_JQL = 'project IN (GCCM, GCMDT, GCMDW, GCMR) AND type IN (Bug, Defect) AND status NOT IN (Closed, Rejected) ORDER BY assignee ASC, created DESC';
const HOURS_PER_DAY = Number(process.env.STATUS_DECK_HOURS_PER_DAY) || 8;
const FIELDS = ['summary', 'issuetype', 'assignee', 'status', 'timeestimate', 'timeoriginalestimate', 'timespent', 'customfield_10020', 'priority', 'resolutiondate'];

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
    };
  });
}
const withoutStatusFilter = (jql) => jql.replace(/\s+AND\s+status\s+NOT\s+IN\s*\([^)]*\)/i, '');
const doneInOpenSprint = (jql) => `${withoutStatusFilter(jql)} AND status IN (Closed, Done) AND sprint in openSprints()`;

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

async function collect() {
  const areaOf = (q, i) => (q === 'SmartComm' ? 'SmartComm' : isOneInc(i) ? 'OneInc' : 'ClaimCenter');
  const items = []; const doneItems = [];
  for (const q of ['ClaimCenter', 'Enhancement', 'SmartComm']) {
    const jql = TRACK_DEFS[q].jql;
    for (const i of await search(jql)) items.push({ ...i, area: areaOf(q, i), current: i.sprints.some((s) => s.state === 'active') });
    for (const i of await search(doneInOpenSprint(jql))) doneItems.push({ ...i, area: areaOf(q, i) });
  }
  const scAll = await search(withoutStatusFilter(TRACK_DEFS.SmartComm.jql));
  const bugs = await search(DEFECTS_JQL);
  return { items, doneItems, scAll, bugs };
}

function buildDeck({ items, doneItems, scAll, bugs, notes = {}, deckText = {} }) {
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
    const cells = [[`${S} remaining`, h(sum(a.s5)), NAVY], ['Potential spillover (impeded)', h(a.spill), NAVY], [`${N} planned`, h(sum(a.s6)), NAVY]];
    const cw = w / cells.length;
    cells.forEach(([label, val, c], n) => {
      slide.addText([{ text: val, options: { bold: true, fontSize: 12, color: c, breakLine: true } }, { text: label, options: { fontSize: 8, color: '555555' } }],
        { x: x + n * cw, y, w: cw, h: 0.5, fontFace: FONT, align: 'center', valign: 'middle', fill: { color: 'FFFFFF' }, line: { color: 'D0D0D0', width: 0.5 } });
    });
  };
  // Column: coloured header + body (hours strip on top) with bullet sections [{ head, lines: [{ t, level, bold, color }] }].
  const column = (slide, x, y, w, hgt, title, color, sections, fontSize, a) => {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.42, fill: { color }, line: { color: 'FFFFFF', width: 1 } });
    slide.addText(title, { x, y, w, h: 0.42, fontFace: FONT, fontSize: 17, bold: true, color: 'FFFFFF', align: 'center' });
    // Full lists, so pick the largest font (down to 6 pt) whose estimated wrapped height fits the column body.
    const secs = sections.filter((z) => z.lines.length);
    const bodyPt = (hgt - 1.07) * 72;
    const fits = (fs) => {
      const charsPerLine = Math.max(10, ((w - 0.5) * 72) / (fs * 0.47));
      let lines = 0;
      for (const z of secs) { lines += Math.ceil(z.head.length / charsPerLine) + 0.25; for (const l of z.lines) lines += Math.ceil(String(l.t).length / charsPerLine); }
      return lines * fs * 1.2 <= bodyPt;
    };
    let fsz = fontSize;
    while (fsz > 6 && !fits(fsz)) fsz -= 0.5;
    fontSize = fsz;
    const runs = [];
    for (const s of secs) {
      runs.push({ text: s.head, options: { bold: true, breakLine: true, fontSize: fontSize + 0.5, color: '000000', paraSpaceBefore: 3 } });
      for (const l of s.lines) runs.push({ text: l.t, options: { bullet: l.plain ? false : { indent: l.level ? 12 : 10 }, indentLevel: l.level || 0, bold: !!l.bold, color: l.color || '222222', breakLine: true, fontSize } });
    }
    slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.42, w, h: hgt - 0.42, fill: { color: 'F5F5F5' }, line: { color: 'D0D0D0', width: 0.75 } });
    slide.addText(runs.length ? runs : [{ text: 'Nothing to report.', options: { fontSize, color: '666666' } }], { x, y: y + 0.97, w, h: hgt - 0.97, fontFace: FONT, valign: 'top', margin: [2, 6, 4, 6] });
    strip(slide, x + 0.04, y + 0.45, w - 0.08, a);
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
    const Y = 1.2; const H = 6.22;

    const cc = A.ClaimCenter;
    column(s, 0.08, Y, 4.3, H, 'ClaimCenter', COL.ClaimCenter, [
      { head: 'Completed this week:', lines: cc.week.map(withPhase) },
      { head: `Outstanding work (${S}):`, lines: [...cc.s5].sort((a, b) => Number(isImpeded(a)) - Number(isImpeded(b)) || b.rem - a.rem).map(outstanding) },
      { head: `Picked up early from ${N}:`, lines: picked(cc) },
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
    const scRisk = risk('SmartComm');
    const scTail = scRisk ? 1.75 : 1.2; // room under the column for the summary table (+ risk text)
    column(s, 4.45, Y, 4.4, H - scTail, 'SMARTCOMM', COL.SmartComm, [
      { head: 'Completed this week:', lines: [
        { t: `${sc.week.length} items — ${sc.week.filter((i) => phase(i.summary) === 'Design').length} test design, ${sc.week.filter((i) => phase(i.summary) === 'Execution').length} test execution.` },
      ] },
      { head: `Outstanding work (${S}):`, lines: compactDigs([...sc.s5].sort((a, b) => b.rem - a.rem)) },
      { head: `Picked up early from ${N}:`, lines: [['done', sc.pickedDone], ['in progress', sc.pickedProg]].flatMap(([what, list]) => {
        const digs = list.filter(digNo); const rest = list.filter((i) => !digNo(i));
        return rest.map((i) => ({ t: `${nice(i.summary)} — ${what}` }))
          .concat(digs.length ? [{ t: `DIG letter templates ${what} (${digs.length}): ${[...new Set(digs.map(digNo))].join(', ')}` }] : []);
      }) },
    ], 9.5, sc);
    s.addText('Overall Summary — templates (done / total):',{ x: 4.55, y: Y + H - scTail + 0.04, w: 4.2, h: 0.22, fontFace: FONT, fontSize: 9.5, bold: true, color: 'FFFFFF' });
    s.addTable([
      [{ text: '', options: hdr }, { text: 'Total', options: hdr }, { text: 'Test design', options: hdr }, { text: 'Test execution', options: hdr }],
      ['BillingCenter', String(bcT.total), bcT.design, bcT.exec],
      ['ClaimCenter', String(ccT.total), ccT.design, ccT.exec],
    ], { ...tableOpts, x: 4.5, y: Y + H - scTail + 0.28, w: 4.3, colW: [1.3, 0.7, 1.15, 1.15], fontSize: 9.5, rowH: 0.24 });
    if (scRisk) {
      s.addText([{ text: 'Risk & Dependencies: ', options: { bold: true } }, { text: scRisk }],
        { x: 4.5, y: Y + H - 0.66, w: 4.3, h: 0.64, fontFace: FONT, fontSize: 9.5, color: 'FFFFFF', valign: 'top', margin: [2, 4, 2, 4] });
    }

    const oi = A.OneInc;
    column(s, 8.92, Y, 4.33, 3.45, 'OneInc', COL.OneInc, [
      { head: 'Completed this week:', lines: oi.week.map(withPhase) },
      { head: `Outstanding work (${S}):`, lines: [...oi.s5].sort((a, b) => b.rem - a.rem).map(outstanding) },
      { head: `Picked up early from ${N}:`, lines: picked(oi) },
      { head: `Ready for QA (${N}):`, lines: oi.s6.filter(readyQa).map((i) => nice(i.summary))
        .reduce((acc, name, n) => { if (n % 2) acc[acc.length - 1].t += `, ${name}`; else acc.push({ t: name }); return acc; }, []) },
      riskSection('OneInc'),
    ], 9, oi);

    const prio = (p) => { const t = String(p || '').toLowerCase(); return /must|critical|highest|blocker/.test(t) ? 'Critical' : /high/.test(t) ? 'High' : /medium/.test(t) ? 'Medium' : /low/.test(t) ? 'Low' : 'Unranked'; };
    const PR = ['Critical', 'High', 'Medium', 'Low', 'Unranked'];
    const statuses = [...new Set(bugs.map((b) => b.status))].sort((a, b) => bugs.filter((x) => x.status === b).length - bugs.filter((x) => x.status === a).length);
    s.addShape(pptx.ShapeType.rect, { x: 8.92, y: Y + 3.5, w: 4.33, h: 0.36, fill: { color: 'E8A100' } });
    s.addText(`Open Defects (ClaimCenter) — ${bugs.length}`, { x: 8.92, y: Y + 3.5, w: 4.33, h: 0.36, fontFace: FONT, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center' });
    const rows = [[{ text: 'Status', options: hdr }, ...PR.map((p) => ({ text: { Critical: 'Crit.', High: 'High', Medium: 'Med.', Low: 'Low', Unranked: 'None' }[p], options: hdr })), { text: 'Total', options: hdr }]];
    for (const st of statuses.slice(0, 8)) {
      const b = bugs.filter((x) => x.status === st);
      rows.push([st, ...PR.map((p) => { const n = b.filter((x) => prio(x.priority) === p).length; return n ? String(n) : ''; }), String(b.length)]);
    }
    if (statuses.length > 8) {
      const b = bugs.filter((x) => !statuses.slice(0, 8).includes(x.status));
      rows.push(['Other', ...PR.map((p) => { const n = b.filter((x) => prio(x.priority) === p).length; return n ? String(n) : ''; }), String(b.length)]);
    }
    rows.push([{ text: 'Grand Total', options: { bold: true } }, ...PR.map((p) => ({ text: String(bugs.filter((x) => prio(x.priority) === p).length), options: { bold: true } })), { text: String(bugs.length), options: { bold: true } }]);
    s.addTable(rows, { ...tableOpts, x: 8.92, y: Y + 3.86, w: 4.33, colW: [1.33, 0.5, 0.5, 0.5, 0.45, 0.5, 0.55], fontSize: 8.5, rowH: 0.2 });
  }

  // ── Slide 2: Wrap-up & Outlook ──
  {
    const s = pptx.addSlide();
    const total = doneItems.length + curAll.length;
    titleBar(s, `${S} Wrap-up & ${N} Outlook`,
      `${S}: ${doneItems.length} of ${total} items done (${total ? Math.round((doneItems.length / total) * 100) : 0}%), ${h(sum(curAll))} left with ${daysLeft} working day(s) to go. ${N}: ${h(sum(nextAll))} planned, plus up to ${h(spillAll)} of impeded ${S} work.`);
    const TITLE = { ClaimCenter: 'ClaimCenter', SmartComm: 'SMARTCOMM', OneInc: 'OneInc' };
    ['ClaimCenter', 'SmartComm', 'OneInc'].forEach((k, n) => {
      const a = A[k]; const rq = a.s6.filter(readyQa);
      column(s, 0.08 + n * 4.42, 1.35, 4.33, 5.8, TITLE[k], COL[k], [
        { head: `${S} — completed (${a.d5.length} items, ${h(a.d5.reduce((t, i) => t + doneH(i), 0))}):`, lines: groupCounts(a.d5).slice(0, 5).map(([g, c]) => ({ t: `${g} — ${c} item${c === 1 ? '' : 's'}`, color: '2E7D32' })) },
        { head: `${S} — remaining (${h(sum(a.s5))}; ${h(a.spill)} impeded):`, lines: groupHours(a.s5).slice(0, 5).map(([g, hr]) => ({ t: `${g} — ${h(hr)}` })) },
        { head: `${N} — planned (${h(sum(a.s6))}, ${a.s6.length} items):`, lines: groupHours(a.s6).slice(0, 5).map(([g, hr]) => ({ t: `${g} — ${h(hr)}` }))
          .concat(rq.length ? [{ t: `${rq.length} item(s) Ready for QA now (${h(sum(rq))})`, color: '2E7D32', bold: true }] : []) },
      ], 10, a);
    });
    s.addText(`Live from Jira, ${NOW.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET · hours = remaining estimate · potential spillover = impeded ${S} work · OneInc = enhancement items named "OneInc"; other enhancements are under ClaimCenter.`,
      { x: 0.1, y: 7.18, w: 13.1, h: 0.28, fontFace: FONT, fontSize: 8, color: 'C9D3E6' });
  }

  // ── Slide 3: Blockers & Dependencies (impeded work + anything the weekly notes explain) ──
  {
    const rowsSrc = curAll.filter((i) => isImpeded(i) || noteOf(i))
      .sort((a, b) => Number(isImpeded(b)) - Number(isImpeded(a)) || a.area.localeCompare(b.area));
    if (rowsSrc.length) {
      const LABEL = { ClaimCenter: 'ClaimCenter', SmartComm: 'SMARTCOMM', OneInc: 'OneInc' };
      const hd = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: '2E5597' } } });
      const header = [hd('Area'), hd('Key'), hd('Item'), hd('Status'), hd('Blocker / dependency')];
      // Paginate by estimated height (note lines wrap at ~115 chars in the 6.1-in column) so every page gets the
      // title bar — pptxgenjs's own autoPage adds bare, untitled slides.
      const lineCount = (i) => Math.max(1, String(noteOf(i) || 'x').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 115)), 0));
      const pages = [[]]; let used = 0; const PAGE_IN = 5.45;
      for (const i of rowsSrc) {
        const rh = 0.08 + lineCount(i) * 0.17;
        if (used + rh > PAGE_IN && pages[pages.length - 1].length) { pages.push([]); used = 0; }
        pages[pages.length - 1].push(i); used += rh;
      }
      pages.forEach((page, p) => {
        const s = pptx.addSlide();
        titleBar(s, `Blockers & Dependencies — ${S}${pages.length > 1 ? ` (${p + 1}/${pages.length})` : ''}`,
          `${curAll.filter(isImpeded).length} impeded items (${h(spillAll)} — potential spillover into ${N}), plus in-progress items with open dependencies.`
          + (Object.keys(notes || {}).length ? ' Notes from the weekly status update.' : ' (No weekly notes uploaded — paste them on the Jira tab to show what each item is waiting on.)'));
        const rows = [header];
        for (const i of page) {
          const red = isImpeded(i);
          rows.push([LABEL[i.area], i.key, nice(i.summary), { text: i.status, options: { bold: red } }, noteOf(i) || (red ? '(no note)' : '')]);
        }
        s.addTable(rows, { ...tableOpts, x: 0.15, y: 1.35, w: 13.0, colW: [1.25, 1.05, 3.6, 1.0, 6.1], fontSize: 9, valign: 'top' });
      });
    }
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
