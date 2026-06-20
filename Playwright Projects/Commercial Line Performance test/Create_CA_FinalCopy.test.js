// Set suite type for email reporter
process.env.TEST_TYPE = 'CA';

const { test, expect } = require('@playwright/test');
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const fs = require('fs');
const path = require('path');

test('CA Submission', async ({ page }, testInfo) => {
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
    policyNumber: 'N/A',
    coverageChanges: [],
    coverageSectionStats: [],
    addCoverageTimings: []
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

  async function clickTextItem(text) {
    const gridItem = page.getByRole('gridcell', { name: text }).first();
    if (await gridItem.count() > 0) {
      await gridItem.click();
      return;
    }
    const fallback = page.locator(`text="${text}"`).first();
    await fallback.waitFor({ state: 'visible', timeout: 10000 });
    await fallback.click({ force: true });
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

    // Wait for next page to fully load before interacting with Auto selection
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);
    // Commercial Auto quote - simple click on the real checkbox
    const autoInput = page.locator('#chk_commercialauto');
    await autoInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    await autoInput.click({ force: true }).catch(() => { });
    await page.waitForTimeout(500);
    console.log('✅ Commercial Auto checkbox clicked');
    await page.getByRole('button', { name: 'Next' }).click();
    //await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click();

    // Business Auto Coverage Form - prefer native <select> if present
    await page.getByText('Product Eligibility', { exact: true }).click().catch(() => { });
    const policySelect = page.locator('#ddlPolicyType').first();
    if (await policySelect.count() > 0) {
      await policySelect.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      try {
        await policySelect.selectOption({ value: 'Business Auto Coverage Form' });
        await page.waitForTimeout(500);
        console.log('✅ Selected "Business Auto Coverage Form" via #ddlPolicyType');
      } catch (e) {
        console.log('⚠️ selectOption failed for #ddlPolicyType:', e.message);
      }
    }

    await page.getByRole('button', { name: 'Yes' }).click();

    // Wait for the Product Eligibility dialog to close and the questions dialog to open
    console.log('Waiting for Commercial Auto questions dialog to load...');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(100);

    // Answer Commercial Auto questions
    console.log('Answering Commercial Auto eligibility questions...');

    // Updated: UI changed from radio buttons to toggle-style Yes/No buttons.
    // Find the questions area (best-effort) and click toggle buttons instead of radios.
    const questionAnchor = page.locator('text=Are you quoting').first();
    const hasAnchor = (await questionAnchor.count()) > 0;

    if (!hasAnchor) {
      console.log('⚠️ Questions anchor not found. Falling back to body for toggle search');
    } else {
      console.log('✓ Questions anchor found on page');
    }

    const questionsContainer = hasAnchor ? questionAnchor.locator('xpath=ancestor::div[1]') : page.locator('body');

    // Try several selectors that may represent the new toggle UI. Look for "No" label toggles first.
    // Observed DOM: label with 'for' attribute like "for_xrdo_..._No" wrapping an <input type="radio">.
    // Use broad page-level fallbacks if none found inside the questions container.
    let noToggles = questionsContainer.locator('label.btn:has-text("No"), label[class*="btn"]:has-text("No"), button:has-text("No"), [role="button"]:has-text("No")');
    let noTogglesCount = await noToggles.count();
    if (noTogglesCount === 0) {
      // Fallback: match labels by for/id naming convention used by the control
      noToggles = page.locator('label[for$="_No"], label[id^="for_xrdo_"][id$="_No"]');
      noTogglesCount = await noToggles.count();
    }
    console.log(`Found ${noTogglesCount} "No" toggle/button elements in questions area (or page)`);


    for (let i = 0; i < Math.min(8, noTogglesCount); i++) {
      try {
        const btn = noToggles.nth(i);

        // Determine if toggle is already active/selected.
        // The styled control may be a label with a nested input[type=radio]. Check both the input.checked and label.class
        const ariaPressed = (await btn.getAttribute('aria-pressed').catch(() => null));
        const classAttr = (await btn.getAttribute('class').catch(() => '')) || '';
        const nestedInput = btn.locator('input[type="radio"]');
        const inputChecked = await nestedInput.isChecked().catch(() => false);
        const alreadySelected = inputChecked || ariaPressed === 'true' || /active|selected|on/i.test(classAttr);

        if (!alreadySelected) {
          const isVisible = await btn.isVisible().catch(() => false);
          if (!isVisible) {
            console.log(`⏭️  Question ${i + 1} No toggle not visible, skipping`);
            continue;
          }
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
          await btn.click({ timeout: 5000 });
          console.log(`✓ Clicked No for question ${i + 1}`);
        } else {
          console.log(`⏭️  No already selected for question ${i + 1}`);
        }
      } catch (e) {
        console.log(`⚠️  Could not click No for question ${i + 1}, skipping: ${e.message.split('\n')[0]}`);
      }
    }

    // Click "Yes" for the last (certification) question using toggle/button selectors
    let yesToggles = questionsContainer.locator('label.btn:has-text("Yes"), label[class*="btn"]:has-text("Yes"), button:has-text("Yes"), [role="button"]:has-text("Yes")');
    let yesTogglesCount = await yesToggles.count();
    if (yesTogglesCount === 0) {
      yesToggles = page.locator('label[for$="_Yes"], label[id^="for_xrdo_"][id$="_Yes"]');
      yesTogglesCount = await yesToggles.count();
    }
    console.log(`Found ${yesTogglesCount} "Yes" toggle/button elements in questions area (or page)`);

    if (yesTogglesCount > 0) {
      try {
        const lastYes = yesToggles.last();
        const ariaPressed = (await lastYes.getAttribute('aria-pressed').catch(() => null));
        const classAttr = (await lastYes.getAttribute('class').catch(() => '')) || '';
        const nestedYesInput = lastYes.locator('input[type="radio"]');
        const yesInputChecked = await nestedYesInput.isChecked().catch(() => false);
        const alreadySelected = yesInputChecked || ariaPressed === 'true' || /active|selected|on/i.test(classAttr);

        if (!alreadySelected) {
          const isVisible = await lastYes.isVisible().catch(() => false);
          if (!isVisible) {
            console.log('⏭️  Certification Yes toggle not visible, skipping');
          } else {
            await lastYes.scrollIntoViewIfNeeded({ timeout: 3000 });
            await lastYes.click({ timeout: 5000 });
            console.log('✓ Clicked Yes for certification question');
          }
        } else {
          console.log('⏭️  Yes already selected for certification question');
        }
      } catch (e) {
        console.log(`⚠️  Could not click certification Yes toggle, skipping: ${e.message.split('\n')[0]}`);
      }
    }

    await page.getByRole('button', { name: 'Finish ' }).click();
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(2000);
    trackMilestone('Commercial Auto Product Eligibility Completed');

    const priorCarrierSelector = '#ddlPriorCarrier';
    console.log('⏳ Waiting for prior carrier dropdown to load...');
    await page.waitForSelector(priorCarrierSelector, { state: 'visible', timeout: 30000 })
      .catch(async (error) => {
        console.log('⚠️ Prior carrier dropdown did not appear in time.');
        console.log(`Current URL: ${page.url()}`);
        const status = await page.evaluate(() => document.readyState).catch(() => 'unknown');
        console.log(`Document readyState: ${status}`);
        const bodyText = await page.locator('body').textContent().catch(() => 'unable to read body');
        console.log(`Body snippet: ${bodyText ? bodyText.slice(0, 400).replace(/\s+/g, ' ') : ''}`);
        throw error;
      });
    await page.waitForTimeout(1001);
    await page.locator(priorCarrierSelector).selectOption('Progressive');
    await page.getByRole('button', { name: 'Next ' }).click();
    trackMilestone('Policy Details Entered');

    // Capture quote number from policy header label (e.g., 3002622343-1: CUSTOM - New Business)
    try {
      const headerLabel = page.locator('#contentHeader_lblPolicyDetails');
      const headerText = (await headerLabel.textContent().catch(() => '')).trim();
      if (headerText) {
        const headerParts = headerText.split(':');
        const headerQuote = headerParts.length ? headerParts[0].trim() : '';
        if (headerQuote) {
          global.testData.quoteNumber = headerQuote;
          console.log(`🧾 Quote Number (header): ${headerQuote}`);
        }
      }
    } catch (e) {
      console.log('⚠️ Could not capture header quote number:', e.message);
    }

    //commercial auto page loads
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(300);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => { });
    //await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    //await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    // Click "Delete Coverage" button if present
    try {
      const deleteCoverageButton = page.locator('i[title="Delete Coverage"]').first();
      const deleteExists = await deleteCoverageButton.count();
      if (deleteExists > 0) {
        console.log('🗑️  Found "Delete Coverage" button, clicking...');
        await deleteCoverageButton.click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        console.log('✅ "Delete Coverage" button clicked');
      }
    } catch (e) {
      console.log('⏭️  No "Delete Coverage" button found or click failed, continuing...');
    }

    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Next ' }).click();
    trackMilestone('Commercial Auto Coverage Completed');

    // Initialize global tracking arrays if not already present
    if (!global.testData.coverageChanges) global.testData.coverageChanges = [];
    if (!global.testData.coverageSectionStats) global.testData.coverageSectionStats = [];
    if (!global.testData.addCoverageTimings) global.testData.addCoverageTimings = [];

    // Generic function to handle multiple "Add coverage" buttons
    async function processAllAddCoverageButtons() {
      console.log('🔍 Starting to process all "Add coverage" buttons...');
      const addCoverageDetails = [];

      // Debug: Check what buttons exist on the page
      const allButtons = await page.locator('button').count();
      console.log(`🔍 Total buttons on page: ${allButtons}`);

      const dataActionAddButtons = await page.locator('button[data-action="Add"]').count();
      console.log(`🔍 Buttons with data-action="Add": ${dataActionAddButtons}`);

      const titleAddButtons = await page.locator('button[title*="Add"]').count();
      console.log(`🔍 Buttons with title containing "Add": ${titleAddButtons}`);

      const iconButtons = await page.locator('button i.fa-plus-circle').count();
      console.log(`🔍 Buttons with fa-plus-circle icon: ${iconButtons}`);

      const MAX_ITERATIONS = 15; // Safety limit to prevent infinite loops
      let processedCount = 0;
      let continueProcessing = true;
      let previousButtonCount = -1;
      let sameCountIterations = 0;

      while (continueProcessing) {
        try {
          const iterationStart = Date.now();
          // Safety check: stop if we've processed too many
          if (processedCount >= MAX_ITERATIONS) {
            console.log(`⚠️ Reached maximum iteration limit (${MAX_ITERATIONS}). Stopping.`);
            break;
          }

          // Try multiple selectors to find the buttons
          let addCoverageButtons = page.locator('button[data-action="Add"]');
          let buttonCount = await addCoverageButtons.count();

          // If not found, try with icon
          if (buttonCount === 0) {
            addCoverageButtons = page.locator('button:has(i.fa-plus-circle)');
            buttonCount = await addCoverageButtons.count();
            console.log(`🔍 Using icon selector, found ${buttonCount} button(s)`);
          }

          console.log(`📊 Found ${buttonCount} "Add coverage" button(s)`);

          // Check if button count hasn't changed - indicates we're in a loop
          if (buttonCount === previousButtonCount) {
            sameCountIterations++;
            if (sameCountIterations >= 3) {
              console.log('⚠️ Button count unchanged for 3 iterations. Likely in a loop, stopping.');
              break;
            }
          } else {
            sameCountIterations = 0;
          }
          previousButtonCount = buttonCount;

          if (buttonCount === 0) {
            console.log('✅ No more "Add coverage" buttons found. Processing complete.');
            continueProcessing = false;
            break;
          }

          // Click the first available "Add coverage" button
          const currentButton = addCoverageButtons.first();
          await currentButton.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);

          // Capture coverage name from td.sorting_1 element in the same row
          let coverageName = 'Unknown Coverage';
          try {
            // Find the td.sorting_1 element in the same row as the Add button
            const row = currentButton.locator('xpath=ancestor::tr[1]');
            const coverageCell = row.locator('td.sorting_1').first();
            const cellText = await coverageCell.textContent({ timeout: 1000 }).catch(() => '');
            if (cellText?.trim()) {
              coverageName = cellText.trim();
            }
          } catch (e) {
            console.log(`⚠️ Could not extract coverage name: ${e.message}`);
          }

          await currentButton.click();
          processedCount++;
          console.log(`✓ Clicked "Add coverage" button #${processedCount} - Coverage: ${coverageName}`);

          // Wait for popup/dialog to appear
          await page.waitForTimeout(2000);

          // Check if popup has "Add Scheduled Item" button (note the capital S)
          const addScheduleItemButton = page.locator('button:has-text("Add Scheduled Item")');
          const hasScheduleItem = await addScheduleItemButton.count().catch(() => 0);

          if (hasScheduleItem > 0) {
            console.log('🔄 Found "Add Scheduled Item" button - clicking "Remove Coverage" instead');

            // Look for "Remove Coverage" button - be specific with text match
            const removeCoverageButton = page.locator('button:has-text("Remove Coverage")');
            const hasRemoveButton = await removeCoverageButton.count().catch(() => 0);

            if (hasRemoveButton > 0) {
              await removeCoverageButton.first().click();
              console.log('✓ Clicked "Remove Coverage" button');
              await page.waitForTimeout(2000); // Wait for dialog to close
              const duration = ((Date.now() - iterationStart) / 1000).toFixed(2);
              addCoverageDetails.push({ coverage: coverageName, action: 'Removed', duration });
            } else {
              console.log('⚠️ "Remove Coverage" button not found');
            }
          } else {
            console.log('➡️ No "Add Scheduled Item" button found - continuing normally');

            // Wait a few seconds before continuing to look for next button
            await page.waitForTimeout(3000);

            // Try to close any open dialog/popup if exists
            const saveButton = page.locator('button:has-text("Save"), button[title*="Save"], button.btn:has-text("Save")');
            const hasSaveButton = await saveButton.count().catch(() => 0);

            if (hasSaveButton > 0) {
              await saveButton.first().click();
              console.log('✓ Clicked "Save" button to close dialog');
              await page.waitForTimeout(1000);
            } else {
              // Try other common close buttons
              const closeButton = page.locator('button:has-text("Close"), button:has-text("Cancel"), button.close');
              const hasCloseButton = await closeButton.count().catch(() => 0);
              if (hasCloseButton > 0) {
                await closeButton.first().click();
                console.log('✓ Clicked close button');
                await page.waitForTimeout(1000);
              }
            }
            const duration = ((Date.now() - iterationStart) / 1000).toFixed(2);
            addCoverageDetails.push({ coverage: coverageName, action: 'Added', duration });
          }

          // Small delay before checking for next button
          await page.waitForTimeout(1000);

        } catch (error) {
          console.log(`⚠️ Error processing "Add coverage" button: ${error.message}`);
          console.log('Attempting to continue to next button...');
          await page.waitForTimeout(2000);

          // Check if we're stuck - if same number of buttons after error, break
          const remainingButtons = await page.locator('button[data-action="Add"]').count().catch(() => 0);
          if (remainingButtons === buttonCount && processedCount > 10) {
            console.log('⚠️ Stuck in loop, breaking out');
            continueProcessing = false;
          }
        }
      }

      console.log(`✅ Completed processing ${processedCount} "Add coverage" button(s)`);
      // Create a milestone for coverage additions with details
      if (addCoverageDetails.length > 0) {
        const detail = addCoverageDetails.map(c => `${c.coverage} (${c.action})`).join(', ');
        trackMilestone(`Coverage Added: ${detail}`, 'PASSED');
      }
      return addCoverageDetails;
    }

    // Generic function to process all coverage dropdowns and select 2nd value
    async function processCoverageDropdowns() {
      console.log('\n🚀 START processCoverageDropdowns() 🚀');

      const coverageChanges = [];
      const coverageSectionStats = [];
      const sectionStats = {}; // Track per-coverage-section timing and counts
      const maxDropdownsPerSection = 2;

      try {
        // SIMPLIFIED APPROACH: Find all SELECT elements on the page and process them directly
        console.log('  🔍 Searching for all SELECT elements on current page...');

        const allSelects = await page.locator('select[id*="ddl"]').all();
        console.log(`  📊 Found ${allSelects.length} SELECT element(s) with ID containing "ddl"`);

        if (allSelects.length === 0) {
          console.log('  ⚠️  No SELECT elements found. Dropdown processing complete.');
          global.testData.coverageChanges.push(...coverageChanges);
          global.testData.coverageSectionStats.push(...coverageSectionStats);
          return coverageChanges;
        }

        // Process each SELECT element
        let processedCount = 0;
        for (let i = 0; i < allSelects.length && processedCount < (maxDropdownsPerSection * 3); i++) {
          try {
            const select = allSelects[i];

            // Get select ID
            const selectId = await select.getAttribute('id').catch(() => `select_${i}`);

            // Identify coverage section name (best-effort with multiple strategies)
            let sectionName = 'Unknown Section';
            try {
              // Strategy 1: Look for heading in ancestor containers
              const container = select.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card") or contains(@class,"section") or contains(@class,"container")][1]');
              let headingText = await container.locator('h3, h4, h5, .panel-heading, .card-header, .section-header, strong, [data-coverage-header], [data-section-name]').first().textContent({ timeout: 500 }).catch(() => '');

              // Strategy 2: If not found, look for preceding h3/h4 before the select
              if (!headingText || headingText.trim().length === 0) {
                headingText = await select.locator('xpath=preceding::h3[1] | preceding::h4[1] | preceding::strong[1]').first().textContent({ timeout: 500 }).catch(() => '');
              }

              // Strategy 3: Look for aria-label or data attributes
              if (!headingText || headingText.trim().length === 0) {
                headingText = await select.locator('xpath=ancestor::*[@aria-label][1]').first().getAttribute('aria-label').catch(() => '');
              }

              // Strategy 4: Look for a parent div/section with text content before our select
              if (!headingText || headingText.trim().length === 0) {
                headingText = await select.locator('xpath=ancestor::*[self::div or self::section or self::fieldset][1]//*[self::h3 or self::h4 or self::h5 or self::strong or self::span or self::label][contains(text(), "Coverage") or contains(text(), "Liability") or contains(text(), "Collision") or contains(text(), "Comprehensive") or contains(text(), "Michigan") or contains(text(), "Uninsured") or contains(text(), "Personal") or contains(text(), "PIP")]').first().textContent({ timeout: 500 }).catch(() => '');
              }

              if (headingText && headingText.trim().length > 0) {
                sectionName = headingText.trim().replace(/\n+/g, ' ').substring(0, 100);
                // Remove trailing button text like "Save", "Edit", "Close", "Add" that might be captured
                sectionName = sectionName.replace(/\s+(Save|Edit|Close|Add|Remove|Cancel|Next|Back|Finish|Submit)\s*$/i, '').trim();
              }
            } catch (e) {
              // Leave as Unknown Section
            }

            // Check if select is visible
            const isVisible = await select.isVisible().catch(() => false);
            if (!isVisible) {
              console.log(`  ⏭️  Skipping ${selectId}: not visible`);
              continue;
            }

            // Check number of options
            const options = await select.locator('option').all();
            if (options.length < 2) {
              console.log(`  ⏭️  Skipping ${selectId}: only ${options.length} option(s)`);
              continue;
            }

            // Get current value
            const oldValue = await select.evaluate(el => {
              const selected = el.querySelector('option:checked');
              return selected ? selected.textContent.trim() : 'Current';
            }).catch(() => 'Current');

            console.log(`\n  🎯 Processing #${processedCount + 1}: ${selectId}`);
            console.log(`      Current value: "${oldValue}"`);
            console.log(`      Options available: ${options.length}`);

            // Pick the first option that is DIFFERENT from the current value
            let targetOption = null;
            for (const opt of options) {
              const txt = (await opt.textContent())?.trim() || '';
              if (txt.length === 0) continue;
              if (txt !== oldValue) { // choose any value other than the current selection
                targetOption = opt;
                break;
              }
            }

            // Fallback: if every option matches oldValue (unlikely), keep current and skip
            if (!targetOption) {
              console.log(`      ⏭️  Skipping ${selectId}: no alternative option found (all match "${oldValue}")`);
              continue;
            }

            const targetOptionValue = await targetOption.getAttribute('value');
            const targetText = (await targetOption.textContent() || '').trim();

            // If the dropdown is already on the target option, just log and record a no-op
            if (oldValue === targetText) {
              console.log(`      ℹ️  Skipping change: already set to "${targetText}"`);
              coverageChanges.push({
                quoteNumber: global.testData.quoteNumber || 'N/A',
                coverage: selectId,
                coverageSection: sectionName,
                oldValue,
                newValue: targetText,
                status: 'NoChange'
              });

              // Track per-section stats even for no-op to capture timing/count
              const now = Date.now();
              if (!sectionStats[sectionName]) {
                sectionStats[sectionName] = {
                  startTime: now,
                  lastTime: now,
                  dropdownsUpdated: 0
                };
              }
              sectionStats[sectionName].lastTime = now;
              continue;
            }

            console.log(`      Changing to: "${targetText}"`);

            // Change the dropdown value
            await select.selectOption(targetOptionValue);
            console.log(`      ✅ selectOption() called`);

            await page.waitForTimeout(1000);

            // Trigger change event
            await select.evaluate(el => {
              const event = new Event('change', { bubbles: true });
              el.dispatchEvent(event);
            });
            console.log(`      ✅ change event dispatched`);

            await page.waitForTimeout(1500);

            // Verify change
            const newValue = await select.evaluate(el => {
              const selected = el.querySelector('option:checked');
              return selected ? selected.textContent.trim() : '';
            }).catch(() => '');

            if (newValue === targetText) {
              console.log(`      ✅ SUCCESS: Dropdown changed from "${oldValue}" → "${newValue}"`);
              coverageChanges.push({
                quoteNumber: global.testData.quoteNumber || 'N/A',
                coverage: selectId,
                coverageSection: sectionName,
                oldValue,
                newValue: newValue,
                status: 'Updated'
              });

              // Track per-section timing and counts
              const now = Date.now();
              if (!sectionStats[sectionName]) {
                sectionStats[sectionName] = {
                  startTime: now,
                  lastTime: now,
                  dropdownsUpdated: 0
                };
              }
              sectionStats[sectionName].dropdownsUpdated += 1;
              sectionStats[sectionName].lastTime = now;

              processedCount++;
            } else {
              console.log(`      ⚠️  WARNING: Value verification failed. Expected "${secondOptionText.trim()}", got "${newValue}"`);
            }

          } catch (e) {
            console.log(`    ❌ Error processing SELECT: ${e.message.split('\n')[0]}`);
          }

          // Give UI a breather before the next dropdown
          if (processedCount < (maxDropdownsPerSection * 3) && i < allSelects.length - 1) {
            console.log('  ⏳ Waiting 2s before next dropdown...');
            await page.waitForTimeout(2000);
          }
        }

        console.log(`\n✅ Processed ${processedCount} dropdown(s) successfully`);

        // Build per-section stats (total time and count)
        for (const [sectionName, info] of Object.entries(sectionStats)) {
          const durationSeconds = ((info.lastTime - info.startTime) / 1000).toFixed(2);
          coverageSectionStats.push({
            quoteNumber: global.testData.quoteNumber || 'N/A',
            coverageSection: sectionName,
            durationSeconds,
            dropdownsUpdated: info.dropdownsUpdated
          });
        }

      } catch (e) {
        console.log(`❌ Error in processCoverageDropdowns: ${e.message.split('\n')[0]}`);
      }

      console.log('\n🏁 END processCoverageDropdowns() 🏁\n');

      // APPEND to global arrays instead of replacing
      global.testData.coverageChanges.push(...coverageChanges);
      global.testData.coverageSectionStats.push(...coverageSectionStats);

      await page.waitForTimeout(500);
      return coverageChanges;
    }

    // Call the function to process all coverage buttons
    await processAllAddCoverageButtons();
    trackMilestone('Commercial Auto additional Coverage Added');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(150);
    // Locations page
    await page.locator('#tblCLAutoLocations button[data-action="edit"]').first().click();


    await page.getByRole('button', { name: 'Verify Address' }).click();

    // Resolve address modals in order: status -> suggested address -> location dialog
    const statusModal = page.locator('#dgic-status-message');
    if (await statusModal.isVisible().catch(() => false)) {
      await statusModal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { });
    }

    const suggestedModal = page.locator('#dgic-modal-validateaddress_suggestedaddress');
    if (await suggestedModal.isVisible().catch(() => false)) {
      const useSuggestedBtn = page.locator('#ValidateAddress_SuggestedAddress_dialog_btn_1');
      if (await useSuggestedBtn.isVisible().catch(() => false)) {
        await page.waitForFunction(el => !el.disabled, useSuggestedBtn, { timeout: 10000 }).catch(() => { });
        if (await useSuggestedBtn.isEnabled().catch(() => false)) {
          await useSuggestedBtn.click();
          console.log('✅ Clicked "Use Suggested"');
        }
      }
      await suggestedModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
    }

    const closeNoAddressModal = async () => {
      const noAddressModal = page.locator('#dgic-modal-validateaddress_noaddressfound').first();
      if (await noAddressModal.isVisible().catch(() => false)) {
        const noAddressOkBtn = noAddressModal.locator('button:has-text("Ok"), button:has-text("OK"), #ValidateAddress_NoAddressFound_dialog_btn_0').first();
        if (await noAddressOkBtn.isVisible().catch(() => false)) {
          await page.waitForFunction(el => !el.disabled, noAddressOkBtn, { timeout: 5000 }).catch(() => { });
          if (await noAddressOkBtn.isEnabled().catch(() => false)) {
            await noAddressOkBtn.click({ force: true });
            console.log('✅ Closed "Address Validation" modal with OK');
          }
        }
        await noAddressModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
      }
    };

    await closeNoAddressModal();

    if (await statusModal.isVisible().catch(() => false)) {
      await statusModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
    }

    const locationDialog = page.locator('[role="dialog"]:has(h5:has-text("Auto Location Address"))').first();
    const locationSaveBtn = locationDialog.getByRole('button', { name: /^Save$/i }).first();
    const locationCancelBtn = locationDialog.getByRole('button', { name: /^Cancel$/i }).first();

    if (await locationSaveBtn.isVisible().catch(() => false)) {
      await closeNoAddressModal();
      await page.waitForFunction(el => !el.disabled, locationSaveBtn, { timeout: 10000 }).catch(() => { });
      if (await locationSaveBtn.isEnabled().catch(() => false)) {
        await locationSaveBtn.click();
        console.log('✅ Clicked location dialog Save');
      } else if (await locationCancelBtn.isVisible().catch(() => false) && await locationCancelBtn.isEnabled().catch(() => false)) {
        await closeNoAddressModal();
        await locationCancelBtn.click();
        console.log('⏭️  Save disabled, clicked location dialog Cancel');
      }
    }

    // Fallback: close Auto Location modal explicitly by known button ids
    const locationModal = page.locator('#dgic-modal-clautolocationaddress');
    if (await locationModal.isVisible().catch(() => false)) {
      const saveBtnById = page.locator('#CLAutoLocationAddress_dialog_btn_0');
      const cancelBtnById = page.locator('#CLAutoLocationAddress_dialog_btn_1');
      const saveVisible = await saveBtnById.isVisible().catch(() => false);
      const saveEnabled = await saveBtnById.isEnabled().catch(() => false);

      if (saveVisible && saveEnabled) {
        await closeNoAddressModal();
        await saveBtnById.click();
        console.log('✅ Fallback: clicked location Save by id');
      } else if (await cancelBtnById.isVisible().catch(() => false) && await cancelBtnById.isEnabled().catch(() => false)) {
        await closeNoAddressModal();
        await cancelBtnById.click({ force: true });
        console.log('✅ Fallback: clicked location Cancel by id');
      }

      await locationModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
    }
    await closeNoAddressModal();
    // Next button (safe)
    await page.getByRole('button', { name: 'Next ' }).click();
    // State specific info page
    await page.getByRole('button', { name: 'Next ' }).click();

    await page.waitForTimeout(150);
    // Ensure coverages page is loaded before processing dropdowns
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });

    await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
    // Process coverage dropdowns and track changes after State specific info page
    const coverageChanges = await processCoverageDropdowns();
    await page.waitForTimeout(300);

    // Close any modal dialogs that might be blocking interaction
    try {
      const modalCloseButton = page.locator('button[data-dismiss="modal"], button.close, .modal-close').first();
      const closeExists = await modalCloseButton.count().catch(() => 0);
      if (closeExists > 0) {
        const closeVisible = await modalCloseButton.isVisible().catch(() => false);
        if (closeVisible) {
          console.log('🔴 Closing modal dialog before clicking Next...');
          await modalCloseButton.click({ timeout: 5000 }).catch(() => { });
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {
      console.log('⏭️ No modal to close, continuing...');
    }
    trackMilestone('State specific info tab navigated');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(150);
    // Vehicles page
    //Private pessanger vehicles
    await page.locator('#CLAutoVehiclePrefill_dialog_btn_1').click();
    await page.waitForTimeout(150);
    await page.getByRole('combobox', { name: 'Add New Vehicle' }).click();
    await page.locator('#bs-select-2-1').click();
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await page.locator('#bs-select-3-1').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.locator('#txt_Vin').click();
    await page.locator('#txt_Vin').fill('1GBJ6C1BX8F416705');
    await page.getByText('Model *').click();
    await page.getByRole('combobox', { name: 'Please select' }).click();
    await page.locator('#bs-select-2-1').click();
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).click();
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('15555');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
    await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
    await processCoverageDropdowns();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Save Vehicle ' }).click();
    await page.waitForTimeout(300);
    trackMilestone('Private pessanger Vehicle Added');
    //Truck Vehicle 
    await page.getByRole('combobox', { name: 'Add New Vehicle' }).click();
    await page.locator('#bs-select-2-3').click();
    await page.getByRole('combobox', { name: 'Select Garaging Location' }).click();
    await page.locator('#bs-select-3-1').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.locator('#txt_Vin').click();
    await page.locator('#txt_Vin').fill('1FDXX46F93EA79961');
    await page.locator('#xrgn_CLAutoVehiclesDetails_LeftColumn').click();
    await page.locator('#xrgn_BusinessUseClass_Trucks_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-3-0').click();
    await page.locator('#xrgn_RadiusClass_Dropdown').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-4-0').click();
    await page.locator('#txt_SecondaryClassCode_Trucks_displayAll > .input-group-text').click();
    await clickTextItem('03 - Truckers - Tow Trucks For-Hire');
    await page.locator('#txt_GrossCombinedWeight').click();
    await page.locator('#txt_GrossCombinedWeight').fill('5000');
    await page.getByRole('textbox', { name: 'Description of Permanently' }).click();
    await page.getByRole('textbox', { name: 'Description of Permanently' }).fill('test desc');
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).click();
    await page.getByRole('textbox', { name: 'Original Cost New Of Vehicle' }).fill('01555');
    await page.getByRole('textbox', { name: 'Stated Amount' }).click();
    await page.getByRole('textbox', { name: 'Stated Amount' }).fill('0');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
    await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
    await processCoverageDropdowns();
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Save Vehicle ' }).click();
    trackMilestone('Truck Vehicle Added');
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.getByRole('button', { name: ' Close' }).click();
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.getByRole('button', { name: 'Next ' }).click();






















    // Create milestones for coverage dropdown updates (done once after all vehicles processed)
    // This consolidates tracking and prevents duplicate milestones from multiple processCoverageDropdowns() calls
    if (global.testData.coverageSectionStats && global.testData.coverageSectionStats.length > 0) {
      // Group by coverage section and sum up the stats to avoid duplicates
      const consolidatedStats = {};
      global.testData.coverageSectionStats.forEach(section => {
        const key = section.coverageSection;
        if (!consolidatedStats[key]) {
          consolidatedStats[key] = {
            coverageSection: section.coverageSection,
            durationSeconds: parseFloat(section.durationSeconds),
            dropdownsUpdated: section.dropdownsUpdated,
            dropdownsFound: section.dropdownsFound
          };
        } else {
          // If already exists, take the max duration and sum the updates
          consolidatedStats[key].durationSeconds = Math.max(consolidatedStats[key].durationSeconds, parseFloat(section.durationSeconds));
          consolidatedStats[key].dropdownsUpdated += section.dropdownsUpdated;
          consolidatedStats[key].dropdownsFound += section.dropdownsFound;
        }
      });

      // Create milestones for sections with updates
      Object.values(consolidatedStats).forEach(section => {
        if (section.dropdownsUpdated > 0) {
          const detail = `${section.dropdownsUpdated} dropdown(s) updated`;
          trackMilestone(`${section.coverageSection}: ${detail}`, 'PASSED', `Duration: ${section.durationSeconds.toFixed(2)}s`);
        }
      });
    }

    // QUICK RUN: optionally stop before quote/policy steps for faster output
    if (process.env.QUICK_RUN === 'true') {
      console.log('⏭️ QUICK_RUN enabled: stopping early before quote capture and downstream steps');
      return; // end test early
    }

    // Capture quote number with proper wait and fallback options
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.locator('#lblQuoteNumValue').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.log('⚠️ Quote number element not found, will use fallback');
    });

    let quoteNumber = 'N/A';
    try {
      // Try primary selector
      const primaryText = await page.locator('#lblQuoteNumValue').textContent({ timeout: 5000 }).catch(() => null);
      if (primaryText && primaryText.trim()) {
        quoteNumber = primaryText.trim();
        console.log('✓ Quote Number (primary):', quoteNumber);
      } else {
        // Try fallback selectors
        const fallbackSelectors = [
          '#contentHeader_lblPolicyDetails',
          'text=/Quote\\s*#\\s*:\\s*\\d+/',
          '[data-testid="quote-number"]',
          '.quote-number'
        ];

        for (const selector of fallbackSelectors) {
          try {
            const fallbackText = await page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
            if (fallbackText && fallbackText.trim()) {
              // Extract just the number if it contains extra text
              const match = fallbackText.match(/(\d+)/);
              if (match) {
                quoteNumber = match[1];
                console.log('✓ Quote Number (fallback):', quoteNumber);
                break;
              }
            }
          } catch (e) {
            // Continue to next fallback
          }
        }
      }
    } catch (e) {
      console.log('⚠️ Error capturing quote number:', e.message);
    }

    const submissionNumber = quoteNumber;
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
      } catch (e) { }
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

