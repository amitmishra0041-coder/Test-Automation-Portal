// scripts/ebt/testCases.js — scenario progress by team, read from the business teams' "Claims EBT Test cases.xlsx"
// (one tab per team: a "<Team> - EBT test cases" title in row 1, then a header row with Scenario ... Status).
// Read-only. A Status is counted by how it starts, the same rule as the workbook's own Dashboard tab:
//   Complet* / Pass* / Done* = completed | Error* / Fail* / Issue* / Defect* = issue reported
//   In Progress / Started = in progress | Block* / On Hold = blocked | blank or anything else = not started
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const casesPath = () => process.env.EBT_CASES_PATH || path.join(os.homedir(), 'Desktop', 'EBT PPT', 'EBT Test cases', 'Claims EBT Test cases.xlsx');
const KEYS = ['completed', 'issue', 'inProgress', 'blocked', 'notStarted'];

function statusKey(s) {
  s = String(s || '').trim();
  if (/^(complet|pass|done)/i.test(s)) return 'completed';
  if (/^(error|fail|issue|defect)/i.test(s)) return 'issue';
  if (/^(in\s*progress|started)/i.test(s)) return 'inProgress';
  if (/^(block|on\s*hold)/i.test(s)) return 'blocked';
  return 'notStarted';
}

// { file, teams: [{ team, scenarios, completed, issue, inProgress, blocked, notStarted }], total: {...same} },
// or null when the workbook isn't there.
function readProgress(file = casesPath()) {
  if (!fs.existsSync(file)) return null;
  const wb = XLSX.read(fs.readFileSync(file));
  const blank = () => Object.assign({ scenarios: 0 }, ...KEYS.map((k) => ({ [k]: 0 })));
  const total = blank(), teams = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const col = (r, re) => r.findIndex((c) => re.test(String(c).trim()));
    const h = rows.findIndex((r) => col(r, /^scenario$/i) >= 0 && col(r, /^status$/i) >= 0);
    if (h < 0) continue; // the Dashboard, or a tab that isn't a team's list
    const sc = col(rows[h], /^scenario$/i), st = col(rows[h], /^status$/i);
    const t = { team: String((rows[0] || [])[0] || '').replace(/\s*-\s*EBT test cases\s*$/i, '').trim() || name, ...blank() };
    for (const r of rows.slice(h + 1)) {
      if (!String(r[sc]).trim()) continue;
      const k = statusKey(r[st]);
      t.scenarios++; t[k]++; total.scenarios++; total[k]++;
    }
    teams.push(t);
  }
  return teams.length ? { file, teams, total } : null;
}

// ---- "EBT Defects" tab: a copy of the feedback tracker's filed rows, which the Dashboard counts by department ----
// Rewritten in place in the sheet XML (the Dashboard has charts, data bars and array formulas that a library save would
// drop); the workbook is flagged to recalculate when next opened. Department = the Dashboard team whose member list
// names the reporter ("Last, First" in the tracker).
const DEFECTS_SHEET = 'EBT Defects';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const lockedBy = (file) => {
  try { const b = fs.readFileSync(path.join(path.dirname(file), `~$${path.basename(file)}`)); return b.slice(1, 1 + b[0]).toString('latin1').trim() || 'someone'; } catch { return null; }
};

function departmentOf(reporter, teams) {
  const [last = '', rest = ''] = String(reporter || '').split(',').map((s) => s.trim());
  const first = rest.split(/\s+/)[0] || '';
  if (!last) return 'Not mapped';
  const hit = teams.find((t) => t.members.toLowerCase().includes(last.toLowerCase()) && (!first || t.members.toLowerCase().includes(first.slice(0, 3).toLowerCase())));
  return hit ? hit.team : 'Not mapped';
}

// entries: tracker.listEntries() rows ({ id, reported 'YYYY-MM-DD', reporter, feature, description, priority, jiraId, status }).
// Returns { ok, file, rows } or { ok: false, skipped } when the workbook is missing or open in Excel (never throws for those).
async function syncDefects(entries, file = casesPath()) {
  if (!fs.existsSync(file)) return { ok: false, skipped: `test case workbook not found (${file})` };
  const owner = lockedBy(file);
  if (owner) return { ok: false, skipped: `test case workbook is open in Excel by ${owner} — it will catch up on the next filing or status refresh` };
  const JSZip = require('jszip');
  const original = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(original);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetTag = (wbXml.match(/<sheet [^>]*>/g) || []).find((s) => /name="EBT Defects"/.test(s));
  if (!sheetTag) return { ok: false, skipped: `the test case workbook has no "${DEFECTS_SHEET}" tab` };
  const rid = sheetTag.match(/r:id="([^"]+)"/)[1];
  const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`));
  const sheetPath = `xl/${(target[1] || target[2]).replace(/^\/?xl\//, '')}`;
  let xml = await zip.file(sheetPath).async('string');

  const dash = XLSX.read(original, { sheets: 'Dashboard' }).Sheets.Dashboard;
  const teams = [];
  if (dash) {
    const rows = XLSX.utils.sheet_to_json(dash, { header: 1, defval: '' });
    const h = rows.findIndex((r) => String(r[0]).trim() === 'Team' && /team members/i.test(String(r[9])));
    for (const r of rows.slice(h + 1)) { if (!String(r[0]).trim() || /^all teams$/i.test(String(r[0]).trim())) break; teams.push({ team: String(r[0]).trim(), members: String(r[9]) }); }
  }

  const row5 = (xml.match(/<row r="5"[^>]*>[\s\S]*?<\/row>/) || [''])[0];
  const style = (col, dflt) => ((row5.match(new RegExp(`<c r="${col}5"[^>]*? s="(\\d+)"`)) || [])[1] || dflt);
  const sText = style('A', '0'), sDate = style('B', sText);
  const rowAttrs = (row5.match(/<row r="5"([^>]*)>/) || ['', ' spans="1:9"'])[1].replace(/ ht="[^"]*"| customHeight="[^"]*"/g, '');
  const str = (ref, v) => `<c r="${ref}" s="${sText}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const list = entries.filter((e) => e.description);
  const body = list.map((e, i) => {
    const r = 5 + i;
    const n = /^\d{4}-\d{2}-\d{2}$/.test(e.reported) ? Math.round((Date.parse(`${e.reported}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 864e5) : null;
    const desc = String(e.description).replace(/^(EBT\.GCCM\.FD\.\d+:\s*)+/, '').trim();
    return `<row r="${r}"${rowAttrs}>${str(`A${r}`, e.id)}${n ? `<c r="B${r}" s="${sDate}"><v>${n}</v></c>` : str(`B${r}`, e.reported || '')}`
      + `${str(`C${r}`, departmentOf(e.reporter, teams))}${str(`D${r}`, String(e.reporter || '').trim())}${str(`E${r}`, e.feature || '')}`
      + `${str(`F${r}`, desc)}${str(`G${r}`, e.priority || '')}${str(`H${r}`, e.jiraId || '')}${str(`I${r}`, e.status || '')}</row>`;
  }).join('');
  const today = new Date().toLocaleDateString('en-US');
  xml = xml.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (m, r) => (Number(r) >= 5 ? '' : m))
    .replace('</sheetData>', `${body}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:I${Math.max(4, 4 + list.length)}"/>`)
    .replace(/(<c r="A2"[^>]*?)(?: t="[^"]*")?>[\s\S]*?<\/c>/, (m, open) => `${open.replace(/ t="[^"]*"/, '')} t="inlineStr"><is><t xml:space="preserve">${esc(`Copied from the GW CC-CM Cloud Migration EBT Feedback Tracker (Log tab) as of ${today} by the Runner on each EBT filing. The Dashboard counts come from the Department and Status columns here.`)}</t></is></c>`);
  zip.file(sheetPath, xml);
  zip.file('xl/workbook.xml', /fullCalcOnLoad=/.test(wbXml) ? wbXml : wbXml.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" '));
  zip.remove('xl/calcChain.xml');
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const backupDir = path.join(path.dirname(file), 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `Claims EBT Test cases - before defect sync ${new Date().toISOString().slice(0, 10)}.xlsx`), original);
  if (lockedBy(file)) return { ok: false, skipped: 'test case workbook was opened in Excel while saving — nothing written' };
  fs.writeFileSync(file, out);
  return { ok: true, file, rows: list.length, unmapped: list.filter((e) => departmentOf(e.reporter, teams) === 'Not mapped').map((e) => e.id) };
}

module.exports = { readProgress, statusKey, casesPath, syncDefects, departmentOf };
