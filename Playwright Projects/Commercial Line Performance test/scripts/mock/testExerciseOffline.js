// Offline test of the CA Refresh dropdown exercise against scripts/mock/caRefreshExerciseMock.html (no WriteBiz needed).
//   node scripts/mock/testExerciseOffline.js
// 1. reproduces the bug: a failed restore post leaves the server on the exercised value while the <select> looks restored;
// 2. proves the fix: exerciseCards + verifyAgainstServer end with every card back on "No Coverage" ON THE SERVER.
const path = require('path');
const { chromium } = require('playwright');
const { exerciseCards } = require('../../helpers/caRefreshAdditional');

const URL = 'file:///' + path.join(__dirname, 'caRefreshExerciseMock.html').replace(/\\/g, '/');
const serverState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fresh = async (fails) => {
    await page.goto(URL);
    await page.evaluate((f) => { localStorage.clear(); localStorage.setItem('fails', String(f)); }, fails);
    await page.goto(URL);
  };

  // ── 1. the bug, done the old way (select, restore, trust the <select>) ──
  await fresh(1);
  const sel = page.locator('#xacc_Card_CollisionGRD select').first();
  await sel.selectOption({ label: 'Blanket Collision' }); await page.waitForTimeout(700);
  await sel.selectOption({ label: 'No Coverage' }); await page.waitForTimeout(700);
  const shown = await sel.evaluate((e) => e.selectedOptions[0].textContent);
  const srv1 = await serverState(page);
  check('bug reproduced: browser shows the restored value', shown === 'No Coverage', `shown=${shown}`);
  check('bug reproduced: server kept the exercised value', srv1.CollisionGRD === 'Blanket Collision', `server=${srv1.CollisionGRD}`);
  await page.click('#tabCoverages'); await page.waitForLoadState('domcontentloaded');
  const after = await page.locator('#xacc_Card_CollisionGRD select').first().evaluate((e) => e.selectedOptions[0].textContent);
  check('bug reproduced: re-render brings the stuck value back', after === 'Blanket Collision', `after re-render=${after}`);

  // ── 2. the fix, with 0, 1 and 2 failed restore posts ──
  for (const fails of [0, 1, 2]) {
    await fresh(fails);
    const pool = [];
    const rerender = async () => { await page.click('#tabCoverages'); await page.waitForLoadState('domcontentloaded'); };
    await exerciseCards(page, pool, 'mock', 14, { rerender });
    const srv = await serverState(page);
    const dom = await page.evaluate(() => [...document.querySelectorAll('[id^="xacc_Card_"] .FieldSpacing:first-of-type select')].map((s) => s.selectedOptions[0].textContent));
    check(`fix (${fails} failed restore post(s)): server back on defaults`, srv.CollisionGRD === 'No Coverage' && srv.GKOTC === 'No Coverage', JSON.stringify(srv));
    check(`fix (${fails} failed restore post(s)): page shows defaults after re-render`, dom.filter((t, i) => i % 1 === 0).every((t) => t === 'No Coverage' || t === 'Nothing selected'), JSON.stringify(dom));
    check(`fix (${fails}): every non-default option was exercised`, pool.length === 3, `${pool.length} option snapshots: ${pool.map((p) => p.context).join(' | ')}`);
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
