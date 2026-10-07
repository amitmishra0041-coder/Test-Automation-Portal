// Generates the Sprint/Pending-Work report directly from Jira's REST API,
// replacing the Excel Power Query version (that approach kept losing data to
// COM/UI flakiness when driven by automation - see the workbook this
// replaces, Sprint_Pending_Work_4Areas_RemainingEst_LIVE.xlsm). Same JQL per
// area, same Track/Sprint tagging and Done/Retired filtering, same combined
// view - just fetched and written to Excel in one deterministic script.
//
// Run directly:  node scripts/jiraReport.js [outputPath] [tracksCsv]
//   tracksCsv - comma-separated subset of Enhancement,ClaimCenter,SmartComm,
//   NautilusOther, or omit/pass "all" for all four (default).
// Or via the UI runner's "Jira Sprint Report" tab (runner/server.js), which
// lets you pick tracks from chips and enter the address to email the report to.
//
// Requires JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN in .env (see .env.example).
//
// Optional email: when JIRA_REPORT_EMAIL_TO is set (the UI runner always sets
// it - typed address, else TO_EMAIL from .env) the finished workbook is also
// emailed as an attachment, via the same SMTP_HOST/SMTP_PORT/FROM_EMAIL
// settings emailReporter.js uses. Direct CLI runs don't email unless it's set.
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');

const JIRA_SITE = process.env.JIRA_SITE;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const FIELDS = ['summary', 'issuetype', 'assignee', 'status', 'timeestimate', 'timeoriginalestimate', 'customfield_10020'];

const ALL_TRACK_KEYS = ['Enhancement', 'ClaimCenter', 'SmartComm', 'NautilusOther'];

// ── Styling ──────────────────────────────────────────────────────────────
const COLOR = {
  title: 'FF1F3864',
  subtitle: 'FF44546A',
  headerFill: 'FF1F3864',
  headerFont: 'FFFFFFFF',
  bandA: 'FFFFFFFF',
  bandB: 'FFF2F2F2',
  totalFill: 'FFD9E1F2',
  border: 'FFBFBFBF',
};
const THIN_BORDER = { style: 'thin', color: { argb: COLOR.border } };
const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

function styleTitleCell(cell) {
  cell.font = { bold: true, size: 14, color: { argb: COLOR.title } };
}
function styleSubtitleCell(cell) {
  cell.font = { italic: true, size: 10, color: { argb: COLOR.subtitle } };
}
function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.headerFill } };
    cell.font = { bold: true, color: { argb: COLOR.headerFont } };
    cell.alignment = { vertical: 'middle' };
    cell.border = ALL_BORDERS;
  });
}
function styleDataRow(row, bandFill) {
  row.eachCell((cell) => {
    if (bandFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandFill } };
    cell.border = ALL_BORDERS;
  });
}
function styleTotalRow(row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.totalFill } };
    cell.font = { bold: true };
    cell.border = ALL_BORDERS;
  });
}

// ── Jira fetch (POST /rest/api/3/search/jql - the old GET /search was
// retired by Atlassian mid-2025 and returns 410 Gone; this one pages via
// nextPageToken instead of startAt/total) ───────────────────────────────────
async function searchJiraJql(jql) {
  const url = `https://${JIRA_SITE}/rest/api/3/search/jql`;
  const issues = [];
  let nextPageToken;
  for (;;) {
    const body = { jql, fields: FIELDS, maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    let resp;
    try {
      resp = await axios.post(url, body, {
        auth: { username: JIRA_EMAIL, password: JIRA_API_TOKEN },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (e) {
      const detail = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
      throw new Error(`Jira search failed for JQL "${jql.slice(0, 80)}...": ${detail}`);
    }
    issues.push(...(resp.data.issues || []));
    if (!resp.data.nextPageToken) break;
    nextPageToken = resp.data.nextPageToken;
  }
  return issues;
}

// Mirrors NautilusOther's inline sprint logic: no fixed 4/5/6 scheme, so it
// just reports whichever sprint is active, else the next future one, else
// the last sprint on the issue. Also used, as-is, for every user-added
// custom track (scripts/jiraTracks.custom.json) - a fixed-ID mapping isn't
// practical to ask for from a UI form, and this adapts automatically as
// sprints roll over instead of needing sprint IDs updated each quarter.
function genericSprintName(sprintsList) {
  if (!Array.isArray(sprintsList) || sprintsList.length === 0) return 'No Sprint / Backlog';
  const active = sprintsList.filter((s) => s && s.state === 'active');
  if (active.length) return active[0].name;
  const future = sprintsList.filter((s) => s && s.state === 'future');
  if (future.length) return future[0].name;
  return sprintsList[sprintsList.length - 1].name;
}

function issueToRow(issue, track, sprintFn) {
  const f = issue.fields || {};
  const sprintsList = f.customfield_10020 || null;
  const sprint = sprintFn(sprintsList);
  return {
    Track: track,
    SprintNum: sprint.num,
    SprintLabel: sprint.label,
    Type: f.issuetype ? f.issuetype.name : null,
    Key: issue.key,
    Summary: f.summary || '',
    Assignee: f.assignee ? f.assignee.displayName : 'Unassigned',
    Status: f.status ? f.status.name : null,
    RemainingHours: f.timeestimate ? f.timeestimate / 3600 : 0,
  };
}

const ENHANCEMENT_JQL = 'project IN (GCCM, GCMDT, GCMDW, GCMR, GBCM, CMT) AND component = CC_ENHANCEMENT AND type NOT IN (Bug, Defect) AND "work item type[dropdown]" = QA_Only AND status NOT IN (Closed, Retired, Done)';

const CLAIMCENTER_JQL = 'project IN (GCCM, GCMDT, CMT) AND component != CC_ENHANCEMENT AND type NOT IN (Bug, Defect) AND status NOT IN (Closed, Retired, Done) AND "work item type[dropdown]" = QA_Only';

const SMARTCOMM_JQL = 'project = SMART AND "work item type[dropdown]" IN ("Test Planning", "Test Execution", QA_Only) AND status NOT IN (Closed, Retired, Done)';

const NAUTILUSOTHER_JQL = '(project IN (PNACIR4, PNGCIR4, PNPR3, "Project Nautilus GW R5 Phase II PL Implementation", "R4 Premium Validation") AND type IN (Task, Subtask, Sub-task, Enhancement) AND assignee IN (632a13f6a84c7f79c383e969, 712020:13c889bd-3479-4459-b9e7-0b7f5b7a7500, 712020:93111fb5-aa75-4fee-bda0-fc2d4167fe0d, 712020:e70c92e0-7022-4335-bff5-f146761c7760, 712020:f25ecc96-be5d-44cd-8d53-7559039c9939, 712020:216591ee-331a-460d-93b6-e1cec716e325, 712020:98d5c96d-586a-46c4-bd1d-4130e0f4d86b, 712020:8f3140cb-7c7b-4403-828c-a207a0ff955d, currentUser(), 712020:db16beeb-7707-4d24-940e-c2089ad15e1c, 712020:d130cf77-6ba5-4436-afc3-8dbf1488ce5b, 712020:44573664-b26a-4b83-b885-b9bdb5fa6ef3) AND status NOT IN (Closed, Deferred, Completed, Rejected, Done, Retired)) or (project IN ("CL Workstation 2.0", Automation, "AppInt Build Projects") AND type IN (Task, Enhancement, Subtask, Sub-task) AND assignee IN (632a13f6a84c7f79c383e969, 712020:13c889bd-3479-4459-b9e7-0b7f5b7a7500, 712020:93111fb5-aa75-4fee-bda0-fc2d4167fe0d, 712020:f9f2a489-ca32-4fd1-8b02-7409ad882bf7, 712020:e70c92e0-7022-4335-bff5-f146761c7760, 712020:216591ee-331a-460d-93b6-e1cec716e325, 712020:98d5c96d-586a-46c4-bd1d-4130e0f4d86b, 712020:8f3140cb-7c7b-4403-828c-a207a0ff955d, currentUser(), 712020:db16beeb-7707-4d24-940e-c2089ad15e1c, 712020:7f9c1158-6dcd-422d-84b8-dee899135c74, 712020:d130cf77-6ba5-4436-afc3-8dbf1488ce5b, 712020:44573664-b26a-4b83-b885-b9bdb5fa6ef3) AND status NOT IN (Closed, Deferred, Completed, Rejected, Done, Retired))';

const TRACK_DEFS = {
  Enhancement: {
    label: 'Enhancement', sheetName: 'Enhancement', jql: ENHANCEMENT_JQL, track: 'Enhancement', filterDoneRetired: false,
    sprintFn: (s) => ({ num: genericSprintName(s), label: genericSprintName(s) }),
    title: 'Enhancement — QA_Only Pending Work (Closed/Retired/Done excluded via JQL) — LIVE from Jira',
    subtitle: 'No fixed Sprint 4/5/6 scheme — grouped by each item’s current sprint · Effort = Remaining Estimate',
  },
  ClaimCenter: {
    label: 'ClaimCenter', sheetName: 'ClaimCenter', jql: CLAIMCENTER_JQL, track: 'ClaimCenter', filterDoneRetired: false,
    sprintFn: (s) => ({ num: genericSprintName(s), label: genericSprintName(s) }),
    title: 'ClaimCenter — QA_Only Pending Work (Closed/Retired/Done excluded via JQL) — LIVE from Jira',
    subtitle: 'No fixed Sprint 4/5/6 scheme — grouped by each item’s current sprint · Effort = Remaining Estimate',
  },
  SmartComm: {
    label: 'SmartComm', sheetName: 'SmartComm', jql: SMARTCOMM_JQL, track: 'SmartComm', filterDoneRetired: false,
    sprintFn: (s) => ({ num: genericSprintName(s), label: genericSprintName(s) }),
    title: 'SmartComm — Test Planning / Test Execution / QA_Only — LIVE from Jira',
    subtitle: 'No fixed Sprint 4/5/6 scheme — grouped by each item’s current sprint · Effort = Remaining Estimate',
  },
  NautilusOther: {
    label: 'Nautilus/Other Projects', sheetName: 'Nautilus-Other', jql: NAUTILUSOTHER_JQL, track: 'Nautilus/Other Projects', filterDoneRetired: false,
    sprintFn: (s) => ({ num: genericSprintName(s), label: genericSprintName(s) }),
    title: 'Nautilus / Other Projects — Pending Work (already excludes Closed/Deferred/Completed/Rejected/Done/Retired) — LIVE from Jira',
    subtitle: 'No fixed Sprint 4/5/6 scheme for this query — grouped by each item’s current sprint · Effort = Remaining Estimate',
  },
};

// User-added tracks (see runner's "Add a new query" form / POST
// /api/jiraReport/tracks) live in this JSON file, separate from the 4
// built-in TRACK_DEFS above so a bad or unwanted custom entry can never
// touch the tested built-in queries - just edit/delete its entry in the
// file (or remove it from the UI) to fix or undo it.
const CUSTOM_TRACKS_FILE = path.join(__dirname, 'jiraTracks.custom.json');

function loadCustomTracks() {
  try {
    const raw = fs.readFileSync(CUSTOM_TRACKS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

for (const custom of loadCustomTracks()) {
  TRACK_DEFS[custom.key] = {
    label: custom.label, sheetName: custom.sheetName, jql: custom.jql, track: custom.label,
    filterDoneRetired: Boolean(custom.filterDoneRetired),
    sprintFn: (s) => ({ num: genericSprintName(s), label: genericSprintName(s) }),
    title: `${custom.label} — Pending Work${custom.filterDoneRetired ? ' (Done & Retired excluded)' : ''} — LIVE from Jira`,
    subtitle: 'Custom query · grouped by each item’s current sprint · Effort = Remaining Estimate',
  };
  ALL_TRACK_KEYS.push(custom.key);
}

async function fetchTrack(def) {
  console.log(`Fetching ${def.label}...`);
  const issues = await searchJiraJql(def.jql);
  let rows = issues.map((i) => issueToRow(i, def.track, def.sprintFn));
  if (def.filterDoneRetired) {
    rows = rows.filter((r) => r.Status !== 'Done' && r.Status !== 'Retired');
  }
  // Stable sort by sprint (ascending string compare - "4"<"5"<"6" for the
  // fixed tracks; for NautilusOther's free-form sprint names this also
  // happens to put "No Sprint / Backlog" last since "N" > the "A"/"P"/etc.
  // starting letters its real sprint names use). Ties keep Jira's own order.
  rows.sort((a, b) => String(a.SprintNum || '').localeCompare(String(b.SprintNum || '')));
  console.log(`${def.label}: ${rows.length} issues`);
  return rows;
}

function groupSum(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, Object.assign({ SumRemainingHours: 0, CountKey: 0 }, labelFn(r)));
    const entry = map.get(key);
    entry.SumRemainingHours += r.RemainingHours || 0;
    entry.CountKey += 1;
  }
  return Array.from(map.values());
}

// Builds one track's sheet: title/subtitle, sprint-sorted+banded detail
// table with a total row, then (per the requested layout) that same
// track's own "Total Remaining Estimate by Assignee" summary directly
// below it on the same sheet.
function buildAreaSheet(workbook, def, rows) {
  const ws = workbook.addWorksheet(def.sheetName);
  ws.columns = [
    { width: 20 }, { width: 10 }, { width: 14 }, { width: 55 }, { width: 22 }, { width: 14 }, { width: 16 },
  ];

  ws.mergeCells('A1:G1');
  const titleCell = ws.getCell('A1');
  titleCell.value = def.title;
  styleTitleCell(titleCell);
  ws.getRow(1).height = 20;

  ws.mergeCells('A2:G2');
  const subtitleCell = ws.getCell('A2');
  subtitleCell.value = def.subtitle;
  styleSubtitleCell(subtitleCell);

  ws.getRow(3); // leave row 3 blank as a spacer, matching the original report layout
  const headerRow = ws.getRow(4);
  headerRow.values = ['Sprint', 'Type', 'Key', 'Summary', 'Assignee', 'Status', 'Remaining Hours'];
  styleHeaderRow(headerRow);
  ws.autoFilter = { from: 'A4', to: 'G4' };
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  let prevSprint;
  let bandFill = COLOR.bandA;
  let totalHours = 0;
  for (const r of rows) {
    const sprintDisplay = r.SprintLabel || r.SprintNum || '(none)';
    if (sprintDisplay !== prevSprint) {
      bandFill = bandFill === COLOR.bandA ? COLOR.bandB : COLOR.bandA;
      prevSprint = sprintDisplay;
    }
    const hours = Math.round(r.RemainingHours * 100) / 100;
    totalHours += hours;
    const row = ws.addRow([sprintDisplay, r.Type, r.Key, r.Summary, r.Assignee, r.Status, hours]);
    styleDataRow(row, bandFill);
  }

  const totalRowIndex = ws.rowCount + 1;
  ws.mergeCells(`A${totalRowIndex}:F${totalRowIndex}`);
  const totalLabelCell = ws.getCell(`A${totalRowIndex}`);
  totalLabelCell.value = 'TOTAL REMAINING ESTIMATE';
  totalLabelCell.alignment = { horizontal: 'right' };
  ws.getCell(`G${totalRowIndex}`).value = Math.round(totalHours * 100) / 100;
  styleTotalRow(ws.getRow(totalRowIndex));

  // ── Inline per-track summary: Total Remaining Estimate by Assignee ──────
  const byAssignee = groupSum(rows, (r) => r.Assignee, (r) => ({ Assignee: r.Assignee }))
    .sort((a, b) => a.Assignee.localeCompare(b.Assignee));

  let r = totalRowIndex + 2;
  ws.mergeCells(`A${r}:C${r}`);
  const summaryTitleCell = ws.getCell(`A${r}`);
  summaryTitleCell.value = 'Total Remaining Estimate by Assignee';
  styleTitleCell(summaryTitleCell);
  summaryTitleCell.font = { bold: true, size: 12, color: { argb: COLOR.title } };
  r += 1;

  const summaryHeaderRow = ws.getRow(r);
  summaryHeaderRow.getCell(1).value = 'Assignee';
  summaryHeaderRow.getCell(2).value = 'Total Items';
  summaryHeaderRow.getCell(3).value = 'Total Remaining Hrs';
  styleHeaderRow({ eachCell: (fn) => [1, 2, 3].forEach((c) => fn(summaryHeaderRow.getCell(c))) });
  r += 1;

  let grandItems = 0;
  let grandHours = 0;
  const summaryStart = r;
  for (const a of byAssignee) {
    const row = ws.getRow(r);
    const hours = Math.round(a.SumRemainingHours * 100) / 100;
    row.getCell(1).value = a.Assignee;
    row.getCell(2).value = a.CountKey;
    row.getCell(3).value = hours;
    styleDataRow({ eachCell: (fn) => [1, 2, 3].forEach((c) => fn(row.getCell(c))) }, null);
    grandItems += a.CountKey;
    grandHours += hours;
    r += 1;
  }
  const grandRow = ws.getRow(r);
  grandRow.getCell(1).value = 'GRAND TOTAL';
  grandRow.getCell(2).value = grandItems;
  grandRow.getCell(3).value = Math.round(grandHours * 100) / 100;
  styleTotalRow({ eachCell: (fn) => [1, 2, 3].forEach((c) => fn(grandRow.getCell(c))) });

  return ws;
}

function buildDataSheet(workbook, rows) {
  const ws = workbook.addWorksheet('Data');
  ws.columns = [
    { header: 'Track', width: 20 }, { header: 'SprintNum', width: 12 }, { header: 'Type', width: 10 },
    { header: 'Key', width: 14 }, { header: 'Summary', width: 55 }, { header: 'Assignee', width: 22 },
    { header: 'Status', width: 14 }, { header: 'RemainingHours', width: 16 },
  ];
  styleHeaderRow(ws.getRow(1));
  ws.autoFilter = { from: 'A1', to: 'H1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const sorted = [...rows].sort((a, b) =>
    a.Track.localeCompare(b.Track) || String(a.SprintNum || '').localeCompare(String(b.SprintNum || ''))
  );
  let prevKey;
  let bandFill = COLOR.bandA;
  for (const r of sorted) {
    const key = `${r.Track}|${r.SprintNum}`;
    if (key !== prevKey) { bandFill = bandFill === COLOR.bandA ? COLOR.bandB : COLOR.bandA; prevKey = key; }
    const row = ws.addRow([r.Track, r.SprintNum, r.Type, r.Key, r.Summary, r.Assignee, r.Status, Math.round(r.RemainingHours * 100) / 100]);
    styleDataRow(row, bandFill);
  }
  return ws;
}

function buildSummarySheets(workbook, allPendingWork) {
  const byTrackSprint = groupSum(
    allPendingWork, (r) => `${r.Track}|${r.SprintNum}`, (r) => ({ Track: r.Track, SprintNum: r.SprintNum })
  ).sort((a, b) => a.Track.localeCompare(b.Track) || String(a.SprintNum || '').localeCompare(String(b.SprintNum || '')));

  const ws1 = workbook.addWorksheet('Summary - By Track-Sprint');
  ws1.columns = [{ header: 'Track', width: 20 }, { header: 'SprintNum', width: 12 }, { header: 'Sum of RemainingHours', width: 22 }, { header: 'Count of Key', width: 14 }];
  styleHeaderRow(ws1.getRow(1));
  byTrackSprint.forEach((r) => ws1.addRow([r.Track, r.SprintNum, Math.round(r.SumRemainingHours * 100) / 100, r.CountKey]).eachCell((c) => { c.border = ALL_BORDERS; }));

  const byAssignee = groupSum(
    allPendingWork, (r) => `${r.Track}|${r.Assignee}|${r.SprintNum}`, (r) => ({ Track: r.Track, Assignee: r.Assignee, SprintNum: r.SprintNum })
  ).sort((a, b) => a.Track.localeCompare(b.Track) || a.Assignee.localeCompare(b.Assignee) || String(a.SprintNum || '').localeCompare(String(b.SprintNum || '')));

  const ws2 = workbook.addWorksheet('Summary - By Assignee');
  ws2.columns = [{ header: 'Track', width: 20 }, { header: 'Assignee', width: 22 }, { header: 'SprintNum', width: 12 }, { header: 'Sum of RemainingHours', width: 22 }];
  styleHeaderRow(ws2.getRow(1));
  byAssignee.forEach((r) => ws2.addRow([r.Track, r.Assignee, r.SprintNum, Math.round(r.SumRemainingHours * 100) / 100]).eachCell((c) => { c.border = ALL_BORDERS; }));
}

function resolveTracks(tracksArg) {
  if (!tracksArg || tracksArg === 'all') return ALL_TRACK_KEYS;
  const requested = String(tracksArg).split(',').map((s) => s.trim()).filter(Boolean);
  const invalid = requested.filter((t) => !ALL_TRACK_KEYS.includes(t));
  if (invalid.length) throw new Error(`Unknown track(s): ${invalid.join(', ')} (valid: ${ALL_TRACK_KEYS.join(', ')})`);
  if (requested.length === 0) return ALL_TRACK_KEYS;
  return requested;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Emails the finished workbook. A missing SMTP config just skips (same as
// emailReporter.js) - the Excel is already saved locally either way. A real
// send failure throws so the run exits non-zero instead of looking like the
// email went out.
async function sendReportEmail(outputPath, trackSummaries, to) {
  if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL) {
    console.log('SMTP_HOST / FROM_EMAIL not set in .env; email skipped (Excel still saved locally)');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 25,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  const totalItems = trackSummaries.reduce((n, t) => n + t.items, 0);
  const totalHours = Math.round(trackSummaries.reduce((n, t) => n + t.hours, 0) * 100) / 100;
  const cell = 'padding:8px 12px;border:1px solid #ddd;';
  const rowsHtml = trackSummaries.map((t) =>
    `<tr><td style="${cell}">${escapeHtml(t.label)}</td><td style="${cell}text-align:right;">${t.items}</td><td style="${cell}text-align:right;">${Math.round(t.hours * 100) / 100}</td></tr>`
  ).join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#1F3864;">Jira Sprint / Pending-Work Report</h2>
      <p style="color:#555;">Generated from Jira on ${escapeHtml(new Date().toLocaleString('en-US'))}. Full detail (per-track sheets, combined Data sheet, and assignee summaries) is in the attached Excel workbook.</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#1F3864;color:#fff;">
          <th style="${cell}text-align:left;">Track</th><th style="${cell}text-align:right;">Items</th><th style="${cell}text-align:right;">Remaining Hrs</th>
        </tr></thead>
        <tbody>${rowsHtml}
          <tr style="background:#D9E1F2;font-weight:bold;"><td style="${cell}">TOTAL</td><td style="${cell}text-align:right;">${totalItems}</td><td style="${cell}text-align:right;">${totalHours}</td></tr>
        </tbody>
      </table>
    </div>`;

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const trackLabel = trackSummaries.length === ALL_TRACK_KEYS.length ? 'All Tracks' : trackSummaries.map((t) => t.label).join(', ');
  const subject = `Jira Sprint Report - ${trackLabel} - ${today}`;
  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to,
    subject,
    html,
    attachments: [{ filename: path.basename(outputPath), path: outputPath }],
  });
  console.log(`Report emailed to ${to}: ${subject}`);
}

// options.emailTo - when set, also emails the workbook to this address.
async function generateReport(outputPath, tracksArg, options = {}) {
  if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must be set in .env (see .env.example).');
  }
  const tracks = resolveTracks(tracksArg);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiraReport.js';
  workbook.created = new Date();

  const allPendingWork = [];
  const trackSummaries = [];
  for (const key of tracks) {
    const def = TRACK_DEFS[key];
    const rows = await fetchTrack(def);
    buildAreaSheet(workbook, def, rows);
    allPendingWork.push(...rows);
    trackSummaries.push({ label: def.label, items: rows.length, hours: rows.reduce((n, r) => n + (r.RemainingHours || 0), 0) });
  }
  console.log(`AllPendingWork: ${allPendingWork.length} issues combined`);

  buildDataSheet(workbook, allPendingWork);
  buildSummarySheets(workbook, allPendingWork);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Report written: ${outputPath}`);

  if (options.emailTo) {
    try {
      await sendReportEmail(outputPath, trackSummaries, options.emailTo);
    } catch (e) {
      throw new Error(`Report was saved to ${outputPath} but emailing it to ${options.emailTo} failed: ${e.message}`);
    }
  }
  return outputPath;
}

if (require.main === module) {
  const outputPath = process.argv[2] || path.join(__dirname, '..', 'reports', 'jira', 'Sprint_Pending_Work_Report.xlsx');
  const tracksArg = process.argv[3];
  generateReport(outputPath, tracksArg, { emailTo: process.env.JIRA_REPORT_EMAIL_TO }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { generateReport, ALL_TRACK_KEYS, TRACK_DEFS };
