// Re-score a finished CA Refresh run OFFLINE from the page snapshots it saved (runtime-data/ca-refresh/<STATE>-<LOB>/N-<label>.html),
// with the current product-model data and validator - no WriteBiz needed. Coverage presence only (the exercised-dropdown
// snapshots are not saved, so term checks are not redone).
//   node scripts/reEvaluateCaRefresh.js --state PA --lob AUTO_DEALERS [--show missing]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { evaluate, readCards, norm } = require('../helpers/caRefreshValidator');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const state = arg('state'); const lob = arg('lob');
const dir = path.join(__dirname, '..', 'runtime-data', 'ca-refresh', `${state}-${lob}`);

(async () => {
  const files = fs.readdirSync(dir).filter((f) => /^\d+-.*\.html$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort())); // offline: no WriteBiz requests
  const pool = [];
  for (const f of files) {
    const label = f.replace(/^\d+-/, '').replace(/\.html$/, '').replace(/_/g, ' ').trim();
    await page.setContent(`<html><body>${fs.readFileSync(path.join(dir, f), 'utf8')}</body></html>`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const txtFile = path.join(dir, f.replace(/\.html$/, '.txt'));
    const text = fs.existsSync(txtFile) ? fs.readFileSync(txtFile, 'utf8') : '';
    const cards = await readCards(page);
    const gridNames = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr) => { const td = tr.querySelectorAll('td'); return td.length > 3 ? td[2].textContent.replace(/\s+/g, ' ').trim() : ''; }).filter(Boolean)).catch(() => []);
    pool.push({ label, text, norm: norm(text), shot: '', cards, gridNames });
  }
  await browser.close();
  const ev = evaluate(lob, state, pool);
  const count = (st) => ev.results.filter((r) => r.status === st).length;
  console.log(JSON.stringify({ state, lob, pages: pool.length, found: count('FOUND'), missing: count('MISSING'), pcOnly: count('PC_ONLY'), notApplicable: count('NOT_APPLICABLE'), notTested: count('NOT_TESTED') }));
  const show = arg('show');
  if (show) for (const r of ev.results.filter((x) => x.status.toLowerCase() === show.toLowerCase().replace('-', '_'))) console.log(`  ${r.status.padEnd(14)} ${r.name} | ${String(r.page || '').slice(0, 90)}`);
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(ev, null, 1));
})();
