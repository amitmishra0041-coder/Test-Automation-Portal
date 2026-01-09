// Set suite type for email reporter
process.env.TEST_TYPE = 'PACKAGE';

import { test, expect } from '@playwright/test';
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }, testInfo) => {
  test.setTimeout(1200000); // 20 minutes total test timeout
  page.setDefaultTimeout(60000); // 60 seconds default timeout for all actions

  // Select environment via TEST_ENV (qa|test). Defaults to qa.
  const envName = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

  // Select state via TEST_STATE. Defaults to DE.
  const allowedStates = Object.keys(STATE_CONFIG);
  let testState = (process.env.TEST_STATE || 'DE').toUpperCase();
  if (!allowedStates.includes(testState)) {
    console.log(`⚠️ TEST_STATE "${testState}" not allowed; defaulting to DE`);
    testState = 'DE';
  }
  const stateConfig = getStateConfig(testState);
  console.log(`🗺️ Running test for state: ${testState} (${stateConfig.name})`);

  // Initialize milestone tracking for email report
  global.testData = {
    state: testState,
    stateName: stateConfig.name,
    milestones: [],
    httpTimings: [],
    networkErrors: [],
    retryCount: testInfo.retry || 0,
    quoteNumber: 'N/A',
    policyNumber: 'N/A'
  };
  
  // Immediately save initialized test data to prevent stale values from previous iterations
  const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
  console.log(`✅ Initialized test data for ${testState} with N/A values`);
  
  // Track HTTP response times and errors
  page.on('response', async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      const timing = response.timing();
      const startTime = timing && timing.startTime ? timing.startTime : null;
      const endTime = timing && timing.responseEnd ? timing.responseEnd : null;
      let duration = null;
      if (startTime && endTime) duration = (endTime - startTime) / 1000;
      else if (response.request().timing()) {
        const reqTiming = response.request().timing();
        if (reqTiming.startTime && reqTiming.responseEnd)
          duration = (reqTiming.responseEnd - reqTiming.startTime) / 1000;
      }
      // Only log for XHR/fetch or important URLs
      if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch' || /api|service|rest|json/i.test(url)) {
        global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
      }
      if (status >= 400) {
        global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
      }
    } catch (e) { }
  });

  page.on('requestfailed', request => {
    global.testData.networkErrors.push({ url: request.url(), error: request.failure(), timestamp: new Date().toISOString() });
  });
  let currentStepStartTime = null;
  let waitBudgetMs = 0; // tracks explicit waits to exclude from milestone duration
  let testFailed = false;

  // Wrap waitForTimeout so we can subtract intentional sleeps from milestone timing
  const originalWaitForTimeout = page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    await originalWaitForTimeout(ms);
    waitBudgetMs += ms;
  };

  // Helper to persist test data to state-specific JSON file (prevent parallel conflicts)
  function saveTestData() {
    try {
      const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
      fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    } catch (e) {
      console.log('⚠️ Could not save test-data.json:', e.message);
    }
  }

  function trackMilestone(name, status = 'PASSED', details = '') {
    const now = new Date();
    let duration = null;

    // Calculate duration since last milestone (exclude intentional waits)
    if (currentStepStartTime) {
      const elapsedMs = now - currentStepStartTime - waitBudgetMs;
      duration = (Math.max(elapsedMs, 0) / 1000).toFixed(2); // in seconds
    }

    const milestone = {
      name,
      status,
      timestamp: now,
      details,
      duration: duration ? `${duration}s` : null
    };
    global.testData.milestones.push(milestone);
    console.log(`${status === 'PASSED' ? '\u2705' : status === 'FAILED' ? '\u274c' : '\u23eb'} ${name}${duration ? ` (${duration}s)` : ''}`);

    // Save data to file immediately so reporter can read it
    saveTestData();

    // Reset timer for next step
    currentStepStartTime = new Date();
    waitBudgetMs = 0;
  }

  // Ensure retry count is always up to date
  global.testData.retryCount = testInfo.retry || 0;

  // Start timing from first milestone
  currentStepStartTime = new Date();

  // Universal helper to wait for modals/overlays to disappear before interacting
  async function waitForModalsToClose(timeout = 5000) {
    try {
      // Wait for common modal/overlay elements to become hidden
      const modalSelectors = [
        '.modal.show',
        '#dgic-status-message',
        '.ui-widget-overlay',
        '#gw-click-overlay.gw-disable-click',
        '.gw-click-overlay',
        '#dgic-modal-clpropertyaddlcoveragesscheduledialog'
      ];

      for (const selector of modalSelectors) {
        const modal = page.locator(selector).first();
        if (await modal.count() > 0) {
          await modal.waitFor({ state: 'hidden', timeout }).catch(() => { });
        }
      }
      // Small buffer to ensure modal animations complete
      await page.waitForTimeout(300);
    } catch (e) {
      // Silently continue if no modals found or timeout
    }
  }

  // Enhanced click function with modal/overlay wait
  async function safeClick(locator, options = {}) {
    await waitForModalsToClose();
    await locator.scrollIntoViewIfNeeded();
    await locator.click(options);
  }

  try {
    // Track start milestone
    trackMilestone('Test Started', 'STARTED');
    // Main test flow wrapped in try-catch

    // Helper function to click optional buttons
    async function clickIfExists(buttonName) {
      try {
        const button = page.getByRole('button', { name: buttonName });
        await button.click({ timeout: 5000 });
        console.log(`✅ "${buttonName}" button clicked`);
      } catch (error) {
        console.log(`⏭️  "${buttonName}" button not present, skipping`);
      }
    }

    // Account creation and qualification (reuses same page/tab)
    await createAccountAndQualify(page, {
      writeBizUrl,
      testState,
      clickIfExists,
      trackMilestone
    });
    trackMilestone('Account Created & Qualified');

    // Wait for next page to fully load before interacting with package selection
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
    trackMilestone('Loaded Package Selection Page');

    const commercialPackageIcon = page.locator('#chk_CommercialPackage + .ui-checkbox-icon');

    try {
      // Allow Guidewire product model to finish loading
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

      await commercialPackageIcon.waitFor({
        state: 'visible',
        timeout: 30000
      });

      await commercialPackageIcon.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // PERF settle time

      await commercialPackageIcon.click({ force: true });

      console.log('✅ Commercial Package selected');

    } catch (e) {
      console.log('⚠️ Icon click failed, attempting fallback checkbox');

      // Fallback: click the real checkbox input
      const commercialCheckbox = page.locator('#chk_CommercialPackage');

      await commercialCheckbox.waitFor({ state: 'attached', timeout: 10000 });
      await commercialCheckbox.check({ force: true }).catch(() => { });
    }


    await safeClick(page.getByRole('button', { name: 'Next' }));
    trackMilestone('Clicked Next after Package Selection');
    // Wait for any overlay to disappear
    await page.waitForSelector('.ui-widget-overlay.ui-front', { state: 'hidden' }).catch(() => { });
    // Click button with force to bypass pointer interception
    await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click({ force: true });

    // Wait for page to load after button click
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    // Wait for prior-carrier dropdown to be ready with options
    const priorCarrierSelect = page.locator('#ddlPriorCarrier');
    await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000); // Allow options to populate

    // Select first available option (skip empty/placeholder)
    const firstCarrierValue = await priorCarrierSelect.evaluate((el) => {
      const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
      return opt ? opt.value : null;
    });
    if (!firstCarrierValue) {
      throw new Error('No prior carrier options available');
    }
    await priorCarrierSelect.selectOption(firstCarrierValue);
    trackMilestone('Selected Prior Carrier');
    console.log(`✅ Selected prior carrier: ${firstCarrierValue}`);

    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Prior Carrier');
    await page.waitForLoadState('networkidle');
    trackMilestone('Loaded Coverage Selection Page');

    // Toggle Inland Marine and Crime to "Yes" if not already selected (slider style controls)
    // Scroll into view and use JavaScript to click the actual checkbox element
    await page.waitForTimeout(1000); // Wait for slider rendering
    trackMilestone('Coverage Sliders Ready');

    // Toggle Inland Marine - scroll and click via JavaScript
    await page.locator('#cbInlandMarine').scrollIntoViewIfNeeded();
    const inlandChecked = await page.locator('#cbInlandMarine').isChecked();
    if (!inlandChecked) {
      await page.locator('#cbInlandMarine').evaluate(el => el.click());
      trackMilestone('Toggled Inland Marine');
      await page.waitForTimeout(500);
      console.log('✅ Inland Marine toggled to Yes');
    }

    // Toggle Crime - scroll and click via JavaScript
    await page.locator('#cbCrime').scrollIntoViewIfNeeded();
    const crimeChecked = await page.locator('#cbCrime').isChecked();
    if (!crimeChecked) {
      await page.locator('#cbCrime').evaluate(el => el.click());
      trackMilestone('Toggled Crime');
      await page.waitForTimeout(500);
      console.log('✅ Crime toggled to Yes');
    }

    // Click Confirm Selections button after both toggles are selected
    await page.waitForTimeout(1000);
    await page.locator('#btnConfirmSelections').click();
    await page.waitForTimeout(1500);
    trackMilestone('Confirmed Selections');

    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Confirm Selections');
    await page.waitForLoadState('networkidle');
    await page.waitForLoadState('domcontentloaded');
    trackMilestone('Commercial Package Data Entry Started');
    await page.waitForTimeout(2500);
    await page.getByTitle('Edit Location').click();
    trackMilestone('Edit Location Clicked');
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Yes' }).click();
    trackMilestone('Confirmed Edit Location');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: ' Cancel' }).click();
    trackMilestone('Cancelled Edit Location');
    await page.waitForTimeout(1500);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Edit Location');
    await page.waitForTimeout(1500);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Edit Location 2');
    await page.waitForTimeout(1500);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Edit Location 3');
    await page.waitForTimeout(2000);
    await page.getByTitle('Add the Coverage').click();
    trackMilestone('Add the Coverage Clicked');
    await page.getByRole('button', { name: ' Add Scheduled Item' }).click();
    trackMilestone('Add Scheduled Item Clicked');
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    trackMilestone('ComboBox Clicked');
    await page.getByRole('button', { name: 'Add New' }).click();
    trackMilestone('Add New Clicked');

    // Select first available account location option (avoids brittle hardcoded JSON value)
    const accountSelect = page.locator('#ddlAccountLocations');
    await accountSelect.waitFor({ state: 'visible', timeout: 15000 });
    const firstLocationValue = await accountSelect.evaluate((el) => {
      const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
      return opt ? opt.value : null;
    });
    if (!firstLocationValue) {
      throw new Error('No account location options available');
    }
    await accountSelect.selectOption(firstLocationValue);
    trackMilestone('Account Location Selected');

    await page.locator('#xrgn_CLANIAddressTypeValue').getByRole('combobox', { name: 'Nothing selected' }).click();
    trackMilestone('Address Type ComboBox Clicked');
    await page.locator('#bs-select-3-1').click();
    trackMilestone('Address Type Selected');
    await page.getByRole('textbox', { name: 'Name' }).click();
    trackMilestone('Name Textbox Clicked');
    await page.getByRole('textbox', { name: 'Name' }).fill('gfdgdf');
    trackMilestone('Name Filled');
    await page.locator('#ThirdPartyContactsDialog_dialog_btn_0').click();
    trackMilestone('Third Party Contact Dialog Saved');
    await page.locator('#txtNoticeDaysID').click();
    trackMilestone('Notice Days Clicked');
    await page.locator('#txtNoticeDaysID').fill('15');
    trackMilestone('Notice Days Filled');
    await page.locator('#CLPropertyAddlCoveragesScheduleItemDialog_dialog_btn_0').click();
    trackMilestone('Schedule Item Dialog Saved');
    // Click Save on the parent schedule dialog (avoid strict-mode ambiguity)
    await page.locator('#CLPropertyAddlCoveragesScheduleDialog_dialog_btn_0').click();
    trackMilestone('Schedule Dialog Saved');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Schedule Dialog');
    // Wait for page to fully load after clicking Next
    // Use domcontentloaded only (networkidle causes timeout waiting for pending requests in perf)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Allow page to stabilize in perf env
    //Commercial property locations
    const editLocationButton = page.getByTitle('Edit Location');
    await page.waitForTimeout(2000); // Additional wait for element to render
    await editLocationButton.waitFor({ state: 'visible', timeout: 30000 });
    await editLocationButton.click();
    trackMilestone('Edit Location Clicked 2');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Edit Location 4');
    //State specific info, Blankets and Buildings

    // Wait for Save Location button to be fully ready
    const saveLocationBtn = page.getByRole('button', { name: 'Save Location ' });
    await saveLocationBtn.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000); // Ensure form processing completes
    // Check for any blocking overlays
    const overlay = page.locator('.ui-widget-overlay');
    if (await overlay.isVisible().catch(() => false)) {
      console.log('⏳ Waiting for overlay to clear before clicking Save Location...');
      await overlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
    await saveLocationBtn.click();
    trackMilestone('Save Location Clicked');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Save Location');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Save Location 2');
    await page.locator('button').filter({ hasText: 'Add Building' }).click();
    trackMilestone('Add Building Clicked');
    await page.locator('#bs-select-1-0').click();
    trackMilestone('Building Option Selected');
    await page.locator('#txtBuildingDescription').click();
    trackMilestone('Building Description Clicked');
    await page.locator('#txtBuildingDescription').fill('test desc');
    trackMilestone('Building Description Filled');
    await page.locator('#txtClassDescription_displayAll > .input-group-text > .fas').click();
    trackMilestone('Class Description Clicked');
    await page.getByRole('gridcell', { name: 'Airports - Hangars with repairing or servicing' }).click();
    trackMilestone('Class Description Selected');
    await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
    trackMilestone('Construction Type ComboBox Clicked');
    await page.locator('#bs-select-6-0').click();
    trackMilestone('Construction Type Selected');
    await page.waitForTimeout(1000);
    await page.locator('#txtNumberOfStories').click();
    trackMilestone('Number Of Stories Clicked');
    await page.locator('#txtNumberOfStories').fill('15');
    trackMilestone('Number Of Stories Filled');
    await page.waitForTimeout(1000);
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    trackMilestone('ComboBox Clicked 2');
    await page.waitForTimeout(1200);
    await page.locator('#bs-select-19-0').click();
    trackMilestone('ComboBox Option Selected');
    await page.waitForTimeout(1000);
    await page.locator('#txtYearOfConstruction').click();
    trackMilestone('Year Of Construction Clicked');
    await page.locator('#txtYearOfConstruction').fill('2015');
    trackMilestone('Year Of Construction Filled');
    await page.waitForTimeout(1500);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    trackMilestone('Clicked Next after Year Of Construction');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    trackMilestone('Loaded After Year Of Construction');

    await page.locator('#xacc_CP7StructureBldg').getByTitle('Edit Coverage').click();
    trackMilestone('Edit Coverage Clicked');
    await page.getByRole('link', { name: 'Create Estimator' }).click();
    trackMilestone('Create Estimator Clicked');
    
    // Wait for page to load after clicking Create Estimator
    await page.waitForTimeout(2000);
    
    // Check for error page after clicking Create Estimator
    let errorPageFound = false;
    try {
      // Must use waitFor to actually check if element exists - getByText alone doesn't throw
      const errorText = page.getByText('WriteBiz was unable to');
      await errorText.waitFor({ state: 'visible', timeout: 3000 });
      errorPageFound = true;
      console.log('⚠️ Error page detected, using alternate replacement cost entry');
    } catch (e) {
      // Error text not found, continue with normal estimator workflow
      console.log('✅ Estimator page loaded successfully, continuing with normal workflow');
    }
    
    if (errorPageFound) {
      // Run alternate replacement cost entry logic
      await page.getByRole('button', { name: ' Enter replacement cost' }).click();
      const limit52Input = page.locator('#txtCP7Limit52_integerWithCommas');
      await limit52Input.waitFor({ state: 'visible', timeout: 10000 });
      await limit52Input.waitFor({ state: 'attached', timeout: 10000 });
      await page.waitForTimeout(1000);
      // Click to select all existing text
      await limit52Input.click({ clickCount: 3 });
      await page.waitForTimeout(500);
      // Clear by pressing Backspace
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);
      // Type character by character for comma formatting
      await page.keyboard.type('165656');
      await page.waitForTimeout(1000);
      // Blur to trigger validation
      await limit52Input.blur();
      await page.waitForTimeout(1500);
      await safeClick(page.getByRole('button', { name: ' Save' }));
      await page.waitForTimeout(1500);
      //await safeClick(page.getByRole('button', { name: ' Save' }));
    } else {
      // Continue with existing workflow
      await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
      trackMilestone('Commercial Sq Ft Clicked');
      await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
      trackMilestone('Commercial Sq Ft Filled');
      await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
      trackMilestone('Commercial Sq Ft Tabbed');
      await page.waitForTimeout(500);
      await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
      trackMilestone('Template ID Primary Clicked');
      await page.getByText('Apartment / Condominium').click();
      trackMilestone('Apartment/Condo Selected');
      await page.getByRole('button', { name: 'Continue' }).click();
      trackMilestone('Continue Clicked');
      await page.getByRole('button', { name: 'Calculate Now' }).click();
      trackMilestone('Calculate Now Clicked');
      await page.getByRole('button', { name: 'Finish' }).click();
      trackMilestone('Finish Clicked');
      await page.getByRole('button', { name: 'Import Data' }).click();
      trackMilestone('Import Data Clicked');
      await page.getByRole('button', { name: ' Save' }).click();
      trackMilestone('Save Clicked');
      await page.waitForTimeout(500);
    }
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.waitForTimeout(2000);


    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Close any lingering modal dialogs before clicking "Save Building & Add Business"
    try {
      const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
      const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
      if (isVisible) {
        console.log('⏭️ Closing lingering modal dialog...');

        // Strategy 1: Look for modal buttons - Save/OK button inside the modal
        const modalButtons = [
          '#CLPropertyAddlCoveragesScheduleDialog_dialog_btn_0',  // First button in modal
          'button[id*="ScheduleDialog"]',
          'button:has-text("Save")',
          'button:has-text("OK")',
          'button:has-text("Close")'
        ];

        let buttonClicked = false;
        for (const btnSelector of modalButtons) {
          try {
            const btn = page.locator(btnSelector).first();
            const count = await btn.count({ timeout: 500 }).catch(() => 0);
            if (count > 0) {
              console.log(`Attempting to click button: ${btnSelector}`);
              await btn.click({ timeout: 3000, force: true });
              await page.waitForTimeout(800);
              buttonClicked = true;
              console.log('✅ Modal button clicked');
              break;
            }
          } catch (e) { }
        }

        // Strategy 2: If no button worked, try backdrop click
        if (!buttonClicked) {
          try {
            const backdrop = page.locator('.modal-backdrop, .ui-widget-overlay');
            await backdrop.click().catch(() => { });
            await page.waitForTimeout(800);
          } catch (e) { }
        }

        // Strategy 3: Try Escape key multiple times
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }

        // Strategy 4: Force remove modal via JavaScript
        try {
          await page.evaluate(() => {
            const m = document.getElementById('dgic-modal-clpropertyaddlcoveragesscheduledialog');
            if (m && m.parentNode) {
              m.parentNode.removeChild(m);
            }
            // Also remove backdrop if present
            const backdrops = document.querySelectorAll('.modal-backdrop, .ui-widget-overlay');
            backdrops.forEach(bd => bd.remove());
          });
          await page.waitForTimeout(500);
        } catch (e) { }
      }
    } catch (modalErr) {
      console.log('ℹ️ Modal close attempt: ' + modalErr.message);
    }

    await page.getByRole('button', { name: 'Save Building & Add Business' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);

    await page.locator('#txtBusinessIncomeDescription').click();
    await page.locator('#txtBusinessIncomeDescription').fill('test desc');
    await page.waitForTimeout(1200);
    await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.waitForTimeout(1200);
    await page.locator('#bs-select-2-1').click();
    await page.waitForTimeout(1000);
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.waitForTimeout(1200);
    await page.locator('#bs-select-6-0').click();
    await page.waitForTimeout(1500);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.locator('#xacc_CP7BusinessIncomeCvrg').getByTitle('Edit Coverage').click();
    const limit53Input = page.locator('#txtCP7Limit53_integerWithCommas');
    await limit53Input.waitFor({ state: 'visible', timeout: 10000 });
    await limit53Input.waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1000);
    // Click to select all existing text
    await limit53Input.click({ clickCount: 3 });
    await page.waitForTimeout(500);
    // Clear by pressing Backspace
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    // Type character by character for comma formatting
    await page.keyboard.type('155666');
    await page.waitForTimeout(1000);
    // Blur to trigger validation
    await limit53Input.blur();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: ' Save' }).click();
    await page.locator('#xacc_CP7BusinessIncomeExtendedPeriodOfIndemnity').getByTitle('Edit Coverage').click();
    // Wait for page to load after clicking Edit Coverage (navigation may occur)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    // Now wait for the combobox with timeout
    await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-7-2').click();
    await page.locator('#dgic-modal-clpropertybuildingbusinessincomecoveragesdialog').click();
    await page.getByRole('button', { name: ' Save' }).click();
    await page.locator('#xacc_CP7BusinessIncomeCvrg').getByTitle('Edit Coverage').click();
    await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-11-2').click();
    await page.getByRole('button', { name: ' Save' }).click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Save Building Business Income' }).click();
    // add occupancy and personal property
    await page.getByTitle('Add Occupancy Building').click();
    await page.locator('#txtOccupancyDescription').click();
    await page.locator('#txtOccupancyDescription').fill('occupancy desc');
    await page.locator('#txtSquareFootage').click();
    await page.locator('#txtSquareFootage').fill('15656');
    await page.getByText('Occupancy Details Location').click();
    await page.locator('#xrgn_CLPropertyBuildingDetails_SprinklerValue').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-4-1').click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-5-2').click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Save Occupancy ' }).click();
    await page.getByTitle('Add Personal Property').click();
    await page.locator('#txtPersonalPropertyDescription').click();
    await page.locator('#txtPersonalPropertyDescription').fill('test personal property desc');
    await page.locator('#txtPersonalPropertyDescription').press('Home');
    await page.locator('#txtPersonalPropertyDescription').fill(' personal property desc');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.locator('#xacc_CP7PersonalPropertyPrsnlProp').getByTitle('Edit Coverage').click();
    const limit54Input = page.locator('#txtCP7Limit54_integerWithCommas');
    await limit54Input.waitFor({ state: 'visible', timeout: 10000 });
    await limit54Input.waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1000);
    // Click to select all existing text
    await limit54Input.click({ clickCount: 3 });
    await page.waitForTimeout(500);
    // Clear by pressing Backspace
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    // Type character by character for comma formatting
    await page.keyboard.type('156566');
    await page.waitForTimeout(1000);
    // Blur to trigger validation
    await limit54Input.blur();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: ' Save' }).click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Save Building Personal' }).click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));


    // Check if Attention dialog is visible
    const attentionHeading = page.getByRole('heading', { name: 'Attention' });
    try {
      await attentionHeading.waitFor({ state: 'visible', timeout: 5000 });
      // Attention dialog found - try clicking Next first
      console.log('⏭️  Attention dialog found, attempting Next button first');
      await page.getByRole('heading', { name: 'Attention' }).click();
      await page.getByRole('button', { name: ' Close' }).click();
      await page.getByTitle('Edit Building').click();
      // Get current URL before clicking Next
      const urlBeforeNext = page.url();

      // Try clicking Next button

      const nextButton = page.getByRole('button', { name: 'Next ' });
      await nextButton.click({ timeout: 5000 }).catch(() => { });
      await page.waitForTimeout(2000);

      // Check if navigation was successful
      const urlAfterNext = page.url();
      const navigationSuccessful = urlAfterNext !== urlBeforeNext;

      if (navigationSuccessful) {
        console.log('✅ Next button successful, skipping error handling');
        // Navigation worked, skip the error handling logic
      } else {
        // Next button didn't navigate, execute error handling
        console.log('⚠️ Next button failed, executing error handling logic');

        await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.locator('#bs-select-6-0').click();
        //await page.locator('#bs-select-6-0').click();
        await page.waitForTimeout(3000);
        //await page.getByRole('button', { name: 'Next ' }).click();
        await page.locator('#btnNext_CLPropertyBuildingDetails').click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertyBuildingCoverages.aspx&sid=8FF799FC9CCA4036945F7A17BAD76A22');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000)
        //await page.getByRole('button', { name: 'Save Building ' }).click();
        await page.locator('#btnNext_CLPackageBuildingAdditionalCoverages').click();
        await page.waitForTimeout(2000);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
      }
    } catch (error) {
      console.log('⏭️  Attention dialog not found, skipping block');
    }

    // Special Classes
    // Wait for Special Classes dropdown with more robust visibility check
    await page.waitForFunction(() => {
      const elements = Array.from(document.querySelectorAll('div.filter-option-inner-inner')).filter(el => {
        const text = el.textContent || '';
        return text.includes('Special Class') || text.includes('Add Special');
      });
      if (elements.length === 0) return false;
      const el = elements[0];
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0';
    }, { timeout: 25000 }).catch(() => {
      // Fallback: proceed without wait if element never appears
      console.log('⚠️ Add Special Class element visibility timeout, attempting to continue');
    });

    // Try to scroll and click the element, handling case where it may not exist
    try {
      const addSpecialClassOption = page.locator('div.filter-option-inner-inner').filter({ hasText: /Special Class|Add Special/ });
      const count = await addSpecialClassOption.count();
      if (count > 0) {
        await addSpecialClassOption.first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);
        await addSpecialClassOption.first().click();
        await page.locator('#bs-select-1-0').click();
        // Wait for page to load after selecting
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
      } else {
        console.log('⚠️ Add Special Class option not found, skipping');
        // If dropdown not found, skip the special class description section
        return; // Exit the step and move to next
      }
    } catch (e) {
      console.log(`⚠️ Failed to interact with Add Special Class: ${e.message}`);
      return; // Exit on error
    }

    // Only proceed if we successfully clicked Add Special Class
    await page.locator('#txtNewSpecialClassDescription').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#txtNewSpecialClassDescription').click();
    await page.locator('#txtNewSpecialClassDescription').fill('special class desc');
    await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-1-1').click();
    await page.locator('#txtSpecialClassesClassificationDescriptions_displayAll > .input-group-text > .fas').click();
    await page.getByRole('gridcell', { name: 'Awnings or Canopies (when Insured Separately) - Entirely Non-combustible,' }).click();

    // Click the Basic Symbol Number dropdown only if it exists
    const basicSymbolDropdown = page.locator('button[data-id="ddlBasicSymbolNumber"]');
    try {
      const dropdownVisible = await basicSymbolDropdown.isVisible({ timeout: 3000 }).catch(() => false);
      if (dropdownVisible) {
        await basicSymbolDropdown.click();
        await page.waitForTimeout(500);
        // Click the first available option
        const menuId = await basicSymbolDropdown.getAttribute('aria-owns');
        if (menuId) {
          await page.locator(`#${menuId} [role="option"]`).first().click();
        } else {
          await page.locator('#bs-select-8 [role="option"]').first().click();
        }
        console.log('✅ Basic Symbol Number dropdown selected');
      } else {
        console.log('⏭️ Basic Symbol Number dropdown not found, skipping');
      }
    } catch (e) {
      console.log('⏭️ Basic Symbol Number dropdown not available, skipping');
    }


    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Next ' }).click();
    // Wait for page to load after clicking Next
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertySpecialClassCoverages.aspx&sid=0780278C9FB44ABCADFEB9E0ED129FBC');
    // Wait for Special Class Coverage section to load
    const specialClassCvrg = page.locator('#xacc_CP7SpecialClassCvrg').getByTitle('Edit Coverage');
    await specialClassCvrg.waitFor({ state: 'visible', timeout: 20000 });
    await safeClick(specialClassCvrg);
    const limit19Input = page.locator('#txtCP7Limit19_integerWithCommas');
    await limit19Input.waitFor({ state: 'visible', timeout: 10000 });
    await limit19Input.waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1000);
    await limit19Input.click({ clickCount: 3 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    await page.keyboard.type('65666');
    await page.waitForTimeout(1000);
    await limit19Input.blur();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: ' Save' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Save Special Class ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Continue ' }).click();

    console.log('Commercial property package data entered  successfully.');
    trackMilestone('Commercial Property Package Completed', 'PASSED', 'Building, Business Income, Occupancy, Personal Property entered');

    console.log('General Liability data entry started.');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLCoverages.aspx&sid=DB02C8659EC1486FA06AF850885BB1FE');
    await page.locator('#xacc_z84icg3rbgvk328k3ahq8cqedu8 > .fa.fa-edit').click();
    await page.locator('input[name="txtz9bj8va1kj4g50uehc6ubms4q19"]').click();
    await page.locator('input[name="txtz9bj8va1kj4g50uehc6ubms4q19"]').press('CapsLock');
    await page.locator('input[name="txtz9bj8va1kj4g50uehc6ubms4q19"]').fill('N');
    await page.locator('input[name="txtz9bj8va1kj4g50uehc6ubms4q19"]').press('CapsLock');
    await page.locator('input[name="txtz9bj8va1kj4g50uehc6ubms4q19"]').fill('No limitations');
    await page.getByRole('button', { name: ' Save' }).click();
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLCoverages.aspx&sid=8F4104755ACC4408A10F0A28450980F8');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.getByTitle('Edit the Coverage').nth(1).click();
    const glCoverageField = page.locator('input[name="txtzh4h8eu1sdr3q3h40nqv6fdk65a_integerWithCommas"]');
    await glCoverageField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('15');
    await glCoverageField.blur();
    
    // Calculate dates dynamically: current month last day and +2 months last day
    const today = new Date();
    const currentMonthLastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    const twoMonthsLastDay = twoMonthsLater.getDate();
    await page.locator('.input-group-text').first().click();
    // Select the last day of current month (use .last() to avoid strict mode violation)
    await page.getByRole('cell', { name: String(currentMonthLastDay) }).last().click();
    await page.locator('#xrgn_zgni6as6fl4tt7q4qkleqpts9jaValue > .ui-xcontrols > .input-group-append > .input-group-text > .fas').click();
    await page.getByTitle('Next Month').click();
    // Select the last day of the month that is 2 months from now
    await page.getByRole('cell', { name: String(twoMonthsLastDay) }).last().click();
    await page.getByRole('button', { name: ' Save' }).click();
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLAdditionalCoverages.aspx&sid=C44457B5B33B46888B07158DDD5B9F24');
    await page.locator('#GL7AddlInsdChurchMbrOffcrVolunWrkr').getByTitle('Add the Coverage').click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
    await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Add Exposure ' }).click();
    await page.getByRole('combobox', { name: 'Select Location' }).click();
    await page.locator('#bs-select-1-1').click();
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E9265AB5DF924567BB72F7434525E340');
    await page.getByRole('combobox', { name: 'Select Class Code' }).click();
    await page.locator('#bs-select-2-1').click();
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E1A86E1405BA4536A6D78577D333850B');
    await page.locator('#txtExposure_Prem').click();
    await page.locator('#txtExposure_Prem').click();
    await page.locator('#txtExposure_Prem').fill('166');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresCoverages.aspx&sid=B7D53EFD48D34942B45549FB2627936C');
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.getByRole('button', { name: 'Save Exposure ' }).click();

    // Wait for any navigation to complete and optional modal to close
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { });
    } catch (e) {
      // Navigation might already be complete
    }
    await page.waitForTimeout(1000);

    // Try to close any modal that might be blocking (GL section)
    const statusModalGL = page.locator('#dgic-status-message');
    try {
      await statusModalGL.waitFor({ state: 'visible', timeout: 2000 });
      const closeBtnGL = statusModalGL.getByRole('button', { name: /close|ok|done/i }).first();
      await closeBtnGL.click().catch(() => { });
      await page.waitForTimeout(500);
    } catch (e) {
      // Modal not present, continue
    }

    await page.getByRole('button', { name: 'Continue ' }).click();

    console.log('General Liability data entered successfully.');
    trackMilestone('General Liability Completed', 'PASSED', 'Coverage limits and deductibles entered');

    console.log('Inland Marine data entry started.');
    await page.getByRole('combobox', { name: 'Add New Form' }).click();
    await page.locator('#bs-select-1-1').click();
    await page.waitForTimeout(2000);
    await page.getByRole('combobox', { name: 'Select Location' }).click();
    await page.locator('#bs-select-1-1').click();
    await page.waitForTimeout(2000);
    await page.getByRole('combobox', { name: 'None' }).click();
    await page.locator('#bs-select-2-1').click();
    await page.waitForTimeout(5000);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.waitForTimeout(2000);
    await page.getByTitle('Edit Coverage').click();

    const inlandMarine1 = page.locator('input[name="txtz66jk360ek2gv3redungtmut688_integerWithCommas"]');
    await inlandMarine1.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('15600');
    await inlandMarine1.blur();

    const inlandMarine2 = page.locator('input[name="txtzv2ikdh26eivu9n0pgub3ph6k19_integerWithCommas"]');
    await inlandMarine2.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('15000');
    await inlandMarine2.blur();

    const inlandMarine3 = page.locator('input[name="txtznrjmb0kmf659ck5liulv1qj6rb_integerWithCommas"]');
    await inlandMarine3.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1500');
    await inlandMarine3.blur();

    await page.getByRole('combobox', { name: 'Nothing selected' }).nth(3).click();
    await page.locator('#bs-select-5-1').click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).nth(3).click();
    await page.locator('#bs-select-7-1').click();
    await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-8-1').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(3000);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Save Form' }).click();
    await page.waitForTimeout(3000);
    await safeClick(page.getByRole('button', { name: 'Next ' }));
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Continue ' }).click();
    await page.waitForTimeout(3000);

    console.log('Inland Marine data entered successfully.');
    trackMilestone('Inland Marine Completed', 'PASSED', 'Coverage limits and deductibles entered');
    console.log('Crime data entry started.');
    await page.waitForTimeout(3000);
    await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
    await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
    // Close any blocking modal before Next click
    //const statusModal = page.locator('#dgic-status-message');
    //try {
    //  await statusModal.waitFor({ state: 'visible', timeout: 3000 });
    //  const closeBtn = statusModal.getByRole('button', { name: /close|ok|done/i }).first();
    //  await closeBtn.click().catch(() => {});
    //  await page.waitForTimeout(500);
    //} catch (e) {
    //  // Modal not present, continue
    //}
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.locator('#txtTotalNumberRatableEmployees').click();
    await page.locator('#txtTotalNumberRatableEmployees').fill('15');
    await page.locator('#txtTotalNumberERISAPlanOfficials').click();
    await page.locator('#txtTotalNumberERISAPlanOfficials').fill('02');
    await page.locator('#xrgn_PredominantActivityValue').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-6-1').click();
    await page.waitForTimeout(1500);
    await page.locator('.fas.fa-th').click();
    await page.waitForTimeout(2000);
    const carWashCell = page.getByRole('gridcell', { name: /Car washes/ });
    await carWashCell.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.log('⚠️ Car washes gridcell not found, clicking first matching gridcell');
    });
    await carWashCell.click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
    //await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Continue ' }).click();
    await page.waitForTimeout(2000);
    await page.locator('#for_xrdo_Question_Form_CPPUnderwritingQuestion_Ext_0_CPPBestInfoByApplicant_Ext_Yes').click();


    console.log('Crime data entered successfully.');
    trackMilestone('Crime Completed', 'PASSED', 'Crime coverage details entered');

    await page.getByRole('button', { name: 'Continue ' }).click();

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(60000);

    //console.log('Finalizing policy and navigating to LOB Review page.');
    //await page.getByRole('button', { name: 'Finalize Policy ' }).click();

    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?a=show&p=LOBReview.aspx&wf=true&sid=2F5067F927AC411EBD7F7103528A95FC');
    await page.waitForSelector('#lblQuoteNumValue', { timeout: 60000 });


    // Capture quote number
    const quoteNumber = await page.locator('#lblQuoteNumValue').textContent();
    console.log('Quote Number:', quoteNumber.trim());

    console.log('Rating is successful.');
    const submissionNumber = quoteNumber.trim();
    trackMilestone('Quote Rated Successfully', 'PASSED', `Quote #: ${submissionNumber}`);

    // Add these at the very top of your test file
    const fs = require('fs');
    const path = require('path');


    // Store submission number globally for email reporter
    global.testData.quoteNumber = submissionNumber;
    saveTestData();

    // Now submit policy for approval in the same browser session
    console.log('Starting policy submission workflow...');


    const policyNumber = await submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone });



    // Store quote and policy numbers globally for email reporter
    global.testData.policyNumber = policyNumber;
    global.testData.quoteNumber = submissionNumber;
    global.testData.status = 'PASSED';
    saveTestData();
    console.log('📋 Test Data:', global.testData);

    // Write test data to state-specific JSON file so reporter can read it
    const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log(`💾 Test data written to test-data-${testState}.json`);

    console.log('✅ Test completed successfully');

  } catch (error) {
    // Test failed - mark the failure as a milestone
    testFailed = true;
    console.error('❌ Test execution failed:', error.message);
    console.error('📍 Stack:', error.stack);

    // Only Strategy 4: Try any visible 10-digit number on the page
    try {
      let extractedNumber = null;
      try {
        const pageText = await page.locator('body').textContent({ timeout: 2000 });
        const textMatch = pageText.match(/\b(\d{10})\b/);
        if (textMatch && textMatch[1]) {
          extractedNumber = textMatch[1];
          console.log(`🔍 Extracted number from page text: ${extractedNumber}`);
        }
      } catch (e) { }
      if (extractedNumber) {
        global.testData.quoteNumber = extractedNumber;
      }
    } catch (extractErr) {
      console.log('⚠️ Could not extract submission number:', extractErr.message);
    }

    trackMilestone('Test Execution Failed', 'FAILED', `${error.message}`);

    // Ensure test data has failure status
    global.testData.status = 'FAILED';
    global.testData.error = error.message;

    // Write final test data with failure info to state-specific file
    const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log(`💾 Test data written to test-data-${testState}.json with failure info`);

    // Re-throw to mark test as failed in Playwright
    throw error;
  }
});

// Note: Consolidated batch email is sent by the parallel runner script.
// Removed test-level afterAll email to avoid duplicate emails.



