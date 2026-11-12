// Weekly blocker / dependency notes for the Sprint status deck (scripts/jiraStatusDeck.js).
//
// The QA lead's weekly status email has a table: Key | Summary | Status | Notes ("Awaiting vendor switch",
// "Mail sent to BAs for requirements"...). Jira doesn't hold those explanations, so the runner's Jira tab lets
// them paste that table (or upload the email) each week; the rows are parsed here and saved, and the deck
// shows each note next to its item (beside outstanding items on slide 1).
//
// Storage: one JSON file — RUNNER_STATUS_NOTES_FILE, else next to the runner's settings file, else
// runtime-data/status-notes.json. Saving replaces the previous week's notes.
'use strict';

const fs = require('fs');
const path = require('path');

const KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/;
const STATUS_RE = /^(impeded|blocked|in progress|in review|to do|done|closed|ready for qa|ready for retest|open|new|re-?open)$/i;

function notesFile() {
  if (process.env.RUNNER_STATUS_NOTES_FILE) return process.env.RUNNER_STATUS_NOTES_FILE;
  if (process.env.RUNNER_SETTINGS_FILE) return path.join(path.dirname(process.env.RUNNER_SETTINGS_FILE), 'status-notes.json');
  return path.join(__dirname, '..', 'runtime-data', 'status-notes.json');
}

const clean = (s) => String(s == null ? '' : s).replace(/ /g, ' ').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// rows: array of cell arrays (from an HTML table) — or text: plain text (tab-separated rows; a line without a key
// continues the previous row's note). Returns [{ key, summary, status, note }].
function parse({ rows, text } = {}) {
  const out = [];
  if (Array.isArray(rows) && rows.length) {
    for (const cellsRaw of rows) {
      const cells = (cellsRaw || []).map(clean);
      const ki = cells.findIndex((c) => KEY_RE.test(c) && c.length <= 20);
      if (ki < 0) continue;
      const key = cells[ki].match(KEY_RE)[1];
      const si = cells.findIndex((c, i) => i > ki && STATUS_RE.test(c));
      const summary = cells.slice(ki + 1, si > ki ? si : ki + 2).join(' ').trim();
      const status = si > ki ? cells[si] : '';
      const note = (si > ki ? cells.slice(si + 1) : cells.slice(ki + 2)).filter(Boolean).join('\n').trim();
      out.push({ key, summary, status, note });
    }
    return out;
  }
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split('\t').map((c) => c.trim());
    const ki = cells.findIndex((c) => KEY_RE.test(c) && c.length <= 20);
    if (ki >= 0 && ki <= 1) {
      const key = cells[ki].match(KEY_RE)[1];
      const si = cells.findIndex((c, i) => i > ki && STATUS_RE.test(c));
      cur = {
        key,
        summary: cells.slice(ki + 1, si > ki ? si : ki + 2).join(' ').trim(),
        status: si > ki ? cells[si] : '',
        note: (si > ki ? cells.slice(si + 1) : cells.slice(ki + 2)).filter(Boolean).join(' ').trim(),
      };
      out.push(cur);
    } else if (cur) {
      cur.note = [cur.note, line.trim()].filter(Boolean).join('\n');
    }
  }
  return out;
}

// Deck text the QA lead writes each week: the header objective and a "Risk & Dependencies" paragraph per area.
// Kept in the same file as the notes; saving one never clears the other.
const AREAS = ['ClaimCenter', 'SmartComm', 'OneInc'];
function saveDeckText({ objective, risks } = {}, { savedBy = '' } = {}) {
  const file = notesFile();
  const data = load();
  data.deckText = {
    objective: String(objective || '').trim(),
    risks: Object.fromEntries(AREAS.map((a) => [a, String((risks || {})[a] || '').trim()])),
    savedAt: new Date().toISOString(), savedBy,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data.deckText;
}

function save(entries, { source = '', savedBy = '' } = {}) {
  const file = notesFile();
  const byKey = {};
  for (const e of entries) if (e.key) byKey[e.key] = { summary: e.summary || '', status: e.status || '', note: e.note || '' };
  const data = { savedAt: new Date().toISOString(), savedBy, source, count: Object.keys(byKey).length, notes: byKey, deckText: load().deckText, emails: load().emails };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

function load() {
  try { return JSON.parse(fs.readFileSync(notesFile(), 'utf8')); } catch (_) { return { savedAt: null, count: 0, notes: {} }; }
}

// ── Status emails dropped on the Jira tab (2026-11-11) ──────────────────────────────────────────────────
// The QA leads' own status emails, read as they are — two shapes are understood:
//   - a table with "Issue key" + "Comments" columns (the CC/CM daily status)  -> byKey { 'GCCM-603': { note, due } }
//   - "Area – what's happening" bullet lines, no Jira keys (the OneInc update)  -> named [{ name, note }]
//     (the deck matches each name to its Jira card; lines that match no card — other teams' updates — are ignored)
// One email is kept per sender + subject: dropping this week's replaces last week's. Emails older than
// EMAIL_MAX_AGE_DAYS are ignored by the deck.
const EMAIL_MAX_AGE_DAYS = 10;
const cellText = (h) => h.replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
const ONLY_KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
function parseStatusEmail({ html = '', text = '' } = {}) {
  const byKey = {};
  for (const tbl of String(html).match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = (tbl.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(cellText));
    const hi = rows.findIndex((r) => r.some((c) => /^issue key$/i.test(c)) && r.some((c) => /^comments?$/i.test(c)));
    if (hi < 0) continue;
    const col = (re) => rows[hi].findIndex((c) => re.test(c));
    const k = col(/^issue key$/i), c = col(/^comments?$/i), d = col(/^due/i);
    for (const r of rows.slice(hi + 1)) if (ONLY_KEY.test(r[k] || '') && r[c]) byKey[r[k]] = { note: r[c], due: d >= 0 ? r[d] || '' : '' };
  }
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // No HTML (an RTF-only .msg): the same table arrives as one cell per line — key, summary, status, then the
  // comment lines up to the hours / date cells.
  if (!Object.keys(byKey).length) {
    for (let i = 0; i < lines.length; i++) {
      if (!ONLY_KEY.test(lines[i]) || !STATUS_RE.test(lines[i + 2] || '')) continue;
      const note = [];
      for (let j = i + 3; j < lines.length && !ONLY_KEY.test(lines[j]) && !/^-?\d+(\.\d+)?$/.test(lines[j]) && !/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(lines[j]) && note.length < 12; j++) note.push(lines[j]);
      if (note.length && !byKey[lines[i]]) byKey[lines[i]] = { note: note.join('\n'), due: '' };
    }
  }
  // "Quick Check – 40% Testing Completed ..." — the first mention of a name wins (the execution status comes
  // before any later section that repeats the name, e.g. an automation-review list).
  const named = []; const seen = new Set();
  for (const l of lines) {
    const m = l.replace(/^[*•·o▪-]\s+/, '').match(/^([A-Z0-9][^–—]{2,70}?)\s+[–—]\s+(.{8,})$/);
    if (!m || /^(from|sent|to|cc|subject):/i.test(m[1])) continue;
    const id = m[1].toLowerCase();
    if (!seen.has(id)) { seen.add(id); named.push({ name: m[1].trim(), note: m[2].trim() }); }
  }
  return { byKey, named };
}
const emailId = (from, subject) => `${String(from || '').toLowerCase().trim()}|${String(subject || '').toLowerCase().replace(/^((re|fw|fwd):\s*)+/i, '').replace(/[\d/.\-]+/g, ' ').replace(/\s+/g, ' ').trim()}`;
function saveEmail({ from, subject, received, byKey = {}, named = [] }, { savedBy = '' } = {}) {
  const file = notesFile(); const data = load();
  data.emails = data.emails || {};
  const id = emailId(from, subject);
  data.emails[id] = { from, subject, received: received ? new Date(received).toISOString() : new Date().toISOString(), savedAt: new Date().toISOString(), savedBy, byKey, named };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return { id, ...data.emails[id] };
}
function removeEmail(id) {
  const file = notesFile(); const data = load();
  if (!data.emails || !data.emails[id]) return false;
  delete data.emails[id];
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return true;
}
// Saved emails, oldest first (so a later email's note wins); `fresh` = still used by the deck.
function emails(now = new Date()) {
  return Object.entries(load().emails || {}).map(([id, e]) => ({ id, ...e, fresh: now - new Date(e.received) < EMAIL_MAX_AGE_DAYS * 864e5 }))
    .sort((a, b) => new Date(a.received) - new Date(b.received));
}

// A dropped .msg / .eml file -> parsed and saved. A status email the user forwarded to themselves is filed under
// the person who wrote it (the first "From:" in the thread).
function ingestEmailFile(buf, name, { savedBy = '' } = {}) {
  const { parseEmail, htmlToText } = require('./ebt/emailParse');
  const m = parseEmail(buf, name);
  const text = m.html ? htmlToText(m.html) : m.body;
  const parsed = parseStatusEmail({ html: m.html, text });
  if (!Object.keys(parsed.byKey).length && !parsed.named.length) {
    throw new Error('No status details found in this email - it needs a table with "Issue key" and "Comments" columns, or "Area – status" lines.');
  }
  let from = m.fromName || m.fromEmail || 'Unknown sender';
  const self = String(process.env.JIRA_EMAIL || '').toLowerCase();
  if (self && String(m.fromEmail).toLowerCase() === self) { const f = text.match(/^From:\s*"?([^"<\n]+?)"?\s*</m); if (f) from = f[1].trim(); }
  const e = saveEmail({ from, subject: m.subject, received: m.sent || new Date(), ...parsed }, { savedBy });
  return { id: e.id, from: e.from, subject: e.subject, received: e.received, cards: Object.keys(e.byKey).length, lines: e.named.length };
}

module.exports = { parse, save, load, saveDeckText, notesFile, parseStatusEmail, saveEmail, removeEmail, emails, ingestEmailFile };
