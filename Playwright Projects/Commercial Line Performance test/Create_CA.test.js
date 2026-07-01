// Set suite type for email reporter
process.env.TEST_TYPE = 'CA';

const { test, expect } = require('@playwright/test');
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./helpers/coverageHelpers');
const fs   = require('fs');
const path = require('path');

test('CA Submission', async ({ page }, testInfo) => {
  test.setTimeout(1800000);
  page.setDefaultTimeout(60000);

  const envName   = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

  const allowedStates = Object.keys(STATE_CONFIG);
  let testState = String(process.env.TEST_STATE || 'DE').trim().toUpperCase();
  if (!allowedStates.includes(testState)) {
    console.log(`WARNING: TEST_STATE "${testState}" not allowed; defaulting to DE`);
    testState = 'DE';
  }
  const stateConfig = getStateConfig(testState);
  console.log(`Running test for state: ${testState} (${stateConfig.name})`);

  global.testData = {
    state: testState,
    stateName: stateConfig.name,
    milestones: [],
    httpTimings: [],
    networkErrors: [],
    retryCount: testInfo.retry || 0,
    quoteNumber: 'N/A',
    policyNumber: 'N/A',
    coverageChanges: [],
    coverageSectionStats: [],
    addCoverageTimings: []
  };

  const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
  console.log(`Initialized test data for ${testState}`);

  page.on('response', async (response) => {
    try {
      const url    = response.url();
      const status = response.status();
      const timing = response.timing();
      let duration = null;
      if (timing && timing.startTime && timing.responseEnd)
        duration = (timing.responseEnd - timing.startTime) / 1000;
      if (['xhr','fetch'].includes(response.request().resourceType()) || /api|service|rest|json/i.test(url))
        global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
      if (status >= 400)
        global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
    } catch (e) {}
  });

  page.on('requestfailed', request => {
    global.testData.networkErrors.push({ url: request.url(), error: request.failure(), timestamp: new Date().toISOString() });
  });

  let currentStepStartTime = null;
  let waitBudgetMs         = 0;
  let testFailed           = false;

  const originalWaitForTimeout = page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    try {
      if (page.isClosed()) return;
      await originalWaitForTimeout(ms);
      waitBudgetMs += ms;
    } catch (error) {
      if (!page.isClosed()) throw error;
    }
  };

  function saveTestData() {
    try {
      fs.writeFileSync(
        path.join(__dirname, `test-data-${testState}.json`),
        JSON.stringify(global.testData, null, 2)
      );
    } catch (e) { console.log('Could not save test-data.json:', e.message); }
  }

  function trackMilestone(name, status = 'PASSED', details = '') {
    const now = new Date();
    let duration = null;
    if (currentStepStartTime) {
      const elapsed = now - currentStepStartTime - waitBudgetMs;
      duration = (Math.max(elapsed, 0) / 1000).toFixed(2);
    }
    global.testData.milestones.push({ name, status, timestamp: now, details, duration: duration ? `${duration}s` : null });
    console.log(`${status === 'PASSED' ? 'OK' : 'FAIL'} ${name}${duration ? ` (${duration}s)` : ''}`);
    saveTestData();
    currentStepStartTime = new Date();
    waitBudgetMs         = 0;
  }

  async function clickTextItem(text) {
    const gridItem = page.getByRole('gridcell', { name: text }).first();
    if (await gridItem.count() > 0) { await gridItem.click(); return; }
    const fallback = page.locator(`text="${text}"`).first();
    await fallback.waitFor({ state: 'visible', timeout: 10000 });
    await fallback.click({ force: true });
  }

  global.testData.retryCount = testInfo.retry || 0;
  currentStepStartTime       = new Date();

  // ── Modal dismissal with retry loop ──────────────────────────────────────────
  async function dismissStatusModal() {
    try {
      for (let i = 0; i < 5; i++) {
        const modal = page.locator('#dgic-status-message');
        const isVisible = await modal.isVisible().catch(() => false);
        if (!isVisible) return;
        console.log(`Status modal visible (attempt ${i + 1}) - dismissing...`);
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
        '.modal.show:not(#dgic-status-message)',
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
        console.log(`safeClick attempt ${attempt}: ${e.message.split('\n')[0]}`);
        await dismissStatusModal();
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) await locator.click({ ...options, force: true });
  }

  async function safeNextClick() {
    const btn = page.getByRole('button', { name: 'Next ' });
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
        console.log(`safeNextClick attempt ${attempt}: ${e.message.split('\n')[0]}`);
        await dismissStatusModal();
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) await btn.click({ force: true });
  }

  async function waitForVisible(locator, timeout = 5000) {
    return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  }

  async function clickIfExists(buttonName) {
    try {
      await dismissStatusModal();
      await page.getByRole('button', { name: buttonName }).click({ timeout: 5000 });
      console.log(`"${buttonName}" button clicked`);
    } catch {
      console.log(`"${buttonName}" button not present, skipping`);
    }
  }

  try {

    await createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await dismissStatusModal();

    // Select rating state
    const ratingStateSelect = page.locator('#ddl_ratingstates');
    if (await ratingStateSelect.count() > 0 && await ratingStateSelect.isVisible().catch(() => false)) {
      try {
        await ratingStateSelect.selectOption({ value: testState });
        await page.waitForTimeout(1000);
        console.log(`Rating state selected: ${testState}`);
      } catch (e) { console.log(`Could not select rating state: ${e.message}`); }
    }

    // Commercial Auto checkbox
    const autoInput = page.locator('#chk_commercialauto');
    await autoInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await autoInput.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    console.log('Commercial Auto checkbox clicked');

    await dismissStatusModal();
    await page.getByRole('button', { name: 'Next' }).click();

    // Business Auto Coverage Form
    await page.getByText('Product Eligibility', { exact: true }).click().catch(() => {});
    const policySelect = page.locator('#ddlPolicyType').first();
    if (await policySelect.count() > 0) {
      await policySelect.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      try {
        await policySelect.selectOption({ value: 'Business Auto Coverage Form' });
        await page.waitForTimeout(500);
        console.log('Selected Business Auto Coverage Form');
      } catch (e) { console.log('selectOption failed for #ddlPolicyType:', e.message); }
    }

    await dismissStatusModal();
    await page.getByRole('button', { name: 'Yes' }).click();

    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Answer Commercial Auto eligibility questions
    console.log('Answering Commercial Auto eligibility questions...');
    const questionAnchor     = page.locator('text=Are you quoting').first();
    const hasAnchor          = (await questionAnchor.count()) > 0;
    const questionsContainer = hasAnchor
      ? questionAnchor.locator('xpath=ancestor::div[1]')
      : page.locator('body');

    let noToggles = questionsContainer.locator('label.btn:has-text("No"), label[class*="btn"]:has-text("No"), button:has-text("No"), [role="button"]:has-text("No")');
    let noTogglesCount = await noToggles.count();
    if (noTogglesCount === 0) {
      noToggles      = page.locator('label[for$="_No"], label[id^="for_xrdo_"][id$="_No"]');
      noTogglesCount = await noToggles.count();
    }
    console.log(`Found ${noTogglesCount} "No" toggle elements`);

    for (let i = 0; i < Math.min(8, noTogglesCount); i++) {
      try {
        const btn          = noToggles.nth(i);
        const nestedInput  = btn.locator('input[type="radio"]');
        const inputChecked = await nestedInput.isChecked().catch(() => false);
        const ariaPressed  = await btn.getAttribute('aria-pressed').catch(() => null);
        const classAttr    = (await btn.getAttribute('class').catch(() => '')) || '';
        const alreadySelected = inputChecked || ariaPressed === 'true' || /active|selected|on/i.test(classAttr);
        if (!alreadySelected && await btn.isVisible().catch(() => false)) {
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
          await btn.click({ timeout: 5000 });
          console.log(`Clicked No for question ${i + 1}`);
        }
      } catch (e) { console.log(`Could not click No for question ${i + 1}: ${e.message.split('\n')[0]}`); }
    }

    let yesToggles = questionsContainer.locator('label.btn:has-text("Yes"), label[class*="btn"]:has-text("Yes"), button:has-text("Yes"), [role="button"]:has-text("Yes")');
    let yesTogglesCount = await yesToggles.count();
    if (yesTogglesCount === 0) {
      yesToggles      = page.locator('label[for$="_Yes"], label[id^="for_xrdo_"][id$="_Yes"]');
      yesTogglesCount = await yesToggles.count();
    }

    if (yesTogglesCount > 0) {
      try {
        const lastYes      = yesToggles.last();
        const nestedYes    = lastYes.locator('input[type="radio"]');
        const yesChecked   = await nestedYes.isChecked().catch(() => false);
        const ariaPressed  = await lastYes.getAttribute('aria-pressed').catch(() => null);
        const classAttr    = (await lastYes.getAttribute('class').catch(() => '')) || '';
        const alreadySelected = yesChecked || ariaPressed === 'true' || /active|selected|on/i.test(classAttr);
        if (!alreadySelected && await lastYes.isVisible().catch(() => false)) {
          await lastYes.scrollIntoViewIfNeeded({ timeout: 3000 });
          await lastYes.click({ timeout: 5000 });
          console.log('Clicked Yes for certification question');
        }
      } catch (e) { console.log(`Could not click certification Yes: ${e.message.split('\n')[0]}`); }
    }

    await dismissStatusModal();
    await page.getByRole('button', { name: 'Finish ' }).click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    trackMilestone('Commercial Auto Product Eligibility Completed');

    // Prior carrier
    console.log('Waiting for prior carrier dropdown...');
    const priorCarrier = page.locator('#ddlPriorCarrier');
    await priorCarrier.waitFor({ state: 'visible', timeout: 30000 });
    await priorCarrier.selectOption('Progressive');
    await safeNextClick();
    trackMilestone('Policy Details Entered');

    // Capture quote number from header
    try {
      const headerText = (await page.locator('#contentHeader_lblPolicyDetails').textContent().catch(() => '')).trim();
      if (headerText) {
        const headerQuote = headerText.split(':')[0].trim();
        if (headerQuote) {
          global.testData.quoteNumber = headerQuote;
          console.log(`Quote Number (header): ${headerQuote}`);
        }
      }
    } catch (e) { console.log('Could not capture header quote number:', e.message); }

    // CA details page
    await safeNextClick();
    trackMilestone('Commercial Auto - Details');
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Delete Coverage if present
    try {
      const deleteCoverageButton = page.locator('i[title="Delete Coverage"]').first();
      if (await deleteCoverageButton.count() > 0) {
        console.log('Found Delete Coverage button, clicking...');
        await deleteCoverageButton.click({ timeout: 5000 });
        await page.waitForTimeout(500);
      }
    } catch (e) { console.log('No Delete Coverage button found, continuing...'); }

    await safeNextClick();
    trackMilestone('Commercial Auto - Coverage');

    await processAllAddCoverageButtons(page);
    await safeNextClick();
    trackMilestone('Commercial Auto - Additional Coverage');

    await dismissStatusModal();

    // ── Locations page ──────────────────────────────────────────────────────────
    await page.locator('#tblCLAutoLocations button[data-action="edit"]').first().click();
    await dismissStatusModal();
    await page.getByRole('button', { name: 'Verify Address' }).click();

    const statusModalAddr = page.locator('#dgic-status-message');
    if (await statusModalAddr.isVisible().catch(() => false))
      await statusModalAddr.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

    const suggestedModal = page.locator('#dgic-modal-validateaddress_suggestedaddress');
    if (await suggestedModal.isVisible().catch(() => false)) {
      const useSuggestedBtn = page.locator('#ValidateAddress_SuggestedAddress_dialog_btn_1');
      if (await useSuggestedBtn.isVisible().catch(() => false) && await useSuggestedBtn.isEnabled().catch(() => false)) {
        await useSuggestedBtn.click();
        console.log('Clicked Use Suggested');
      }
      await suggestedModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    const closeNoAddressModal = async () => {
      const noAddressModal = page.locator('#dgic-modal-validateaddress_noaddressfound').first();
      if (await noAddressModal.isVisible().catch(() => false)) {
        const okBtn = noAddressModal.locator('button:has-text("Ok"), button:has-text("OK"), #ValidateAddress_NoAddressFound_dialog_btn_0').first();
        if (await okBtn.isVisible().catch(() => false) && await okBtn.isEnabled().catch(() => false)) {
          await okBtn.click({ force: true });
          console.log('Closed no-address-found modal');
        }
        await noAddressModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
    };
    await closeNoAddressModal();
    await dismissStatusModal();

    const locationDialog    = page.locator('[role="dialog"]:has(h5:has-text("Auto Location Address"))').first();
    const locationSaveBtn   = locationDialog.getByRole('button', { name: /^Save$/i }).first();
    const locationCancelBtn = locationDialog.getByRole('button', { name: /^Cancel$/i }).first();

    if (await locationSaveBtn.isVisible().catch(() => false)) {
      await closeNoAddressModal();
      if (await locationSaveBtn.isEnabled().catch(() => false)) {
        await locationSaveBtn.click();
        console.log('Clicked location dialog Save');
      } else if (await locationCancelBtn.isVisible().catch(() => false)) {
        await closeNoAddressModal();
        await locationCancelBtn.click();
        console.log('Save disabled, clicked Cancel');
      }
    }

    const locationModal = page.locator('#dgic-modal-clautolocationaddress');
    if (await locationModal.isVisible().catch(() => false)) {
      const saveBtnById   = page.locator('#CLAutoLocationAddress_dialog_btn_0');
      const cancelBtnById = page.locator('#CLAutoLocationAddress_dialog_btn_1');
      if (await saveBtnById.isVisible().catch(() => false) && await saveBtnById.isEnabled().catch(() => false)) {
        await closeNoAddressModal();
        await saveBtnById.click();
        console.log('Fallback: clicked location Save by id');
      } else if (await cancelBtnById.isVisible().catch(() => false)) {
        await closeNoAddressModal();
        await cancelBtnById.click({ force: true });
        console.log('Fallback: clicked location Cancel by id');
      }
      await locationModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
    await closeNoAddressModal();

    await safeNextClick();
    trackMilestone('Locations page Loaded');

    // ── State specific info ─────────────────────────────────────────────────────
    await safeNextClick();
    trackMilestone('State specific info - Details tab');

    await page.waitForLoadState('domcontentloaded');
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await dismissStatusModal();

    await processCoverageDropdowns(page);
    await safeNextClick();
    trackMilestone('State specific info - Coverages');

    await safeNextClick();
    trackMilestone('State specific info - Additional coverages');

    // ── Vehicles - Private passenger ────────────────────────────────────────────
    await page.locator('#CLAutoVehiclePrefill_dialog_btn_1').click();
    await dismissStatusModal();
    await page.getByRole('combobox', { name: 'Add New Vehicle' }).click();
    await page.locator('#bs-select-2-1').click();
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await page.locator('#bs-select-3-1').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await dismissStatusModal();
    await page.locator('#txt_Vin').fill('1GBJ6C1BX8F416705');
    await page.getByText('Model *').click();
    await page.getByRole('combobox', { name: 'Please select' }).click();
    await page.locator('#bs-select-2-1').click();
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('15555');
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await dismissStatusModal();
    await processCoverageDropdowns(page);
    await safeNextClick();
    await safeClick(page.getByRole('button', { name: 'Save Vehicle ' }));
    trackMilestone('Vehicles Page: Private passenger Vehicle Added');

    // ── Vehicles - Truck ────────────────────────────────────────────────────────
    await page.getByRole('combobox', { name: 'Add New Vehicle' }).click();
    await page.locator('#bs-select-2-3').click();
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await page.locator('#bs-select-3-1').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await dismissStatusModal();
    await page.locator('#txt_Vin').fill('1FDXX46F93EA79961');
    await page.locator('#xrgn_CLAutoVehiclesDetails_LeftColumn').click();
    await page.locator('#xrgn_BusinessUseClass_Trucks_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-3-0').click();
    await page.locator('#xrgn_RadiusClass_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-4-0').click();
    await page.locator('#txt_SecondaryClassCode_Trucks_displayAll > .input-group-text').click();
    await clickTextItem('03 - Truckers - Tow Trucks For-Hire');
    await page.locator('#txt_GrossCombinedWeight').fill('5000');
    await page.getByRole('textbox', { name: 'Description of Permanently' }).fill('test desc');
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('01555');
    await page.getByRole('textbox', { name: 'Stated Amount' }).fill('0');
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await dismissStatusModal();
    await processCoverageDropdowns(page);
    await safeNextClick();
    await safeClick(page.getByRole('button', { name: 'Save Vehicle ' }));
    trackMilestone('Vehicles Page: Truck Vehicle Added');

    // ── Drivers and Symbols ─────────────────────────────────────────────────────
    await safeClick(page.locator('#btnNext_CLAutoVehicles'));
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    await safeClick(page.locator('#btn_CLAutoDrivers_Next'));
    trackMilestone('Drivers Page');
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    await safeClick(page.locator('#btn_CLAutoSymbols_Next'));
    trackMilestone('Symbols Page');

    // ── Quote number capture ────────────────────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
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