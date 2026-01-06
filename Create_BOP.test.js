// Set suite type for email reporter
process.env.TEST_TYPE = 'BOP';

import { test, expect } from '@playwright/test';
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }, testInfo) => {
  test.setTimeout(1200000); // 20 minutes total test timeout
  page.setDefaultTimeout(60000); // 60 seconds default timeout for all actions

  // Select environment via TEST_ENV (qa|test). Defaults to qa.
  const envName = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

  // Select state via TEST_STATE (DE|MI|OH|PA|WI). Defaults to DE.
  const allowedStates = ['DE', 'MI', 'OH', 'PA', 'WI'];
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
    retryCount: testInfo.retry || 0
  };
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
      } catch (e) {}
    });

    page.on('requestfailed', request => {
      global.testData.networkErrors.push({ url: request.url(), error: request.failure(), timestamp: new Date().toISOString() });
    });
  let currentStepStartTime = null;
  let testFailed = false;

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

    // Calculate duration since last milestone (excluding wait times)
    if (currentStepStartTime) {
      duration = ((now - currentStepStartTime) / 1000).toFixed(2); // in seconds
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
  }

  // Ensure retry count is always up to date
  global.testData.retryCount = testInfo.retry || 0;

  // Start timing from first milestone
  currentStepStartTime = new Date();

  try {
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

    // Wait for next page to fully load before interacting with package selection
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);
  // Businessowners quote
  await page.getByText('Businessowners (v7)').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click();
  await page.locator('#ddlPriorCarrier').selectOption('Progressive');
  await page.getByRole('button', { name: 'Next ' }).click();
  
  // Wait for any modal dialogs to close before interacting with dropdowns
  await page.waitForSelector('.modal.show', { state: 'hidden', timeout: 5000 }).catch(() => {
    console.log('⚠️ Modal dialog did not close within timeout, attempting close');
  });
  await page.waitForTimeout(500); // Small buffer for DOM to stabilize
  
  
  // Select Legal Entity - Association (only if not already set to "Other")
  const legalEntityBtn = page.locator('button[data-id="ddlLegalEntity"]').or(page.locator('button.dropdown-toggle').first());
  await legalEntityBtn.scrollIntoViewIfNeeded();
  
  // Check current value
  const currentValue = await legalEntityBtn.textContent();
  const isOther = currentValue && currentValue.trim().toLowerCase().includes('other');
  
  if (!isOther) {
    await legalEntityBtn.click({ force: true, timeout: 10000 });
    await page.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: /^Association$/ }).click();
    console.log('✓ Legal Entity set to Association');
  } else {
    console.log('✓ Legal Entity already set to "Other", skipping');
  }
  
  // Select Business Type - Contractor
  await page.waitForSelector('.modal.show', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  
  const businessTypeBtn = page.locator('button[data-id="ddlBusinessType"]').or(page.locator('button.dropdown-toggle').nth(1));
  await businessTypeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await businessTypeBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  
  // Retry click if dropdown doesn't open
  for (let attempt = 0; attempt < 3; attempt++) {
    await businessTypeBtn.click({ force: true, timeout: 10000 });
    const dropdownVisible = await page.locator('.dropdown-menu.show').isVisible().catch(() => false);
    if (dropdownVisible) break;
    await page.waitForTimeout(500);
  }
  
  await page.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: /^Contractor$/ }).click();
  await page.waitForTimeout(300);
  
  await page.getByRole('button', { name: 'Next ' }).click();
  //Contractors' Tools And Equip
  await page.getByTitle('Edit Coverage').nth(3).click();
  await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: '500' }).click();
  await page.locator('#bs-select-13-0').click();
  await page.getByRole('button', { name: ' Save' }).click();
  //Contractors Installation
  await page.locator('#xacc_BP7ContrctrsInstalltnToolsAndEquipmtInstalltn').getByTitle('Add Coverage').click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).first().click();
  await page.locator('#bs-select-13-1').click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-20-1').click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  //Add't Cov
  //Cyber Coverage Insurance
  //await page.getByTitle('Edit the Coverage').first().click();
  //await page.getByRole('button', { name: ' Save' }).click();
  //Waiver Of Transfer Of Rights Of Recovery Against 
  await page.locator('#z9ui28llcn0ikdavhkktuu7uqpa > td:nth-child(4) > .btn-sm').click();
  await page.locator('#z0lhi64ee7joqeidb4r7kqm5bp9 > td:nth-child(4) > .btn-sm').click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).first().click();
  await page.locator('#bs-select-1-1').click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-5-1').click();
  await page.getByRole('button', { name: ' Save' }).click();

  //existing code
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('BOP quote - preliminary info completed');
  // Add building
  await page.locator('#xrgn_AddBuilding button.dropdown-toggle[role="combobox"]').click();
  await page.locator('.dropdown-menu.show .text').filter({ hasText: /^[0-9]+: .*/ }).first().click();
  await page.waitForLoadState('load');
  // Ensure overlays/modals are gone before interacting with Construction Type
  await page.waitForSelector('.ui-widget-overlay.ui-front', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForSelector('.modal.show', { state: 'hidden', timeout: 3000 }).catch(() => {});

  // Click the Construction Type dropdown button robustly
  const constructionBtn = page.locator('button[data-id="ddlConstructionType"]');
  await constructionBtn.waitFor({ state: 'visible', timeout: 15000 });
  await constructionBtn.scrollIntoViewIfNeeded();
  await constructionBtn.click({ force: true, timeout: 10000 });

  // Wait for the dropdown menu to appear
  const menu = page.locator('#bs-select-6');
  await menu.waitFor({ state: 'visible', timeout: 10000 });

  // Click the option by visible text
  await menu.locator('li span.text', { hasText: 'Frame Construction' }).click();

  await page.locator('#xrgn_CLBOPBuildingDetails_RoofTypeValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-7-0').first().click();
  await page.locator('#txtYearOfConstruction').fill('2015');
  console.log('Building details filled');
  await page.getByRole('button', { name: 'Next ' }).click();
  // Add coverage

  await page.locator('#xacc_BP7StructureBuilding').getByTitle('Add Coverage').click();
  await page.locator('#xrgn_BP7RatingBasisValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-1-1').click();
  await page.getByRole('link', { name: 'Create Estimator' }).click();
  const locator = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
  await locator.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  for (const digit of '999') {
    await page.keyboard.press(digit);
  }
  await page.keyboard.press('Tab');
  //await page.locator('#lblClassGroup').click();

  // Template selection
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();

  // Import data & save
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-9-1').click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  // Classification
  await page.waitForLoadState('networkidle');
  await page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Carpentry - Interior - Office' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const squareFootageInput = page.locator('#txtClassificationSquareFootage_integerWithCommas');
  await squareFootageInput.waitFor({ state: 'visible', timeout: 10000 });
  await squareFootageInput.waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForTimeout(1000);
  
  // Click to focus and select all
  await squareFootageInput.click({ clickCount: 3 });
  await page.waitForTimeout(1000);
  
  // Clear by pressing Backspace
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  
  // Type character by character for comma formatting
  await page.keyboard.type('2999');
  await page.waitForTimeout(1000);
  
  // Blur to trigger validation
  await squareFootageInput.blur();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  //Business Personal Propert
  await page.getByTitle('Edit Coverage').click();
  await page.waitForTimeout(1000);
  
  const exposureInput = page.locator('#txtexposure_integerWithCommas');
  await exposureInput.waitFor({ state: 'visible', timeout: 10000 });
  
  // Click to focus and select all
  await exposureInput.click({ clickCount: 3 });
  await page.waitForTimeout(500);
  
  // Clear by pressing Backspace
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  
  // Type character by character for comma formatting
  await page.keyboard.type('40000');
  await page.waitForTimeout(500);
  
  // Blur to trigger validation
  await exposureInput.blur();
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Save' }).click();

  //await page.getByRole('button', { name: ' Close' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Building/Classification' }).click();
  trackMilestone('Building and Classification Added');
  console.log('Building and classification added');
  // Continue workflow
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForLoadState('networkidle');
  await page.locator('#for_xrdo_Question_Form_BP7UnderwritingQuestion_Ext_0_BP7MortgageonProp_Ext_No').click();
  await page.locator('#for_xrdo_Question_Form_BP7UnderwritingQuestion_Ext_0_BP7CertificateQuestion_Ext_Yes').click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#lblQuoteNumValue', { timeout: 60000 });


  // Capture quote number
  const quoteNumber = await page.locator('#lblQuoteNumValue').textContent();
  console.log('Quote Number:', quoteNumber.trim());


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
  

  
  // Store policy number globally for email reporter
  global.testData.policyNumber = policyNumber;
  saveTestData();
  console.log('📋 Test Data:', global.testData);

  // Write test data to state-specific JSON file so reporter can read it
  const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
  console.log(`💾 Test data written to test-data-${testState}.json`);

  console.log('Test completed successfully');
  
  } catch (error) {
    // Test failed - mark the failure as a milestone
    testFailed = true;
    console.error('❌ Test execution failed:', error.message);

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
      } catch (e) {}
      if (extractedNumber) {
        global.testData.quoteNumber = extractedNumber;
      }
    } catch (extractErr) {
      console.log('⚠️ Could not extract submission number:', extractErr.message);
    }

    trackMilestone('Test Execution Failed', 'FAILED', error.message);

    // Write final test data with failure info to state-specific file
    const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log(`💾 Test data written to test-data-${testState}.json with failure info`);

    // Re-throw to mark test as failed in Playwright
    throw error;
  }
});
