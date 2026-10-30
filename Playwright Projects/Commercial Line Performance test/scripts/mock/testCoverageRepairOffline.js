// Offline test of the CA Refresh State Specific "Errors" repair against scripts/mock/caRefreshStateMock.html.
//   node scripts/mock/testCoverageRepairOffline.js
// The UM Property Damage Limit is blank on the server (shown blank, or shown filled = "ghost"); after the repair Next must
// land on Vehicles with the limit saved on the server.
process.env.CA_REFRESH = '1';
const path = require('path');
const { chromium } = require('playwright');
const { repairCoverageErrors } = require('../../helpers/caRefreshVehicleRepair');
const { fillBlankRequiredSelects } = require('../../helpers/coverageHelpers');

const BASE = 'file:///' + path.join(__dirname, 'caRefreshStateMock.html').replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dismiss = async () => { await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); };
  const deps = {
    dismiss, log: (m) => console.log('   ' + m),
    fillBlanks: (tag) => fillBlankRequiredSelects(page, tag),
    safeNextClick: async () => { await dismiss(); await page.getByRole('button', { name: 'Next ' }).click({ timeout: 10000 }); },
  };
  for (const [ghost, disabledUmpd] of [[0, 0], [1, 0], [0, 1]]) {
    await page.goto(`${BASE}?p=additional`);
    await page.evaluate(([g, d]) => { localStorage.clear(); localStorage.setItem('ghost', String(g)); localStorage.setItem('disabledUmpd', String(d)); }, [ghost, disabledUmpd]);
    await page.goto(`${BASE}?p=additional`);
    await deps.safeNextClick(); // the flow's own Next that WriteBiz refuses
    const ok = await repairCoverageErrors(page, deps);
    const onVehicles = await page.getByText('Vehicles', { exact: true }).isVisible().catch(() => false);
    const srv = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
    check(`shown-but-blank=${!!ghost}, disabled-until-UM-reposted=${!!disabledUmpd}: Next accepted, on Vehicles`, ok && onVehicles);
    check(`shown-but-blank=${!!ghost}, disabled-until-UM-reposted=${!!disabledUmpd}: limit saved on the server`, !!srv.umpd, JSON.stringify(srv));
  }
  // nothing wrong: returns true straight away
  await page.goto(`${BASE}?p=vehicles`);
  check('no Errors box: returns true', await repairCoverageErrors(page, deps) === true);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
