// One consolidated CA Refresh email: for every state, the best Business Auto and Auto Dealers result documents found in
// runtime-data/ca-refresh/batch/*/<STATE>-<LOB>.log (latest run that reached rating, else the latest with a document),
// attached, plus a per-state summary table in the body.
//   node scripts/sendCaRefreshConsolidated.js --states PA,AZ,CO --to a@x.com,b@y.com [--dry 1]
// --dry 1 writes the email body to runtime-data/ca-refresh/consolidated-preview.html instead of sending.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const states = (arg('states', '') || '').split(',').filter(Boolean);
const to = (arg('to', process.env.TO_EMAIL || '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dry = arg('dry', '0') === '1';
const LOBS = [['BUSINESS_AUTO', 'Business Auto'], ['AUTO_DEALERS', 'Auto Dealers']];
const batchRoot = path.join(ROOT, 'runtime-data', 'ca-refresh', 'batch');

const runsFor = (state, lob) => fs.readdirSync(batchRoot).sort().map((b) => path.join(batchRoot, b, `${state}-${lob}.log`)).filter((f) => fs.existsSync(f)).map((log) => {
  const t = fs.readFileSync(log, 'utf8');
  const doc = (/CA Refresh result document: (.+\.docx)/.exec(t) || [])[1] || '';
  let v = {}; try { v = JSON.parse((/CA Refresh coverage validation: (\{.*\})/.exec(t) || [])[1] || '{}'); } catch (e) { /* none */ }
  const rated = /OK Quote Rated Successfully/.test(t);
  const err = ((/Test execution failed: ([^\n]+)/.exec(t) || [])[1] || '').trim();
  return { log, doc: doc && fs.existsSync(doc) ? doc : '', v, rated, err };
}).filter((r) => r.doc);

const pick = (state, lob) => { const r = runsFor(state, lob); return r.filter((x) => x.rated).pop() || r.pop() || null; };
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const outcome = (r) => {
  if (!r) return 'No result document';
  if (r.rated) return 'Reached rating';
  return 'Stopped before rating: ' + esc(r.err.replace(/\s*-\s*see C:\\.*$/, '').slice(0, 160));
};

const rows = []; const files = [];
for (const st of states) {
  LOBS.forEach(([lob, name], k) => {
    const r = pick(st, lob);
    if (r) files.push({ filename: path.basename(r.doc), path: r.doc });
    const v = (r && r.v) || {};
    rows.push(`<tr>${k === 0 ? `<td rowspan="2"><b>${st}</b></td>` : ''}<td>${name}</td><td>${outcome(r)}</td><td align="right">${v.found ?? ''}</td><td align="right">${v.missing ?? ''}</td><td align="right">${v.termMismatches ?? ''}</td><td align="right">${v.termsChecked ?? ''}</td><td align="right">${r ? `${v.additionsAdded ?? 0}/${(v.additionsAdded ?? 0) + (v.additionsFailed ?? 0)}` : ''}</td><td>${r ? esc(path.basename(r.doc)) : ''}</td></tr>`);
  });
}
const html = `<p>CA Refresh (ABP-593) results on WriteBiz Test, rating only, for ${states.join(', ')}. The Business Auto and Auto Dealers result documents for each state are attached.</p>
<table border="1" cellpadding="4" style="border-collapse:collapse;font-family:Calibri,Arial;font-size:13px">
<tr style="background:#003a70;color:#fff"><th>State</th><th>Line</th><th>Run</th><th>Found</th><th>Missing</th><th>Term mismatches</th><th>Terms checked</th><th>Additions added</th><th>Document</th></tr>
${rows.join('\n')}</table>
<p style="font-family:Calibri,Arial;font-size:13px"><b>How to read it.</b> <i>Missing</i> = in the product model for that state and line (SBT Update 2025 = Y, WriteBiz Availability For Agents = Y) but not seen on any WriteBiz page the run visited.
For a run that stopped before rating, pages after the stop were not visited, so its Missing count is too high and its term checks are incomplete.
<i>Term mismatches</i> = a term's dropdown options differ from the product model. Each document lists every coverage and term with the page it was found on.</p>`;

// ~1.5-2 MB per document: 22 documents are ~40 MB, over the mail limit. Copy them to the team share and link the folder;
// attach only when the total is small enough.
const shareDir = path.join(arg('share', String.raw`V:\Amit Int\CARefresh\Results`), new Date().toISOString().slice(0, 10));
const totalMb = files.reduce((n, f) => n + fs.statSync(f.path).size, 0) / 1048576;
const attach = totalMb <= 20;
const shareNote = `<p style="font-family:Calibri,Arial;font-size:13px"><b>Documents:</b> ${attach ? 'attached, and also' : `${files.length} documents (${totalMb.toFixed(0)} MB, too large to attach)`} saved in <b>${esc(shareDir)}</b></p>`;

(async () => {
  if (!dry) { fs.mkdirSync(shareDir, { recursive: true }); for (const f of files) fs.copyFileSync(f.path, path.join(shareDir, f.filename)); }
  const body = shareNote + html;
  if (dry || !to.length) {
    const out = path.join(ROOT, 'runtime-data', 'ca-refresh', 'consolidated-preview.html');
    fs.writeFileSync(out, body);
    console.log(`DRY RUN: ${files.length} document(s), ${totalMb.toFixed(1)} MB, attach=${attach}, share=${shareDir}; body -> ${out}`);
    files.forEach((f) => console.log('  ' + f.filename));
    return;
  }
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 25, secure: false, tls: { rejectUnauthorized: false } });
  await t.sendMail({ from: process.env.FROM_EMAIL, to, subject: `CA Refresh results - ${states.join(', ')} (WriteBiz Test, rating only)`, html: body, attachments: attach ? files : [] });
  console.log(`SENT to ${to.join(', ')}: ${attach ? files.length + ' attachment(s)' : 'no attachments'}; documents in ${shareDir}`);
})();
