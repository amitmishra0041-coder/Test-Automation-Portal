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
  const data = { savedAt: new Date().toISOString(), savedBy, source, count: Object.keys(byKey).length, notes: byKey, deckText: load().deckText };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

function load() {
  try { return JSON.parse(fs.readFileSync(notesFile(), 'utf8')); } catch (_) { return { savedAt: null, count: 0, notes: {} }; }
}

module.exports = { parse, save, load, saveDeckText, notesFile };
