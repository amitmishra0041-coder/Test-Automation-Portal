// scripts/ebt/ebtFiling.js — the Runner's "EBT feedback -> Jira defect + tracker row" flow.
//   preview(buf, name)  parse the uploaded email, suggest the tracker fields, show the next Feedback ID
//   file(token, form)   create the GCCM Bug, then fill that ID's row in the tracker
//   retryTracker(token) re-try only the tracker write (the Jira defect already exists)
// Parsed emails are held in memory for an hour between preview and file.
'use strict';

const path = require('path');
const crypto = require('crypto');
const { parseEmail, cleanSubject } = require('./emailParse');
const tracker = require('./tracker');
const { createDefect, getStatuses, findSimilar } = require('./jiraDefect');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'runtime-data', 'ebt', 'tracker-backups');
const pending = new Map();
const TTL = 60 * 60 * 1000;
const sweep = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > TTL) pending.delete(k); };

// First matching keyword wins; the user can change it before filing.
const FEATURE_HINTS = [
  [/\b(document|template|letter|smartcomm|form letter)/i, 'Documents'],
  [/\b(payment|reserve|check|invoice|recovery|financial)/i, 'Financials'],
  [/\b(contact|vendor|address book|contact manager|payee)/i, 'Parties Involved/Contact Manager'],
  [/\b(policy search|policy retriev|verify policy|policy refresh)/i, 'Policy Search & Retrieve'],
  [/\b(fnol|new claim|claim setup|set up|intake|endorsement|policy tab|medicare)/i, 'Intake/FNOL'],
  [/\b(activity|note|assignment|diary)/i, 'Claim Handling'],
];
function guessFeature(text, list) {
  const hit = FEATURE_HINTS.find(([re, f]) => re.test(text) && (!list.length || list.includes(f)));
  return hit ? hit[1] : '';
}

// "Mary Flohr" -> "Flohr, Mary" (the tracker's Reporter style); Outlook names already "Last, First" stay as they are.
function reporterName(n) {
  n = String(n || '').trim();
  if (!n || n.includes(',') || /@/.test(n)) return n;
  const parts = n.split(/\s+/);
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(' ')}` : n;
}

const SMALL_IMAGE = 20 * 1024; // signature logos / icons (Donegal's are 8-15 KB) — offered but unticked

async function preview(buf, name) {
  sweep();
  const email = parseEmail(buf, name);
  // Outlook's plain text keeps "[cid:image003.png@01DD...]" where inline images sat and doubles every link.
  email.body = email.body.replace(/\[cid:[^\]]+\]\s*/g, '').replace(/<mailto:[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  // Forwarded / replied by you: the business reporter is the first "From:" in the thread below.
  const self = String(process.env.JIRA_EMAIL || '').toLowerCase();
  if (self && String(email.fromEmail).toLowerCase() === self) {
    const m = email.body.match(/^From:\s*"?([^"<\n]+?)"?\s*<([^>\s]+@[^>\s]+)>/m);
    if (m) {
      // Start the description at the business user's own message (their From/Sent/To/Subject lines included) and
      // date the feedback by when they sent it.
      email.forwardedBy = email.fromName; email.fromName = m[1].trim(); email.fromEmail = m[2].trim();
      email.body = email.body.slice(m.index);
      const sent = new Date((email.body.match(/^Sent:\s*(.+)$/m) || [])[1] || '');
      if (!isNaN(sent)) email.sent = sent;
      email.to = '';
    }
  }
  const subject = cleanSubject(email.subject);
  const t = await tracker.inspect({ subject });
  // Open SMART / GCCM bugs that may already cover this feedback (offered before a new defect is filed).
  let similar = [], similarError = '';
  try { similar = await findSimilar(subject, email.body); } catch (e) { similarError = e.message; }
  const token = crypto.randomUUID();
  pending.set(token, { at: Date.now(), email, subject, similar });
  return {
    token,
    similar,
    similarError,
    email: { subject: email.subject, fromName: email.fromName, fromEmail: email.fromEmail, to: email.to, sent: email.sent, body: email.body, forwardedBy: email.forwardedBy || '' },
    images: email.attachments.map((a, i) => ({
      i, filename: a.filename, size: a.data.length, isImage: a.isImage,
      checked: a.isImage && a.data.length >= SMALL_IMAGE,
      dataUrl: a.isImage && a.data.length < 6 * 1024 * 1024 ? `data:${a.contentType};base64,${a.data.toString('base64')}` : null,
    })),
    tracker: t,
    suggested: {
      id: t.nextId,
      title: subject,
      reporter: reporterName(email.fromName),
      reported: email.sent || new Date(),
      lob: 'Common',
      feature: guessFeature(`${subject}\n${email.body}`, t.lists.feature),
      system: (t.lists.system[0]) || 'ClaimCenter',
      priority: 'Medium',
      workstream: 'CC',
      status: 'New',
    },
  };
}

function trackerRow(p) {
  const f = p.form;
  return {
    id: p.id, reported: f.reported ? new Date(f.reported) : new Date(), lob: f.lob, feature: f.feature, system: f.system,
    description: `${p.id}: ${f.title}`, priority: f.priority, jiraId: p.jira.key, reporter: f.reporter,
    workstream: f.workstream, status: f.status || 'New', comments: f.comments || '',
  };
}

// form: { title, body, reporter, reported, lob, feature, system, priority, workstream, status, comments, images: [index] }
async function file(token, form) {
  const p = pending.get(token);
  if (!p) throw new Error('This email preview has expired — upload the email again.');
  if (p.jira) throw new Error(`Already filed as ${p.jira.key}${p.trackerDone ? '' : ' — use "Retry tracker update"'}.`);
  if (!String(form.title || '').trim()) throw new Error('Summary is required.');
  // Fail before touching Jira if the tracker can't be written right now.
  const t = await tracker.inspect();
  if (t.lockedBy) throw new Error(`The tracker is open in Excel by ${t.lockedBy} — close it first so the row can be added (nothing was filed).`);
  p.id = t.nextId;
  p.form = form;
  // Existing bug chosen: no new defect — the tracker row points at that key with its current status.
  const existing = String(form.existingKey || '').trim().toUpperCase();
  if (existing) {
    if (!/^(SMART|GCCM)-\d+$/.test(existing)) throw new Error(`"${existing}" is not a SMART or GCCM key.`);
    const st = await getStatuses([existing]);
    if (!st[existing]) throw new Error(`${existing} was not found in Jira.`);
    form.status = st[existing];
    p.jira = { key: existing, url: `https://${String(process.env.JIRA_SITE || 'donegalgroup.atlassian.net').replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/browse/${existing}`, existing: true, attached: [] };
    return finishTracker(p);
  }
  const images = (form.images || []).map((i) => p.email.attachments[+i]).filter(Boolean);
  p.jira = await createDefect({
    id: p.id,
    summary: `${p.id}: ${String(form.title).trim()}`,
    email: { ...p.email, fromName: p.email.fromName || form.reporter },
    body: form.body != null ? String(form.body) : p.email.body,
    lob: form.lob, feature: form.feature, workstream: form.workstream, priority: form.priority,
    images,
  });
  return finishTracker(p);
}

// Current JIRA status of every key already in the tracker (refreshed into column K on each filing).
async function currentStatuses() {
  try { return await getStatuses((await tracker.listEntries()).map((e) => e.jiraId)); }
  catch (e) { console.warn(`[ebt] status refresh skipped: ${e.message}`); return null; }
}

async function finishTracker(p) {
  try {
    const r = await tracker.addRow(trackerRow(p), { backupDir: BACKUP_DIR, statuses: await currentStatuses() });
    p.trackerDone = true;
    return { id: p.id, jira: p.jira, tracker: { ok: true, row: r.row, file: r.file, statusChanges: r.statusChanges } };
  } catch (e) {
    return { id: p.id, jira: p.jira, tracker: { ok: false, error: e.message, row: trackerRow(p) } };
  }
}

async function retryTracker(token) {
  const p = pending.get(token);
  if (!p || !p.jira) throw new Error('Nothing to retry for this email.');
  if (p.trackerDone) return { id: p.id, jira: p.jira, tracker: { ok: true } };
  return finishTracker(p);
}

// Status refresh on its own (Runner button / weekly deck refresh).
async function syncTrackerStatuses() {
  const statuses = await getStatuses((await tracker.listEntries()).map((e) => e.jiraId));
  return tracker.syncStatuses(statuses, { backupDir: BACKUP_DIR });
}

module.exports = { preview, file, retryTracker, syncTrackerStatuses, reporterName, guessFeature };
