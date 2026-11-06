// Sign-in tests — run: node --test runner/tests/auth.node-test.js  (codes go to a test outbox file; no email)
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
const outbox = path.join(dir, 'outbox.txt');
process.env.RUNNER_AUTH_TEST_OUTBOX = outbox;
delete process.env.RUNNER_AUTH;
const { createAuth } = require('../auth');

function server() {
  const app = express();
  app.use(express.json());
  const auth = createAuth({ dataDir: dir, packaged: false, sendMail: async () => { throw new Error('no mail in tests'); } });
  auth.mount(app);
  app.post('/api/run', (req, res) => res.json({ as: req.body.requestedBy }));
  app.get('/reports/oneinc/Logs/x.log', (req, res) => res.json({ as: req.authEmail }));
  app.get('/api/who', (req, res) => res.json({ as: req.authEmail, header: req.get('x-runner-user') || null }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve({ s, auth, url: `http://127.0.0.1:${s.address().port}` })); });
}
async function call(url, method = 'GET', body, cookie, headers = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const lastCode = (email) => fs.readFileSync(outbox, 'utf8').trim().split('\n').filter((l) => l.startsWith(email + ' ')).pop().split(' ')[1];

test('no session → everything except sign-in answers 401', async () => {
  const { s, url } = await server();
  assert.strictEqual((await call(url + '/api/who')).status, 401);
  assert.strictEqual((await call(url + '/api/run', 'POST', { requestedBy: 'boss@donegalgroup.com' })).status, 401);
  assert.deepStrictEqual((await call(url + '/api/auth/me')).json, { enabled: true, email: null });
  s.close();
});

test('code sign-in: wrong code counts down, right code signs in, identity cannot be spoofed', async () => {
  const { s, url } = await server();
  assert.match((await call(url + '/api/auth/request', 'POST', { email: 'me@gmail.com' })).json.error, /donegalgroup/);
  assert.ok((await call(url + '/api/auth/request', 'POST', { email: 'Me@DonegalGroup.com' })).json.ok);
  const code = lastCode('me@donegalgroup.com');
  const bad = code === '000000' ? '111111' : '000000';
  assert.match((await call(url + '/api/auth/verify', 'POST', { email: 'me@donegalgroup.com', code: bad })).json.error, /4 tries left/);
  const ok = await call(url + '/api/auth/verify', 'POST', { email: 'me@donegalgroup.com', code });
  assert.strictEqual(ok.json.email, 'me@donegalgroup.com');
  assert.match(ok.cookie, /^runner_session=/);
  // Claims to be someone else → acts as the signed-in person.
  assert.strictEqual((await call(url + '/api/run', 'POST', { requestedBy: 'boss@donegalgroup.com' }, ok.cookie)).json.as, 'me@donegalgroup.com');
  assert.deepStrictEqual((await call(url + '/api/who', 'GET', null, ok.cookie, { 'X-Runner-User': 'boss@donegalgroup.com' })).json, { as: 'me@donegalgroup.com', header: 'me@donegalgroup.com' });
  // A used code can't be replayed; sign-out ends the session.
  assert.match((await call(url + '/api/auth/verify', 'POST', { email: 'me@donegalgroup.com', code })).json.error, /expired/);
  await call(url + '/api/auth/signout', 'POST', {}, ok.cookie);
  assert.strictEqual((await call(url + '/api/who', 'GET', null, ok.cookie)).status, 401);
  s.close();
});

test('limits: 3 codes per 10 minutes, 5 wrong tries kill the code', async () => {
  const { s, url } = await server();
  for (let i = 0; i < 3; i++) assert.ok((await call(url + '/api/auth/request', 'POST', { email: 'x@donegalgroup.com' })).json.ok);
  assert.match((await call(url + '/api/auth/request', 'POST', { email: 'x@donegalgroup.com' })).json.error, /Too many codes/);
  const code = lastCode('x@donegalgroup.com');
  const bad = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await call(url + '/api/auth/verify', 'POST', { email: 'x@donegalgroup.com', code: bad });
  assert.match((await call(url + '/api/auth/verify', 'POST', { email: 'x@donegalgroup.com', code })).json.error, /Too many wrong/);
  s.close();
});

test("server's own calls (the Assistant) need the in-process key; a guessed key is refused", async () => {
  const { s, url, auth } = await server();
  assert.strictEqual((await call(url + '/api/who', 'GET', null, null, auth.internalHeaders('me@donegalgroup.com'))).json.as, 'me@donegalgroup.com');
  assert.strictEqual((await call(url + '/api/who', 'GET', null, null, { 'X-Runner-Internal': 'guess', 'X-Runner-User': 'boss@donegalgroup.com' })).status, 401);
  s.close();
});

test('sessions survive a restart (stored hashed, not as the token)', async () => {
  const a = await server();
  await call(a.url + '/api/auth/request', 'POST', { email: 'r@donegalgroup.com' });
  const ok = await call(a.url + '/api/auth/verify', 'POST', { email: 'r@donegalgroup.com', code: lastCode('r@donegalgroup.com') });
  a.s.close();
  const saved = fs.readFileSync(path.join(dir, 'auth-sessions.json'), 'utf8');
  assert.ok(!saved.includes(ok.cookie.split('=')[1]));
  const b = await server();
  assert.strictEqual((await call(b.url + '/api/who', 'GET', null, ok.cookie)).json.as, 'r@donegalgroup.com');
  b.s.close();
});

test('report link token: opens a /reports link in a browser with no session, and only that', async () => {
  const { s, url } = await server();
  await call(url + '/api/auth/request', 'POST', { email: 'rl@donegalgroup.com' });
  const ok = await call(url + '/api/auth/verify', 'POST', { email: 'rl@donegalgroup.com', code: lastCode('rl@donegalgroup.com') });
  const rt = (await call(url + '/api/auth/link-token', 'GET', null, ok.cookie)).json.rt;
  assert.ok(rt);
  assert.strictEqual((await call(url + '/api/auth/link-token')).status, 401); // no token for the signed-out
  assert.strictEqual((await call(url + '/reports/oneinc/Logs/x.log')).status, 401);
  const viaLink = await call(url + '/reports/oneinc/Logs/x.log?rt=' + encodeURIComponent(rt));
  assert.strictEqual(viaLink.json.as, 'rl@donegalgroup.com');
  assert.match(viaLink.cookie, /^runner_session=/); // the browser is now signed in (report screenshots load)
  assert.strictEqual((await call(url + '/reports/oneinc/Logs/x.log', 'GET', null, viaLink.cookie)).status, 200);
  // Tampered or used outside /reports → refused.
  assert.strictEqual((await call(url + '/reports/oneinc/Logs/x.log?rt=' + encodeURIComponent(rt.slice(0, -2) + 'xx'))).status, 401);
  assert.strictEqual((await call(url + '/api/who?rt=' + encodeURIComponent(rt))).status, 401);
  s.close();
});
