// Offline test of opening the Auto Dealers tab against scripts/mock/caRefreshDealerTabMock.html.
//   node scripts/mock/testDealerTabOffline.js
// The tab is an ajax tab: the click returns before the content is there and the "Add New Location" list fills later (WI 11/07 read it
// straight away, saw an empty list, skipped every dealer step). The helper must wait for the location, and report [] when none comes.
const path = require('path');
const { chromium } = require('playwright');
const { openAutoDealersTab, dealerChoices, dealerGridState } = require('../../helpers/caRefreshDealerLocation');

const BASE = 'file:///' + path.join(__dirname, 'caRefreshDealerTabMock.html').replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dismiss = async () => { await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); };
  const open = (opts) => openAutoDealersTab(page, { dismiss, log: () => {}, ...opts });

  await page.goto(BASE);
  check('before the tab is opened the list is empty (the old code read it here)', (await dealerChoices(page)).length === 0);
  let c = await open({ waitMs: 8000 });
  check('ajax tab: waits for the content and the list, returns the location', c.length === 1 && /MAIN ST/.test(c[0].text), JSON.stringify(c));
  check('the tab url reads Auto Dealers', /CLAutoDealers/.test(page.url()));

  await page.goto(`${BASE}?overlay=1`);
  c = await open({ waitMs: 8000 });
  check('status overlay over the tab: click waits it out, location returned', c.length === 1, JSON.stringify(c));

  await page.goto(`${BASE}?already=1`);
  await page.waitForTimeout(2000);
  c = await open({ waitMs: 3000 });
  check('already on the tab with the list filled: no second click needed', c.length === 1, JSON.stringify(c));

  await page.goto(`${BASE}?none=1`);
  c = await open({ waitMs: 2500, tries: 2 });
  check('no location ever offered: returns [] (the flow then fails loudly)', Array.isArray(c) && c.length === 0, JSON.stringify(c));

  await page.goto(`${BASE}?existing=1`);
  const t0 = Date.now();
  c = await open({ waitMs: 20000, tries: 1 });
  const g = await dealerGridState(page);
  check('location already on the grid: returns at once (no 20 s wait) and the grid shows 1 row', c.length === 0 && g.rows === 1 && Date.now() - t0 < 10000, JSON.stringify({ c, g, ms: Date.now() - t0 }));
  await page.goto(`${BASE}?none=1`);
  await open({ waitMs: 1500, tries: 1 });
  check('no location and none offered: the grid says No Locations found, 0 rows', JSON.stringify(await dealerGridState(page)) === JSON.stringify({ empty: true, rows: 0 }));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
