// Resume a finished CA Refresh run on its EXISTING submission instead of building a new account + submission (~25 of a run's ~40
// minutes): reopen the quote, redo one step (the Auto Dealers tab), and rebuild the Word result document from the previous run's
// saved data + page snapshots + the new snapshots. Used by Create_CA.test.js when CA_RESUME_QUOTE is set (batch: --resume 1).
const fs = require('fs');
const path = require('path');
const { readCards, norm } = require('./caRefreshValidator');

const tagFile = (runtimeDir, state, tag) => path.join(runtimeDir, `test-data-${state}${tag ? '-' + tag : ''}.json`);

// The previous run's saved data (test-data-<state>-<tag>.json: quote, milestones, caRefresh {results, termChecks, additions}) and
// its snapshot folder, checked to be THAT quote's - a newer run of the same state + line replaces both files. A copy of both goes
// to ca-refresh/resume-backup/ first: the run's own start-up rewrites the data file, and a normal run wipes the snapshot folder.
function prepare({ runtimeDir, state, lob, tag, quote }) {
  const file = tagFile(runtimeDir, state, tag);
  let prev;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`RESUME_NO_BASELINE: ${path.basename(file)} is not readable (${e.message.split('\n')[0]})`); }
  if (String(prev.quoteNumber) !== String(quote)) throw new Error(`RESUME_NO_BASELINE: the saved run for ${state} ${lob} is quote ${prev.quoteNumber}, not ${quote} (a newer run replaced it)`);
  if (!prev.caRefresh || !Array.isArray(prev.caRefresh.results)) throw new Error('RESUME_NO_BASELINE: the saved run has no CA Refresh result data');
  const shotDir = path.join(runtimeDir, 'ca-refresh', `${state}-${lob}`);
  if (!fs.existsSync(shotDir) || !fs.readdirSync(shotDir).some((f) => /\.html$/.test(f))) throw new Error(`RESUME_NO_BASELINE: no page snapshots in ${shotDir}`);
  const backup = path.join(runtimeDir, 'ca-refresh', 'resume-backup', `${state}-${lob}-${quote}-${Date.now()}`);
  fs.mkdirSync(backup, { recursive: true });
  fs.cpSync(shotDir, path.join(backup, 'snapshots'), { recursive: true });
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  return { prev, backup, shotDir };
}

// Rebuilds the snapshot pool from the saved folder (N-<label>.html/.txt/.png), like scripts/reEvaluateCaRefresh.js. The file name
// has lost the label's punctuation, so the original label is taken from the previous run's own result rows where one matches.
async function loadPool(context, shotDir, prev) {
  const keyOf = (l) => String(l).replace(/[^A-Za-z0-9]+/g, '_');
  const labels = new Map();
  const add = (l) => { l = String(l || '').trim(); if (l && l.length < 80 && !/not present|PolicyCenter only|added via/i.test(l)) labels.set(keyOf(l), l); };
  const c = prev.caRefresh || {};
  (c.results || []).forEach((r) => add(r.page));
  (c.termChecks || []).forEach((t) => String(t.page || '').split(', ').forEach(add));
  (c.additions || []).forEach((a) => add(a.page));
  const files = fs.readdirSync(shotDir).filter((f) => /^\d+-.*\.html$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const page = await context.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort())); // offline: no WriteBiz requests
  const pool = [];
  try {
    for (const f of files) {
      const base = f.replace(/\.html$/, '');
      const rest = base.replace(/^\d+-/, '');
      await page.setContent(`<html><body>${fs.readFileSync(path.join(shotDir, f), 'utf8')}</body></html>`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const txt = path.join(shotDir, `${base}.txt`);
      const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
      const png = path.join(shotDir, `${base}.png`);
      const cards = await readCards(page);
      const gridNames = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr) => { const td = tr.querySelectorAll('td'); return td.length > 3 ? td[2].textContent.replace(/\s+/g, ' ').trim() : ''; }).filter(Boolean)).catch(() => []);
      pool.push({ label: labels.get(rest) || rest.replace(/_/g, ' ').trim(), text, norm: norm(text), shot: fs.existsSync(png) ? png : '', cards, gridNames, n: parseInt(f, 10), file: base });
    }
  } finally { await page.close().catch(() => {}); }
  return pool;
}

// The term checks of the pages that were NOT redone come from the previous run (their exercised-dropdown snapshots are not saved,
// so re-deriving them from the folder would turn options seen only there into PARTIAL); a term check that involves the redone
// pages comes from the new run and replaces the previous one with the same coverage + term.
function mergeTermChecks(prevTerms, newTerms, redonePage) {
  const key = (t) => `${norm(t.coverage)}|${norm(t.term)}|${t.context || ''}`;
  const fresh = (newTerms || []).filter((t) => redonePage.test(t.page || ''));
  const freshKeys = new Set(fresh.map(key));
  return (prevTerms || []).filter((t) => !freshKeys.has(key(t))).concat(fresh);
}

function termSummary(t) {
  const n = (st) => t.filter((x) => x.status === st).length;
  return { termMismatches: n('MISMATCH'), termsChecked: t.length, termsPartial: n('PARTIAL'), termsSetByStatePip: n('SET_BY_STATE_PIP'), termsNotTested: n('NOT_TESTED'), termsNotApplicable: n('NOT_APPLICABLE'), termsNoModelData: n('NO_MODEL_DATA') };
}

// Login -> search the quote on the landing page -> open its account -> open the quote row. Same screens as accountCreationHelper.
async function openSubmission(page, { writeBizUrl, state, sub, dismiss, log = () => {}, dump = async () => {} }) {
  // same order as createAccountAndQualify: the state's own login, the generic one, then the DE login (most states have no login of their own)
  const own = { u: process.env['WB_USER_' + state], p: process.env['WB_PASS_' + state] };
  const generic = { u: process.env.WB_USER, p: process.env.WB_PASS };
  const creds = (own.u && own.p) ? own : (generic.u && generic.p) ? generic : { u: process.env.WB_USER_DE, p: process.env.WB_PASS_DE };
  const user = creds.u; const pass = creds.p;
  if (!user || !pass) throw new Error(`Missing credentials for ${state}: set WB_USER / WB_PASS or WB_USER_${state} / WB_PASS_${state} in .env`);
  await page.goto(writeBizUrl);
  const u = page.getByRole('textbox', { name: 'User ID:' }).or(page.getByRole('textbox', { name: 'Username' })).first();
  await u.waitFor({ state: 'visible' });
  await u.fill(user);
  await page.getByRole('textbox', { name: 'Password:' }).or(page.getByRole('textbox', { name: 'Password' })).first().fill(pass);
  const legacy = page.locator('#btnLogin');
  if (await legacy.isVisible({ timeout: 2000 }).catch(() => false)) await legacy.click(); else await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForLoadState('domcontentloaded');
  await dismiss();
  await page.locator('#btn_CreateClient').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await dump('landing');
  log('Logged in');
  // landing dashboard: "Quote / Policy Number" box + Search button (seen live 10/29)
  await page.locator('#txtQuoteNumber').fill(sub);
  await page.locator('#btn_Search').click();
  await page.waitForLoadState('domcontentloaded');
  await dismiss();
  await page.waitForTimeout(2000);
  await dump('search-results');
  // results grid: one account row - the row itself is clickable (no link inside)
  const hit = page.locator('#tblClients tbody tr:visible').first().locator('td').first();
  if (await hit.isVisible().catch(() => false)) {
    await hit.click(); await page.waitForLoadState('domcontentloaded'); await dismiss(); await page.waitForTimeout(1500);
    await dump('after-result-click');
  }
  // Client Summary > Pending Account Transactions: the submission row's folder icon ("Open the Quote")
  const open = page.locator(`#tblQuotes tbody tr:has(td:text-is("${sub}")) button[data-action="Open"]`).first();
  if (await open.isVisible().catch(() => false)) { await open.click(); await page.waitForLoadState('domcontentloaded'); await dismiss(); await page.waitForTimeout(2000); }
  await dump('submission-opened');
  if (!await page.getByText(sub).first().isVisible().catch(() => false)) throw new Error(`RESUME_SUBMISSION_NOT_OPENED: submission header ${sub} not shown after search + open`);
  log(`Opened submission ${sub}`);
}

module.exports = { prepare, loadPool, mergeTermChecks, termSummary, openSubmission };
