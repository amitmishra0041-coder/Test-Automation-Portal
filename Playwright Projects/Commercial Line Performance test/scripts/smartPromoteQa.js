// SMARTCOMM: move QA cards to "Ready for QA" when their BA / Dev card is Done (weekly, QA lead approves).
//
// Each SMARTCOMM template has a BA card ("<template>_Requirements"), a Dev card ("<template>_DEV") and two QA cards
// ("<template>_Test_Design", "<template>_Test_Execution"). A Test_Design card can start once its Requirements card
// is Done; a Test_Execution card once its DEV card is Done. This finds QA cards still in To Do whose BA/Dev card is
// Done, and (only on request) moves them to Ready for QA.
//
// Matching: same template name (DIG number normalised), else same DIG number (names sometimes drift, e.g.
// "Physcial"/"Physical"). When a template has several BA/Dev cards (a re-opened round — DIG 183 has SMART-235/510
// and later SMART-1273/1274), the one nearest in key number belongs with the QA card. Retired BA/Dev cards don't
// count as Done.
//
// Used by the runner (Jira tab: Find / Move) and by the weekly scheduled preview:
//   node scripts/smartPromoteQa.js --preview [--email you@donegalgroup.com]   (lists + emails; changes nothing)
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const jira = () => {
  const site = String(process.env.JIRA_SITE || 'donegalgroup.atlassian.net').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) throw new Error('Jira credentials missing — set them on the Settings tab.');
  return axios.create({ baseURL: `https://${site}/rest/api/3`, auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_API_TOKEN },
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
};

async function searchAll(http, jql, fields) {
  const out = []; let nextPageToken;
  for (let i = 0; i < 60; i++) {
    const { data } = await http.post('/search/jql', { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) });
    out.push(...(data.issues || []));
    if (!data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return out;
}

const SUFFIX = /[_ -]*(test[_ ]?design|test[_ ]?execution|requirements?|dev)\s*$/i;
function parseCard(summary) {
  const m = String(summary).match(SUFFIX);
  if (!m) return null;
  const s = m[1].toLowerCase().replace(/[_ ]/g, '');
  const kind = s === 'testdesign' ? 'design' : s === 'testexecution' ? 'exec' : s.startsWith('requirement') ? 'ba' : 'dev';
  const head = summary.slice(0, m.index);
  const digM = head.match(/^\s*DIG\s*-?\s*(\d+[A-Z]*)/i);
  const base = head.replace(/^\s*DIG\s*-?\s*(\d+[A-Z]*)/i, (_, n) => `dig${n.toLowerCase()}`).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return { kind, base, dig: digM ? `DIG${digM[1].toUpperCase()}` : null };
}
const keyNo = (k) => Number(String(k).split('-')[1]);
const isDone = (s) => /^(done|closed)$/i.test(s);

// { candidates: [{ key, summary, type, sprint, partnerKey, partnerSummary, partnerStatus, note }], notReady, noPartner }
async function findCandidates() {
  const http = jira();
  const issues = await searchAll(http, 'project = SMART ORDER BY key ASC', ['summary', 'status', 'customfield_10020']);
  const cards = issues.map((i) => ({
    key: i.key, summary: i.fields.summary || '', status: i.fields.status.name,
    sprint: ((i.fields.customfield_10020 || []).filter(Boolean).pop() || {}).name || '',
    ...(parseCard(i.fields.summary || '') || {}),
  })).filter((c) => c.kind);
  const byBase = new Map(); const byDig = new Map();
  for (const c of cards) {
    (byBase.get(c.base) || byBase.set(c.base, []).get(c.base)).push(c);
    if (c.dig) (byDig.get(c.dig) || byDig.set(c.dig, []).get(c.dig)).push(c);
  }
  const candidates = []; const notReady = []; const noPartner = [];
  for (const qa of cards.filter((c) => (c.kind === 'design' || c.kind === 'exec') && /^to do$/i.test(c.status))) {
    const want = qa.kind === 'design' ? 'ba' : 'dev';
    let partners = (byBase.get(qa.base) || []).filter((c) => c.kind === want);
    let byNumber = false;
    if (!partners.length && qa.dig) { partners = (byDig.get(qa.dig) || []).filter((c) => c.kind === want); byNumber = true; }
    if (!partners.length) { noPartner.push({ key: qa.key, summary: qa.summary }); continue; }
    const p = [...partners].sort((x, y) => Math.abs(keyNo(x.key) - keyNo(qa.key)) - Math.abs(keyNo(y.key) - keyNo(qa.key)))[0];
    const row = {
      key: qa.key, summary: qa.summary, type: qa.kind === 'design' ? 'Test Design' : 'Test Execution', sprint: qa.sprint,
      partnerKey: p.key, partnerSummary: p.summary, partnerStatus: p.status,
      note: [byNumber ? 'matched by DIG number' : '', partners.length > 1 ? `${partners.length} ${want === 'ba' ? 'BA' : 'Dev'} cards; nearest used` : ''].filter(Boolean).join('; '),
    };
    (isDone(p.status) ? candidates : notReady).push(row);
  }
  return { candidates, notReady, noPartner, scanned: issues.length };
}

// Moves the given keys To Do -> Ready for QA, re-checking each is still To Do. Returns [{ key, outcome, moved }].
async function moveToReadyForQa(keys) {
  const http = jira();
  const out = [];
  for (const key of keys) {
    if (!/^SMART-\d+$/.test(key)) { out.push({ key, moved: false, outcome: 'not a SMART key' }); continue; }
    try {
      const { data: issue } = await http.get(`/issue/${key}?fields=status`);
      const status = issue.fields.status.name;
      if (!/^to do$/i.test(status)) { out.push({ key, moved: false, outcome: `skipped — now ${status}` }); continue; }
      const { data: tr } = await http.get(`/issue/${key}/transitions`);
      const t = (tr.transitions || []).find((x) => /^ready for qa$/i.test(x.to.name) || /^ready for qa$/i.test(x.name));
      if (!t) { out.push({ key, moved: false, outcome: 'no "Ready for QA" move available' }); continue; }
      await http.post(`/issue/${key}/transitions`, { transition: { id: t.id } });
      out.push({ key, moved: true, outcome: 'moved to Ready for QA' });
    } catch (e) {
      out.push({ key, moved: false, outcome: `failed — ${e.response ? e.response.status : e.message}` });
    }
  }
  return out;
}

async function emailPreview(result, to) {
  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST || process.env.EMAIL_SMTP_HOST;
  const from = process.env.FROM_EMAIL || process.env.EMAIL_FROM;
  if (!host || !from) { console.log('SMTP not configured — email skipped'); return; }
  const cell = 'padding:4px 8px;border:1px solid #ddd;font-size:12px;';
  const runner = process.env.RUNNER_PUBLIC_URL || 'http://mar-guidewir-9:3000';
  const rows = result.candidates.map((c) => `<tr><td style="${cell}"><a href="https://donegalgroup.atlassian.net/browse/${c.key}">${c.key}</a></td><td style="${cell}">${c.summary}</td><td style="${cell}">${c.type}</td><td style="${cell}">${c.partnerKey} — ${c.partnerStatus}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:900px;">
<h3 style="color:#1F3864;">SMARTCOMM — ${result.candidates.length} QA card(s) ready to move to "Ready for QA"</h3>
<p>These QA cards are still <b>To Do</b> while their BA (Requirements) or Dev card is <b>Done</b>. Nothing has been changed.
To move them, open the Runner (<a href="${runner}">${runner}</a>) → <b>Jira Sprint Report</b> → <b>Find cards</b> → <b>Move selected</b>.</p>
${result.candidates.length ? `<table style="border-collapse:collapse;"><tr style="background:#1F3864;color:#fff;"><th style="${cell}">QA card</th><th style="${cell}">Summary</th><th style="${cell}">Type</th><th style="${cell}">BA / Dev card</th></tr>${rows}</table>` : '<p>No cards to move this week.</p>'}
<p style="color:#666;font-size:12px;">${result.notReady.length} other QA card(s) are waiting on a BA/Dev card that isn't Done; ${result.noPartner.length} have no BA/Dev card.</p></div>`;
  await nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT) || 25, secure: false, tls: { rejectUnauthorized: false } })
    .sendMail({ from, to, subject: `SMARTCOMM: ${result.candidates.length} QA card(s) ready for "Ready for QA" — ${new Date().toLocaleDateString('en-US')}`, html });
  console.log(`Preview emailed to ${to}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf('--email');
  (async () => {
    const r = await findCandidates();
    console.log(`Scanned ${r.scanned} SMART cards: ${r.candidates.length} to move, ${r.notReady.length} waiting on BA/Dev, ${r.noPartner.length} without a BA/Dev card.`);
    for (const c of r.candidates) console.log(`  ${c.key}  ${c.summary}  <- ${c.partnerKey} ${c.partnerStatus}`);
    const out = path.join(__dirname, '..', 'reports', 'jira', 'smart-promote-preview.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...r }, null, 1));
    if (emailIdx >= 0 && args[emailIdx + 1]) await emailPreview(r, args[emailIdx + 1]);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { findCandidates, moveToReadyForQa, parseCard };
