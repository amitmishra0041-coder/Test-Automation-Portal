// Assistant unit/integration tests — run: node --test runner/agent/tests/
// No Jira or email is touched: they use the Runner-local tools and REJECT the approval step.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
delete process.env.AGENT_LOCAL_MODEL_URL;
const planner = require('../planner');
const { createOrchestrator } = require('../orchestrator');

const host = { queueStatus: () => ({ queued: [], running: [{ label: 'BOP DE', requestedBy: 'x@y.com' }] }), readUsage: () => [{ ts: new Date().toISOString(), tool: 'smartComm', jobs: 3 }] };
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out waiting'); };

test('planner: impeded review for SMART builds query → analysis → spreadsheet', async () => {
  const p = await planner.plan('review all impeded test execution stories for smartcomm and list linked bugs in a spreadsheet');
  assert.deepStrictEqual(p.steps.map((s) => s.tool), ['jira.impededStories', 'analysis.blockerInsights', 'report.impededSpreadsheet']);
  assert.strictEqual(p.steps[0].args.project, 'SMART');
});

test('planner: CC maps to GCCM; explicit JQL is passed through', async () => {
  assert.strictEqual((await planner.plan('impeded CC stories')).steps[0].args.project, 'GCCM');
  const p = await planner.plan('impeded stories JQL: project = SMART AND sprint = 6302 AND status = Impeded');
  assert.match(p.steps[0].args.jql, /sprint = 6302/);
});

test('planner: email request picks the approval-gated tool and the address', async () => {
  const p = await planner.plan('email the status deck to a.b@donegalgroup.com');
  assert.strictEqual(p.steps[0].tool, 'email.statusDeck');
  assert.strictEqual(p.steps[0].args.to, 'a.b@donegalgroup.com');
});

test('planner: saved preference fills a missing project; unknown requests make no plan', async () => {
  assert.strictEqual((await planner.plan('impeded stories please', { defaultProject: 'GCCM' })).steps[0].args.project, 'GCCM');
  const u = await planner.plan('make me a sandwich');
  assert.strictEqual(u.steps.length, 0);
});

test('planner: a non-local model URL is refused (data policy)', async () => {
  process.env.AGENT_LOCAL_MODEL_URL = 'https://api.example.com'; process.env.AGENT_LOCAL_MODEL = 'x';
  const p = await planner.plan('show runner usage');
  assert.match(p.note, /localhost/);
  assert.strictEqual(p.planner, 'rules');
  delete process.env.AGENT_LOCAL_MODEL_URL; delete process.env.AGENT_LOCAL_MODEL;
});

test('orchestrator: read task runs to done with validation and an audit trail', async () => {
  const o = createOrchestrator({ host });
  const t = await o.submit('a@b.com', "what's running on the runner right now");
  const done = await until(() => { const x = o.get('a@b.com', t.id); return x.status === 'done' && x; });
  assert.strictEqual(done.steps[0].result.running.length, 1);
  assert.ok(done.steps.find((s) => s.tool === 'validate').result.checks.every((c) => c.ok));
  const audit = fs.readFileSync(path.join(process.env.AGENT_DATA_DIR, 'audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"tool.run"/);
});

test('orchestrator: send step waits for approval; reject skips it and nothing is sent', async () => {
  const o = createOrchestrator({ host });
  const t = await o.submit('a@b.com', 'email the status deck to a.b@donegalgroup.com');
  await until(() => o.get('a@b.com', t.id).status === 'awaiting_approval');
  assert.throws(() => o.act('other@b.com', t.id, 'approve'), /someone else/);
  o.act('a@b.com', t.id, 'reject');
  const done = await until(() => { const x = o.get('a@b.com', t.id); return x.status === 'done' && x; });
  assert.strictEqual(done.steps[0].status, 'skipped');
  assert.match(done.summary, /rejected/);
});

test('orchestrator: cancel, delete, memory controls and per-user isolation', async () => {
  const o = createOrchestrator({ host });
  const t = await o.submit('a@b.com', 'email the status deck to a.b@donegalgroup.com');
  await until(() => o.get('a@b.com', t.id).status === 'awaiting_approval');
  assert.throws(() => o.remove('a@b.com', t.id), /Cancel/);
  o.act('a@b.com', t.id, 'cancel');
  o.remove('a@b.com', t.id);
  assert.throws(() => o.get('a@b.com', t.id), /No such task/);
  assert.strictEqual(o.list('c@d.com').length, 0);
  assert.deepStrictEqual(o.setMemory('a@b.com', 'defaultProject', 'GCCM'), { defaultProject: 'GCCM' });
  assert.throws(() => o.setMemory('a@b.com', 'password', 'x'), /Unknown preference/);
  assert.throws(() => o.setMemory('a@b.com', 'defaultProject', 'not a key'), /valid/);
  o.setMemory('a@b.com', 'defaultProject', null);
  assert.deepStrictEqual(o.memoryFor('a@b.com'), {});
});

test('orchestrator: a missing Jira login fails fast without retrying', async () => {
  const saved = { e: process.env.JIRA_EMAIL, t: process.env.JIRA_API_TOKEN };
  delete process.env.JIRA_EMAIL; delete process.env.JIRA_API_TOKEN;
  const o = createOrchestrator({ host });
  const t = await o.submit('a@b.com', 'how many open defects');
  const f = await until(() => { const x = o.get('a@b.com', t.id); return x.status === 'failed' && x; });
  assert.strictEqual(f.steps[0].attempts, 1);
  assert.match(f.summary, /not configured/);
  if (saved.e) process.env.JIRA_EMAIL = saved.e; if (saved.t) process.env.JIRA_API_TOKEN = saved.t;
});

test('orchestrator: a task interrupted by a restart comes back as resumable', async () => {
  const o = createOrchestrator({ host });
  const t = await o.submit('a@b.com', 'show runner usage for 7 days');
  await until(() => o.get('a@b.com', t.id).status === 'done');
  const f = path.join(process.env.AGENT_DATA_DIR, 'tasks', `${t.id}.json`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.status = 'running'; j.steps[0].status = 'running'; fs.writeFileSync(f, JSON.stringify(j));
  const o2 = createOrchestrator({ host });
  assert.strictEqual(o2.get('a@b.com', t.id).status, 'interrupted');
  o2.act('a@b.com', t.id, 'resume');
  await until(() => o2.get('a@b.com', t.id).status === 'done');
});

// ── runs and Admin changes (fake Runner API: nothing is queued, no config is written) ─────────────────────
function fakeRunner(admins) {
  const calls = [];
  let config = { ownerEmail: 'o@d.com', adminEmails: admins.slice(), entitlements: { default: ['smartComm'], grants: {} }, environmentUrls: {}, smtp: {}, s3: {} };
  const api = async (method, url, body) => {
    calls.push({ method, url, body });
    if (url.startsWith('/api/admin')) {
      const who = method === 'GET' ? decodeURIComponent(url.split('email=')[1]) : body.requestedBy;
      if (!config.adminEmails.includes(who)) throw new Error('Admin access only.');
      if (method === 'GET') return { config: JSON.parse(JSON.stringify(config)) };
      config = body.config; return { ok: true };
    }
    if (url === '/api/run') return { ok: true, queued: body.jobs.length };
    throw new Error('unexpected ' + url);
  };
  return { calls, api, config: () => config };
}

test('planner: runs on the tool tabs are parsed into approval-gated steps', async () => {
  let p = await planner.plan('Run BOP and CA for DE and PA on QA');
  assert.strictEqual(p.steps[0].tool, 'run.policy');
  assert.deepStrictEqual(p.steps[0].args, { lobs: ['BOP', 'CA'], states: ['DE', 'PA'], env: 'qa' });
  p = await planner.plan('validate SmartCOMM DIG32 and dig47b on test', { user: 'a@b.com' });
  assert.deepStrictEqual(p.steps[0].args.templates, ['DIG32', 'DIG47B']);
  p = await planner.plan('run oneinc GCCM-1234 on dev');
  assert.deepStrictEqual(p.steps[0].args, { stories: ['GCCM-1234'], tier: 'dev' });
  p = await planner.plan('give x.y@donegalgroup.com access to PDF compare and OneInc');
  assert.deepStrictEqual(p.steps[0].args, { email: 'x.y@donegalgroup.com', add: ['pdfCompare', 'oneInc'] });
  assert.strictEqual((await planner.plan('make x.y@donegalgroup.com an admin')).steps[0].args.admin, true);
});

test('orchestrator: a non-admin is refused before any approval prompt', async () => {
  const r = fakeRunner(['boss@d.com']);
  const o = createOrchestrator({ host: { ...host, api: r.api } });
  const t = await o.submit('user@d.com', 'give x@d.com access to OneInc');
  const f = await until(() => { const x = o.get('user@d.com', t.id); return x.status === 'failed' && x; });
  assert.match(f.summary, /admins only/);
  assert.ok(!r.calls.some((c) => c.method === 'POST'));
  const t2 = await o.submit('user@d.com', 'who has access to which tools?');
  assert.match((await until(() => { const x = o.get('user@d.com', t2.id); return x.status === 'failed' && x; })).summary, /admins only/);
});

test('orchestrator: admin change waits for approval, applies, and can be undone', async () => {
  const r = fakeRunner(['boss@d.com']);
  const o = createOrchestrator({ host: { ...host, api: r.api } });
  const t = await o.submit('boss@d.com', 'give x@d.com access to OneInc');
  const w = await until(() => { const x = o.get('boss@d.com', t.id); return x.status === 'awaiting_approval' && x; });
  assert.match(w.steps[0].preview.lines[0], /x@d\.com: SmartCOMM Validator {2}→ {2}SmartCOMM Validator, OneInc Payments/);
  assert.ok(!r.calls.some((c) => c.method === 'POST'));
  o.act('boss@d.com', t.id, 'approve');
  await until(() => o.get('boss@d.com', t.id).status === 'done');
  assert.deepStrictEqual(r.config().entitlements.grants['x@d.com'], ['smartComm', 'oneInc']);
  const u = await o.submit('boss@d.com', 'undo my last admin change');
  await until(() => o.get('boss@d.com', u.id).status === 'awaiting_approval');
  o.act('boss@d.com', u.id, 'approve');
  await until(() => o.get('boss@d.com', u.id).status === 'done');
  assert.deepStrictEqual(r.config().entitlements.grants, {});
});

test('orchestrator: a run is queued only after approval, as the requesting user', async () => {
  const r = fakeRunner([]);
  const o = createOrchestrator({ host: { ...host, api: r.api } });
  const t = await o.submit('a@b.com', 'run BOP for DE on training');
  await until(() => o.get('a@b.com', t.id).status === 'awaiting_approval');
  assert.strictEqual(r.calls.length, 0);
  o.act('a@b.com', t.id, 'approve');
  const d = await until(() => { const x = o.get('a@b.com', t.id); return x.status === 'done' && x; });
  assert.deepStrictEqual(r.calls[0].body, { suite: 'policy', requestedBy: 'a@b.com', jobs: [{ project: 'REGRESSION', lob: 'BOP', state: 'DE', env: 'training' }] });
  assert.match(d.summary, /Queued 1 job/);
  const m = await o.submit('a@b.com', 'run BOP for DE');
  assert.match((await until(() => { const x = o.get('a@b.com', m.id); return x.status === 'failed' && x; })).summary, /Which environment/);
});
