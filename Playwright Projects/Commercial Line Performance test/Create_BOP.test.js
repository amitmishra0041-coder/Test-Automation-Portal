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
  test.setTimeout(1800000);
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
    console.log((status === 'PASSED' ? 'OK' : 'FAIL') + ' ' + name + (duration ? ' (' + duration + 's)' : ''));
    saveTestData();
    currentStepStartTime = new Date();
    waitBudgetMs = 0;
  }

  // ── Modal dismissal with retry loop ──────────────────────────────────────────
  async function dismissStatusModal() {
    try {
      for (let i = 0; i < 5; i++) {
        const modal = page.locator('#dgic-status-message');
        const isVisible = await modal.isVisible().catch(() => false);
        if (!isVisible) return;
        console.log('Status modal visible (attempt ' + (i + 1) + ') - dismissing...');
        const btn = modal.locator('button').first();
        if (await btn.count() > 0) await btn.click({ force: true }).catch(() => {});
        await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch (e) {}
  }

  async function waitForModalsToClose(timeout = 8000) {
    await dismissStatusModal();
    try {
      const otherModals = [
        '.ui-widget-overlay',
        '#gw-click-overlay.gw-disable-click',
        '.gw-click-overlay',
      ];
      for (const selector of otherModals) {
        const modal = page.locator(selector).first();
        const count = await modal.count().catch(() => 0);
        if (count === 0) continue;
        const isVisible = await modal.isVisible().catch(() => false);
        if (isVisible) await modal.waitFor({ state: 'hidden', timeout }).catch(() => {});
      }
    } catch (e) {}
  }

  // ── Safe click helpers with retry loop ────────────────────────────────────────
  async function safeClick(locator, options = {}) {
    await locator.waitFor({ state: 'visible', timeout: 30000 });
    await waitForModalsToClose();
    let clicked = false;
    for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
      try {
        await dismissStatusModal();
        await locator.click({ ...options, timeout: 10000 });
        clicked = true;
      } catch (e) {
        console.log('safeClick attempt ' + attempt + ': ' + e.message.split('\n')[0]);
        await dismissStatusModal();
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) await locator.click({ ...options, force: true });
  }

  async function safeNextClick() {
    const btn = page.getByRole('button', { name: 'Next' });
    await btn.waitFor({ state: 'visible', timeout: 30000 });
    await dismissStatusModal();
    const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false);
    if (isDisabled) {
      await page.waitForFunction(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent.trim().startsWith('Next') && b.classList.contains('btn-primary'));
        return b ? !b.disabled && !b.classList.contains('disabled') : true;
      }, { timeout: 15000 }).catch(() => {});
      await dismissStatusModal();
    }
    let clicked = false;
    for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
      try {
        await dismissStatusModal();
        await btn.click({ timeout: 10000 });
        clicked = true;
      } catch (e) {
        console.log('safeNextClick attempt ' + attempt + ': ' + e.message.split('\n')[0]);
        await dismissStatusModal();
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) await btn.click({ force: true });
  }

  async function safeContinueClick() {
    const btn = page.getByRole('button', { name: 'Continue ' });
    await btn.waitFor({ state: 'visible', timeout: 30000 });
    await dismissStatusModal();
    let clicked = false;
    for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
      try {
        await dismissStatusModal();
        await btn.click({ timeout: 10000 });
        clicked = true;
      } catch (e) {
        console.log('safeContinueClick attempt ' + attempt + ': ' + e.message.split('\n')[0]);
        await dismissStatusModal();
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) await btn.click({ force: true });
  }

  async function clickIfExists(buttonName) {
    try {
      await dismissStatusModal();
      await page.getByRole('button', { name: buttonName }).click({ timeout: 5000 });
      console.log('"' + buttonName + '" clicked');
    } catch (_) {
      console.log('"' + buttonName + '" not present, skipping');
    }
  }

  global.testData.retryCount = testInfo.retry || 0;
  currentStepStartTime = new Date();

  try {
    // ── Account creation ──────────────────────────────────────────────────────
    await createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await dismissStatusModal();

    // ── Select Businessowners (BOP) ───────────────────────────────────────────
    const bopCheckbox = page.locator('#chk_businessowners, label[for="chk_businessowners"]').first();
    await bopCheckbox.waitFor({ state: 'visible', timeout: 15000 });
    await bopCheckbox.click({ force: true });
    console.log('Businessowners checkbox clicked');
    await dismissStatusModal();

    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    trackMilestone('BOP Product Selected');

    // ── Prior carrier ─────────────────────────────────────────────────────────
    const priorCarrierSelect = page.locator('#ddlPriorCarrier');
    await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
    const firstCarrier = await priorCarrierSelect.evaluate(el => {
      const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
      return opt ? opt.value : null;
    });
    if (!firstCarrier) throw new Error('No prior carrier options available');
    await priorCarrierSelect.selectOption(firstCarrier);
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    trackMilestone('Policy Details Entered');

    // ── BOP coverage flow ─────────────────────────────────────────────────────
    await runBopCoverageFlow(page, { testState, trackMilestone, clickIfExists });

    // ── Quote rating loop ─────────────────────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    await dismissStatusModal();

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
      await page.waitForLoadState('domcontentloaded');
      await dismissNotification();
      status = await getStatus();
      console.log('Status: ' + status);
    }

    if (status !== 'Quoted')
      throw new Error('Quote never reached Quoted after ' + attempts + ' attempts. Final: ' + status);

    trackMilestone('Quote Rated Successfully', 'PASSED', 'Quote: ' + quoteNumber);
    global.testData.quoteNumber = quoteNumber;
    saveTestData();

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