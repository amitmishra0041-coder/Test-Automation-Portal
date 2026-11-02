// runner/agent/tools.js — the Assistant's internal tools: thin wrappers over what the Runner already does.
// Every tool declares a risk level, which the orchestrator enforces:
//   read   — looks things up; runs automatically
//   report — writes a local file (spreadsheet / deck); runs automatically
//   send   — reaches people or external systems (email); ALWAYS waits for the user's approval
//   run / admin — start jobs on a tool tab / change the Admin config (actions.js); ALWAYS wait for approval
// Tool output is data, never instructions: nothing a tool returns is executed or re-planned from.
// Data policy (2026-11-01): no Donegal data leaves this PC — no tool calls a cloud AI service.
'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');

const REPORT_DIR = path.join(__dirname, '..', '..', 'reports', 'assistant');
const SEVERITY_FIELD = 'customfield_10137';
const DEFECTS_JQL = 'project IN (GCCM, GCMDT, GCMDW, GCMR, SMART) AND type IN (Bug, Defect) AND status NOT IN (Closed, Rejected)';
const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

function jira() {
  const { JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error('Jira login not configured (Settings tab: Jira email + API token).');
  const site = String(JIRA_SITE || 'donegalgroup.atlassian.net').replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
  return { site, auth: { username: JIRA_EMAIL, password: JIRA_API_TOKEN } };
}

async function searchJql(jql, fields, { signal } = {}) {
  const cfg = jira();
  const out = [];
  let nextPageToken;
  for (let page = 0; page < 20; page++) {
    const resp = await axios.post(`https://${cfg.site}/rest/api/3/search/jql`, { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) },
      { auth: cfg.auth, headers: { Accept: 'application/json' }, timeout: 60000, signal });
    out.push(...(resp.data.issues || []));
    if (!resp.data.nextPageToken) break;
    nextPageToken = resp.data.nextPageToken;
  }
  return out;
}

const sevName = (v) => (v ? v.value || v.name || String(v) : '');
const browse = (key) => `https://${jira().site}/browse/${key}`;

// ── tools ───────────────────────────────────────────────────────────────────────────────────────────────
const TOOLS = {
  'jira.impededStories': {
    title: 'Find impeded test-execution stories and their linked bugs',
    risk: 'read',
    params: { project: 'Jira project key (e.g. SMART, GCCM)', jql: 'optional full JQL instead of the default query' },
    async run({ project = 'SMART', jql } = {}, ctx) {
      if (!jql && !PROJECT_KEY.test(project)) throw new Error(`"${project}" isn't a Jira project key.`);
      const q = jql || `project = ${project} AND status = Impeded AND (summary ~ "Test_Execution" OR summary ~ "Test Execution") ORDER BY assignee ASC, created DESC`;
      const stories = await searchJql(q, ['summary', 'status', 'assignee', 'issuelinks'], ctx);
      const bugKeys = new Set();
      for (const s of stories) for (const l of s.fields.issuelinks || []) {
        const o = l.inwardIssue || l.outwardIssue;
        if (o && /bug|defect/i.test(((o.fields || {}).issuetype || {}).name || '')) bugKeys.add(o.key);
      }
      const bugs = {};
      const keys = [...bugKeys];
      for (let n = 0; n < keys.length; n += 80) {
        for (const b of await searchJql(`key in (${keys.slice(n, n + 80).join(',')})`, ['summary', 'status', 'priority', 'duedate', 'assignee', SEVERITY_FIELD], ctx)) bugs[b.key] = b;
      }
      const rows = [];
      for (const s of stories) {
        const seen = new Set();
        const base = { story: s.key, storySummary: s.fields.summary, storyAssignee: (s.fields.assignee || {}).displayName || '' };
        for (const l of s.fields.issuelinks || []) {
          const o = l.inwardIssue || l.outwardIssue;
          if (!o || !bugs[o.key] || seen.has(o.key)) continue;
          seen.add(o.key);
          const f = bugs[o.key].fields;
          rows.push({ ...base, link: l.inwardIssue ? l.type.inward : l.type.outward, bug: o.key, bugSummary: f.summary, bugStatus: f.status.name,
            severity: sevName(f[SEVERITY_FIELD]), priority: (f.priority || {}).name || '', due: f.duedate || '', bugAssignee: (f.assignee || {}).displayName || '' });
        }
        if (!seen.size) rows.push({ ...base, bug: '' });
      }
      return { query: q, stories: stories.length, bugLinks: rows.filter((r) => r.bug).length, rows };
    },
  },

  'jira.openDefects': {
    title: 'Count open defects by status and severity',
    risk: 'read',
    params: {},
    async run(_args, ctx) {
      const bugs = await searchJql(DEFECTS_JQL, ['status', 'priority', SEVERITY_FIELD], ctx);
      const table = {};
      for (const b of bugs) {
        const st = b.fields.status.name; const sv = sevName(b.fields[SEVERITY_FIELD]) || (b.fields.priority || {}).name || 'None';
        table[st] = table[st] || {}; table[st][sv] = (table[st][sv] || 0) + 1;
      }
      return { total: bugs.length, byStatus: table };
    },
  },

  'analysis.blockerInsights': {
    title: 'Analyse the stories: overdue bugs, stories ready to unblock, stories with no bug',
    risk: 'read',
    params: { from: 'step whose rows to analyse' },
    async run(_args, ctx) {
      const src = ctx.resultOf('jira.impededStories');
      if (!src) throw new Error('Needs the impeded-stories step first.');
      const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD (UTC rolls over early in the US evening)
      const closed = (s) => /^(closed|rejected|fixed|done|resolved)$/i.test(s || '');
      const byStory = new Map();
      for (const r of src.rows) { if (!byStory.has(r.story)) byStory.set(r.story, []); if (r.bug) byStory.get(r.story).push(r); }
      const readyToUnblock = [...byStory].filter(([, b]) => b.length && b.every((r) => closed(r.bugStatus))).map(([k]) => k);
      const noBug = [...byStory].filter(([, b]) => !b.length).map(([k]) => k);
      const uniq = (list) => [...new Map(list.map((r) => [r.bug, r])).values()];
      const open = uniq(src.rows.filter((r) => r.bug && !closed(r.bugStatus)));
      return {
        readyToUnblock, noBug,
        overdue: open.filter((r) => r.due && r.due < today).map((r) => ({ bug: r.bug, status: r.bugStatus, due: r.due, severity: r.severity })),
        dueToday: open.filter((r) => r.due === today).map((r) => r.bug),
        openNoDueDate: open.filter((r) => !r.due).map((r) => ({ bug: r.bug, severity: r.severity })),
      };
    },
  },

  'report.impededSpreadsheet': {
    title: 'Write the stories and bugs to an Excel spreadsheet',
    risk: 'report',
    params: {},
    async run(_args, ctx) {
      const src = ctx.resultOf('jira.impededStories');
      if (!src) throw new Error('Needs the impeded-stories step first.');
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Impeded stories');
      const cols = [['Story', 'story', 14], ['Story Summary', 'storySummary', 60], ['Story Assignee', 'storyAssignee', 20], ['Link Type', 'link', 14], ['Bug', 'bug', 14],
        ['Bug Summary', 'bugSummary', 60], ['Bug Status', 'bugStatus', 16], ['Severity', 'severity', 11], ['Priority', 'priority', 11], ['Bug Due Date', 'due', 13], ['Bug Assignee', 'bugAssignee', 20]];
      ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
      for (const r of src.rows) {
        const row = ws.addRow({ ...r, bug: r.bug || '(no linked bug)', due: r.bug ? r.due || '(none)' : '' });
        for (const k of ['story', 'bug']) if (r[k]) row.getCell(k).value = { text: r[k], hyperlink: browse(r[k]) };
      }
      ws.getRow(1).font = { bold: true }; ws.autoFilter = { from: 'A1', to: 'K1' }; ws.views = [{ state: 'frozen', ySplit: 1 }];
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const file = path.join(REPORT_DIR, `Impeded_Stories_${new Date().toLocaleDateString('en-CA')}_${ctx.taskId.slice(-6)}.xlsx`);
      await wb.xlsx.writeFile(file);
      return { file: path.basename(file), rows: src.rows.length };
    },
  },

  'report.statusDeck': {
    title: 'Generate the QA status deck (PowerPoint)',
    risk: 'report',
    params: {},
    async run(_args, ctx) {
      const { generateStatusDeck } = require('../../scripts/jiraStatusDeck');
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const file = path.join(REPORT_DIR, `QA_Status_${new Date().toLocaleDateString('en-CA')}_${ctx.taskId.slice(-6)}.pptx`);
      await generateStatusDeck(file);
      return { file: path.basename(file) };
    },
  },

  'email.statusDeck': {
    title: 'Email the QA status deck',
    risk: 'send',
    params: { to: 'recipient email address(es), comma separated' },
    async run({ to } = {}, ctx) {
      const list = String(to || '').split(/[,;\s]+/).filter(Boolean);
      if (!list.length || !list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new Error('Needs valid recipient email address(es).');
      const { generateStatusDeck } = require('../../scripts/jiraStatusDeck');
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const file = path.join(REPORT_DIR, `QA_Status_${new Date().toLocaleDateString('en-CA')}_${ctx.taskId.slice(-6)}.pptx`);
      await generateStatusDeck(file, { emailTo: list.join(',') });
      return { file: path.basename(file), sentTo: list };
    },
  },

  'runner.queueStatus': {
    title: "Show what's queued and running on this Runner",
    risk: 'read',
    params: {},
    async run(_args, ctx) { return ctx.host.queueStatus(); },
  },

  'runner.usageStats': {
    title: 'Summarise Runner usage by tool',
    risk: 'read',
    params: { days: 'look-back window in days (default 7)' },
    async run({ days = 7 } = {}, ctx) {
      const since = Date.now() - Math.min(365, Math.max(1, Number(days) || 7)) * 864e5;
      const recs = ctx.host.readUsage().filter((r) => new Date(r.at || r.ts || r.time || 0).getTime() >= since);
      const byTool = {};
      for (const r of recs) byTool[r.tool || 'unknown'] = (byTool[r.tool || 'unknown'] || 0) + (r.jobs || 1);
      return { days: Number(days) || 7, submissions: recs.length, jobsByTool: byTool };
    },
  },
};

// Tools that act on the Runner (start runs, Admin changes) — see actions.js.
Object.assign(TOOLS, require('./actions').ACTION_TOOLS);

module.exports = { TOOLS, REPORT_DIR };
