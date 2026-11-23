// scripts/ebt/weeklyStatus.js — the weekly ClaimCenter EBT status e-mail (HTML + two chart PNGs), built from the
// business test case workbook (scenario progress) and the EBT feedback tracker (issues, statuses refreshed from JIRA).
// weeklyStatusDraft.ps1 runs this every Sunday and saves the result as an Outlook draft for review — nothing is sent.
//
//   node scripts/ebt/weeklyStatus.js [--date YYYY-MM-DD]   -> prints the output folder (email.html, overall.png, areas.png, meta.json)
//
// The reported week is Monday-Sunday of the week before --date (default today), so a Sunday run reports that week.
// Each run saves a snapshot (completed scenarios) next to its output; the next run compares against it for
// "completed this week". Department of an issue = the Dashboard team whose member list names the reporter.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const tracker = require('./tracker');
const { casesPath, statusKey, departmentOf } = require('./testCases');
const { getStatuses } = require('./jiraDefect');

const OUT_ROOT = process.env.EBT_WEEKLY_DIR || path.join(os.homedir(), '.claimcenter-runner', 'ebt-weekly');
const C = { navy: '#1F2A44', blue: '#2E5597', teal: '#2A8C8C', amber: '#B9770E', green: '#2E7D32', red: '#C0392B', grey: '#D9D9D9', text: '#404040', light: '#8A8A8A' };
const AREA = { Documents: 'Documents / letters', 'Intake/FNOL': 'FNOL / Intake', 'Parties Involved/Contact Manager': 'Parties involved', 'Claim Handling': 'Claim handling' };
const AREA_COLORS = [C.blue, C.teal, C.amber, C.navy, '#7B5EA7', C.light, '#5D8AA8', '#A0522D'];
const RESOLVED = { Closed: 'closed', Rejected: 'working as designed', Deferred: 'deferred to a later release' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const serial = (d) => Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 864e5);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Monday of the reported week: the week that contains the day before runDate.
function reportWeek(runDate) {
  const y = addDays(runDate, -1);
  const mon = addDays(y, -((y.getUTCDay() + 6) % 7));
  return { mon, next: addDays(mon, 7) };
}

// Does a Target Week cell ("Week of 11/9", a date, or a date serial) fall in the week starting mon?
function inWeek(v, mon) {
  if (typeof v === 'number') return v >= serial(mon) && v < serial(mon) + 7;
  if (v instanceof Date) return inWeek(serial(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))), mon);
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})/);
  return !!m && Number(m[1]) === mon.getUTCMonth() + 1 && Number(m[2]) === mon.getUTCDate();
}
const weekBefore = (v, mon) => {
  if (typeof v === 'number') return v > 0 && v < serial(mon);
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return false;
  const d = Date.UTC(mon.getUTCFullYear(), Number(m[1]) - 1, Number(m[2]));
  return d < mon.getTime() && mon.getTime() - d < 200 * 864e5;
};

function readWorkbook(file) {
  const wb = XLSX.read(fs.readFileSync(file));
  const teams = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const col = (r, re) => r.findIndex((c) => re.test(String(c).trim()));
    const h = rows.findIndex((r) => col(r, /^scenario$/i) >= 0 && col(r, /^status$/i) >= 0);
    if (h < 0) continue;
    const ix = { sc: col(rows[h], /^scenario$/i), st: col(rows[h], /^status$/i), wk: col(rows[h], /^target week$/i) };
    const team = String((rows[0] || [])[0] || '').replace(/\s*-\s*EBT test cases\s*$/i, '').trim() || name;
    const scen = rows.slice(h + 1).filter((r) => String(r[ix.sc]).trim()).map((r) => ({ name: String(r[ix.sc]).replace(/\s+/g, ' ').trim(), status: statusKey(r[ix.st]), week: ix.wk >= 0 ? r[ix.wk] : '' }));
    teams.push({ team, scen });
  }
  const dash = wb.Sheets.Dashboard ? XLSX.utils.sheet_to_json(wb.Sheets.Dashboard, { header: 1, defval: '' }) : [];
  const h = dash.findIndex((r) => String(r[0]).trim() === 'Team' && /team members/i.test(String(r[9])));
  const members = [];
  for (const r of h >= 0 ? dash.slice(h + 1) : []) { if (!String(r[0]).trim() || /^all teams$/i.test(String(r[0]).trim())) break; members.push({ team: String(r[0]).trim(), members: String(r[9]) }); }
  return { teams, members };
}

function lastSnapshot(before) {
  if (!fs.existsSync(OUT_ROOT)) return null;
  const dirs = fs.readdirSync(OUT_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < before).sort();
  for (const d of dirs.reverse()) { const f = path.join(OUT_ROOT, d, 'meta.json'); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); }
  return null;
}

// ---- charts (SVG -> PNG through Playwright) ----
const FONT = 'font-family:Calibri,Segoe UI,Arial,sans-serif';
function donutSvg(parts, center, sub, title) {
  const cx = 115, cy = 130, r = 82, tot = parts.reduce((s, p) => s + p[1], 0) || 1;
  let a = -Math.PI / 2, segs = '';
  for (const [, v, col] of parts) {
    if (!v) continue; const b = a + (v / tot) * Math.PI * 2 - 0.0001;
    segs += `<path d="M${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} A${r},${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(b)},${cy + r * Math.sin(b)}" stroke="${col}" stroke-width="26" fill="none"/>`; a = b + 0.0001;
  }
  const leg = parts.map(([n, v, col], i) => `<rect x="235" y="${80 + i * 28}" width="14" height="14" rx="3" fill="${col}"/><text x="257" y="${92 + i * 28}" font-size="15" fill="${C.text}">${esc(n)} <tspan font-weight="700">${v}</tspan></text>`).join('');
  return `<svg id="overall" width="420" height="250" style="${FONT};background:#fff" xmlns="http://www.w3.org/2000/svg"><text x="16" y="26" font-size="17" font-weight="700" fill="${C.navy}">${esc(title)}</text>${segs}
    <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="30" font-weight="700" fill="${C.navy}">${esc(center)}</text><text x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="12" fill="${C.light}">${esc(sub)}</text>${leg}</svg>`;
}
function areaSvg(areas, title) {
  const x0 = 160, max = Math.max(1, ...areas.map((a) => a[1])), sc = 200 / max, H = Math.max(250, 50 + areas.length * 30);
  const b = areas.map(([n, v, col], i) => { const y = 46 + i * 30;
    return `<text x="${x0 - 10}" y="${y + 15}" text-anchor="end" font-size="14" fill="${C.text}">${esc(n)}</text><rect x="${x0}" y="${y}" width="${Math.max(2, v * sc)}" height="20" rx="3" fill="${col}"/><text x="${x0 + v * sc + 7}" y="${y + 15}" font-size="14" font-weight="700" fill="${C.navy}">${v}</text>`; }).join('');
  return `<svg id="areas" width="420" height="${H}" style="${FONT};background:#fff" xmlns="http://www.w3.org/2000/svg"><text x="16" y="26" font-size="17" font-weight="700" fill="${C.navy}">${esc(title)}</text>${b}</svg>`;
}
async function renderPngs(svgs, outDir) {
  const { chromium } = require('playwright');
  // channel 'chromium' = the full browser in headless mode; the packaged Runner ships without chrome-headless-shell.
  const br = await chromium.launch({ channel: 'chromium' });
  try {
    const pg = await br.newPage({ deviceScaleFactor: 2 });
    await pg.setContent(`<html><body style="margin:0;background:#fff">${svgs.join('')}</body></html>`);
    for (const id of ['overall', 'areas']) await (await pg.$('#' + id)).screenshot({ path: path.join(outDir, `${id}.png`) });
  } finally { await br.close(); }
}

async function build(runDate = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))) {
  const { mon, next } = reportWeek(runDate);
  const stamp = runDate.toISOString().slice(0, 10);
  const outDir = path.join(OUT_ROOT, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  // scenarios
  const wbFile = casesPath();
  const { teams, members } = readWorkbook(wbFile);
  const all = teams.flatMap((t) => t.scen.map((s) => ({ ...s, team: t.team })));
  const tot = { scen: all.length, done: all.filter((s) => s.status === 'completed').length, issue: all.filter((s) => s.status === 'issue').length };
  tot.notRun = tot.scen - tot.done - tot.issue;
  const loaded = teams.filter((t) => t.scen.length);
  // baseline = the last run on or before the reported week's Monday, so on-demand mid-week runs don't shift it
  const prev = lastSnapshot(addDays(mon, 1).toISOString().slice(0, 10));
  const doneKeys = all.filter((s) => s.status === 'completed').map((s) => `${s.team}|${s.name}`);
  const newDone = prev ? doneKeys.filter((k) => !prev.doneKeys.includes(k)) : doneKeys;

  // issues (tracker rows, statuses refreshed from JIRA when it answers)
  const entries = (await tracker.listEntries()).filter((e) => e.description);
  let live = {}; try { live = await getStatuses(entries.map((e) => e.jiraId)); } catch (e) { console.warn(`[weekly] JIRA status refresh skipped: ${e.message}`); }
  const issues = entries.map((e) => ({ ...e, status: live[e.jiraId] || e.status, dept: departmentOf(e.reporter, members),
    area: AREA[e.feature] || e.feature || 'Other', text: String(e.description).replace(/^(EBT\.GCCM\.FD\.\d+:\s*)+/, '').replace(/^EBT Testing\s*[:-]\s*/i, '').trim() }));
  const isOpen = (i) => !RESOLVED[i.status];
  const open = issues.filter(isOpen);
  const thisWeek = issues.filter((i) => i.reported >= mon.toISOString().slice(0, 10) && i.reported < next.toISOString().slice(0, 10));
  const retest = issues.filter((i) => i.status === 'Ready for Retest');
  const areaCount = {}; issues.forEach((i) => { areaCount[i.area] = (areaCount[i.area] || 0) + 1; });
  const areas = Object.entries(areaCount).sort((a, b) => b[1] - a[1]).map(([n, v], i) => [n, v, AREA_COLORS[i % AREA_COLORS.length]]);
  const openArea = {}; open.forEach((i) => { openArea[i.area] = (openArea[i.area] || 0) + 1; });
  const topOpenArea = Object.entries(openArea).sort((a, b) => b[1] - a[1])[0];


  // ---- text ----
  const resolvedParts = Object.entries(RESOLVED).map(([st, label]) => [issues.filter((i) => i.status === st).length, label]).filter(([n]) => n);
  const resolvedN = resolvedParts.reduce((s, [n]) => s + n, 0);
  const leading = loaded.map((t) => ({ t: t.team, d: t.scen.filter((s) => s.status === 'completed').length, n: t.scen.length })).filter((x) => x.d).sort((a, b) => b.d / b.n - a.d / a.n);
  const noResults = loaded.filter((t) => !t.scen.some((s) => s.status === 'completed' || s.status === 'issue')).map((t) => t.team);
  const notLoaded = teams.filter((t) => !t.scen.length).map((t) => t.team);
  const examples = [...new Set(newDone.map((k) => k.split('|')[1]))].slice(0, 8);
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

  const hl = [];
  // Net change vs the last snapshot: renamed/re-keyed rows (e.g. a rebuilt team tab) would otherwise count as new.
  const gained = prev ? tot.done - prev.done : 0;
  hl.push(prev && gained > 0
    ? `${gained} scenario${gained === 1 ? '' : 's'} completed this week. ${tot.done} of ${tot.scen} are now complete (${pct(tot.done, tot.scen)}%), up from ${prev.done}.`
    : `${tot.done} of ${tot.scen} scenarios completed so far (${pct(tot.done, tot.scen)}%). ${loaded.length} teams have loaded scenarios and ${loaded.length - noResults.length} have reported results.`);
  if (leading.length) hl.push(`${list(leading.slice(0, 3).map((x) => `${esc(x.t)} (${x.d} of ${x.n}, ${pct(x.d, x.n)}%)`))}.`);
  if (examples.length) hl.push(`Completed successfully${prev ? ' this week' : ''}: ${esc(list(examples.map((e) => e.replace(/\.$/, ''))))}.`);
  hl.push(`${thisWeek.length} issue${thisWeek.length === 1 ? '' : 's'} logged this week (${issues.length} in total, ${open.length} still open).`
    + (resolvedN ? ` ${resolvedN} resolved so far (${list(resolvedParts.map(([n, l]) => `${n} ${l}`))}).` : '')
    + (retest.length ? ` ${retest.length} fix${retest.length === 1 ? ' is' : 'es are'} ready for the business to retest.` : '')
    + (topOpenArea ? ` Most open issues are about ${esc(topOpenArea[0].toLowerCase())}.` : ''));

  const byDept = {}; issues.forEach((i) => { (byDept[i.dept] = byDept[i.dept] || []).push(i); });
  const td = 'border:1px solid #BFBFBF;padding:2px 7px';
  const tdn = td + ';white-space:nowrap';
  const deptRows = Object.entries(byDept).sort((a, b) => b[1].filter(isOpen).length - a[1].filter(isOpen).length || b[1].length - a[1].length).map(([d, l]) => {
    const o = l.filter(isOpen);
    const themes = (o.length ? o : l).map((x) => x.text + (x.status === 'Ready for Retest' ? ' (fix ready for retest)' : '')).join('; ');
    return `<tr><td style="${tdn}">${esc(d)}</td><td style="${td}" align="center">${l.length}</td><td style="${td}" align="center">${o.length}</td><td style="${td}">${esc(o.length ? themes : `All resolved: ${themes}`)}</td></tr>`;
  }).join('');

  // team progress table, same columns as the e-mail sent on 11/16
  const cnt = (l, k) => l.filter((s) => s.status === k).length;
  const progRow = (name, l, bold) => {
    const n = l.length, d = cnt(l, 'completed'), ns = cnt(l, 'notStarted');
    const c = (v) => `<td style="${td}${bold ? ';font-weight:bold' : ''}" align="center">${v}</td>`;
    return `<tr><td style="${td}${bold ? ';font-weight:bold' : ''}">${esc(name)}</td>${c(n)}${c(d)}${c(cnt(l, 'inProgress'))}${c(cnt(l, 'blocked'))}${c(ns)}${c(n ? pct(n - ns, n) + '%' : '')}${c(n ? pct(d, n) + '%' : '')}</tr>`;
  };
  const th = (t, left, w) => `<th style="background:#2E5597;color:#fff;padding:4px 7px;font-weight:normal;white-space:nowrap"${w ? ` width="${w}"` : ''} align="${left ? 'left' : 'center'}">${t}</th>`;
  const progTable = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#404040">
<tr>${th('Team', 1)}${['Scenarios', 'Completed', 'In progress', 'Blocked', 'Not started', '% executed', '% completed'].map((x) => th(x)).join('')}</tr>
${teams.map((t) => progRow(t.team, t.scen)).join('\n')}
${progRow('All teams', all, true)}
</table>`;

  const f = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#404040';
  const h = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#404040;margin:14px 0 6px 0';
  const img = (id) => `<img src="cid:${id}.png" width="420" style="display:block;border:0" alt="${id}">`;
  const weekLabel = `week of ${md(mon)}`;
  const html = `<html><body style="${f}">
<p style="${f}">Good morning All,</p>
<p style="${f}">Please see below the ClaimCenter EBT status for the ${weekLabel}.</p>
<p style="${f}">The status is based on the test scenarios shared by each group last week.</p>
<p style="${f}">Kindly review and update the sheet above with the latest progress and status for your respective group by the end of this week.</p>
<p style="${h}">Highlights:</p>
<ul style="${f};margin-top:0">${hl.map((x) => `<li>${x}</li>`).join('\n')}</ul>
<p style="${h}">Progress and issues</p>
${progTable}
<br><table cellpadding="0" cellspacing="0"><tr><td valign="top">${img('overall')}</td><td width="20"></td><td valign="top">${img('areas')}</td></tr></table>
${noResults.length || notLoaded.length ? `<p style="${f}">${noResults.length ? `${esc(list(noResults))} ${noResults.length === 1 ? 'has' : 'have'} scenarios loaded but no results recorded yet. ` : ''}${notLoaded.length ? `${esc(list(notLoaded))} ${notLoaded.length === 1 ? 'has' : 'have'} not loaded scenarios yet.` : ''}</p>` : ''}
<p style="${h}">Issues identified</p>
<table cellpadding="0" cellspacing="0" width="860" style="border-collapse:collapse;${f}">
<tr>${th('Team', 1, 200)}${th('Logged')}${th('Still open')}${th('Open issues', 1)}</tr>
${deptRows}
<tr><td style="${td};font-weight:bold">Total</td><td style="${td};font-weight:bold" align="center">${issues.length}</td><td style="${td};font-weight:bold" align="center">${open.length}</td><td style="${td}"></td></tr>
</table>
<p style="${f}">As always, please send any new findings through the usual EBT feedback process.</p>
</body></html>`;

  await renderPngs([
    donutSvg([['Completed', tot.done, C.green], ['Issue found', tot.issue, C.red], ['Not run yet', tot.notRun, C.grey]], `${pct(tot.done, tot.scen)}%`, `of ${tot.scen} completed`, 'Overall scenario progress'),
    areaSvg(areas, `Issues by area (${issues.length} logged)`),
  ], outDir);
  fs.writeFileSync(path.join(outDir, 'email.html'), html);
  fs.writeFileSync(path.join(outDir, 'preview.html'), html.replace(/cid:(\w+)\.png/g, '$1.png'));
  const meta = { subject: `ClaimCenter EBT - Weekly Status (${weekLabel})`, runDate: stamp, done: tot.done, scen: tot.scen, issues: issues.length, open: open.length, workbook: wbFile, doneKeys };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
  return { outDir, ...meta };
}

if (require.main === module) {
  const i = process.argv.indexOf('--date');
  const d = i > 0 ? new Date(`${process.argv[i + 1]}T00:00:00Z`) : undefined;
  build(d).then((r) => console.log(r.outDir)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { build, reportWeek };
