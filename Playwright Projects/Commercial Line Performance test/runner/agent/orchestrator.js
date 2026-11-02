// runner/agent/orchestrator.js — runs an Assistant task: plan → execute steps → validate → summary.
//   - read/report steps run automatically; a `send` step stops at "awaiting approval" until the user approves
//     (or rejects) it, showing exactly what will be sent and to whom.
//   - each step: timeout (AGENT_STEP_TIMEOUT_MS, default 3 min), one automatic retry on failure.
//   - pause / resume / cancel between steps; every state change is checkpointed to disk, so task history
//     survives a restart (a task that was mid-step when the Runner stopped is marked "interrupted" and can be resumed).
//   - audit log: one JSON line per action (who, what, tool, risk, outcome) in runtime-data/agent/audit.jsonl.
//   - memory: per-user preferences (default project, default recipients) the user can view / change / delete.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TOOLS } = require('./tools');
const planner = require('./planner');

const DATA_DIR = process.env.AGENT_DATA_DIR || path.join(__dirname, '..', '..', 'runtime-data', 'agent');
const TASK_DIR = path.join(DATA_DIR, 'tasks');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const NEEDS_APPROVAL = new Set(['send', 'run', 'admin']); // never run without the user's Approve; never auto-retried
const STEP_TIMEOUT_MS = Number(process.env.AGENT_STEP_TIMEOUT_MS) || 180000;
const MAX_RETRIES = 1;
const MEMORY_KEYS = { defaultProject: /^[A-Z][A-Z0-9]{1,9}$/, defaultRecipients: /^([^\s@,;]+@[^\s@,;]+\.[^\s@,;]+[,; ]*)+$/ };

function createOrchestrator({ host = {}, emit = () => {} } = {}) {
  fs.mkdirSync(TASK_DIR, { recursive: true });
  const tasks = new Map();
  const controllers = new Map(); // taskId -> AbortController of the running step

  // Load history; anything that was running when the Runner stopped is interrupted.
  for (const f of fs.readdirSync(TASK_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(TASK_DIR, f), 'utf8'));
      if (t.status === 'running') { t.status = 'interrupted'; t.steps.forEach((s) => { if (s.status === 'running') s.status = 'pending'; }); }
      tasks.set(t.id, t);
    } catch (_) { /* skip unreadable */ }
  }

  const save = (t) => { t.updatedAt = new Date().toISOString(); fs.writeFileSync(path.join(TASK_DIR, `${t.id}.json`), JSON.stringify(t, null, 2)); emit('agent', { id: t.id, user: t.user, status: t.status }); }; // ping only — the stream reaches every viewer; the owner fetches details
  const audit = (rec) => { try { fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n'); } catch (_) { /* never break a task */ } };
  const log = (t, msg, level = 'info') => { t.log.push({ ts: new Date().toISOString(), level, msg }); };

  // ── memory ──
  const readMemory = () => { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch (_) { return {}; } };
  const memoryFor = (user) => readMemory()[user] || {};
  function setMemory(user, key, value) {
    if (!MEMORY_KEYS[key]) throw new Error(`Unknown preference "${key}".`);
    const all = readMemory(); all[user] = all[user] || {};
    if (value === null || value === '') delete all[user][key];
    else { if (!MEMORY_KEYS[key].test(String(value))) throw new Error(`"${value}" isn't a valid ${key}.`); all[user][key] = String(value); }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(all, null, 2));
    audit({ user, action: value ? 'memory.set' : 'memory.delete', key });
    return all[user];
  }

  // ── task lifecycle ──
  async function submit(user, objective, { continueFrom } = {}) {
    const text = String(objective || '').trim().slice(0, 2000);
    if (!text) throw new Error('Tell me what you want done.');
    const prefs = memoryFor(user);
    const p = await planner.plan(text, { ...prefs, user });
    const id = `t${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const t = {
      id, user, objective: text, intent: p.intent, planner: p.planner, note: p.note || '', continueFrom: continueFrom || null,
      status: p.steps.length ? 'running' : 'needs_input', createdAt: new Date().toISOString(), updatedAt: '',
      steps: [...p.steps, ...(p.steps.length ? [{ tool: 'validate' }] : [])].map((s, n) => ({
        n, tool: s.tool, args: s.args || {}, title: s.tool === 'validate' ? 'Check the results' : TOOLS[s.tool].title,
        risk: s.tool === 'validate' ? 'read' : TOOLS[s.tool].risk, status: 'pending', attempts: 0, result: null, error: null,
      })),
      log: [], summary: '', followUps: planner.FOLLOW_UPS[p.intent] || [], usage: { toolCalls: 0, retries: 0, ms: 0, modelTokens: 0 },
    };
    log(t, `Planned ${t.steps.length} step(s) with ${t.planner}${t.note ? ` — ${t.note}` : ''}.`);
    tasks.set(id, t); save(t);
    audit({ user, action: 'task.submit', task: id, intent: t.intent, steps: t.steps.map((s) => s.tool) });
    if (t.steps.length) setImmediate(() => advance(t));
    return publicTask(t);
  }

  async function advance(t) {
    while (t.status === 'running') {
      const step = t.steps.find((s) => s.status === 'pending' || s.status === 'approved');
      if (!step) { finish(t); return; }
      if (NEEDS_APPROVAL.has(step.risk) && step.status !== 'approved') {
        // preview(): checks the request (and admin rights) and lists exactly what will happen — a request that
        // would be refused fails here instead of asking for an approval that can't succeed.
        if (TOOLS[step.tool].preview && !step.preview) {
          try { step.preview = await TOOLS[step.tool].preview(step.args, ctxFor(t)); } catch (e) {
            step.status = 'failed'; step.error = String(e.message || e).slice(0, 500);
            log(t, `Step ${step.n + 1} not possible: ${step.error}`, 'error');
            audit({ user: t.user, action: 'approval.refused', task: t.id, tool: step.tool, error: step.error });
            t.status = 'failed'; t.summary = step.error; save(t); return;
          }
          if (t.status !== 'running') { save(t); return; }
        }
        step.status = 'awaiting_approval'; t.status = 'awaiting_approval';
        log(t, `Waiting for your approval: ${step.title}${step.args.to ? ` → ${step.args.to}` : ''}.`);
        audit({ user: t.user, action: 'approval.requested', task: t.id, tool: step.tool, args: step.args });
        save(t); return;
      }
      await runStep(t, step);
      if (step.status === 'failed') { t.status = 'failed'; t.summary = `Stopped at step ${step.n + 1} (${step.title}): ${step.error}`; save(t); return; }
    }
  }

  function ctxFor(t) {
    return {
      taskId: t.id, user: t.user, host, dataDir: DATA_DIR,
      resultOf: (tool) => (t.steps.find((s) => s.tool === tool && s.status === 'done') || {}).result || null,
    };
  }

  async function runStep(t, step) {
    const ctx = ctxFor(t);
    while (step.attempts <= MAX_RETRIES) {
      step.attempts++; step.status = 'running'; step.startedAt = new Date().toISOString();
      log(t, `Step ${step.n + 1}: ${step.title}${step.attempts > 1 ? ` (retry ${step.attempts - 1})` : ''}…`); save(t);
      const ac = new AbortController(); controllers.set(t.id, ac);
      const started = Date.now();
      try {
        const work = step.tool === 'validate' ? validate(t) : TOOLS[step.tool].run(step.args, { ...ctx, signal: ac.signal });
        step.result = await withTimeout(work, STEP_TIMEOUT_MS, ac);
        step.status = 'done'; step.error = null;
        log(t, `Step ${step.n + 1} done${brief(step)}.`);
        audit({ user: t.user, action: 'tool.run', task: t.id, tool: step.tool, risk: step.risk, ok: true, ms: Date.now() - started });
      } catch (e) {
        step.error = String(e.message || e).slice(0, 500);
        audit({ user: t.user, action: 'tool.run', task: t.id, tool: step.tool, risk: step.risk, ok: false, error: step.error });
        if (t.status === 'cancelled') { step.status = 'cancelled'; return; }
        // Don't retry what can't succeed on a second try (bad input, missing login) or a send.
        const retryable = !NEEDS_APPROVAL.has(step.risk) && !/needs|isn't|not configured|valid/i.test(step.error);
        if (retryable && step.attempts <= MAX_RETRIES) { t.usage.retries++; log(t, `Step ${step.n + 1} failed (${step.error}) — retrying.`, 'warn'); continue; }
        step.status = 'failed'; log(t, `Step ${step.n + 1} failed: ${step.error}`, 'error');
      } finally {
        controllers.delete(t.id); t.usage.toolCalls++; t.usage.ms += Date.now() - started; step.ms = Date.now() - started;
      }
      save(t); return;
    }
  }

  // Final check: every step produced a result, and the counts agree with each other.
  async function validate(t) {
    const checks = [];
    for (const s of t.steps.filter((x) => x.tool !== 'validate' && x.status !== 'skipped')) checks.push({ check: `${s.title} produced a result`, ok: s.status === 'done' && s.result != null });
    const st = t.steps.find((s) => s.tool === 'jira.impededStories' && s.result);
    if (st) {
      const r = st.result;
      checks.push({ check: 'Every story appears in the rows', ok: new Set(r.rows.map((x) => x.story)).size === r.stories });
      checks.push({ check: 'Bug-link count matches the rows', ok: r.rows.filter((x) => x.bug).length === r.bugLinks });
      if (!r.stories) checks.push({ check: 'Query returned stories', ok: false, note: 'No stories matched — check the project / JQL.' });
    }
    const failed = checks.filter((c) => !c.ok);
    if (failed.some((c) => !c.note)) throw new Error(`Validation failed: ${failed.map((c) => c.check).join('; ')}`);
    return { checks };
  }

  function finish(t) {
    t.status = 'done';
    t.summary = summarise(t);
    log(t, 'Finished.');
    audit({ user: t.user, action: 'task.done', task: t.id, toolCalls: t.usage.toolCalls, ms: t.usage.ms });
    save(t);
  }

  function act(user, id, action) {
    const t = tasks.get(id);
    if (!t) throw new Error('No such task.');
    if (t.user !== user) throw new Error("That task belongs to someone else.");
    const step = t.steps.find((s) => s.status === 'awaiting_approval');
    if (action === 'approve' || action === 'reject') {
      if (!step) throw new Error('Nothing is waiting for approval.');
      audit({ user, action: `approval.${action}`, task: id, tool: step.tool, args: step.args });
      if (action === 'reject') { step.status = 'skipped'; log(t, `You rejected: ${step.title}. Nothing was sent or changed.`); t.status = 'running'; }
      else { step.status = 'approved'; log(t, `You approved: ${step.title}.`); t.status = 'running'; }
    } else if (action === 'pause') {
      if (t.status !== 'running') throw new Error('Only a running task can be paused.');
      t.status = 'paused'; log(t, 'Paused — the current step finishes, then it waits.');
    } else if (action === 'resume') {
      if (!['paused', 'interrupted', 'failed'].includes(t.status)) throw new Error('Only a paused, interrupted or failed task can be resumed.');
      t.steps.forEach((s) => { if (s.status === 'failed') { s.status = 'pending'; s.attempts = 0; } });
      t.status = 'running'; log(t, 'Resumed.');
    } else if (action === 'cancel') {
      if (['done', 'cancelled'].includes(t.status)) throw new Error('That task already ended.');
      t.status = 'cancelled'; t.steps.forEach((s) => { if (['pending', 'awaiting_approval', 'approved'].includes(s.status)) s.status = 'cancelled'; });
      const ac = controllers.get(id); if (ac) ac.abort();
      log(t, 'Cancelled.'); t.summary = 'Cancelled by you.';
    } else throw new Error(`Unknown action "${action}".`);
    audit({ user, action: `task.${action}`, task: id });
    save(t);
    if (t.status === 'running') setImmediate(() => advance(t));
    return publicTask(t);
  }

  const list = (user) => [...tasks.values()].filter((t) => t.user === user).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(publicTask);
  const get = (user, id) => { const t = tasks.get(id); if (!t || t.user !== user) throw new Error('No such task.'); return publicTask(t); };
  function remove(user, id) {
    const t = tasks.get(id); if (!t || t.user !== user) throw new Error('No such task.');
    if (['running', 'awaiting_approval'].includes(t.status)) throw new Error('Cancel the task before deleting it.');
    tasks.delete(id); fs.rmSync(path.join(TASK_DIR, `${id}.json`), { force: true });
    audit({ user, action: 'task.delete', task: id });
  }
  function metrics(user) {
    const mine = [...tasks.values()].filter((t) => !user || t.user === user);
    const by = (s) => mine.filter((t) => t.status === s).length;
    const steps = mine.flatMap((t) => t.steps.filter((s) => s.tool !== 'validate' && s.ms != null));
    const perTool = {};
    for (const s of steps) { const p = perTool[s.tool] = perTool[s.tool] || { calls: 0, failed: 0, ms: 0 }; p.calls++; p.ms += s.ms; if (s.status === 'failed') p.failed++; }
    return { tasks: mine.length, done: by('done'), failed: by('failed'), cancelled: by('cancelled'), retries: mine.reduce((a, t) => a + t.usage.retries, 0),
      completionRate: mine.length ? Math.round((by('done') / mine.length) * 100) : 0, perTool, modelTokens: 0, costUsd: 0 };
  }

  return { submit, act, list, get, remove, metrics, memoryFor, setMemory, suggestions: planner.SUGGESTIONS, tools: () => Object.entries(TOOLS).map(([name, t]) => ({ name, title: t.title, risk: t.risk })) };
}

function withTimeout(promise, ms, ac) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error(`timed out after ${Math.round(ms / 1000)}s`)); }, ms); })])
    .finally(() => clearTimeout(timer));
}

function brief(step) {
  const r = step.result || {};
  if (step.tool === 'jira.impededStories') return ` — ${r.stories} stories, ${r.bugLinks} linked bugs`;
  if (step.tool === 'jira.openDefects') return ` — ${r.total} open defects`;
  if (r.file) return ` — ${r.file}`;
  return '';
}

function summarise(t) {
  const res = (tool) => (t.steps.find((s) => s.tool === tool) || {}).result;
  const parts = [];
  const st = res('jira.impededStories');
  if (st) parts.push(`Found ${st.stories} impeded stories with ${st.bugLinks} linked bugs.`);
  const an = res('analysis.blockerInsights');
  if (an) parts.push(`${an.readyToUnblock.length} look ready to unblock (all bugs closed), ${an.noBug.length} have no bug linked, ${an.overdue.length} open bugs are overdue.`);
  const df = res('jira.openDefects');
  if (df) parts.push(`${df.total} open defects.`);
  for (const s of t.steps) if (s.result && s.result.file) parts.push(`Saved ${s.result.file}.`);
  const em = res('email.statusDeck');
  if (em) parts.push(`Emailed to ${em.sentTo.join(', ')}.`);
  for (const s of t.steps) {
    if (s.result && s.result.queued != null) parts.push(`Queued ${s.result.queued} job(s) on ${s.result.tabLabel}.`);
    if (s.result && s.result.changed) parts.push(s.result.changed.join(' '));
  }
  const acc = res('admin.showAccess');
  if (acc) parts.push(`${acc.admins.length} admin(s); ${acc.people.length} people with their own tool list.`);
  if (t.steps.some((s) => s.status === 'skipped')) parts.push('You rejected it — nothing was sent or changed.');
  return parts.join(' ') || 'Done.';
}

// What the UI gets: everything except bulky rows beyond a preview.
function publicTask(t) {
  return { ...t, steps: t.steps.map((s) => (s.result && Array.isArray(s.result.rows) ? { ...s, result: { ...s.result, rows: s.result.rows.slice(0, 500) } } : s)) };
}

module.exports = { createOrchestrator, DATA_DIR };
