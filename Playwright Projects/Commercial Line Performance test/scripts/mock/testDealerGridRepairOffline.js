// Offline test of the Auto Dealers grid-coverage repair against scripts/mock/caRefreshDealerGridMock.html.
//   node scripts/mock/testDealerGridRepairOffline.js
// "Save Auto Dealers" is refused for the pre-selected "Auto Dealers Personal Injury Protection Endorsement PIP" row (two blank
// required fields in its edit dialog); after the repair the tab must save (land on Vehicles) with both fields set on the server.
const path = require('path');
const { chromium } = require('playwright');
const { repairGridCoverageErrors } = require('../../helpers/caRefreshVehicleRepair');

const BASE = 'file:///' + path.join(__dirname, 'caRefreshDealerGridMock.html').replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dismiss = async () => { await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); };
  const saveTab = async () => { await page.getByRole('button', { name: /Save Auto Dealers/ }).click({ timeout: 10000 }).catch(() => {}); };
  await page.goto(`${BASE}?p=additional`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}?p=additional`);
  await saveTab(); // the flow's own save that WriteBiz refuses
  const ok = await repairGridCoverageErrors(page, { saveTab, dismiss, log: (m) => console.log('   ' + m) });
  const srv = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
  check('Save Auto Dealers accepted after the repair, on Vehicles', ok && /p=vehicles/.test(page.url()));
  check('both PIP endorsement fields saved on the server', !!srv.bi && !!srv.ded, JSON.stringify(srv));
  // DE 10/30 live: Save Auto Dealers passes, the box comes when the Vehicles tab is clicked - leaving = save + Vehicles tab
  await page.goto(`${BASE}?p=additional&on=leave&paged=1`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}?p=additional&on=leave&paged=1`);
  const leave = async () => { await saveTab(); await page.waitForTimeout(500); if (!/p=vehicles/.test(page.url())) await page.getByRole('link', { name: 'Vehicles' }).click({ timeout: 5000 }).catch(() => {}); };
  await leave();
  const ok2 = await repairGridCoverageErrors(page, { saveTab: leave, dismiss, log: (m) => console.log('   ' + m) });
  const srv2 = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
  check('box raised on leaving the tab, row on grid page 2: repaired, on Vehicles', ok2 && /p=vehicles/.test(page.url()));
  check('box raised on leaving the tab: both fields saved', !!srv2.bi && !!srv2.ded, JSON.stringify(srv2));
  // DE Auto Dealers 11/07: an empty box already open must not be taken for the coverage's edit dialog
  await page.goto(`${BASE}?p=additional&stale=1`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}?p=additional&stale=1`);
  await saveTab();
  const ok3 = await repairGridCoverageErrors(page, { saveTab, dismiss, log: (m) => console.log('   ' + m) });
  const srv3 = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
  check('empty box already open: the PIP edit dialog is filled anyway', ok3 && !!srv3.bi && !!srv3.ded, JSON.stringify(srv3));
  // DE Auto Dealers 11/07: a second, fieldless Attention box stays open over the grid and swallows the edit click
  await page.goto(`${BASE}?p=additional&twice=1`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}?p=additional&twice=1`);
  await saveTab();
  const ok4 = await repairGridCoverageErrors(page, { saveTab, dismiss, log: (m) => console.log('   ' + m) });
  const srv4 = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
  check('second Attention box over the grid: closed, PIP dialog filled', ok4 && !!srv4.bi && !!srv4.ded, JSON.stringify(srv4));
  // DE Auto Dealers 11/07: both required PIP fields are DISABLED and blank in the dialog - forced as the last resort
  await page.goto(`${BASE}?p=additional&disabledPip=1`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}?p=additional&disabledPip=1`);
  await saveTab();
  const ok5 = await repairGridCoverageErrors(page, { saveTab, dismiss, log: (m) => console.log('   ' + m) });
  const srv5 = await page.evaluate(() => JSON.parse(localStorage.getItem('srv') || '{}'));
  check('disabled required PIP fields: force-set, saved, on Vehicles', ok5 && !!srv5.bi && !!srv5.ded && /p=vehicles/.test(page.url()), JSON.stringify(srv5));
  await page.goto(`${BASE}?p=vehicles`);
  check('no Errors box: returns true', await repairGridCoverageErrors(page, { saveTab, dismiss, log: () => {} }) === true);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
