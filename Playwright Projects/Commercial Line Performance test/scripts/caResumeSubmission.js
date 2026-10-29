// Verify a CA Refresh fix on an EXISTING submission instead of creating a new one (QA's suggestion, saves ~25 min a try):
// login -> search the submission number on the landing page -> Client Summary -> open the submission -> run a step.
//   node scripts/caResumeSubmission.js --sub 3002771093 --state PA --env test --step vehicles [--headed]
// Steps: vehicles = Vehicles tab -> repairVehicleErrors (helpers/caRefreshVehicleRepair.js) -> must land on Drivers.
// Every stage writes a screenshot + body HTML to runtime-data/ca-refresh/resume/<sub>/ so a selector miss can be fixed offline.
require('dotenv').config({ quiet: true });
process.env.CA_REFRESH = '1';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getEnvUrls } = require('../helpers/envConfig');
const { repairVehicleErrors } = require('../helpers/caRefreshVehicleRepair');
const { fillBlankRequiredSelects } = require('../helpers/coverageHelpers');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const sub = arg('sub');
const state = (arg('state', 'PA') || '').toUpperCase();
const env = arg('env', 'test');
const step = arg('step', 'vehicles');
if (!sub) { console.error('--sub <submission number> is required'); process.exit(2); }
const outDir = path.join(__dirname, '..', 'runtime-data', 'ca-refresh', 'resume', sub);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  let n = 0;
  const dump = async (name) => {
    const f = path.join(outDir, `${String(++n).padStart(2, '0')}-${name}`);
    await page.screenshot({ path: f + '.png', fullPage: true }).catch(() => {});
    fs.writeFileSync(f + '.html', await page.content().catch(() => ''));
  };
  const dismiss = async () => {
    await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  try {
    // ── login (same shapes as accountCreationHelper) ──
    const { writeBizUrl } = getEnvUrls(env);
    const user = process.env['WB_USER_' + state] || process.env.WB_USER;
    const pass = process.env['WB_PASS_' + state] || process.env.WB_PASS;
    if (!user || !pass) throw new Error('WB_USER / WB_PASS not set in .env');
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
    console.log('Logged in');

    // ── search the submission on the landing page ──
    // landing dashboard: "Quote / Policy Number" box + Search button (seen live 10/29)
    await page.locator('#txtQuoteNumber').fill(sub);
    await page.locator('#btn_Search').click();
    await page.waitForLoadState('domcontentloaded');
    await dismiss();
    await page.waitForTimeout(2000);
    await dump('search-results');
    // a results row / link with the number, if the search lands on a list first
    // results grid: one account row - open it by its Account Name link (the row itself does not show the quote number)
    const hit = page.locator('#tblClients tbody tr:visible').first().locator('td').first(); // the row is clickable (no link inside)
    if (await hit.isVisible().catch(() => false)) {
      await hit.click(); await page.waitForLoadState('domcontentloaded'); await dismiss(); await page.waitForTimeout(1500);
      await dump('after-result-click');
    }
    // ── client summary -> open the submission ──
    // Client Summary > Pending Account Transactions: the submission row's folder icon ("Open the Quote")
    const open = page.locator(`#tblQuotes tbody tr:has(td:text-is("${sub}")) button[data-action="Open"]`).first();
    if (await open.isVisible().catch(() => false)) { await open.click(); await page.waitForLoadState('domcontentloaded'); await dismiss(); await page.waitForTimeout(2000); }
    await dump('submission-opened');
    if (!await page.getByText(sub).first().isVisible().catch(() => false)) throw new Error('submission header not shown - see the dumps');
    console.log(`Opened submission ${sub}`);

    if (step === 'vehicles') {
      await page.locator('a:visible, li:visible').filter({ hasText: /^\s*Vehicles\s*$/ }).first().click();
      await page.waitForLoadState('domcontentloaded'); await dismiss(); await page.waitForTimeout(1500);
      await dump('vehicles');
      const ok = await repairVehicleErrors(page, {
        dismiss, log: (m) => console.log(m),
        fillBlanks: async (tag) => {
          let total = 0;
          for (let i = 0; i < 3; i++) { await dismiss(); await page.waitForTimeout(1500); const k = await fillBlankRequiredSelects(page, tag); total += k; if (!k) break; }
          return total;
        },
        safeNextClick: async () => { await dismiss(); await page.getByRole('button', { name: 'Next ' }).first().click({ timeout: 15000 }); },
      });
      await dump(ok ? 'after-repair-accepted' : 'after-repair-refused');
      console.log(`RESULT: Vehicles Next ${ok ? 'ACCEPTED' : 'still REFUSED'}; Add Driver visible = ${await page.getByRole('button', { name: /Add Driver/ }).first().isVisible().catch(() => false)}`);
      process.exitCode = ok ? 0 : 1;
    }
  } catch (e) {
    console.log('RESUME FAILED: ' + e.message.split('\n')[0]);
    await dump('failed');
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
