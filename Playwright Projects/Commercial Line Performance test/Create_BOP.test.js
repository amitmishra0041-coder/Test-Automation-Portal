// Set suite type for email reporter (matches Package/CA pattern)
process.env.TEST_TYPE = 'BOP';

const { test, expect } = require('@playwright/test');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const { runBopCoverageFlow } = require('./helpers/bopCoverageHelper');
const fs = require('fs');
const path = require('path');

// Runtime-generated test-data JSON lives in its own subfolder to keep the
// project root uncluttered (matches emailReporter.js's RUNTIME_DIR).
const RUNTIME_DIR = path.join(__dirname, 'runtime-data');
fs.mkdirSync(RUNTIME_DIR, { recursive: true });

test('BOP Submission', async ({ page }, testInfo) => {
  test.setTimeout(1800000);
  page.setDefaultTimeout(60000);

  const envName = process.env.TEST_ENV || 'qa';
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

  const testDataFile = path.join(RUNTIME_DIR, 'test-data-' + testState + '.json');
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));

  page.on('response', async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      const timing = response.timing();
      let duration = null;
      if (timing && timing.startTime && timing.responseEnd)
        duration = (timing.responseEnd - timing.startTime) / 1000;
      if (/xhr|fetch/i.test(response.request().resourceType()) || /api|service|json|ajinvoke/i.test(url))
        global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
      if (status >= 400)
        global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
    } catch (_) { }
  });

  page.on('requestfailed', req => {
    global.testData.networkErrors.push({ url: req.url(), error: req.failure(), timestamp: new Date().toISOString() });
  });

  let currentStepStartTime = new Date();
  let waitBudgetMs = 0;
  let testFailed = false;

  const origWait = page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    try { if (page.isClosed()) return; await origWait(ms); waitBudgetMs += ms; } catch (e) { if (!page.isClosed()) throw e; }
  };

  function saveTestData() {
    try { fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2)); } catch (_) { }
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
        if (await btn.count() > 0) await btn.click({ force: true }).catch(() => { });
        await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
        await page.waitForTimeout(300);
      }
    } catch (e) { }
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
        if (isVisible) await modal.waitFor({ state: 'hidden', timeout }).catch(() => { });
      }
    } catch (e) { }
  }

  // Several silent, hard-to-diagnose failures traced back to a navigation
  // button (Save Building/Classification, Next, Continue) simply never
  // appearing - the bare TimeoutError gave no clue whether the page was
  // stuck on an earlier screen, showing an unhandled validation error, or
  // something else entirely. Dump what's actually on screen before failing
  // so the next occurrence is a fact, not a guess.
  async function dumpNavFailureDiagnostic(label) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      heading: (document.querySelector('h1, h2, .gw-title, [role="heading"]')?.textContent || '').trim().slice(0, 200),
      visibleButtons: [...document.querySelectorAll('button')]
        .filter(el => el.offsetParent !== null)
        .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 15),
      visibleErrors: [...document.querySelectorAll('[class*="error" i], [class*="alert" i], [class*="danger" i]')]
        .filter(el => el.offsetParent !== null)
        .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 5),
    })).catch(() => ({}));
    console.log(label + ': button not visible after 30s - page diagnostic: ' + JSON.stringify(diag));
  }

  // ── Safe click helpers with retry loop ────────────────────────────────────────
  async function safeClick(locator, options = {}) {
    const locVisible = await locator.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    if (!locVisible) {
      await dumpNavFailureDiagnostic('safeClick');
      await locator.waitFor({ state: 'visible', timeout: 1000 });
    }
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
    const nextVisible = await btn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    if (!nextVisible) {
      await dumpNavFailureDiagnostic('safeNextClick');
      await btn.waitFor({ state: 'visible', timeout: 1000 });
    }
    await dismissStatusModal();
    const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false);
    if (isDisabled) {
      await page.waitForFunction(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent.trim().startsWith('Next') && b.classList.contains('btn-primary'));
        return b ? !b.disabled && !b.classList.contains('disabled') : true;
      }, { timeout: 15000 }).catch(() => { });
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
    let btn = page.getByRole('button', { name: 'Continue ' });
    let continueVisible = await btn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!continueVisible) {
      // Confirmed live on CP: some screens in this wizard label their
      // "proceed" button "Next" instead of "Continue " (e.g. the Mortgagees
      // screen) - try that before giving up and dumping a diagnostic.
      const nextBtn = page.getByRole('button', { name: 'Next ' });
      const nextVisible = await nextBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (nextVisible) {
        console.log('safeContinueClick: "Continue " not found, using "Next " instead');
        btn = nextBtn;
        continueVisible = true;
      }
    }
    if (!continueVisible) {
      await dumpNavFailureDiagnostic('safeContinueClick');
      await btn.waitFor({ state: 'visible', timeout: 1000 });
    }
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
      const btn = page.getByRole('button', { name: buttonName });
      // Fast presence probe instead of relying on click()'s full 5s
      // actionability timeout to detect "not present".
      const visible = await btn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
      if (!visible) { console.log('"' + buttonName + '" not present, skipping'); return; }
      await btn.click({ timeout: 3000 });
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
    // Shrunk from 3000ms - bopCheckbox.waitFor() below already polls up to 15s.
    await page.waitForTimeout(500);
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


    // ── BOP Product Eligibility Questions ────────────────────────────────────────
    // Q1: "Has the applicant had any Property or General Liability losses..." = No
    // Q2: "Does the applicant do cremations for other funeral homes?" = No  
    // Q3: "To the best of my knowledge..." = Yes
    // Pattern: click by question text → find the Yes/No label after it

    async function clickYesNoByQuestion(questionSnippet, answer) {
      const label = page.locator(
        `xpath=//*[contains(normalize-space(.), ${JSON.stringify(questionSnippet)})]` +
        `/following::label[contains(@class,"btn") and normalize-space(text())=${JSON.stringify(answer)}][1]`
      ).first();
      if (await label.count() > 0 && await label.isVisible().catch(() => false)) {
        await label.click({ force: true, timeout: 5000 }).catch(() => { });
        console.log(`"${questionSnippet.substring(0, 40)}..." = ${answer}`);
      } else {
        console.log(`WARNING: could not find toggle for "${questionSnippet.substring(0, 40)}..."`);
      }
    }

    await clickYesNoByQuestion('Property or General Liability losses', 'No');
    await clickYesNoByQuestion('cremations for other funeral homes', 'No');
    await clickYesNoByQuestion('best of my knowledge', 'Yes');


    await page.getByRole('button', { name: 'Finish' }).click();


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
    await runBopCoverageFlow(page, { testState, trackMilestone, clickIfExists, dismissStatusModal, safeNextClick, safeContinueClick, safeClick });

    // ── Quote rating loop ─────────────────────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
    // Shrunk from 4000ms - the lblQuoteNumValue wait below already polls up to 15s.
    await page.waitForTimeout(500);
    await dismissStatusModal();

    await page.locator('#lblQuoteNumValue').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.log('Quote number element not found');
    });

    let quoteNumber = 'N/A';
    try {
      const primaryText = await page.locator('#lblQuoteNumValue').textContent({ timeout: 5000 }).catch(() => null);
      if (primaryText?.trim()) {
        quoteNumber = primaryText.trim();
        console.log('Quote Number:', quoteNumber);
      } else {
        const fallbackSelectors = ['#contentHeader_lblPolicyDetails', 'text=/Quote\\s*#\\s*:\\s*\\d+/'];
        for (const selector of fallbackSelectors) {
          const text = await page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
          if (text?.trim()) {
            const match = text.match(/(\d+)/);
            if (match) { quoteNumber = match[1]; console.log('Quote Number (fallback):', quoteNumber); break; }
          }
        }
      }
    } catch (e) { console.log('Error capturing quote number:', e.message); }

    trackMilestone('Quote Rated Successfully', 'PASSED', `Quote #: ${quoteNumber}`);
    global.testData.quoteNumber = quoteNumber;
    saveTestData();

    console.log('Starting policy submission workflow...');
    const policyNumber = await submitPolicyForApproval(page, quoteNumber, { policyCenterUrl, trackMilestone });

    global.testData.policyNumber = policyNumber;
    global.testData.status = 'PASSED';
    saveTestData();
    console.log('Test completed successfully. Policy:', policyNumber);

  } catch (error) {
    testFailed = true;
    console.error('Test execution failed:', error.message);
    console.error('Stack:', error.stack);

    try {
      const pageText = await page.locator('body').textContent({ timeout: 2000 }).catch(() => '');
      const match    = pageText.match(/\b(\d{10})\b/);
      if (match) { global.testData.quoteNumber = match[1]; console.log(`Extracted number: ${match[1]}`); }
    } catch {}

    global.testData.status = 'FAILED';
    global.testData.error  = error.message;
    saveTestData();
    console.log(`Test data written with failure info`);
    throw error;
  }
});