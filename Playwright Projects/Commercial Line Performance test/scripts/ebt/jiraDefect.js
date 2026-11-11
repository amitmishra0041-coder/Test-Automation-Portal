// scripts/ebt/jiraDefect.js — file one EBT feedback email as a GCCM Bug (format of SMART-1750 / GCCM-1410):
//   Summary   "EBT.GCCM.FD.007: <email subject>"     Label  EBT
//   Assignee  the Jira user whose token the Runner uses (you)
//   Description: who reported it and when, the email (From/Sent/Subject + body) and every chosen screenshot inline.
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
    // A forwarded email's body already starts with the business user's own From/Sent/To/Subject lines.
    ...(email.forwardedBy ? [] : [
      `*From:* ${wikiEscape(who)}`,
      email.sent ? `*Sent:* ${wikiEscape(fmtSent(email.sent))}` : '',
      email.to ? `*To:* ${wikiEscape(email.to)}` : '',
      `*Subject:* ${wikiEscape(email.subject)}`,
      '',
    ]),
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

// opts: { id, summary, email (parsed), body (edited text), lob, feature, workstream, priority, images: [{filename, contentType, data}] }
async function createDefect(opts) {
  const user = await myself();
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
  return { key, url: `https://${site()}/browse/${key}`, assignee: user.displayName, attached };
}

module.exports = { createDefect, buildDescription, myself };
