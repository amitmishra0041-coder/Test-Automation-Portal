// runner/agent/routes.js — the Assistant's API, mounted by server.js only when RUNNER_AGENT=1 on a dev
// (non-packaged) Runner. Turn it off by removing the flag: nothing else in the Runner depends on it.
// Identity follows the Runner's own convention (the email entered in the app), sent as the X-Runner-User header.
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { createOrchestrator } = require('./orchestrator');
const { REPORT_DIR } = require('./tools');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBMITS_PER_MINUTE = 10;

function mountAgent(app, { broadcast, host }) {
  const orch = createOrchestrator({ host, emit: broadcast });
  const r = express.Router();
  r.use(express.json({ limit: '32kb' }));

  r.use((req, res, next) => {
    // Header for API calls; ?u= only for file downloads (a plain link can't send a header).
    const user = String(req.authEmail || req.get('x-runner-user') || (req.path.startsWith('/files/') ? req.query.u : '') || '').trim().toLowerCase();
    if (!EMAIL_RE.test(user)) return res.status(400).json({ error: 'Enter your email at the top of the Runner first.' });
    if (host.allowUser && !host.allowUser(user)) return res.status(403).json({ error: 'The Assistant is available to admins only for now.' });
    req.user = user; next();
  });

  const recent = new Map(); // user -> submit timestamps (rate limit)
  const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); } };

  r.get('/meta', wrap((req) => ({ suggestions: orch.suggestions, tools: orch.tools(), memory: orch.memoryFor(req.user) })));
  r.get('/tasks', wrap((req) => orch.list(req.user)));
  r.get('/tasks/:id', wrap((req) => orch.get(req.user, req.params.id)));
  r.post('/tasks', wrap((req) => {
    const now = Date.now(); const times = (recent.get(req.user) || []).filter((t) => now - t < 60000);
    if (times.length >= SUBMITS_PER_MINUTE) throw new Error('Too many requests — wait a minute.');
    times.push(now); recent.set(req.user, times);
    return orch.submit(req.user, req.body && req.body.objective, { continueFrom: req.body && req.body.continueFrom });
  }));
  r.post('/tasks/:id/:action', wrap((req) => orch.act(req.user, req.params.id, req.params.action)));
  r.delete('/tasks/:id', wrap((req) => { orch.remove(req.user, req.params.id); return { ok: true }; }));
  r.get('/memory', wrap((req) => orch.memoryFor(req.user)));
  r.post('/memory', wrap((req) => orch.setMemory(req.user, req.body.key, req.body.value)));
  r.get('/metrics', wrap((req) => orch.metrics(req.user)));
  // Reports the Assistant wrote — basename only, inside the assistant reports folder.
  r.get('/files/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(REPORT_DIR, name);
    if (!/\.(xlsx|pptx)$/i.test(name) || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
    res.download(file);
  });

  app.use('/api/agent', r);
  app.use('/agent-ui', express.static(path.join(__dirname, 'ui')));
  return orch;
}

module.exports = { mountAgent };
