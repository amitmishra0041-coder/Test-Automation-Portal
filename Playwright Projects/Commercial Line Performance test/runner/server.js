// Local test-runner server for the Playwright suites in this repo, the
// sibling ClaimCenter-Automation repo, and the sibling cc-migration-
// reconciliation project. Serves runner/index.html and exposes:
//   GET  /api/config          - LOB / state / env / tier catalogs the UI renders from
//   GET  /api/stream          - SSE channel: live output + job/queue status
//   POST /api/run             - enqueue one or more jobs (policy / claims / reconciliation / updateValidation / pdfCompare / smartComm / jiraReport)
//   POST /api/stop            - kill the running job and clear the queue
//   POST /api/recon/upload    - save a bulk claims file (.csv/.xlsx) for a reconciliation job
//   POST /api/jiraReport/tracks       - add a custom Jira query as a new track
//   DELETE /api/jiraReport/tracks/:key - remove a custom Jira query track
//   GET  /reports/recon/*     - the reconciliation project's generated reports (static)
//   GET  /reports/pdf-compare/* - PDF Compare's generated Excel reports (static)
//   GET  /reports/jira/*      - the Jira Sprint Report's generated Excel workbook (static)
//
// Start with:  node runner/server.js   (from this project root, or anywhere)
'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { ENV_URLS } = require('../helpers/envConfig');

// This runner can be used by anyone, but its maintainer should always get a copy of every emailed report,
// regardless of whose address was typed into the UI's own "Report Email" field — added 2026-10-02 per user
// request. Every report sender here (nodemailer's `to`) already accepts a comma-separated address list, so
// this just appends the owner's address instead of needing a separate CC mechanism.
const ALWAYS_CC_EMAIL = 'amitmishra@donegalgroup.com';
function withAlwaysCc(email) {
  const typed = String(email || '').trim();
  if (!typed) return ALWAYS_CC_EMAIL;
  if (typed.toLowerCase() === ALWAYS_CC_EMAIL.toLowerCase()) return typed;
  return `${typed},${ALWAYS_CC_EMAIL}`;
}

const POLICY_DIR = path.join(__dirname, '..');
const CLAIMS_DIR = path.join(__dirname, '..', '..', 'ClaimCenter-Automation');
const RECON_DIR = path.join(__dirname, '..', '..', 'cc-migration-reconciliation');
const RECON_UPLOADS_DIR = path.join(RECON_DIR, 'data', 'uploads');
const RECON_REPORTS_DIR = path.join(RECON_DIR, 'reports');
const PDF_COMPARE_SCRIPT = path.join(POLICY_DIR, 'tools', 'pdf-compare', 'compare_insurance_pdfs.py');
const PDF_COMPARE_REPORTS_DIR = path.join(POLICY_DIR, 'reports', 'pdf-compare');
const JIRA_REPORT_SCRIPT = path.join(POLICY_DIR, 'scripts', 'jiraReport.js');
const JIRA_REPORTS_DIR = path.join(POLICY_DIR, 'reports', 'jira');
const CC_UI_REPORTS_DIR = path.join(CLAIMS_DIR, 'results', 'ccUi');
const S3_DOWNLOAD_SCRIPT = path.join(CLAIMS_DIR, 'scripts', 'downloadSmartCommFile.js');
const S3_DOWNLOADS_DIR = path.join(CLAIMS_DIR, 'results', 's3Downloads');
const S3_ESTABLISH_SESSION_SCRIPT = path.join(CLAIMS_DIR, 'scripts', 'establishS3Session.js');
// Mirrors scripts/jiraReport.js's ALL_TRACK_KEYS/TRACK_DEFS - kept as a
// separate literal (not required in) so this server has zero dependency on
// exceljs/axios just to render the tab's chip labels.
const JIRA_TRACKS = {
  Enhancement: { label: 'Enhancement' },
  ClaimCenter: { label: 'ClaimCenter' },
  SmartComm: { label: 'SmartComm' },
  NautilusOther: { label: 'Nautilus/Other Projects' },
};
// User-added queries (runner's "Add a new query" form) - same file
// scripts/jiraReport.js reads at fetch time, so a track added here is
// immediately usable in a run with no server restart needed.
const CUSTOM_TRACKS_FILE = path.join(POLICY_DIR, 'scripts', 'jiraTracks.custom.json');
const PORT = process.env.RUNNER_PORT || 3000;

function loadCustomTracks() {
  try {
    const list = JSON.parse(fs.readFileSync(CUSTOM_TRACKS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveCustomTracks(list) {
  fs.writeFileSync(CUSTOM_TRACKS_FILE, JSON.stringify(list, null, 2) + '\n');
}

// Every track key/chart-visible label the UI and jiraReport.js can currently
// select from - built-ins first, then whatever's in the custom file, read
// fresh each call so an add/remove shows up without a restart.
function getAllJiraTracks() {
  const tracks = {};
  Object.keys(JIRA_TRACKS).forEach((k) => { tracks[k] = { label: JIRA_TRACKS[k].label, custom: false }; });
  loadCustomTracks().forEach((c) => { tracks[c.key] = { label: c.label, custom: true, jql: c.jql, filterDoneRetired: Boolean(c.filterDoneRetired) }; });
  return tracks;
}

// Excel sheet names: <=31 chars, no \ / ? * [ ] : - and keeping the 3
// existing reserved sheet names free avoids a custom track silently
// colliding with the Data/Summary sheets jiraReport.js always writes.
const RESERVED_SHEET_NAMES = new Set(['Data', 'Summary - By Track-Sprint', 'Summary - By Assignee']);
function sanitizeSheetName(label) {
  return String(label).replace(/[\\/?*[\]:]/g, '-').trim().slice(0, 31) || 'Track';
}
function sanitizeTrackKey(label) {
  const key = String(label).replace(/[^A-Za-z0-9]/g, '');
  return key || 'Track' + Date.now();
}

fs.mkdirSync(RECON_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PDF_COMPARE_REPORTS_DIR, { recursive: true });
fs.mkdirSync(JIRA_REPORTS_DIR, { recursive: true });
fs.mkdirSync(CC_UI_REPORTS_DIR, { recursive: true });
fs.mkdirSync(S3_DOWNLOADS_DIR, { recursive: true });

// ── Catalogs (single source of truth - the UI just renders these) ──────────

// LOB -> spec file, mirrors runners/run-states.ps1's $testFile switch.
const POLICY_LOB = {
  BOP:     { label: 'BOP',          file: 'Create_BOP.test.js' },
  PACKAGE: { label: 'Package (CP)', file: 'Create_Package.test.js' },
  CA:      { label: 'CA',           file: 'Create_CA.test.js' },
};
const POLICY_STATES = ['DE', 'WI', 'PA', 'MI'];
// Shown in this order regardless of which are wired up yet; the UI greys out
// any key missing from helpers/envConfig.js's ENV_URLS so a click can never
// silently run against the wrong URL (getEnvUrls() falls back to qa).
const POLICY_ENV_ORDER = ['test', 'qa', 'dev', 'training', 'perf'];

// LOB -> ClaimCenter project name (playwright.config.js) + the env var
// getNextPolicy() reads for that LOB (see helpers/claimCenterBase.js and
// tests/lob/*.e2e.test.js, all currently hardcoded to the _PA policy var).
const CLAIMS_LOB = {
  BOP:     { label: 'BOP',          project: 'E2E - BOP',                policyVar: 'POLICY_BOP_PA' },
  PACKAGE: { label: 'Package (CP)', project: 'E2E - Commercial Package', policyVar: 'POLICY_CP_PA' },
  CA:      { label: 'CA',           project: 'E2E - Commercial Auto',    policyVar: 'POLICY_CAU_PA' },
};
const CLAIMS_PLATFORMS = ['onprem', 'cloud']; // CC_ENV
const CLAIMS_TIERS = ['test', 'dev'];         // CC_TIER

// Migration-reconciliation tier options — same CC_TIER axis as the claims
// suite, but a separate constant since the two projects' tier support can
// (and currently does — see cc-migration-reconciliation's own README) drift
// independently, e.g. one tier being temporarily down on one side.
const RECON_TIERS = ['test', 'dev'];

// SmartCOMM Template Validator — cloud only (see ClaimCenter-Automation's
// helpers/smartComm/); DEV/TEST/QA are cloud instance tiers, a different
// axis from claims' onprem/cloud split above. "qa" needs CC_BASE_URL_CLOUD_QA
// set in that repo's .env before it'll hit the right instance — same
// unenforced convention the claims suite's own tiers already rely on
// (claimCenterBase.js falls back silently if a tier's URL isn't set, it
// doesn't hard-fail), not a new gap introduced here.
const SMARTCOMM_TIERS = ['dev', 'test', 'qa'];
const SMARTCOMM_CATALOG_PATH = path.join(CLAIMS_DIR, 'helpers', 'smartComm', 'catalogService.js');

// The template list lives in Claims_Documents_Index.xlsx (BA/QA-maintained),
// read fresh on every /api/config call so an edit to that spreadsheet shows
// up without restarting this server — this repo never copies its rows in.
function getSmartCommTemplates() {
  try {
    const catalogService = require(SMARTCOMM_CATALOG_PATH);
    return catalogService.loadTemplateCatalog({ refresh: true })
      .map((t) => ({ digNumber: t.digNumber, documentName: t.documentName, states: t.states, lob: t.lob, interactiveOrOnDemand: t.interactiveOrOnDemand }));
  } catch (e) {
    console.error('SmartCOMM catalog unavailable:', e.message);
    return [];
  }
}

// Data Update & Dropdown Validation — a DIFFERENT test from reconciliation:
// it opens Edit on every section, compares dropdown option lists, and
// ALWAYS clicks Update to confirm old claim data still saves cleanly. It
// WRITES to whatever claims it's pointed at. Same tier axis as reconciliation.
const UPDATE_VALIDATION_TIERS = ['test', 'dev'];

const app = express();
app.use(express.json({ limit: '15mb' })); // bulk claims-file uploads travel as base64 JSON — see /api/recon/upload

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Generated reports (HTML/XLSX/JSON/CSV) served read-only so the UI can link straight to them after a run.
app.use('/reports/recon', express.static(RECON_REPORTS_DIR));
app.use('/reports/pdf-compare', express.static(PDF_COMPARE_REPORTS_DIR));
app.use('/reports/jira', express.static(JIRA_REPORTS_DIR));
app.use('/reports/cc-ui', express.static(CC_UI_REPORTS_DIR));
app.use('/reports/s3-download', express.static(S3_DOWNLOADS_DIR));

app.get('/api/config', (req, res) => {
  res.json({
    policy: {
      lobs: POLICY_LOB,
      states: POLICY_STATES,
      envs: POLICY_ENV_ORDER.map((key) => ({ key, configured: Boolean(ENV_URLS[key]) })),
    },
    claims: {
      lobs: CLAIMS_LOB,
      platforms: CLAIMS_PLATFORMS,
      tiers: CLAIMS_TIERS,
    },
    reconciliation: {
      tiers: RECON_TIERS,
    },
    updateValidation: {
      tiers: UPDATE_VALIDATION_TIERS,
    },
    smartComm: {
      templates: getSmartCommTemplates(),
      tiers: SMARTCOMM_TIERS,
    },
    pdfCompare: {
      scriptFound: fs.existsSync(PDF_COMPARE_SCRIPT),
    },
    jiraReport: {
      configured: Boolean(process.env.JIRA_SITE && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
      tracks: getAllJiraTracks(),
    },
  });
});

// ── Jira Sprint Report: manage custom queries ───────────────────────────────
// Lets the UI add a brand-new JQL-backed track without touching code - it
// gets appended to scripts/jiraTracks.custom.json (jiraReport.js reads that
// file at fetch time, so no restart needed) and immediately shows up as a
// new chip on the tab. Built-in tracks (Enhancement/ClaimCenter/SmartComm/
// NautilusOther) live only in code and can't be added/removed here.
app.post('/api/jiraReport/tracks', (req, res) => {
  const label = String((req.body || {}).label || '').trim();
  const jql = String((req.body || {}).jql || '').trim();
  const filterDoneRetired = Boolean((req.body || {}).filterDoneRetired);
  if (!label) return res.status(400).json({ error: 'Label is required' });
  if (!jql) return res.status(400).json({ error: 'JQL is required' });

  const allTracks = getAllJiraTracks();
  let key = sanitizeTrackKey(label);
  if (allTracks[key]) {
    return res.status(400).json({ error: `A track already uses the key "${key}" (derived from this label) - pick a different label` });
  }
  const sheetName = sanitizeSheetName(label);
  if (RESERVED_SHEET_NAMES.has(sheetName)) {
    return res.status(400).json({ error: `"${sheetName}" is a reserved sheet name (Data/Summary sheets) - pick a different label` });
  }

  const list = loadCustomTracks();
  list.push({ key, label, sheetName, jql, filterDoneRetired });
  saveCustomTracks(list);
  res.json({ ok: true, track: { key, label, custom: true } });
});

app.delete('/api/jiraReport/tracks/:key', (req, res) => {
  const list = loadCustomTracks();
  const next = list.filter((t) => t.key !== req.params.key);
  if (next.length === list.length) {
    return res.status(404).json({ error: `No custom track "${req.params.key}" found` });
  }
  saveCustomTracks(next);
  res.json({ ok: true });
});

// ── Migration reconciliation: bulk claims-file upload ───────────────────────
// Client reads the picked file as base64 (FileReader) and posts it as JSON —
// avoids pulling in a multipart-parsing dependency for what's a small
// claims list (a few hundred rows at most). Saved under a fixed uploads
// directory inside the reconciliation project so buildReconJob can verify
// any path it's asked to run against actually lives there (Section: don't
// let the UI hand an arbitrary filesystem path to a spawned process).
app.post('/api/recon/upload', (req, res) => {
  const { filename, contentBase64 } = req.body || {};
  if (!filename || !contentBase64) {
    return res.status(400).json({ error: 'filename and contentBase64 are required' });
  }
  const ext = path.extname(String(filename)).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') {
    return res.status(400).json({ error: 'Only .csv, .xlsx or .xls claims files are supported' });
  }
  const safeName = path.basename(String(filename)).replace(/[^A-Za-z0-9._-]/g, '_');
  const savedName = `${Date.now()}-${safeName}`;
  const savedPath = path.join(RECON_UPLOADS_DIR, savedName);
  try {
    fs.writeFileSync(savedPath, Buffer.from(contentBase64, 'base64'));
  } catch (e) {
    return res.status(500).json({ error: `Failed to save upload: ${e.message}` });
  }
  res.json({ ok: true, path: savedPath, filename: savedName });
});

// ── SSE broadcast ────────────────────────────────────────────────────────────

let sseClients = [];

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) sendEvent(res, event, data);
}

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sseClients.push(res);
  sendEvent(res, 'hello', {
    queue: queue.map((j) => j.label),
    running: running.map((r) => ({ id: r.id, label: r.job.label, progress: r.progress })),
    stats,
  });
  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// ── Job queue ────────────────────────────────────────────────────────────────
// Up to MAX_PARALLEL jobs run concurrently (across ALL suites - the queue is
// one shared FIFO, same as it always was); a newly-started job waits
// STAGGER_MS after the most recently started one before launching, so two
// browser sessions never hit login at the exact same instant. Both mirror
// runners/run-states.ps1's own -MaxParallel/-StaggerSeconds defaults.
const MAX_PARALLEL = 2;
const STAGGER_MS = 60000;

let queue = [];
let running = []; // { id, proc, job, startedAt, progress: { done, total } }
let nextJobId = 1;
let staggerTimer = null;
let stats = { passed: 0, failed: 0 };
// Per-job progress (unlike `stats` above, which is a cumulative session
// total never reset between jobs) now lives on each entry in `running`,
// since more than one job can be in flight at once. `total` starts null -
// meaning "unknown, show an indeterminate bar" - until either source below
// reports a real count:
//   - Playwright jobs (policy/claims): its own list-reporter prints
//     "Running N test(s) using M worker(s)" as the very first line; `done`
//     then increments off the same ok/x result lines TEST_LINE_RE already
//     parses for `stats`, just counted per-job instead of cumulatively.
//   - PDF Compare jobs: compare_insurance_pdfs.py prints "Found N folder(s)
//     with PDF pairs to compare" once up front (see that script's
//     scan_and_compare()); `done` then increments once per "📁 <folder>"
//     line, printed right before each folder/pair starts processing.
// Other suites (reconciliation, update-validation) have no equivalent
// upfront count in their own output, so `total` just stays null for them
// and the UI falls back to an indeterminate/animated bar.
const RUNNING_TESTS_RE = /^Running (\d+) tests? using \d+ worker/;
const PDF_TOTAL_RE = /^Found (\d+) folder/;

function buildPolicyJob(j) {
  const lob = POLICY_LOB[j.lob];
  if (!lob) throw new Error(`Unknown LOB "${j.lob}"`);
  if (!POLICY_STATES.includes(j.state)) throw new Error(`Unknown state "${j.state}"`);
  const envKey = String(j.env || '').toLowerCase();
  if (!ENV_URLS[envKey]) {
    throw new Error(
      `Env "${j.env}" isn't configured yet - add ENV_URLS.${envKey} in helpers/envConfig.js before running it.`
    );
  }
  return {
    label: `${lob.label} · ${j.state} · ${envKey.toUpperCase()}`,
    cwd: POLICY_DIR,
    cmd: 'npx',
    args: ['playwright', 'test', lob.file, '--project=chromium'],
    env: { TEST_ENV: envKey, TEST_STATE: j.state },
  };
}

function buildClaimsJob(j) {
  const lob = CLAIMS_LOB[j.lob];
  if (!lob) throw new Error(`Unknown LOB "${j.lob}"`);
  if (!CLAIMS_PLATFORMS.includes(j.platform)) throw new Error(`Unknown platform "${j.platform}"`);
  if (!CLAIMS_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const policyNumber = String(j.policyNumber || '').trim();
  if (!policyNumber) throw new Error('Policy number is required');

  // getNextPolicy() checks POLICY_<VAR>_<TIER> before the bare POLICY_<VAR>
  // (helpers/claimCenterBase.js) - set both so the typed-in number wins no
  // matter which tier is selected.
  const env = { CC_ENV: j.platform, CC_TIER: j.tier };
  env[lob.policyVar] = policyNumber;
  env[`${lob.policyVar}_TEST`] = policyNumber;
  env[`${lob.policyVar}_DEV`] = policyNumber;

  return {
    label: `${lob.label} · ${policyNumber} · ${j.platform}/${j.tier}`,
    cwd: CLAIMS_DIR,
    cmd: 'npx',
    args: ['playwright', 'test', '--project', lob.project, '--workers=1'],
    env,
  };
}

// SmartCOMM tool, "ClaimCenter screens" mode: launches ClaimCenter-Automation's scripts/validateCcUi.js
// (requirement workbook vs the live Create-New-Document screens) instead of the template-content Playwright
// project. Every value that reaches the shell command line is validated against a strict pattern first.
function buildCcUiJob(j) {
  const dig = String(j.templateId || 'DIG52').trim().toUpperCase();
  if (!/^DIG\d+[A-Z]*$/.test(dig)) throw new Error(`"${dig}" is not a valid template ID`);
  if (!SMARTCOMM_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const claimNumber = String(j.claimNumber || '').trim();
  if (claimNumber && !/^[A-Za-z0-9-]+$/.test(claimNumber)) throw new Error(`"${claimNumber}" doesn't look like a claim number`);
  const reportEmail = String(j.reportEmail || '').trim();
  if (reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) {
    throw new Error(`"${reportEmail}" doesn't look like a valid email address`);
  }
  const writes = Boolean(j.writes);
  if (writes && j.tier !== 'test') throw new Error('The write scenario (Business Rule 1 saves a document) is only allowed on the TEST tier');
  const br2States = String(j.br2States || '').replace(/\s+/g, '');
  if (br2States && !/^[A-Za-z]{2}(,[A-Za-z]{2})*$/.test(br2States)) throw new Error('Activity-scan states must be 2-letter codes separated by commas, e.g. MD,DE,VA');

  const reportName = `ccui_${j.tier}_${dig}_${Date.now()}`;
  const args = ['scripts/validateCcUi.js', '--template', dig, '--report-name', reportName, '--email'];
  if (claimNumber) args.push('--claim', claimNumber);
  if (writes) args.push('--writes');
  if (br2States) args.push('--br2-states', br2States);
  if (j.noBr2) args.push('--no-br2');
  const env = { CC_ENV: 'cloud', CC_TIER: j.tier };
  env.EMAIL_TO = withAlwaysCc(reportEmail);
  return {
    label: `SmartCOMM UI · ${dig} · cloud/${j.tier}` + (claimNumber ? ` · claim ${claimNumber}` : '') + (writes ? ' · +write scenario' : '') + (reportEmail ? ` · report to ${reportEmail}` : ''),
    cwd: CLAIMS_DIR,
    cmd: 'node',
    args,
    env,
    reportUrls: { kind: 'ccUi', html: `/reports/cc-ui/${reportName}.html`, json: `/reports/cc-ui/${reportName}.json` },
  };
}

// SmartCOMM tool, "Download from S3" mode: launches ClaimCenter-Automation's scripts/downloadSmartCommFile.js
// (Guidewire's S3 Integration Files admin UI — see helpers/s3Download/s3AdminService.js for the login/branch/
// matching behaviour this was built against). Always forces Planet = Test; no CC_ENV/CC_TIER involved — this
// admin tool's own "Planet" setting is a separate concept from the claims suite's onprem/cloud + tier axes.
function buildS3DownloadJob(j) {
  if (!fs.existsSync(S3_DOWNLOAD_SCRIPT)) throw new Error(`downloadSmartCommFile.js not found at ${S3_DOWNLOAD_SCRIPT}`);
  const key = String(j.key || '').trim();
  if (!key) throw new Error('A key (or part of one) is required');
  if (key.length < 4) throw new Error('Key must be at least 4 characters — a very short key could match many unrelated files');
  if (!/^[A-Za-z0-9_\-./]+$/.test(key)) throw new Error('Key may only contain letters, numbers, "-", "_", "." and "/"');
  const reportEmail = String(j.reportEmail || '').trim();
  if (reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) {
    throw new Error(`"${reportEmail}" doesn't look like a valid email address`);
  }
  const dirName = `${Date.now()}`;
  const outDir = path.join(S3_DOWNLOADS_DIR, dirName);
  const args = [S3_DOWNLOAD_SCRIPT, '--key', key, '--out-dir', outDir];
  args.push('--email', withAlwaysCc(reportEmail));
  return {
    label: `SmartCOMM S3 download · key "${key}"` + (reportEmail ? ` · email to ${reportEmail}` : ''),
    cwd: CLAIMS_DIR,
    cmd: 'node',
    args,
    env: {},
    reportUrls: { kind: 's3Download', manifest: `/reports/s3-download/${dirName}/manifest.json`, dir: `/reports/s3-download/${dirName}/` },
  };
}

// SmartCOMM tool, "Establish S3 Session" mode: launches ClaimCenter-Automation's
// scripts/establishS3Session.js in a VISIBLE (headed) browser window on this machine so a human can complete
// whatever Okta actually asks for once, then saves the resulting cookies (helpers/s3Download/oktaSessionStore.js)
// for every later "Download from S3" job to reuse — CONFIRMED live 2026-10-01 that a brand-new, cookie-less
// browser now gets an immediate Okta 400 "GENERAL_NONSUCCESS" rejection instead of the silent network-trust
// sign-in that used to work. Run this once up front, and again whenever a download job's error message says
// the saved session expired.
function buildS3SessionJob() {
  if (!fs.existsSync(S3_ESTABLISH_SESSION_SCRIPT)) throw new Error(`establishS3Session.js not found at ${S3_ESTABLISH_SESSION_SCRIPT}`);
  return {
    label: 'SmartCOMM S3 · establish session',
    cwd: CLAIMS_DIR,
    cmd: 'node',
    args: [S3_ESTABLISH_SESSION_SCRIPT],
    env: {},
  };
}

// SmartCOMM tool, "Template content" mode with 2+ templates selected: runs ClaimCenter-Automation's
// scripts/bulkValidateSmartComm.js (ONE shared browser across all templates, one consolidated Excel report —
// Summary tab, a "Common Issues" cross-template pattern-analysis tab, then one tab per scenario — emailed at
// the end) instead of queuing N separate single-template jobs that would each send their own report. Picking
// just one template keeps using the existing single-template path (buildSmartCommJob's default branch below)
// unchanged.
function buildSmartCommBulkJob(j) {
  const ids = Array.isArray(j.templateIds) ? j.templateIds.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean) : [];
  if (ids.length < 2) throw new Error('Bulk mode needs at least 2 templates — pick just one for a single-template run instead.');
  for (const dig of ids) {
    if (!/^DIG\d+[A-Z]*$/.test(dig)) throw new Error(`"${dig}" is not a valid template ID`);
  }
  if (!SMARTCOMM_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const reportEmail = String(j.reportEmail || '').trim();
  if (reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) {
    throw new Error(`"${reportEmail}" doesn't look like a valid email address`);
  }
  const outPath = path.join(CLAIMS_DIR, 'results', 'smartComm', 'bulk', `ui_bulk_${Date.now()}.json`);
  const env = { CC_ENV: 'cloud', CC_TIER: j.tier };
  env.EMAIL_TO = withAlwaysCc(reportEmail);
  const interactive = Boolean(j.interactive);
  if (interactive) env.SMARTCOMM_INTERACTIVE = '1';
  // validateTemplate() (called once per template by bulkValidateSmartComm.js) reads this env var directly —
  // same clamp as the single-template path, since it becomes a shell env var either way.
  const concurrency = Math.max(1, Math.min(5, parseInt(j.concurrency, 10) || 1));
  if (concurrency > 1) env.SMARTCOMM_CONCURRENCY = String(concurrency);
  // How many of a template's own matched scenarios to actually run — NOT the same as concurrency (how many
  // run AT ONCE). scenarioService.js reads this directly, defaulting to 3 when unset; 0 here means "leave it
  // unset, use that default" rather than trusting a falsy parseInt result as a real choice.
  const maxScenarios = j.maxScenarios ? Math.max(1, Math.min(3, parseInt(j.maxScenarios, 10) || 3)) : 0;
  if (maxScenarios > 0) env.SMARTCOMM_MAX_SCENARIOS_PER_TEMPLATE = String(maxScenarios);
  return {
    label: `SmartCOMM Bulk · ${ids.length} templates (${ids.join(', ')}) · cloud/${j.tier}` +
      (reportEmail ? ` · report to ${reportEmail}` : '') + (interactive ? ' · Interactive templates enabled' : '') +
      (concurrency > 1 ? ` · ${concurrency}x concurrent scenarios` : '') +
      (maxScenarios > 0 ? ` · ${maxScenarios} scenario(s)/template` : ''),
    cwd: CLAIMS_DIR,
    cmd: 'node',
    args: ['scripts/bulkValidateSmartComm.js', ids.join(','), outPath],
    env,
  };
}

function buildSmartCommJob(j) {
  if (j.mode === 'ui') return buildCcUiJob(j);
  if (j.mode === 's3') return buildS3DownloadJob(j);
  if (j.mode === 's3-session') return buildS3SessionJob();
  if (j.mode === 'bulk') return buildSmartCommBulkJob(j);
  const dig = String(j.templateId || '').trim();
  if (!dig) throw new Error('Template is required');
  if (!SMARTCOMM_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const claimNumber = String(j.claimNumber || '').trim();
  const reportEmail = String(j.reportEmail || '').trim();
  if (reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) {
    throw new Error(`"${reportEmail}" doesn't look like a valid email address`);
  }

  const env = { CC_ENV: 'cloud', CC_TIER: j.tier, SMARTCOMM_TEMPLATE_ID: dig };
  // Optional manual override — validationService uses this claim directly
  // for a single scenario instead of matching the Test Data claim
  // inventory by the template's own LOB/State applicability. Handy for
  // testing a template that doesn't have a matching test-data claim yet.
  if (claimNumber) env.SMARTCOMM_CLAIM_NUMBER = claimNumber;
  // Overrides reportService's own default recipient (EMAIL_TO) so each person running a validation can get
  // their own copy too — remembered client-side (localStorage) so this is a one-time setup per browser, not
  // a per-run chore. withAlwaysCc ALSO always includes the tool's owner regardless of whose address was
  // typed in (added 2026-10-02 per request), so every report still reaches them even when someone else runs it.
  env.EMAIL_TO = withAlwaysCc(reportEmail);
  // Templates the index marks "Interactive" are BLOCKED unless this is set — that flow opens a real,
  // visible browser window and needs a person to clear an Azure SSO/MFA prompt in it, so it can't be part
  // of an unattended run by default.
  const interactive = Boolean(j.interactive);
  if (interactive) env.SMARTCOMM_INTERACTIVE = '1';
  // Runs this template's own scenarios concurrently (separate browser contexts) instead of one at a time —
  // see validateTemplate()'s own comment in ClaimCenter-Automation/helpers/smartComm/validationService.js.
  // Clamped here too (not just trusted from the client) since this becomes a shell env var.
  const concurrency = Math.max(1, Math.min(5, parseInt(j.concurrency, 10) || 1));
  if (concurrency > 1) env.SMARTCOMM_CONCURRENCY = String(concurrency);
  // How many of this template's own matched scenarios to actually run — NOT the same as concurrency (how
  // many run AT ONCE). scenarioService.js reads this directly, defaulting to 3 when unset; 0 here means
  // "leave it unset, use that default" rather than trusting a falsy parseInt result as a real choice.
  const maxScenarios = j.maxScenarios ? Math.max(1, Math.min(3, parseInt(j.maxScenarios, 10) || 3)) : 0;
  if (maxScenarios > 0) env.SMARTCOMM_MAX_SCENARIOS_PER_TEMPLATE = String(maxScenarios);

  return {
    label: `SmartCOMM · ${dig} · cloud/${j.tier}` + (claimNumber ? ` · claim ${claimNumber}` : '') + (reportEmail ? ` · report to ${reportEmail}` : '') + (interactive ? ' · Interactive templates enabled' : '') + (concurrency > 1 ? ` · ${concurrency}x concurrent scenarios` : '') + (maxScenarios > 0 ? ` · ${maxScenarios} scenario(s)` : ''),
    cwd: CLAIMS_DIR,
    cmd: 'npx',
    args: ['playwright', 'test', '--project', 'SmartCOMM Validator', '--workers=1'],
    env,
  };
}

// Migration reconciliation (cc-migration-reconciliation's own CLI — see its
// README): single mode compares one on-prem claim against one cloud claim
// (same number on both sides if the user only typed one — a real migrated
// pair often isn't available yet, see that README's environment note, so an
// asymmetric pair is the common case, not the exception); bulk mode reads
// an uploaded claims file (already saved by /api/recon/upload).
function buildReconJob(j) {
  if (!RECON_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const reportBase = `reconciliation-${j.tier}`;
  const reportUrls = {
    html: `/reports/recon/${reportBase}.html`,
    xlsx: `/reports/recon/${reportBase}.xlsx`,
    json: `/reports/recon/${reportBase}.json`,
  };

  if (j.mode === 'bulk') {
    const filePath = String(j.filePath || '').trim();
    if (!filePath) throw new Error('Uploaded claims file is required for bulk mode');
    const resolved = path.resolve(filePath);
    // Only ever run against a file we ourselves saved via /api/recon/upload
    // — never let the UI hand an arbitrary filesystem path to a spawned process.
    if (path.relative(RECON_UPLOADS_DIR, resolved).startsWith('..')) {
      throw new Error('Claims file must come from an upload');
    }
    return {
      label: `Reconciliation · bulk (${path.basename(resolved)}) · ${j.tier.toUpperCase()}`,
      cwd: RECON_DIR,
      cmd: 'npm',
      args: ['run', 'reconcile', '--', '--claims', resolved, '--tier', j.tier],
      env: {},
      reportUrls,
    };
  }

  const onprem = String(j.onpremClaim || '').trim();
  const cloud = String(j.cloudClaim || '').trim() || onprem;
  if (!onprem) throw new Error('On-prem claim number is required');

  const args = onprem === cloud
    ? ['run', 'reconcile', '--', '--claim', onprem, '--tier', j.tier]
    : ['run', 'reconcile', '--', '--onprem-claim', onprem, '--cloud-claim', cloud, '--tier', j.tier];
  const label = onprem === cloud
    ? `Reconciliation · ${onprem} · ${j.tier.toUpperCase()}`
    : `Reconciliation · ${onprem} (on-prem) / ${cloud} (cloud) · ${j.tier.toUpperCase()}`;

  return { label, cwd: RECON_DIR, cmd: 'npm', args, env: {}, reportUrls };
}

// Data Update & Dropdown Validation — same on-prem/cloud claim # + bulk
// upload shape as buildReconJob (and reuses the SAME /api/recon/upload
// endpoint/uploads dir — the claims-file format is identical, read by the
// same ClaimListReader), but runs the DIFFERENT `validate-updates` CLI,
// which WRITES to whichever claims it's pointed at.
function buildUpdateValidationJob(j) {
  if (!UPDATE_VALIDATION_TIERS.includes(j.tier)) throw new Error(`Unknown tier "${j.tier}"`);
  const reportBase = `update-validation-${j.tier}`;
  const reportUrls = {
    html: `/reports/recon/${reportBase}.html`,
    json: `/reports/recon/${reportBase}.json`,
  };

  if (j.mode === 'bulk') {
    const filePath = String(j.filePath || '').trim();
    if (!filePath) throw new Error('Uploaded claims file is required for bulk mode');
    const resolved = path.resolve(filePath);
    if (path.relative(RECON_UPLOADS_DIR, resolved).startsWith('..')) {
      throw new Error('Claims file must come from an upload');
    }
    return {
      label: `Update Validation · bulk (${path.basename(resolved)}) · ${j.tier.toUpperCase()}`,
      cwd: RECON_DIR,
      cmd: 'npm',
      args: ['run', 'validate-updates', '--', '--claims', resolved, '--tier', j.tier],
      env: {},
      reportUrls,
    };
  }

  const onprem = String(j.onpremClaim || '').trim();
  const cloud = String(j.cloudClaim || '').trim() || onprem;
  if (!onprem) throw new Error('On-prem claim number is required');

  const args = onprem === cloud
    ? ['run', 'validate-updates', '--', '--claim', onprem, '--tier', j.tier]
    : ['run', 'validate-updates', '--', '--onprem-claim', onprem, '--cloud-claim', cloud, '--tier', j.tier];
  const label = onprem === cloud
    ? `Update Validation · ${onprem} · ${j.tier.toUpperCase()}`
    : `Update Validation · ${onprem} (on-prem) / ${cloud} (cloud) · ${j.tier.toUpperCase()}`;

  return { label, cwd: RECON_DIR, cmd: 'npm', args, env: {}, reportUrls };
}

// PDF Compare - wraps compare_insurance_pdfs.py (from the QA Automation Suite
// desktop tool - same script, just spawned here instead of from its Tkinter
// GUI). Scans --input-dir for sub-folders of PDF pairs (or the folder itself
// with --flat), diffs each pair section-by-section using bold-header
// detection, and writes one consolidated Excel workbook. Input dir is a
// server-side path (this runner and the browser share the same machine, same
// as every other suite here) - never given to the browser, only referenced.
function buildPdfCompareJob(j) {
  if (!fs.existsSync(PDF_COMPARE_SCRIPT)) {
    throw new Error(`compare_insurance_pdfs.py not found at ${PDF_COMPARE_SCRIPT}`);
  }
  const inputDir = String(j.inputDir || '').trim();
  if (!inputDir) throw new Error('Input folder is required');
  const resolvedInput = path.resolve(inputDir);
  if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isDirectory()) {
    throw new Error(`Input folder does not exist: ${resolvedInput}`);
  }

  let outName = String(j.outputName || '').trim() || 'results.xlsx';
  outName = path.basename(outName).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!outName.toLowerCase().endsWith('.xlsx')) outName += '.xlsx';
  const outPath = path.join(PDF_COMPARE_REPORTS_DIR, outName);

  const args = [PDF_COMPARE_SCRIPT, '--input-dir', resolvedInput, '--output', outPath];
  if (j.flat) args.push('--flat');
  // Independent of --flat: PDF pairs can live at any depth under the input
  // folder (e.g. root/state-folder/variant-folder/*.pdf) - neither --flat
  // (depth 0) nor the default (fixed depth 1) finds those, so this walks
  // every sub-folder recursively instead. See compare_insurance_pdfs.py's
  // find_pdf_pairs_recursive() for why this needed its own mode rather than
  // changing what --flat/default already do.
  if (j.recursive) args.push('--recursive');
  const limit = parseInt(j.limit, 10);
  if (Number.isFinite(limit) && limit > 0) args.push('--limit', String(limit));

  return {
    label: `PDF Compare · ${path.basename(resolvedInput)}${j.flat ? ' (flat)' : ''}${j.recursive ? ' (recursive)' : ''}`,
    cwd: POLICY_DIR,
    cmd: 'python',
    args,
    // The script prints emoji (e.g. folder icon) - Windows' default console
    // codepage (cp1252) can't encode those and the process crashes with
    // UnicodeEncodeError unless stdout/stderr are forced to UTF-8.
    env: { PYTHONIOENCODING: 'utf-8' },
    reportUrls: { xlsx: `/reports/pdf-compare/${outName}` },
  };
}

// Jira Sprint Report — pulls the selected areas (Enhancement/ClaimCenter/
// SmartComm/Nautilus-Other, default all four) straight from Jira's REST API
// and writes an Excel workbook (scripts/jiraReport.js), then emails it to the
// address typed in the UI (default: TO_EMAIL from .env). Replaces the earlier
// Power-Query workbook approach, which kept losing loaded tables to Excel
// COM/UI flakiness under automation; this path is deterministic and
// rerunnable. Each distinct track selection writes its own output file (see
// jiraReportFileName below) so running just one track doesn't clobber - or
// get confused with - a prior full run's report.
function jiraReportFileName(tracks, allKeys) {
  const allSelected = tracks.length === allKeys.length;
  return allSelected ? 'Sprint_Pending_Work_Report.xlsx' : `Sprint_Pending_Work_Report_${tracks.join('-')}.xlsx`;
}

// Same fallback SmartCOMM's reportService uses when no address is typed in the
// UI: the owner's own inbox (TO_EMAIL from .env, else this literal).
const JIRA_DEFAULT_REPORT_EMAIL = process.env.TO_EMAIL || 'amitmishra@donegalgroup.com';

function buildJiraReportJob(j) {
  if (!fs.existsSync(JIRA_REPORT_SCRIPT)) {
    throw new Error(`jiraReport.js not found at ${JIRA_REPORT_SCRIPT}`);
  }
  const typedEmail = String(j.reportEmail || '').trim();
  if (typedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)) {
    throw new Error(`"${typedEmail}" doesn't look like a valid email address`);
  }
  const reportEmail = typedEmail || JIRA_DEFAULT_REPORT_EMAIL;
  const allTracks = getAllJiraTracks();
  const allKeys = Object.keys(allTracks);
  const requested = Array.isArray(j.tracks) && j.tracks.length > 0 ? j.tracks : allKeys;
  const invalid = requested.filter((t) => !allTracks[t]);
  if (invalid.length) throw new Error(`Unknown track(s): ${invalid.join(', ')}`);
  // Keep a stable order regardless of how the UI sent them, so the same
  // selection always maps to the same output filename.
  const tracks = allKeys.filter((t) => requested.includes(t));

  const outName = jiraReportFileName(tracks, allKeys);
  const outPath = path.join(JIRA_REPORTS_DIR, outName);
  const trackLabel = tracks.length === allKeys.length ? 'all tracks' : tracks.join(', ');
  return {
    label: `Jira Sprint Report · ${trackLabel} · email to ${reportEmail}`,
    cwd: POLICY_DIR,
    cmd: 'node',
    args: [JIRA_REPORT_SCRIPT, outPath, tracks.join(',')],
    // jiraReport.js emails the finished workbook to this address (it only
    // sends when this is set, so direct CLI runs stay email-free).
    env: { JIRA_REPORT_EMAIL_TO: withAlwaysCc(reportEmail) },
    reportUrls: { kind: 'jiraReport', xlsx: `/reports/jira/${outName}` },
  };
}

app.post('/api/run', (req, res) => {
  const { suite, jobs } = req.body || {};
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: 'No jobs provided' });
  }
  let built;
  try {
    built = jobs.map((j) => (
      suite === 'claims' ? buildClaimsJob(j)
        : suite === 'reconciliation' ? buildReconJob(j)
        : suite === 'updateValidation' ? buildUpdateValidationJob(j)
        : suite === 'pdfCompare' ? buildPdfCompareJob(j)
        : suite === 'smartComm' ? buildSmartCommJob(j)
        : suite === 'jiraReport' ? buildJiraReportJob(j)
        : buildPolicyJob(j)
    ));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  queue.push(...built);
  broadcast('queued', { added: built.map((b) => b.label), queue: queue.map((j) => j.label) });
  processQueue();
  res.json({ ok: true, queued: built.length });
});

app.post('/api/stop', (req, res) => {
  const clearedQueue = queue.length;
  queue = [];
  if (staggerTimer) { clearTimeout(staggerTimer); staggerTimer = null; }
  const stoppedLabels = running.map((r) => r.job.label);
  running.forEach((r) => killTree(r.proc.pid));
  stoppedLabels.forEach((label) => broadcast('stopped', { label }));
  res.json({ ok: true, clearedQueue, stoppedLabels });
});

function killTree(pid) {
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${pid} /T /F`);
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (__) {} }
  }
}

// Matches Playwright's non-TTY list-reporter lines, e.g.:
//   ok 1 [chromium] › Create_BOP.test.js:18:1 › BOP Submission (5.3m)
//   x  1 [E2E - BOP] › tests\lob\BOP.e2e.test.js:52:3 › ... (8.4m)
const TEST_LINE_RE = /^\s*(ok|x)\s+\d+\s+(.+)$/;

// spawn(..., { shell: true }) does NOT escape array args on Windows - it just
// joins them with spaces (Node emits DEP0190 warning about this), so
// '--project', 'E2E - Commercial Package' would arrive as five separate
// words and silently break the Playwright project match. Quoting any arg
// that contains whitespace keeps it intact as one argument; harmless for the
// plain flags/filenames that don't need it.
function shellQuote(arg) {
  const s = String(arg);
  return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function scheduleProcessQueue(delayMs) {
  if (staggerTimer) return; // already have a pending retry - it'll re-check everything
  staggerTimer = setTimeout(() => { staggerTimer = null; processQueue(); }, delayMs);
}

function processQueue() {
  if (queue.length === 0) {
    if (running.length === 0) broadcast('queue-empty', { stats });
    return;
  }
  if (running.length >= MAX_PARALLEL) return; // retried by the job-end handler below when a slot frees up

  if (running.length > 0) {
    const elapsed = Date.now() - Math.max(...running.map((r) => r.startedAt));
    if (elapsed < STAGGER_MS) {
      scheduleProcessQueue(STAGGER_MS - elapsed);
      return;
    }
  }

  const job = queue.shift();
  const id = nextJobId++;
  const child = spawn(job.cmd, job.args.map(shellQuote), {
    cwd: job.cwd,
    shell: true, // resolves npx.cmd on Windows
    detached: process.platform !== 'win32',
    env: { ...process.env, ...job.env, FORCE_COLOR: '0' },
  });
  const entry = { id, proc: child, job, startedAt: Date.now(), progress: { done: 0, total: null } };
  running.push(entry);
  broadcast('job-start', { id, label: job.label, queue: queue.map((j) => j.label) });
  broadcast('progress', { id, label: job.label, ...entry.progress });

  const handleChunk = (stream) => (chunk) => {
    for (const rawLine of chunk.toString().split(/\r?\n/)) {
      if (rawLine === '') continue;
      broadcast('line', { id, label: job.label, stream, text: rawLine });

      const m = rawLine.match(TEST_LINE_RE);
      if (m && rawLine.includes('›')) {
        const status = m[1].toLowerCase() === 'ok' ? 'passed' : 'failed';
        stats[status] += 1;
        broadcast('test-result', { id, label: job.label, status, name: m[2], stats });
        entry.progress.done += 1;
        broadcast('progress', { id, label: job.label, ...entry.progress });
        continue;
      }

      const runningM = rawLine.match(RUNNING_TESTS_RE);
      if (runningM) {
        entry.progress.total = parseInt(runningM[1], 10);
        broadcast('progress', { id, label: job.label, ...entry.progress });
        continue;
      }

      const pdfTotalM = rawLine.match(PDF_TOTAL_RE);
      if (pdfTotalM) {
        entry.progress.total = parseInt(pdfTotalM[1], 10);
        broadcast('progress', { id, label: job.label, ...entry.progress });
        continue;
      }

      if (rawLine.trimStart().startsWith('📁')) {
        entry.progress.done += 1;
        broadcast('progress', { id, label: job.label, ...entry.progress });
      }
    }
  };
  child.stdout.on('data', handleChunk('stdout'));
  child.stderr.on('data', handleChunk('stderr'));

  child.on('close', (code) => {
    running = running.filter((r) => r.id !== id);
    broadcast('job-end', {
      id, label: job.label, code, stats, reportUrls: job.reportUrls || null,
      queue: queue.map((j) => j.label),
    });
    processQueue();
  });

  child.on('error', (err) => {
    broadcast('line', { id, label: job.label, stream: 'stderr', text: `Failed to start: ${err.message}` });
  });

  // Try to fill the next slot too - if MAX_PARALLEL allows it, this recurses
  // immediately and (since `running` now includes the job just started) hits
  // the stagger check above, scheduling itself for STAGGER_MS later instead
  // of launching back-to-back.
  processQueue();
}

app.listen(PORT, () => {
  console.log(`Test runner UI: http://localhost:${PORT}`);
  console.log(`  Policy suite dir: ${POLICY_DIR}`);
  console.log(`  Claims suite dir: ${CLAIMS_DIR}`);
  console.log(`  Reconciliation project dir: ${RECON_DIR}`);
});
