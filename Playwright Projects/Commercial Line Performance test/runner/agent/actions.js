// runner/agent/actions.js — Assistant tools that DO things: start runs on the tool tabs, change the Admin config.
// They never reimplement a tab: each one calls the Runner's own endpoint (/api/run, /api/admin) on this PC, so
// the same validation, tool-access checks, queue and usage log apply as when the button is clicked.
// Risk levels (enforced by the orchestrator):
//   run   — queues a job on a tool tab; waits for the user's Approve
//   admin — changes the shared Admin config; admin users only, waits for Approve, previous config kept for Undo
// Every tool here has preview(): it runs BEFORE the approval prompt, checks the request (and admin rights) and
// returns the exact lines shown in the approval bar. A request that would be refused fails there, unasked.
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SUITE_LABELS = {
  policy: 'Policy Tests', claims: 'Claims (ClaimCenter)', smartComm: 'SmartCOMM Validator', jiraReport: 'Jira Sprint Report',
  reconciliation: 'Migration Reconciliation', updateValidation: 'Data Update & Dropdown Validation', pdfCompare: 'PDF Compare', oneInc: 'OneInc Payments',
};
const SUITES = Object.keys(SUITE_LABELS);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNDO_KEEP = 20;

// The Runner's own HTTP API on this PC (the host passes baseUrl; tests pass a fake api()).
function runnerApi(ctx) {
  if (ctx.host.api) return ctx.host.api;
  if (!ctx.host.baseUrl) throw new Error('Runner API not available.');
  return async (method, url, body) => {
    try {
      const headers = ctx.host.authHeaders ? ctx.host.authHeaders(ctx.user) : {};
      const r = await axios({ method, url: ctx.host.baseUrl + url, data: body, headers, timeout: 30000, signal: ctx.signal });
      return r.data;
    } catch (e) {
      throw new Error((e.response && e.response.data && e.response.data.error) || e.message);
    }
  };
}

// ── run tools ───────────────────────────────────────────────────────────────────────────────────────────
function runTool(suite, title, params, toJobs) {
  return {
    title, risk: 'run', params, suite,
    async preview(args) {
      const jobs = toJobs(args);
      return { lines: jobs.map((j) => j._label), note: `Queues ${jobs.length} job(s) on the ${SUITE_LABELS[suite]} tab as you.` };
    },
    async run(args, ctx) {
      const jobs = toJobs(args);
      const out = await runnerApi(ctx)('POST', '/api/run', { suite, requestedBy: ctx.user, jobs: jobs.map(({ _label, ...j }) => j) });
      return { suite, tab: suite, tabLabel: SUITE_LABELS[suite], queued: out.queued, jobs: jobs.map((j) => j._label) };
    },
  };
}

const POLICY_LOB_LABEL = { BOP: 'BOP', PACKAGE: 'Package (CP)', CA: 'CA' };
const RUN_TOOLS = {
  'run.policy': runTool('policy', 'Start Policy Tests runs', { lobs: 'BOP / PACKAGE / CA', states: 'DE WI PA MI', env: 'test qa dev training perf' }, (a) => {
    const lobs = a.lobs || [], states = a.states || [];
    if (!lobs.length) throw new Error('Which line of business? Say BOP, Package or CA.');
    if (!states.length) throw new Error('Which state(s)? DE, WI, PA or MI.');
    if (!a.env) throw new Error('Which environment? Say e.g. "on QA" or "on Training".');
    return lobs.flatMap((lob) => states.map((state) => ({ project: 'REGRESSION', lob, state, env: a.env, _label: `${POLICY_LOB_LABEL[lob]} · ${state} · ${a.env.toUpperCase()}` })));
  }),
  'run.claims': runTool('claims', 'Start a ClaimCenter end-to-end run', { lobs: 'BOP / PACKAGE / CA', policyNumber: 'policy number', platform: 'onprem / cloud', tier: 'test / dev' }, (a) => {
    const lob = (a.lobs || [])[0];
    if (!lob) throw new Error('Which line of business? Say BOP, Package or CA.');
    if (!a.policyNumber) throw new Error('Which policy? Say e.g. "policy 1234567".');
    const platform = a.platform || 'cloud', tier = a.tier || 'test';
    return [{ lob, policyNumber: a.policyNumber, platform, tier, _label: `${POLICY_LOB_LABEL[lob]} · policy ${a.policyNumber} · ${platform}/${tier}` }];
  }),
  'run.smartComm': runTool('smartComm', 'Validate SmartCOMM template(s)', { templates: 'DIG ids', tier: 'dev / test / qa', claimNumber: 'optional claim' }, (a) => {
    const templates = a.templates || [];
    if (!templates.length) throw new Error('Which template? Say e.g. "DIG32".');
    const tier = a.tier || 'test';
    return templates.map((t) => ({ templateId: t, tier, claimNumber: a.claimNumber || '', reportEmail: a.reportEmail || '', _label: `SmartCOMM · ${t} · cloud/${tier}${a.claimNumber ? ` · claim ${a.claimNumber}` : ''}` }));
  }),
  // Payments are never submitted from here (no Finish, no new claims): those stay on the OneInc tab's own switches.
  'run.oneInc': runTool('oneInc', 'Run OneInc scenarios (no payment submit)', { stories: 'GCCM-### list, or all', tier: 'test / dev' }, (a) => {
    const tier = a.tier || 'test';
    if (a.all) return [{ mode: 'all', tier, _label: `OneInc · all automated scenarios · cloud/${tier} · Finish off` }];
    if (!(a.stories || []).length) throw new Error('Which story? Say e.g. "OneInc GCCM-1234", or "all OneInc scenarios".');
    return [{ mode: 'story', stories: a.stories, tier, _label: `OneInc · ${a.stories.join(', ')} · cloud/${tier} · Finish off` }];
  }),
};

// ── admin tools ─────────────────────────────────────────────────────────────────────────────────────────
async function adminConfig(ctx) {
  // The Runner's own admin check (same as the Admin tab). Non-admins are stopped here — before any approval prompt.
  let r;
  try { r = await runnerApi(ctx)('GET', `/api/admin?email=${encodeURIComponent(ctx.user)}`); } catch (e) {
    if (/admin access only/i.test(e.message)) throw new Error(`Admin commands are for admins only — ${ctx.user} isn't an admin. Ask an admin to make this change.`);
    throw e;
  }
  return r.config;
}
const grantsOf = (cfg, email) => (cfg.entitlements.grants && cfg.entitlements.grants[email]) || cfg.entitlements.default || ['smartComm'];
const names = (list) => list.map((k) => SUITE_LABELS[k] || k).join(', ') || '(none)';

function undoFile(ctx) { return path.join(ctx.dataDir, 'admin-undo.json'); }
function readUndo(ctx) { try { return JSON.parse(fs.readFileSync(undoFile(ctx), 'utf8')); } catch (_) { return []; } }
function writeUndo(ctx, list) { fs.mkdirSync(ctx.dataDir, { recursive: true }); fs.writeFileSync(undoFile(ctx), JSON.stringify(list.slice(-UNDO_KEEP * 5), null, 2)); }

// An admin change = (current config) → (next config) + a human description. Saved through /api/admin, with the
// previous config pushed on this user's undo list first.
function adminTool(title, params, change) {
  return {
    title, risk: 'admin', params,
    async preview(args, ctx) {
      const cfg = await adminConfig(ctx);
      const { lines } = change(JSON.parse(JSON.stringify(cfg)), args, ctx);
      return { lines, note: 'Changes the shared Admin config. You can undo it afterwards ("undo my last admin change").' };
    },
    async run(args, ctx) {
      const before = await adminConfig(ctx);
      const { next, lines } = change(JSON.parse(JSON.stringify(before)), args, ctx);
      const undo = readUndo(ctx);
      undo.push({ at: new Date().toISOString(), user: ctx.user, task: ctx.taskId, what: lines, before });
      writeUndo(ctx, undo);
      await runnerApi(ctx)('POST', '/api/admin', { requestedBy: ctx.user, config: next });
      return { changed: lines, tab: 'admin', tabLabel: 'Admin' };
    },
  };
}

function needEmail(e) { if (!e || !EMAIL_RE.test(e)) throw new Error('Whose access? Include their email address.'); return e.toLowerCase(); }

const ADMIN_TOOLS = {
  'admin.showAccess': {
    title: 'Show who is an admin and who has which tools', risk: 'read', params: {},
    async run(_a, ctx) {
      const cfg = await adminConfig(ctx);
      const grants = cfg.entitlements.grants || {};
      return {
        admins: cfg.adminEmails,
        defaultTools: (cfg.entitlements.default || []).map((k) => SUITE_LABELS[k] || k),
        people: Object.keys(grants).sort().map((e) => ({ email: e, tools: grants[e].map((k) => SUITE_LABELS[k] || k) })),
      };
    },
  },
  'admin.setAccess': adminTool('Change which tools a person can use', { email: 'their email', add: 'tool keys to give', remove: 'tool keys to take away' }, (cfg, a) => {
    const email = needEmail(a.email);
    if (!(a.add || []).length && !(a.remove || []).length) throw new Error(`Which tool(s)? e.g. "give ${email} access to SmartCOMM and OneInc".`);
    const now = grantsOf(cfg, email);
    const next = [...new Set([...now, ...(a.add || [])])].filter((k) => !(a.remove || []).includes(k) || k === 'smartComm');
    cfg.entitlements.grants = Object.assign({}, cfg.entitlements.grants, { [email]: SUITES.filter((k) => next.includes(k)) });
    const lines = [`${email}: ${names(now)}  →  ${names(cfg.entitlements.grants[email])}`];
    if ((a.remove || []).includes('smartComm')) lines.push('SmartCOMM stays on — it is always enabled for everyone.');
    return { next: cfg, lines };
  }),
  'admin.setAdmin': adminTool('Add or remove an admin', { email: 'their email', admin: 'true to add, false to remove' }, (cfg, a, ctx) => {
    const email = needEmail(a.email);
    const list = cfg.adminEmails.map((e) => e.toLowerCase());
    if (a.admin && list.includes(email)) throw new Error(`${email} is already an admin.`);
    if (!a.admin && !list.includes(email)) throw new Error(`${email} isn't an admin.`);
    if (!a.admin && email === String(ctx.user).toLowerCase()) throw new Error("You can't remove yourself as admin here — ask another admin.");
    cfg.adminEmails = a.admin ? [...list, email] : list.filter((e) => e !== email);
    return { next: cfg, lines: [`${a.admin ? 'Make' : 'Remove'} admin: ${email}`, `Admins after: ${cfg.adminEmails.join(', ')}`] };
  }),
  'admin.undo': {
    title: 'Undo my last admin change', risk: 'admin', params: {},
    async preview(_a, ctx) {
      await adminConfig(ctx);
      const last = readUndo(ctx).filter((u) => u.user === ctx.user).pop();
      if (!last) throw new Error('No admin change made through the Assistant to undo.');
      return { lines: last.what.map((l) => `Undo: ${l}`), note: `Restores the Admin config as it was before your change at ${new Date(last.at).toLocaleString()}. Any edits made since then on the Admin tab are replaced too.` };
    },
    async run(_a, ctx) {
      await adminConfig(ctx);
      const list = readUndo(ctx);
      let i = list.length - 1; while (i >= 0 && list[i].user !== ctx.user) i--;
      if (i < 0) throw new Error('No admin change made through the Assistant to undo.');
      const [last] = list.splice(i, 1);
      await runnerApi(ctx)('POST', '/api/admin', { requestedBy: ctx.user, config: last.before });
      writeUndo(ctx, list);
      return { changed: last.what.map((l) => `Undone: ${l}`), tab: 'admin', tabLabel: 'Admin' };
    },
  },
};

module.exports = { ACTION_TOOLS: { ...RUN_TOOLS, ...ADMIN_TOOLS }, SUITE_LABELS, SUITES };
