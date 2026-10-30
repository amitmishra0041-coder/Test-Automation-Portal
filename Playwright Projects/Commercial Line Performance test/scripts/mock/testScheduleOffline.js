// Offline test of the CA Refresh scheduled-item flow against scripts/mock/caRefreshScheduleMock.html (no WriteBiz needed).
//   node scripts/mock/testScheduleOffline.js
// Drive Other Car - Broadened Coverage For Named Individuals must end with 2 items: Collision, then Other Than Collision,
// whether or not the parent dialog is hidden while it re-renders after an item is saved.
const path = require('path');
const { chromium } = require('playwright');
const { addExpectedFromGrid } = require('../../helpers/caRefreshAdditional');

const BASE = 'file:///' + path.join(__dirname, 'caRefreshScheduleMock.html').replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const hideMs of [0, 1500, 4000]) {
    await page.goto(`${BASE}?hideMs=${hideMs}`);
    const recs = [];
    await addExpectedFromGrid(page, {
      expected: [{ name: 'Drive Other Car Coverage - Broadened Coverage For Named Individuals', category: 'Coverage' }],
      effectiveDate: '08/01/2027', pool: [], record: (e) => recs.push(e), label: 'mock',
    });
    const items = await page.evaluate(() => window.__items);
    const saved = await page.evaluate(() => window.__saved);
    const r = recs[0] || {};
    check(`hide ${hideMs}ms: items are Collision then Other Than Collision`, JSON.stringify(items) === '["Collision","OthThanCollision"]', JSON.stringify(items));
    check(`hide ${hideMs}ms: coverage saved`, saved === true);
    check(`hide ${hideMs}ms: report says ADDED with 2 items`, r.status === 'ADDED' && r.detail === '2 scheduled items added', `${r.status} / ${r.detail}`);
  }
  // one-word grid rows: "Garagekeepers" must match the QA extra "Garagekeepers" (CO 10/29 reported it "not in the grid"),
  // but must NOT be taken for a longer expected name that merely contains the word
  await page.setContent(`<table><tbody>
    <tr><td>Additional Coverages</td><td></td><td>Garagekeepers</td><td>CO</td><td><i class="fa-trash"></i></td></tr>
  </tbody></table>`);
  for (const [name, want] of [['Garagekeepers', 'ALREADY_SELECTED'], ['Garagekeepers Coverage Other Than Collision', undefined]]) {
    const recs = [];
    await addExpectedFromGrid(page, { expected: [{ name, category: 'Coverage' }], effectiveDate: '08/01/2027', pool: [], record: (e) => recs.push(e), label: 'mock grid' });
    check(`one-word row vs expected "${name}"`, (recs[0] || {}).status === want, JSON.stringify(recs[0] || null));
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
