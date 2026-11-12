// scripts/ebt/jiraDefect.js — file one EBT feedback email as a GCCM Bug (format of SMART-1750 / GCCM-1410):
//   Summary   "EBT.GCCM.FD.007: <email subject>"     Label  EBT
//   Assignee  opts.assignee (document issues -> Ingrid Keough, others -> Brendan Lutz; see ebtFiling.assigneeFor);
//             the Jira user whose token the Runner uses when that person can't be found
//   Description: who reported it and when, the reporter's message (no e-mail header lines, no signature) and every
//   chosen screenshot inline. The email file itself is attached to the defect.
// Steps: create (v2, wiki-markup description without images) -> attach the screenshots -> set the final description
// with !file! image macros (they only render once the attachments exist).
'use strict';

const site = () => String(process.env.JIRA_SITE || 'donegalgroup.atlassian.net').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const auth = () => 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const PROJECT = process.env.EBT_JIRA_PROJECT || 'GCCM';
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

async function jira(method, p, body, headers = {}) {
  const res = await fetch(`https://${site()}${p}`, {
    method,
    headers: { Authorization: auth(), Accept: 'application/json', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = [...(j.errorMessages || []), ...Object.entries(j.errors || {}).map(([k, v]) => `${k}: ${v}`)].join('; ') || text; } catch { /* raw */ }
    throw new Error(`Jira ${method} ${p} -> ${res.status}: ${String(msg).slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

// Wiki markup treats {, [, |, *, _, +, ^, ~, ?? and a leading "-"/"#" as formatting; the email should read verbatim.
function wikiEscape(s) {
  return String(s || '').replace(/([{}\[\]|*_+^~!\\])/g, '\\$1').replace(/^(\s*)([-#]+)(\s)/gm, '$1\\$2$3').replace(/\?\?/g, '\\?\\?');
}

function fmtSent(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function buildDescription({ id, email, lob, feature, workstream, body, images }) {
  const who = email.fromEmail ? `${email.fromName} (${email.fromEmail})` : email.fromName;
  const lines = [
    `*Reported by:* ${wikiEscape(who)}`,
    `*Reported on:* ${wikiEscape(fmtSent(email.sent))}`,
    `*EBT Feedback ID:* ${id}`,
    `*LOB / Feature / Workstream:* ${wikiEscape([lob, feature, workstream].filter(Boolean).join(' / '))}`,
    '',
    '----',
    wikiEscape(body),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  if (images && images.length) {
    lines.push('', '*Screenshots from the email:*');
    images.forEach((f) => lines.push(`!${f}|width=900!`, ''));
  }
  return lines.join('\n');
}

let me = null;
async function myself() { if (!me) me = await jira('GET', '/rest/api/3/myself'); return me; }

// A person who can be assigned GCCM issues, by name ("Ingrid Keough"); the surname alone is tried when the full
// name finds nobody (Jira has "Brendan", people write "Brendon"). null when there is no single clear match.
const people = new Map();
async function findAssignee(name) {
  name = String(name || '').trim();
  if (!name) return null;
  if (people.has(name)) return people.get(name);
  let hit = null;
  for (const q of [name, name.split(/\s+/).pop()]) {
    const list = (await jira('GET', `/rest/api/3/user/assignable/search?project=${PROJECT}&query=${encodeURIComponent(q)}`)).filter((u) => u.active !== false);
    hit = list.find((u) => String(u.displayName).toLowerCase() === name.toLowerCase()) || (list.length === 1 ? list[0] : null);
    if (hit) break;
  }
  people.set(name, hit);
  return hit;
}

// opts: { id, summary, email (parsed), body (edited text), lob, feature, workstream, priority, assignee (name),
//         images: [{filename, contentType, data}], emailFile: {filename, data} }
async function createDefect(opts) {
  let user = null, assigneeNote = '';
  try { user = await findAssignee(opts.assignee); } catch (e) { assigneeNote = e.message; }
  if (!user) { user = await myself(); if (opts.assignee) assigneeNote = `${opts.assignee} was not found in Jira${assigneeNote ? ` (${assigneeNote})` : ''} - assigned to ${user.displayName} instead`; }
  const sev = SEVERITIES.includes(opts.priority) ? opts.priority : opts.priority === 'Trivial' ? 'Low' : 'Medium';
  const fields = {
    project: { key: PROJECT },
    issuetype: { name: 'Bug' },
    summary: opts.summary.slice(0, 254),
    labels: ['EBT'],
    assignee: { accountId: user.accountId },
    description: buildDescription({ ...opts, images: [] }),
    priority: { name: opts.priority || 'Medium' },
    customfield_10137: { value: sev },
  };
  let issue;
  try { issue = await jira('POST', '/rest/api/2/issue', { fields }); } catch (e) {
    // Priority / Severity screens differ between projects — retry without them rather than fail the filing.
    if (!/priority|customfield_10137/i.test(e.message)) throw e;
    delete fields.priority; delete fields.customfield_10137;
    issue = await jira('POST', '/rest/api/2/issue', { fields });
  }
  const key = issue.key;
  const attached = [];
  for (const img of opts.images || []) {
    const fd = new FormData();
    fd.append('file', new Blob([img.data], { type: img.contentType || 'application/octet-stream' }), img.filename);
    const r = await jira('POST', `/rest/api/3/issue/${key}/attachments`, fd, { 'X-Atlassian-Token': 'no-check' });
    attached.push((r[0] && r[0].filename) || img.filename);
  }
  if (attached.length) {
    await jira('PUT', `/rest/api/2/issue/${key}`, { fields: { description: buildDescription({ ...opts, images: attached }) } });
  }
  // The email itself, so the fixer can open the original (attached last: a failure here must not lose the defect).
  let emailAttached = '', emailError = '';
  if (opts.emailFile && opts.emailFile.data) {
    try {
      const fd = new FormData();
      const type = /\.eml$/i.test(opts.emailFile.filename) ? 'message/rfc822' : 'application/vnd.ms-outlook';
      fd.append('file', new Blob([opts.emailFile.data], { type }), opts.emailFile.filename);
      const r = await jira('POST', `/rest/api/3/issue/${key}/attachments`, fd, { 'X-Atlassian-Token': 'no-check' });
      emailAttached = (r[0] && r[0].filename) || opts.emailFile.filename;
    } catch (e) { emailError = e.message; }
  }
  return { key, url: `https://${site()}/browse/${key}`, assignee: user.displayName, assigneeNote, attached, emailAttached, emailError };
}

// Jira status -> the tracker's Status list (Values!J). Names the tracker already has pass straight through.
const TRACKER_STATUSES = ['New', 'Open', 'Fixed', 'In Business Review', 'Ready for Retest', 'Rejected', 'Re-Open', 'To Do', 'Deferred', 'Impeded', 'Closed'];
const STATUS_MAP = { 'In Progress': 'Open', 'In Review': 'Open', Pending: 'Open', Backlog: 'To Do', 'Ready for QA': 'Ready for Retest', 'Awaiting Prod Deployment': 'Fixed', Done: 'Closed', Retired: 'Closed' };
const trackerStatus = (s) => (TRACKER_STATUSES.includes(s) ? s : STATUS_MAP[s] || s);

// { 'GCCM-1393': 'Fixed', ... } for the given keys (unknown / deleted keys are simply absent).
async function getStatuses(keys) {
  keys = [...new Set(keys.filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)))];
  const out = {};
  for (let i = 0; i < keys.length; i += 100) {
    const r = await jira('POST', '/rest/api/3/search/jql', { jql: `key in (${keys.slice(i, i + 100).join(',')})`, fields: ['status'], maxResults: 100 });
    (r.issues || []).forEach((x) => { out[x.key] = trackerStatus(x.fields.status.name); });
  }
  return out;
}

// Open bugs in SMART / GCCM that look like the same issue: OR-search the subject's key words (plus claim / policy
// numbers anywhere in the email), then rank by how many of those terms each summary contains.
const STOP = new Set('about after again also because been before being below between both cannot could does doing down during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very were what when where which while with would your issue issues claim claims test testing please thanks thank good morning afternoon hello team when getting error unable able new'.split(' '));
async function findSimilar(subject, body = '', { projects = ['SMART', 'GCCM'], limit = 6 } = {}) {
  const ids = [...new Set((`${subject}\n${body}`.match(/\b[A-Z]{2,4}-[A-Z]{2}-\d{2}-\d{2}-\d{6,7}\b/g) || []))].slice(0, 3);
  const words = [...new Set(String(subject).toLowerCase().match(/[a-z0-9]{4,}/g) || [])].filter((w) => !STOP.has(w)).slice(0, 8);
  const terms = [...ids, ...words];
  if (!terms.length) return [];
  const jql = `project in (${projects.join(',')}) AND issuetype in (Bug, Defect) AND statusCategory != Done AND (` +
    terms.map((t) => `text ~ "\\"${t}\\""`).join(' OR ') + ') ORDER BY created DESC';
  const r = await jira('POST', '/rest/api/3/search/jql', { jql, fields: ['summary', 'status', 'created', 'assignee'], maxResults: 50 });
  return (r.issues || []).map((x) => {
    const s = x.fields.summary.toLowerCase();
    const sw = new Set(s.match(/[a-z0-9]+/g) || []);
    const hit = words.filter((w) => sw.has(w)).length + ids.filter((i) => s.includes(i.toLowerCase())).length * 3;
    return { key: x.key, summary: x.fields.summary.trim(), status: x.fields.status.name, created: x.fields.created.slice(0, 10),
      assignee: x.fields.assignee ? x.fields.assignee.displayName : '', score: hit, url: `https://${site()}/browse/${x.key}` };
  }).filter((x) => x.score >= Math.max(Math.min(2, terms.length), Math.ceil(words.length * 0.4))).sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { createDefect, buildDescription, myself, getStatuses, trackerStatus, findSimilar, findAssignee };
