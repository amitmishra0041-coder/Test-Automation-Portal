// Set suite type for email reporter (matches Package/CA pattern)
process.env.TEST_TYPE = 'BOP';

const { test, expect } = require('@playwright/test');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const { runBopCoverageFlow } = require('./helpers/bopCoverageHelper');
const fs   = require('fs');
const path = require('path');

test('BOP Submission', async ({ page }, testInfo) => {
  test.setTimeout(1200000);
  page.setDefaultTimeout(60000);

  const envName   = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

  const allowedStates = Object.keys(STATE_CONFIG);
  let testState = String(process.env.TEST_STATE || 'DE').trim().toUpperCase();
  if (!allowedStates.includes(testState)) {
    console.log('TEST_STATE "' + testState + '" not allowed; defaulting to DE');
    testState = 'DE';
  }
  const stateConfig = getStateConfig(testState);
  console.log('Running BOP test for state: ' + testState + ' (' + stateConfig.name + ')');

  // ── Initialize testData (same structure as Package/CA) ────────────────────
  global.testData = {
    state: testState,
    stateName: stateConfig.name,
    milestones: [],
    httpTimings: [],
    networkErrors: [],
    coverageChanges: [],
    coverageSectionStats: [],
    addCoverageTimings: [],
    retryCount: testInfo.retry || 0,
    quoteNumber: 'N/A',
    policyNumber: 'N/A',
  };

  const testDataFile = path.join(__dirname, 'test-data-' + testState + '.json');
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));

  // ── HTTP tracking ─────────────────────────────────────────────────────────
  page.on('response', async (response) => {
    try {
      const url    = response.url();
      const status = response.status();
      const timing = response.timing();
      let duration = null;
      if (timing && timing.startTime && timing.responseEnd)
        duration = (timing.responseEnd - timing.startTime) / 1000;
      if (/xhr|fetch/i.test(response.request().resourceType()) || /api|service|json/i.test(url))
        global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
      if (status >= 400)
        global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
    } catch (_) {}
  });

  page.on('requestfailed', req => {
    global.testData.networkErrors.push({ url: req.url(), error: req.failure(), timestamp: new Date().toISOString() });
  });

  let currentStepStartTime = new Date();
  let waitBudgetMs = 0;

  const origWait = page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    try { if (page.isClosed()) return; await origWait(ms); waitBudgetMs += ms; } catch (e) { if (!page.isClosed()) throw e; }
  };

  function saveTestData() {
    try { fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2)); } catch (_) {}
  }

  function trackMilestone(name, status = 'PASSED', details = '') {
    const now = new Date();
    let duration = null;
    if (currentStepStartTime) {
      const elapsed = now - currentStepStartTime - waitBudgetMs;
      duration = (Math.max(elapsed, 0) / 1000).toFixed(2);
    }
    global.testData.milestones.push({ name, status, timestamp: now, details, duration: duration ? duration + 's' : null });
    console.log((status === 'PASSED' ? '\u2705' : '\u274c') + ' ' + name + (duration ? ' (' + duration + 's)' : ''));
    saveTestData();
    currentStepStartTime = new Date();
    waitBudgetMs = 0;
  }

  async function clickIfExists(buttonName) {
    try {
      await page.getByRole('button', { name: buttonName }).click({ timeout: 5000 });
      console.log('"' + buttonName + '" clicked');
    } catch (_) {
      console.log('"' + buttonName + '" not present, skipping');
    }
  }

  global.testData.retryCount = testInfo.retry || 0;
  currentStepStartTime = new Date();

  try {
    // ── Account creation (shared with Package/CA) ─────────────────────────
    await createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // ── Select Businessowners (BOP) ────────────────────────────────────────
    const bopCheckbox = page.locator('#chk_businessowners, label[for="chk_businessowners"]').first();
    await bopCheckbox.waitFor({ state: 'visible', timeout: 15000 });
    await bopCheckbox.click({ force: true });
    console.log('Businessowners checkbox clicked');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    trackMilestone('BOP Product Selected');

    // ── Prior carrier ──────────────────────────────────────────────────────
    const priorCarrierSelect = page.locator('#ddlPriorCarrier');
    await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
    const firstCarrier = await priorCarrierSelect.evaluate(el => {
      const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
      return opt ? opt.value : null;
    });
    if (!firstCarrier) throw new Error('No prior carrier options available');
    await priorCarrierSelect.selectOption(firstCarrier);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForLoadState('domcontentloaded');
    trackMilestone('Policy Details Entered');

    // ── BOP-specific coverage flow ─────────────────────────────────────────
    await runBopCoverageFlow(page, { testState, trackMilestone, clickIfExists });

    // ── Quote rating loop ──────────────────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);

    const quoteNumberEl = page.locator('#tblQuotes tbody tr').first().locator('td').nth(3);
    await quoteNumberEl.waitFor({ state: 'visible', timeout: 30000 });
    const quoteNumber = (await quoteNumberEl.innerText()).trim();
    console.log('Quote Number: ' + quoteNumber);

    async function dismissNotification() {
      try {
        const btn = page.locator('button.wb-bell-btn-ack');
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          await btn.waitFor({ state: 'hidden', timeout: 3000 });
        }
      } catch (_) {}
    }

    async function getStatus() {
      try {
        await dismissNotification();
        const row = page.locator('#tblQuotes tbody tr:has-text("' + quoteNumber + '")');
        await row.waitFor({ state: 'visible', timeout: 5000 });
        return (await row.locator('td').nth(11).innerText({ timeout: 5000 })).trim();
      } catch (_) { return 'Quote Requested'; }
    }

    let status = await getStatus();
    let attempts = 0;
    while (status === 'Quote Requested' && attempts < 50) {
      attempts++;
      console.log('Attempt ' + attempts + '/50: waiting 10s...');
      await page.waitForTimeout(10000);
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      await dismissNotification();
      status = await getStatus();
      console.log('Status: ' + status);
    }

    if (status !== 'Quoted')
      throw new Error('Quote never reached Quoted after ' + attempts + ' attempts. Final: ' + status);

    trackMilestone('Quote Rated Successfully', 'PASSED', 'Quote: ' + quoteNumber);
    global.testData.quoteNumber = quoteNumber;
    saveTestData();

    // ── Policy submission ──────────────────────────────────────────────────
    const policyNumber = await submitPolicyForApproval(page, quoteNumber, { policyCenterUrl, trackMilestone });
    global.testData.policyNumber = policyNumber;
    global.testData.status = 'PASSED';
    saveTestData();
    console.log('BOP test completed. Policy: ' + policyNumber);

  } catch (error) {
    console.error('Test failed: ' + error.message);
    try {
      const pageText = await page.locator('body').textContent({ timeout: 2000 });
      const match = pageText.match(/\b(\d{10})\b/);
      if (match) global.testData.quoteNumber = match[1];
    } catch (_) {}
    global.testData.status = 'FAILED';
    global.testData.error  = error.message;
    saveTestData();
    throw error;
  }
});
