// Offline test of the CA Refresh Vehicles "Errors" repair against scripts/mock/caRefreshVehicleMock.html (no WriteBiz needed).
//   node scripts/mock/testVehicleRepairOffline.js
// Vehicles 2 (Deductible Type blank) and 3 (Losses Covered blank) block Next; the repair must fix both and reach Drivers,
// with a slow Edit link (0 / 3 / 8 s) and with a lost first post (browser shows the value, server keeps it blank).
process.env.CA_REFRESH = '1';
const path = require('path');
const { chromium } = require('playwright');
const { repairVehicleErrors } = require('../../helpers/caRefreshVehicleRepair');
const { fillBlankRequiredSelects } = require('../../helpers/coverageHelpers');

const BASE = 'file:///' + path.join(__dirname, 'caRefreshVehicleMock.html').replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dismiss = async () => { await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); };
  const deps = {
    dismiss,
    log: (m) => console.log('   ' + m),
    fillBlanks: (tag) => fillBlankRequiredSelects(page, tag),
    safeNextClick: async () => { await dismiss(); await page.getByRole('button', { name: 'Next ' }).click({ timeout: 10000 }); },
  };
  for (const [editDelay, dropFirst] of [[0, 0], [3000, 0], [8000, 0], [3000, 1]]) {
    await page.goto(`${BASE}?p=summary&editDelay=${editDelay}`);
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('dropFirst', String(d)); }, dropFirst);
    await page.goto(`${BASE}?p=summary&editDelay=${editDelay}`);
    const ok = await repairVehicleErrors(page, deps);
    const onDrivers = await page.getByText('Drivers', { exact: true }).isVisible().catch(() => false);
    const srv = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
    const complete = Object.values(srv).every((x) => x.losses && x.ded);
    check(`edit ${editDelay}ms, lost first post=${!!dropFirst}: Next accepted, on Drivers`, ok && onDrivers);
    check(`edit ${editDelay}ms, lost first post=${!!dropFirst}: every vehicle complete on the server`, complete, JSON.stringify(srv));
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
