// runner/auth.js — real sign-in for the Runner: a 6-digit code emailed to the person's Donegal address.
// Until 2026-11, "who you are" was whatever email was typed into Settings, so anyone could claim an admin's
// address. Now the server proves it: the code goes to that inbox, and a correct code sets an HttpOnly session
// cookie. Every identity the Runner acts on (runs, stops, Admin, Settings, the Assistant) comes from that cookie;
// emails typed into requests are overwritten with it.
//
//   POST /api/auth/request {email}       → emails a code (10 min, 5 tries, 3 codes per 10 min per address)
//   POST /api/auth/verify  {email, code} → sets the session cookie (14 days, renewed while in use)
//   GET  /api/auth/me                    → { email } or { email: null }
//   POST /api/auth/signout
// Everything else under the Runner needs a session, except the page itself ('/').
//
// Off switch: RUNNER_AUTH=0 (e.g. if the mail server is down) — back to the old typed-email behaviour.
// Allowed address domains: RUNNER_AUTH_DOMAINS (default donegalgroup.com).
// Testing only (never in the packaged app): RUNNER_AUTH_TEST_OUTBOX=<file> writes codes there instead of emailing.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const CODES_PER_WINDOW = 3;
const SESSION_TTL_MS = 14 * 864e5;
const COOKIE = 'runner_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function createAuth({ dataDir, packaged, sendMail }) {
  const enabled = process.env.RUNNER_AUTH !== '0';
  const domains = String(process.env.RUNNER_AUTH_DOMAINS || 'donegalgroup.com').toLowerCase().split(/[,\s]+/).filter(Boolean);
  const outbox = !packaged && process.env.RUNNER_AUTH_TEST_OUTBOX;
  const file = path.join(dataDir, 'auth-sessions.json');
  const internalKey = crypto.randomBytes(32).toString('hex'); // in-process calls (the Assistant → /api/run) only
  const codes = new Map(); // email -> { hash, expires, tries, sent: [timestamps] }
  let sessions = {};       // sha(token) -> { email, expires }
  try { sessions = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { /* first run */ }
  const persist = () => {
    const now = Date.now();
    for (const k of Object.keys(sessions)) if (sessions[k].expires < now) delete sessions[k];
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(sessions)); fs.renameSync(file + '.tmp', file); } catch (_) { /* keep in memory */ }
  };

  function cookieOf(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
    return m ? m[1] : null;
  }
  function sessionEmail(req) {
    const tok = cookieOf(req);
    const s = tok && sessions[sha(tok)];
    if (!s || s.expires < Date.now()) return null;
    if (s.expires - Date.now() < SESSION_TTL_MS / 2) { s.expires = Date.now() + SESSION_TTL_MS; persist(); }
    return s.email;
  }
  function setCookie(res, token, maxAgeMs) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  }

  function checkEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error('Enter your email address.');
    if (!domains.includes(email.split('@')[1])) throw new Error(`Use your ${domains.map((d) => '@' + d).join(' / ')} address.`);
    return email;
  }

  async function request(raw) {
    const email = checkEmail(raw);
    const now = Date.now();
    const prev = codes.get(email);
    const sent = ((prev && prev.sent) || []).filter((t) => now - t < CODE_TTL_MS);
    if (sent.length >= CODES_PER_WINDOW) throw new Error('Too many codes requested — wait 10 minutes and try again.');
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    codes.set(email, { hash: sha(email + ':' + code), expires: now + CODE_TTL_MS, tries: 0, sent: [...sent, now] });
    if (outbox) { fs.appendFileSync(outbox, `${email} ${code}\n`); return; }
    await sendMail({
      to: email,
      subject: `Your Runner sign-in code: ${code}`,
      text: `Your ClaimCenter Runner sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif"><p>Your ClaimCenter Runner sign-in code is</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p style="color:#666">It expires in 10 minutes. If you didn't try to sign in, ignore this email.</p></div>`,
    });
  }

  function verify(raw, code, res) {
    const email = checkEmail(raw);
    const c = codes.get(email);
    if (!c || c.expires < Date.now()) throw new Error('That code has expired — request a new one.');
    if (c.tries >= MAX_TRIES) throw new Error('Too many wrong codes — request a new one.');
    const ok = crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(sha(email + ':' + String(code || '').trim())));
    if (!ok) { c.tries++; throw new Error(`Wrong code — ${MAX_TRIES - c.tries} tries left.`); }
    codes.delete(email);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[sha(token)] = { email, expires: Date.now() + SESSION_TTL_MS };
    persist();
    setCookie(res, token, SESSION_TTL_MS);
    return email;
  }

  function signout(req, res) {
    const tok = cookieOf(req);
    if (tok) { delete sessions[sha(tok)]; persist(); }
    setCookie(res, '', 0);
  }

  // Routes + the gate. Mount before every other route.
  function mount(app) {
    const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(400).json({ error: e.message }); } };
    app.post('/api/auth/request', wrap(async (req) => { await request(req.body && req.body.email); return { ok: true }; }));
    app.post('/api/auth/verify', wrap((req, res) => ({ email: verify(req.body && req.body.email, req.body && req.body.code, res) })));
    app.get('/api/auth/me', (req, res) => res.json({ enabled, email: enabled ? sessionEmail(req) : null }));
    app.post('/api/auth/signout', (req, res) => { signout(req, res); res.json({ ok: true }); });

    app.use((req, res, next) => {
      if (!enabled) return next();
      if (req.path === '/' || req.path.startsWith('/api/auth/')) return next();
      const internal = req.get('x-runner-internal') === internalKey && EMAIL_RE.test(String(req.get('x-runner-user') || ''));
      const email = internal ? String(req.get('x-runner-user')).toLowerCase() : sessionEmail(req);
      if (!email) return res.status(401).json({ error: 'Sign in first.', signIn: true });
      req.authEmail = email;
      // Whatever identity a request names, it acts as the signed-in person.
      if (req.body && typeof req.body === 'object') {
        if ('requestedBy' in req.body || req.path === '/api/run' || req.path === '/api/stop' || req.path.startsWith('/api/admin')) req.body.requestedBy = email;
        if (req.path === '/api/settings') req.body.email = email;
      }
      if ('email' in req.query) req.query.email = email;
      if (req.get('x-runner-user')) req.headers['x-runner-user'] = email;
      next();
    });
  }

  // Headers for the server's own calls to itself, acting as an already signed-in user.
  const internalHeaders = (email) => ({ 'X-Runner-Internal': internalKey, 'X-Runner-User': email });
  return { enabled, mount, sessionEmail, internalHeaders };
}

module.exports = { createAuth };
