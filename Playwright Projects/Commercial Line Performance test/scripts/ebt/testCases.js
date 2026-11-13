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

module.exports = { readProgress, statusKey, casesPath };
