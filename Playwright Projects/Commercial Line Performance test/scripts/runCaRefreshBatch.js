// CA Refresh batch: runs every state x line of business one after another (one shared login on Test - never in parallel),
// keeps a summary file, and emails the Word result documents of each state as soon as that state is done.
//   node scripts/runCaRefreshBatch.js --states PA,TX --lobs BUSINESS_AUTO,AUTO_DEALERS --env test --until RATING --email 1
// Quiet by design: one line per finished run in runtime-data/ca-refresh/batch/<stamp>/summary.txt (read it once at the end).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const DATA = require(path.join(ROOT, 'helpers', 'caRefreshData.json'));
const states = (arg('states', DATA.states.join(',')) || '').split(',').filter(Boolean);
const lobs = (arg('lobs', 'BUSINESS_AUTO,AUTO_DEALERS')).split(',').filter(Boolean);
const env = arg('env', 'test');
const until = arg('until', 'RATING'); // RATING | ISSUANCE
const sendEmail = arg('email', '1') !== '0';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(ROOT, 'runtime-data', 'ca-refresh', 'batch', stamp);
fs.mkdirSync(outDir, { recursive: true });
const summaryFile = path.join(outDir, 'summary.txt');
const say = (s) => { fs.appendFileSync(summaryFile, s + '\n'); };

const runOne = (state, lob) => new Promise((resolve) => {
  const log = path.join(outDir, `${state}-${lob}.log`);
  const out = fs.openSync(log, 'w');
  const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', 'Create_CA.test.js', '--project=chromium', '--retries=0', '--output=test-results-qa'], {
    cwd: ROOT, shell: process.platform === 'win32', stdio: ['ignore', out, out],
    env: { ...process.env, TEST_ENV: env, TEST_STATE: state, CA_REFRESH: '1', CA_REFRESH_LOB: lob, TEST_DATA_TAG: `CARefresh-${lob}`, CA_REFRESH_STOP_AT: until === 'RATING' ? 'RATING' : '' },
  });
  const killer = setTimeout(() => { try { process.platform === 'win32' ? spawn('taskkill', ['/PID', String(p.pid), '/T', '/F']) : p.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 60 * 60 * 1000);
  p.on('close', () => {
    clearTimeout(killer);
    const text = fs.readFileSync(log, 'utf8');
    const doc = (/CA Refresh result document: (.+\.docx)/.exec(text) || [])[1] || '';
    const val = (/CA Refresh coverage validation: (\{.*\})/.exec(text) || [])[1] || '';
    const failed = /^\s+1 failed/m.test(text);
    const err = (/Test execution failed: ([^\n]{0,200})/.exec(text) || [])[1] || '';
    resolve({ state, lob, doc, validation: val, status: failed ? 'FAIL' : 'PASS', err, log });
  });
});

const mail = async (state, results) => {
  if (!sendEmail || !process.env.SMTP_HOST || !process.env.TO_EMAIL) return;
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 25, secure: false, tls: { rejectUnauthorized: false } });
  const rows = results.map((r) => {
    let v = {}; try { v = JSON.parse(r.validation || '{}'); } catch (e) { /* none */ }
    return `<tr><td>${r.lob.replace('_', ' ')}</td><td>${r.status}</td><td>${v.found ?? ''}</td><td>${v.missing ?? ''}</td><td>${v.termMismatches ?? ''}</td><td>${v.additionsAdded ?? ''}/${(v.additionsAdded ?? 0) + (v.additionsFailed ?? 0)}</td><td>${(r.err || '').replace(/</g, '&lt;').slice(0, 160)}</td></tr>`;
  }).join('');
  await t.sendMail({
    from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL,
    subject: `CA Refresh ${state} (${env.toUpperCase()}, until ${until.toLowerCase()}): ${results.map((r) => `${r.lob === 'AUTO_DEALERS' ? 'AD' : 'BA'} ${r.status}`).join(', ')}`,
    html: `<p>CA Refresh result documents for <b>${state}</b> are attached.</p><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Line</th><th>Run</th><th>Found</th><th>Missing</th><th>Term mismatches</th><th>Additions added</th><th>Note</th></tr>${rows}</table>`,
    attachments: results.filter((r) => r.doc && fs.existsSync(r.doc)).map((r) => ({ filename: path.basename(r.doc), path: r.doc })),
  }).then(() => say(`  emailed ${state}`)).catch((e) => say(`  email for ${state} failed: ${e.message}`));
};

(async () => {
  say(`batch ${stamp}: states=${states.join(',')} lobs=${lobs.join(',')} env=${env} until=${until}`);
  for (const state of states) {
    const results = [];
    for (const lob of lobs) {
      const r = await runOne(state, lob);
      results.push(r);
      say(`${state} ${lob}: ${r.status} | doc=${path.basename(r.doc || '-')} | ${r.validation} ${r.err ? '| ' + r.err : ''}`);
    }
    await mail(state, results);
  }
  say('BATCH DONE');
})();
