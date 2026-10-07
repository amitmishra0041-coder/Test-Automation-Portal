// Set suite type for email reporter
process.env.TEST_TYPE = 'CA';

const { test, expect } = require('@playwright/test');
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify, isTrainingUrl, TRAINING_LICENSED_STATES } = require('./accountCreationHelper');
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./helpers/coverageHelpers');
const fs   = require('fs');
const path = require('path');

// Runtime-generated test-data JSON lives in its own subfolder to keep the
// project root uncluttered (matches emailReporter.js's RUNTIME_DIR).
const RUNTIME_DIR = path.join(__dirname, 'runtime-data');
fs.mkdirSync(RUNTIME_DIR, { recursive: true });

test('CA Submission', async ({ page }, testInfo) => {
  test.setTimeout(1800000);
  page.setDefaultTimeout(60000);

  const envName   = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);
  // Confirmed live: getEnvUrls() previously fell through to qa silently
  // whenever the requested env's casing didn't match ENV_URLS' own key
  // casing (e.g. TEST_ENV=Training vs the declared key "Training") - every
  // run looked like it was hitting the requested env but wasn't. Logging
  // the resolved URL makes that class of mismatch visible immediately
  // instead of silently testing the wrong environment.
  console.log(`Resolved environment "${envName}" -> writeBizUrl=${writeBizUrl}`);

  const allowedStates = Object.keys(STATE_CONFIG);
  let testState = String(process.env.TEST_STATE || 'DE').trim().toUpperCase();
  if (!allowedStates.includes(testState)) {
    console.log(`WARNING: TEST_STATE "${testState}" not allowed; defaulting to DE`);
    testState = 'DE';
  }
  const stateConfig = getStateConfig(testState);
  console.log(`Running test for state: ${testState} (${stateConfig.name})`);

  // Per user direction: on Training the only confirmed-working producer
  // (Linda D. Strause, agency 0000988) is licensed in a specific state
  // list. Running an unlicensed state there fails submission creation
  // (see accountCreationHelper.js's getAgencyConfig) - skip cleanly rather
  // than burning a full run on a state that can never succeed.
  test.skip(isTrainingUrl(writeBizUrl) && !TRAINING_LICENSED_STATES.includes(testState),
    `Skipping ${testState} on Training - producer Linda D. Strause is only licensed in: ${TRAINING_LICENSED_STATES.join(', ')}`);

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

  const testDataFile = path.join(RUNTIME_DIR, `test-data-${testState}.json`);
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
      if (['xhr','fetch'].includes(response.request().resourceType()) || /api|service|rest|json|ajinvoke/i.test(url))
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
        path.join(RUNTIME_DIR, `test-data-${testState}.json`),
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

  // Bootstrap-select dropdown OPTION menus (e.g. #bs-select-2-1) were being
  // clicked directly with zero visibility wait throughout the Vehicles
  // section - any transient render delay hung the full 60s actionTimeout
  // with no diagnostic. Wait for the option first, and log clearly if it
  // never appears instead of silently eating the whole timeout.
  async function clickBsSelect(id, label) {
    const opt = page.locator('#' + id);
    const visible = await opt.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (visible) {
      await opt.click();
    } else {
      await dumpNavFailureDiagnostic((label || id) + ' (bs-select option #' + id + ')');
      await opt.click().catch(e => console.log((label || id) + ': click failed - ' + e.message.split('\n')[0]));
    }
  }

  // Generic wait-then-click-with-diagnostic used for first-action-after-
  // page-transition clicks (comboboxes, edit buttons) that previously fired
  // as raw .click() calls with no visibility guard.
  async function waitAndClick(locator, label, timeout = 15000) {
    const visible = await locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
    if (visible) {
      await locator.click();
    } else {
      await dumpNavFailureDiagnostic(label);
      await locator.click().catch(e => console.log(`${label}: click failed - ${e.message.split('\n')[0]}`));
    }
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

  // Mirrors the same diagnostic added to Create_Package.test.js/
  // Create_BOP.test.js after several silent, hard-to-diagnose failures
  // traced back to a button simply never appearing. Dumps what's actually
  // on screen instead of leaving a bare TimeoutError with no clue whether
  // the page is stuck on an earlier screen, showing an unhandled validation
  // error, or something else entirely.
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
    console.log(`${label}: element not visible - page diagnostic: ${JSON.stringify(diag)}`);
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
      const btn = page.getByRole('button', { name: buttonName });
      // Fast presence probe instead of relying on click()'s full 5s
      // actionability timeout to detect "not present" - these are called in
      // runs of 3-5 mutually-exclusive optional buttons, so a miss here used
      // to cost a guaranteed 5s each.
      const visible = await btn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
      if (!visible) { console.log(`"${buttonName}" button not present, skipping`); return; }
      await btn.click({ timeout: 3000 });
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
    // Confirmed live on Training via a standalone diagnostic: selecting the
    // rating state triggers a "Reloading products.." status modal
    // (#dgic-status-message) that can take up to (and sometimes past) 60s to
    // clear - far longer than dismissStatusModal()'s own ~25s ceiling. A
    // force click fired while that modal still covers the checkbox lands ON
    // THE MODAL, not the input (verified via elementFromPoint), and never
    // actually checks the box - confirmed both a force click AND a plain
    // click on the box's own <label> silently failed for this reason, while
    // a raw coordinate click thrown right after the modal finally cleared
    // succeeded immediately. Wait the modal out properly, then click and
    // verify the box actually got checked rather than trusting the click.
    const autoInput = page.locator('#chk_commercialauto');
    await autoInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
    await dismissStatusModal();

    let autoChecked = await autoInput.isChecked().catch(() => false);
    for (let attempt = 0; attempt < 3 && !autoChecked; attempt++) {
      await autoInput.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      autoChecked = await autoInput.isChecked().catch(() => false);
    }
    if (!autoChecked) {
      console.log('WARNING: Commercial Auto checkbox did not report checked after retries - product eligibility validation may block Next');
    }
    console.log('Commercial Auto checkbox clicked, checked =', autoChecked);

    await dismissStatusModal();
    await safeClick(page.getByRole('button', { name: 'Next' }));

    // Business Auto Coverage Form
    // Was an instant count()>0 check - same bug class as the BOP Structure
    // Building panel and the Delete Coverage button below: if the page
    // hadn't rendered #ddlPolicyType at that exact millisecond (confirmed
    // live on Training/DE - the page transition can be slower than usual),
    // this read 0 and silently skipped selecting "Business Auto Coverage
    // Form" entirely, leaving the flow one screen behind and making the
    // very next step (the "Yes" button) hang for the full 30s timeout with
    // no clue why. Give it a real wait before deciding it's genuinely absent.
    await page.getByText('Product Eligibility', { exact: true }).click().catch(() => {});
    const policySelect = page.locator('#ddlPolicyType').first();
    const policySelectPresent = await policySelect.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);
    if (policySelectPresent) {
      try {
        await policySelect.selectOption({ value: 'Business Auto Coverage Form' });
        await page.waitForTimeout(500);
        console.log('Selected Business Auto Coverage Form');
      } catch (e) { console.log('selectOption failed for #ddlPolicyType:', e.message); }
    } else {
      await dumpNavFailureDiagnostic('#ddlPolicyType (Business Auto Coverage Form)');
    }

    await dismissStatusModal();
    await safeClick(page.getByRole('button', { name: 'Yes' }));

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
        // Was yesToggles.last() - picked by list position, so an eligibility
        // question added/removed above the certification question would
        // silently answer the wrong row. Identify it by its own text first,
        // falling back to last position only if no row matches.
        let targetYes = null;
        for (let i = 0; i < yesTogglesCount; i++) {
          const candidate = yesToggles.nth(i);
          const row = candidate.locator('xpath=ancestor::tr[1] | ancestor::div[contains(@class,"row")][1] | ancestor::li[1]').first();
          const rowText = ((await row.textContent().catch(() => '')) || '').toLowerCase();
          if (/certif|best of (my|our) knowledge|true and correct/.test(rowText)) {
            targetYes = candidate;
            break;
          }
        }
        if (!targetYes) {
          console.log('Certification question not identified by text - falling back to last "Yes" toggle');
          targetYes = yesToggles.last();
        }
        const nestedYes    = targetYes.locator('input[type="radio"]');
        const yesChecked   = await nestedYes.isChecked().catch(() => false);
        const ariaPressed  = await targetYes.getAttribute('aria-pressed').catch(() => null);
        const classAttr    = (await targetYes.getAttribute('class').catch(() => '')) || '';
        const alreadySelected = yesChecked || ariaPressed === 'true' || /active|selected|on/i.test(classAttr);
        if (!alreadySelected && await targetYes.isVisible().catch(() => false)) {
          await targetYes.scrollIntoViewIfNeeded({ timeout: 3000 });
          await targetYes.click({ timeout: 5000 });
          console.log('Clicked Yes for certification question');
        }
      } catch (e) { console.log(`Could not click certification Yes: ${e.message.split('\n')[0]}`); }
    }

    await dismissStatusModal();
    await safeClick(page.getByRole('button', { name: 'Finish ' }));
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    trackMilestone('Commercial Auto Product Eligibility Completed');

    // Prior carrier
    // Was a hardcoded selectOption('Progressive') - not guaranteed to exist
    // in every environment/state's carrier list. Pick the first real
    // (non-placeholder) option instead, same "first available" pattern used
    // for Classification Description / Secondary Class Code below.
    console.log('Waiting for prior carrier dropdown...');
    const priorCarrier = page.locator('#ddlPriorCarrier');
    await priorCarrier.waitFor({ state: 'visible', timeout: 30000 });
    const priorCarrierOptions = await priorCarrier.locator('option').all();
    let priorCarrierSet = false;
    for (const opt of priorCarrierOptions) {
      const value = await opt.getAttribute('value');
      const text  = ((await opt.textContent()) || '').trim();
      if (value && text && !/select|none/i.test(text)) {
        await priorCarrier.selectOption(value);
        console.log(`Prior Carrier: selected "${text}"`);
        priorCarrierSet = true;
        break;
      }
    }
    if (!priorCarrierSet) console.log('Prior Carrier: no valid option found, leaving default');
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
    // Was an instant count()>0 check - same bug class as the BOP Structure
    // Building panel: if the page hadn't fully rendered at that exact
    // millisecond, this read 0 and silently skipped a legitimately-present
    // button. Give it a short window to actually appear before deciding
    // it's genuinely absent.
    try {
      const deleteCoverageButton = page.locator('i[title="Delete Coverage"]').first();
      const deleteCoveragePresent = await deleteCoverageButton.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);
      if (deleteCoveragePresent) {
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
    // Both of these were raw .click() calls with no visibility wait - first
    // action after a page transition, no fallback if the page took longer
    // than expected to render.
    const locationEditBtn = page.locator('#tblCLAutoLocations button[data-action="edit"]').first();
    await waitAndClick(locationEditBtn, 'Locations edit button');
    await dismissStatusModal();
    const verifyAddressBtn = page.getByRole('button', { name: 'Verify Address' });
    await waitAndClick(verifyAddressBtn, 'Verify Address button');

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

    // Confirmed live on Training: "Number of Employees" is a required plain
    // text input on this Details tab (marked with a red asterisk), which
    // processCoverageDropdowns() never touches since it only fills <select>
    // elements. Left empty, clicking Next later silently bounces the page
    // back to this Details tab with a "Number of Employees is required"
    // banner - which looked like every subsequent step (Vehicle Prefill,
    // Add New Vehicle, ...) was stuck, when the flow had actually never
    // left this tab at all. Fill it explicitly before proceeding.
    const numEmployeesField = page.getByRole('textbox', { name: 'Number of Employees' });
    const numEmployeesVisible = await numEmployeesField.isVisible({ timeout: 3000 }).catch(() => false);
    if (numEmployeesVisible) {
      const currentVal = await numEmployeesField.inputValue().catch(() => '');
      if (!currentVal.trim()) {
        await numEmployeesField.fill('5');
        console.log('Number of Employees filled: 5');
      }
    } else {
      console.log('Number of Employees field not visible - skipping (may not be required for this LOB/state combo)');
    }

    await safeNextClick();
    trackMilestone('State specific info - Coverages');

    await safeNextClick();
    trackMilestone('State specific info - Additional coverages');

    // ── Vehicles - Private passenger ────────────────────────────────────────────
    // Confirmed live: this raw .click() with no wait/fallback hung for the
    // full 60s actionTimeout when the dialog didn't appear (or took longer
    // than that to render), with no diagnostic to tell whether it was a
    // timing issue or the dialog being genuinely absent this run.
    const vehiclePrefillBtn = page.locator('#CLAutoVehiclePrefill_dialog_btn_1');
    const vehiclePrefillVisible = await vehiclePrefillBtn.waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true).catch(() => false);
    if (vehiclePrefillVisible) {
      await vehiclePrefillBtn.click();
    } else {
      await dumpNavFailureDiagnostic('CLAutoVehiclePrefill_dialog_btn_1');
      console.log('Vehicle Prefill dialog not visible after 20s - continuing without it');
    }
    await dismissStatusModal();
    await waitAndClick(page.getByRole('combobox', { name: 'Add New Vehicle' }), 'Add New Vehicle combobox (private passenger)');
    await clickBsSelect('bs-select-2-1', 'Vehicle Type (private passenger)');
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await clickBsSelect('bs-select-3-1', 'Garaging Location (private passenger)');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await dismissStatusModal();
    await page.locator('#txt_Vin').fill('1GBJ6C1BX8F416705');
    await page.getByText('Model *').click();
    await page.getByRole('combobox', { name: 'Please select' }).click();
    await clickBsSelect('bs-select-2-1', 'Model (private passenger)');
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('15555');
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await dismissStatusModal();
    // Confirmed live: this was commented out on both vehicle screens, unlike
    // the identical sequence on the State Specific Info page above (which
    // does call it) - leaving required vehicle coverage limits/options
    // unset here, causing rating or a much later Save to fail for what
    // looks like an unrelated reason.
    await processCoverageDropdowns(page);
    await safeNextClick();
    await dismissStatusModal()
    await safeClick(page.getByRole('button', { name: 'Save Vehicle ' }));
    trackMilestone('Vehicles Page: Private passenger Vehicle Added');

    // ── Vehicles - Truck ────────────────────────────────────────────────────────
    await waitAndClick(page.getByRole('combobox', { name: 'Add New Vehicle' }), 'Add New Vehicle combobox (truck)');
    await clickBsSelect('bs-select-2-3', 'Vehicle Type (truck)');
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await clickBsSelect('bs-select-3-1', 'Garaging Location (truck)');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await dismissStatusModal();
    await page.locator('#txt_Vin').fill('1FDXX46F93EA79961');
    await page.locator('#xrgn_CLAutoVehiclesDetails_LeftColumn').click();
    await page.locator('#xrgn_BusinessUseClass_Trucks_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await clickBsSelect('bs-select-3-0', 'Business Use Class');
    await page.locator('#xrgn_RadiusClass_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await clickBsSelect('bs-select-4-0', 'Radius Class');
    await page.locator('#txt_SecondaryClassCode_Trucks_displayAll > .input-group-text').click();
    // Confirmed live via BOP's Classification Description fix: this same
    // "open a lookup grid icon, pick a row" widget pattern is fragile when
    // hardcoded to one specific classification text - a different random
    // account's available class list may not include "03 - Truckers - Tow
    // Trucks For-Hire" at all, and clickTextItem() throws UNCAUGHT after
    // 10s in that case, killing the whole test. Prefer picking the first
    // available row from the grid (mirrors the proven BOP fix); fall back
    // to the original hardcoded text only if that selector guess is wrong.
    const secondaryClassRow = page.locator('#txt_SecondaryClassCode_Trucks_resultsTable tbody tr').first();
    const secondaryClassRowVisible = await secondaryClassRow.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false);
    if (secondaryClassRowVisible) {
      await secondaryClassRow.click();
      console.log('Secondary Class Code: selected first available option from grid lookup');
    } else {
      console.log('Secondary Class Code: grid lookup rows not found via #txt_SecondaryClassCode_Trucks_resultsTable - trying hardcoded fallback');
      await clickTextItem('03 - Truckers - Tow Trucks For-Hire')
        .catch(e => console.log('Secondary Class Code: hardcoded fallback also failed: ' + e.message.split('\n')[0]));
    }
    await page.locator('#txt_GrossCombinedWeight').fill('5000');
    await page.getByRole('textbox', { name: 'Description of Permanently' }).fill('test desc');
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('01555');
    await page.getByRole('textbox', { name: 'Stated Amount' }).fill('0');
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await dismissStatusModal();
    // Confirmed live: this was commented out on both vehicle screens, unlike
    // the identical sequence on the State Specific Info page above (which
    // does call it) - leaving required vehicle coverage limits/options
    // unset here, causing rating or a much later Save to fail for what
    // looks like an unrelated reason.
    await processCoverageDropdowns(page);
    await safeNextClick();
    await dismissStatusModal()
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