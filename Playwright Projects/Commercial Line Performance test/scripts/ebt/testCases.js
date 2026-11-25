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

// Shared copy on the team drive (so the Runner works for everyone); the owner's Desktop copy only if V: isn't there.
const SHARED_CASES = 'V:\\Amit Int\\EBT\\Test cases\\Claims EBT Test cases.xlsx';
const casesPath = () => process.env.EBT_CASES_PATH || (fs.existsSync(SHARED_CASES) ? SHARED_CASES
  : path.join(os.homedir(), 'Desktop', 'EBT PPT', 'EBT Test cases', 'Claims EBT Test cases.xlsx'));
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

// ---- What the teams tested this week (the EBT slide's middle column) ----
// A row counts when its Status is completed / issue / in progress and it was worked this week (Monday on):
//   - the date in its Status ("Completed 11/19") or, failing that, its Target Week cell (a date, "11-17",
//     "Week of 11/16") decides: on or after this Monday = this week
//   - a row with no date counts when its status changed since the start of the week, read from the newest
//     "backup/... YYYY-MM-DD.xlsx" copy dated on or before this Monday (the defect sync keeps one a day)
// Each team is summed up in business words picked out of its scenarios and feature areas (fixed list, no AI).
const TERMS = [
  [/total loss|\bTL\b/i, 'total loss'], [/salvage/i, 'salvage'], [/fnol|new claim|queue|website|mobile/i, 'new claims (FNOL)'],
  [/glass|towing/i, 'glass / towing'], [/assign/i, 'assignments'], [/diary|diaries|activit/i, 'activities / diaries'],
  [/deductible/i, 'deductible returns'], [/recovery|subro/i, 'recoveries'], [/reserve/i, 'reserves'],
  [/payment|check|\bpaid\b|\bpay\b/i, 'payments'], [/approv|authority/i, 'approvals / authority'], [/lienholder/i, 'lienholder payments'],
  [/metro/i, 'Metro'], [/medicare/i, 'Medicare'], [/image\s*right/i, 'ImageRight'], [/smart\s*comm|template|letter|\bdoc/i, 'documents / letters'],
  [/exposure/i, 'exposures'], [/parties|contact/i, 'parties / contacts'], [/polic|coverage/i, 'policy / coverages'],
  [/enterprise|reservation|rental/i, 'rental (Enterprise)'], [/note/i, 'notes'], [/admin/i, 'administration'], [/report/i, 'reports'],
  [/team tab|team view/i, 'team view'], [/medical|wage/i, 'medical / wage payments'],
];
const ACTIVE = new Set(['completed', 'issue', 'inProgress']);
const mondayOf = (d) => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };

// A date from a cell: an Excel date number, "11/19", "11-17", "Week of 11/16", "Completed 11/19". null if none.
function cellDate(v, year) {
  if (typeof v === 'number' && v > 40000) return new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4);
  const m = String(v || '').match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  return new Date(y, Number(m[1]) - 1, Number(m[2]));
}

// { tab -> Map(scenario -> statusKey) } of a workbook, for the start-of-week comparison.
function statusesOf(file) {
  const wb = XLSX.read(fs.readFileSync(file)), out = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const col = (r, re) => r.findIndex((c) => re.test(String(c).trim()));
    const h = rows.findIndex((r) => col(r, /^scenario$/i) >= 0 && col(r, /^status$/i) >= 0);
    if (h < 0) continue;
    const sc = col(rows[h], /^scenario$/i), st = col(rows[h], /^status$/i);
    out[name] = new Map(rows.slice(h + 1).filter((r) => String(r[sc]).trim()).map((r) => [String(r[sc]).trim(), statusKey(r[st])]));
  }
  return out;
}

function weekBaseline(file, monday) {
  const dir = path.join(path.dirname(file), 'backup');
  if (!fs.existsSync(dir)) return null;
  const day = (d) => d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate();
  const cands = fs.readdirSync(dir).map((f) => ({ f, m: f.match(/(\d{4})-(\d{2})-(\d{2})\.xlsx$/i) })).filter((c) => c.m && !c.f.startsWith('~$'))
    .map((c) => ({ f: path.join(dir, c.f), d: Number(c.m[1]) * 1e4 + Number(c.m[2]) * 100 + Number(c.m[3]) })).filter((c) => c.d <= day(monday))
    .sort((a, b) => b.d - a.d);
  try { return cands.length ? statusesOf(cands[0].f) : null; } catch { return null; }
}

// { label: '11/16 - 11/19', teams: [{ team, n, completed, issue, inProgress, terms: [...] }], n } or null without the workbook.
function readThisWeek(file = casesPath(), now = new Date()) {
  if (!fs.existsSync(file)) return null;
  const monday = mondayOf(now);
  const base = weekBaseline(file, monday);
  const wb = XLSX.read(fs.readFileSync(file));
  const teams = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const col = (r, re) => r.findIndex((c) => re.test(String(c).trim()));
    const h = rows.findIndex((r) => col(r, /^scenario$/i) >= 0 && col(r, /^status$/i) >= 0);
    if (h < 0) continue;
    const sc = col(rows[h], /^scenario$/i), st = col(rows[h], /^status$/i), wk = col(rows[h], /^target\s*week$/i), ar = col(rows[h], /^feature/i);
    const t = { team: String((rows[0] || [])[0] || '').replace(/\s*-\s*EBT test cases\s*$/i, '').trim() || name, n: 0, completed: 0, issue: 0, inProgress: 0, terms: [] };
    const hits = new Map();
    for (const r of rows.slice(h + 1)) {
      const scen = String(r[sc]).trim();
      const k = statusKey(r[st]);
      if (!scen || !ACTIVE.has(k)) continue;
      const d = cellDate(r[st], now.getFullYear()) || (wk >= 0 ? cellDate(r[wk], now.getFullYear()) : null);
      const prev = base && base[name] ? base[name].get(scen) : undefined;
      if (d ? d < monday : !(base && prev !== k)) continue;
      t.n++; t[k]++;
      const text = `${scen} ${ar >= 0 ? r[ar] : ''}`;
      for (const [re, label] of TERMS) if (re.test(text)) hits.set(label, (hits.get(label) || 0) + 1);
    }
    if (!t.n) continue;
    t.terms = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
    teams.push(t);
  }
  teams.sort((a, b) => b.n - a.n);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  return { label: `${md(monday)} - ${md(now)}`, teams, n: teams.reduce((s, t) => s + t.n, 0), baseline: !!base };
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
  // the calc chain goes (Excel rebuilds it), and with it the two references to it, or Excel refuses to open the file
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
    const wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship [^>]*calcChain[^>]*\/>/, ''));
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const backupDir = path.join(path.dirname(file), 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `Claims EBT Test cases - before defect sync ${new Date().toISOString().slice(0, 10)}.xlsx`), original);
  if (lockedBy(file)) return { ok: false, skipped: 'test case workbook was opened in Excel while saving — nothing written' };
  fs.writeFileSync(file, out);
  return { ok: true, file, rows: list.length, unmapped: list.filter((e) => departmentOf(e.reporter, teams) === 'Not mapped').map((e) => e.id) };
}

module.exports = { readProgress, readThisWeek, statusKey, casesPath, syncDefects, departmentOf };
