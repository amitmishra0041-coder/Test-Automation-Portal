// scripts/ebt/tracker.js — read / add rows in "GW CC-CM Cloud Migration EBT Feedback Tracker.xlsx".
//
// The workbook's Summary sheet is a pivot table and the Log sheet carries x14 dropdowns; ExcelJS drops both on save,
// so rows are written by editing the Log sheet's XML in place: only the cells of the one row being filled change
// (each keeps its existing style), and the pivot cache is flagged to refresh when the file is next opened.
//
// Log columns: A Feedback ID | B Reported | C LOB | D Feature | E System | F Description | G Initial Priority |
//              H JIRA ID | I Reporter | J Workstream | K Status | L Comments
// The team pre-numbers IDs down column A (EBT.GCCM.FD.007, .008, ...); the next ID is the first numbered row with an
// empty Description. When every numbered row is used a new row is appended with the next number.
'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const DEFAULT_TRACKER = 'S:\\Shared Folders\\Guidewire Cloud Initiative\\QA\\EBT\\GW CC-CM Cloud Migration EBT Feedback Tracker.xlsx';
const trackerPath = () => process.env.EBT_TRACKER_PATH || DEFAULT_TRACKER;
const LOG_SHEET = '--- Log ---';
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const FIELD_COL = { id: 'A', reported: 'B', lob: 'C', feature: 'D', system: 'E', description: 'F', priority: 'G', jiraId: 'H', reporter: 'I', workstream: 'J', status: 'K', comments: 'L' };
const ID_RE = /^EBT\.GCCM\.FD\.(\d+)$/;

const xmlUnescape = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const textOf = (xml) => xmlUnescape((xml.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));

// Excel's own lock file ("~$name.xlsx") sits next to a workbook someone has open; its owner name is a
// length-prefixed string at byte 1.
function lockOwner(file) {
  const lock = path.join(path.dirname(file), `~$${path.basename(file).slice(2)}`);
  const lock2 = path.join(path.dirname(file), `~$${path.basename(file)}`);
  for (const l of [lock2, lock]) {
    try {
      const b = fs.readFileSync(l);
      const n = b[0]; const name = b.slice(1, 1 + n).toString('latin1').trim();
      return name || 'someone';
    } catch { /* no lock */ }
  }
  return null;
}

async function open(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheet = (wb.match(/<sheet [^>]*>/g) || []).find((s) => xmlUnescape((s.match(/name="([^"]*)"/) || [])[1] || '') === LOG_SHEET);
  if (!sheet) throw new Error(`The tracker has no "${LOG_SHEET}" sheet`);
  const rid = sheet.match(/r:id="([^"]+)"/)[1];
  const target = (rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`)) || [''])[0].match(/Target="([^"]+)"/)[1];
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const ssFile = zip.file('xl/sharedStrings.xml');
  const ss = ssFile ? ((await ssFile.async('string')).match(/<si>[\s\S]*?<\/si>/g) || []).map(textOf) : [];
  return { zip, sheetPath, xml: await zip.file(sheetPath).async('string'), ss };
}

function cellValue(cellXml, ss) {
  if (!cellXml || /\/>$/.test(cellXml.match(/^<c[^>]*>/)[0])) return '';
  const t = (cellXml.match(/^<c[^>]*\st="([^"]+)"/) || [])[1];
  if (t === 'inlineStr') return textOf(cellXml);
  const v = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  if (v == null) return '';
  return t === 's' ? ss[+v] || '' : xmlUnescape(v);
}

function readRows(xml, ss) {
  const rows = [];
  (xml.match(/<row [^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).forEach((rowXml) => {
    const r = +rowXml.match(/ r="(\d+)"/)[1];
    const cells = {};
    (rowXml.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => { cells[c.match(/ r="([A-Z]+)\d+"/)[1]] = c; });
    const vals = {};
    Object.entries(FIELD_COL).forEach(([k, col]) => { vals[k] = cellValue(cells[col], ss).trim(); });
    rows.push({ r, xml: rowXml, cells, vals });
  });
  return rows;
}

// Everything the Runner shows before filing: the next free ID, the dropdown lists from the Values sheet, the most
// recent entries and any row whose description already carries this subject (a re-upload of the same email).
async function inspect({ subject } = {}) {
  const file = trackerPath();
  if (!fs.existsSync(file)) throw new Error(`Tracker not found: ${file} (is the S: drive connected?)`);
  const { zip, xml, ss } = await open(file);
  const rows = readRows(xml, ss).filter((x) => x.r > 1);
  const numbered = rows.filter((x) => ID_RE.test(x.vals.id));
  const free = numbered.find((x) => !x.vals.description);
  const maxN = numbered.reduce((m, x) => Math.max(m, +x.vals.id.match(ID_RE)[1]), 0);
  const nextId = free ? free.vals.id : `EBT.GCCM.FD.${String(maxN + 1).padStart(3, '0')}`;
  const filed = numbered.filter((x) => x.vals.description);
  const subj = String(subject || '').toLowerCase().trim();
  const duplicates = subj ? filed.filter((x) => x.vals.description.toLowerCase().includes(subj)).map((x) => x.vals) : [];
  return { file, lockedBy: lockOwner(file), nextId, lists: await valueLists(zip, ss), recent: filed.slice(-8).map((x) => x.vals), duplicates };
}

// Values sheet: A LOB, C Priority, E Features, H System, J Status (row 1 = headers).
async function valueLists(zip, ss) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheet = (wb.match(/<sheet [^>]*>/g) || []).find((s) => /name="Values"/.test(s));
  const lists = { lob: [], priority: [], feature: [], system: [], status: [] };
  if (!sheet) return lists;
  const rid = sheet.match(/r:id="([^"]+)"/)[1];
  const target = (rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`)) || [''])[0].match(/Target="([^"]+)"/)[1];
  const xml = await zip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`).async('string');
  const colMap = { A: 'lob', C: 'priority', E: 'feature', H: 'system', J: 'status' };
  (xml.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
    const [, col, row] = c.match(/ r="([A-Z]+)(\d+)"/);
    if (+row < 2 || !colMap[col]) return;
    const v = cellValue(c, ss).trim();
    if (v) lists[colMap[col]].push(v);
  });
  return lists;
}

// Local calendar date -> Excel serial (the Reported column holds plain dates).
function excelDate(d) {
  const dt = new Date(d);
  return Math.round((Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

function buildCell(col, r, style, value) {
  const s = style ? ` s="${style}"` : '';
  if (value === '' || value == null) return `<c r="${col}${r}"${s}/>`;
  if (typeof value === 'number') return `<c r="${col}${r}"${s}><v>${value}</v></c>`;
  return `<c r="${col}${r}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

// statuses: { 'GCCM-1393': 'Fixed', ... } (current JIRA status per key). Rewrites column K of every filed row whose
// JIRA ID is in the map and whose Status differs. Returns the new sheet XML and the list of changes.
function applyStatuses(xml, rows, statuses) {
  const changes = [];
  if (!statuses) return { xml, changes };
  rows.forEach((x) => {
    const want = statuses[x.vals.jiraId];
    if (!want || !x.vals.description || want === x.vals.status) return;
    const old = x.cells.K;
    const style = old ? (old.match(/ s="(\d+)"/) || [])[1] : '';
    const cell = buildCell('K', x.r, style, want);
    if (old) xml = xml.replace(old, cell);
    else {
      const next = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].map((c) => x.cells[c]).find(Boolean);
      const rowNow = xml.match(new RegExp(`<row r="${x.r}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`))[0];
      xml = xml.replace(rowNow, next ? rowNow.replace(next, cell + next) : rowNow.replace(/<\/row>$/, `${cell}</row>`));
    }
    changes.push({ id: x.vals.id, jiraId: x.vals.jiraId, from: x.vals.status, to: want });
  });
  return { xml, changes };
}

// Refresh only the Status column from JIRA (no new row).
async function syncStatuses(statuses, { backupDir } = {}) {
  const file = trackerPath();
  const owner = lockOwner(file);
  if (owner) throw new Error(`The tracker is open in Excel by ${owner} — close it, then retry.`);
  const original = fs.readFileSync(file);
  const { zip, sheetPath, xml, ss } = await open(file);
  const { xml: newXml, changes } = applyStatuses(xml, readRows(xml, ss), statuses);
  if (!changes.length) return { file, changes };
  zip.file(sheetPath, newXml);
  await save(file, zip, original, backupDir);
  return { file, changes };
}

async function save(file, zip, original, backupDir) {
  const pivots = Object.keys(zip.files).filter((n) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(n));
  for (const p of pivots) {
    const px = await zip.file(p).async('string');
    if (!/refreshOnLoad=/.test(px)) zip.file(p, px.replace(/<pivotCacheDefinition /, '<pivotCacheDefinition refreshOnLoad="1" '));
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `${path.basename(file, '.xlsx')}.${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`), original);
  }
  if (lockOwner(file)) throw new Error('The tracker was opened in Excel while saving — nothing was written; retry once it is closed.');
  try { fs.writeFileSync(file, out); } catch (e) {
    if (/EBUSY|EPERM|EACCES/.test(e.code || '')) throw new Error('The tracker is locked (open in Excel or read-only for you) — close it and retry.');
    throw e;
  }
}

// row: { id, reported (Date), lob, feature, system, description, priority, jiraId, reporter, workstream, status, comments }
// Fills the row whose column A is row.id (or appends it). Refuses to overwrite a row that already has a description.
// statuses (optional): JIRA statuses to refresh on the existing rows in the same save (see applyStatuses).
async function addRow(row, { backupDir, statuses } = {}) {
  const file = trackerPath();
  const owner = lockOwner(file);
  if (owner) throw new Error(`The tracker is open in Excel by ${owner} — ask them to close it (or close it yourself), then retry.`);
  const original = fs.readFileSync(file);
  const { zip, sheetPath, xml: rawXml, ss } = await open(file);
  const synced = applyStatuses(rawXml, readRows(rawXml, ss), statuses);
  const xml = synced.xml;
  const rows = readRows(xml, ss);
  let target = rows.find((x) => x.vals.id === row.id);
  if (target && target.vals.description) throw new Error(`${row.id} is already used in the tracker ("${target.vals.description}")`);

  const values = { ...row, reported: row.reported ? excelDate(row.reported) : '' };
  let newXml;
  if (target) {
    const cells = COLS.map((col) => {
      const field = Object.keys(FIELD_COL).find((k) => FIELD_COL[k] === col);
      const existing = target.cells[col];
      const style = existing ? (existing.match(/ s="(\d+)"/) || [])[1] : '';
      if (col === 'A') return existing || buildCell(col, target.r, style, row.id);
      return buildCell(col, target.r, style, values[field] == null ? '' : values[field]);
    });
    const extra = Object.keys(target.cells).filter((c) => !COLS.includes(c)).map((c) => target.cells[c]);
    const open = target.xml.match(/^<row [^>]*?>/)[0].replace(/\/>$/, '>');
    newXml = xml.replace(target.xml, `${open}${cells.join('')}${extra.join('')}</row>`);
  } else {
    // Append after the last numbered row, copying that row's cell styles.
    const numbered = rows.filter((x) => ID_RE.test(x.vals.id));
    const last = numbered[numbered.length - 1] || rows[rows.length - 1];
    const r = last.r + 1;
    if (rows.some((x) => x.r === r && Object.values(x.vals).some(Boolean))) throw new Error(`Row ${r} of the tracker is not empty — add the next Feedback ID rows by hand first`);
    const cells = COLS.map((col) => {
      const field = Object.keys(FIELD_COL).find((k) => FIELD_COL[k] === col);
      const style = last.cells[col] ? (last.cells[col].match(/ s="(\d+)"/) || [])[1] : '';
      return buildCell(col, r, style, values[field] == null ? '' : values[field]);
    });
    const attrs = (last.xml.match(/^<row ([^>]*?)\/?>/)[1]).replace(/ r="\d+"/, '').replace(/^r="\d+"\s*/, '');
    const rowXml = `<row r="${r}" ${attrs}>${cells.join('')}</row>`;
    const existingEmpty = rows.find((x) => x.r === r);
    newXml = existingEmpty ? xml.replace(existingEmpty.xml, rowXml) : xml.replace(last.xml, last.xml + rowXml);
  }
  zip.file(sheetPath, newXml);
  await save(file, zip, original, backupDir);
  // Read back what landed.
  const check = readRows((await open(file)).xml, ss).find((x) => x.vals.id === row.id);
  if (!check || check.vals.jiraId !== String(row.jiraId || '')) throw new Error(`Saved, but ${row.id} did not read back as expected — check the tracker`);
  return { file, row: check.r, statusChanges: synced.changes };
}

// Every filed entry (numbered row with a description), Reported as an ISO date — for the weekly status deck.
async function listEntries() {
  const file = trackerPath();
  if (!fs.existsSync(file)) throw new Error(`Tracker not found: ${file} (is the S: drive connected?)`);
  const { xml, ss } = await open(file);
  return readRows(xml, ss).filter((x) => x.r > 1 && ID_RE.test(x.vals.id) && x.vals.description).map((x) => {
    const n = Number(x.vals.reported);
    const reported = n > 0 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : x.vals.reported;
    return { ...x.vals, reported };
  });
}

module.exports = { inspect, addRow, syncStatuses, listEntries, trackerPath, excelDate };
