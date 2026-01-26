// Set suite type for email reporter
process.env.TEST_TYPE = 'CA';

import { test, expect } from '@playwright/test';
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
      } catch (e) {}
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
  // Commercial Auto quote
  await page.getByText('Commercial Auto (v7)').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click();

  // Business Auto Coverage Form (jQuery UI combobox)
  await page.getByText('Product Eligibility', { exact: true }).click();
  await page.getByRole('textbox').click();
  
  // Wait for the dropdown menu to appear and select the first visible option
  await page.waitForTimeout(1000); // Allow dropdown to render
  const firstOption = page.locator('.ui-autocomplete li').first();
  await firstOption.waitFor({ state: 'visible', timeout: 5000 });
  await firstOption.click();

  await page.getByRole('button', { name: 'Yes' }).click();
  
  // Wait for the Product Eligibility dialog to close and the questions dialog to open
  console.log('Waiting for Commercial Auto questions dialog to load...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(10000);
  
  // Answer Commercial Auto questions
  console.log('Answering Commercial Auto eligibility questions...');
  
  // Debug: Check if any radio inputs exist on the page
  const allInputs = page.locator('input[type="radio"]');
  const totalInputs = await allInputs.count();
  console.log(`Found ${totalInputs} total radio input elements on page`);
  
  // Get all radio input elements with data-isuiradiobutton="true" (these are the actual clickable inputs)
  const allRadios = page.locator('input[type="radio"][data-isuiradiobutton="true"]');
  const totalRadios = await allRadios.count();
  console.log(`Found ${totalRadios} total radio button inputs with data-isuiradiobutton="true"`);
  
  // If still not found, log page structure for debugging
  if (totalRadios === 0) {
    console.log('⚠️ No radio buttons found. Checking page content...');
    const pageText = await page.locator('body').textContent();
    if (pageText?.includes('Are you quoting')) {
      console.log('✓ Questions page content is present on page');
    } else {
      console.log('❌ Questions page content NOT found - may still be on dialog');
    }
  }
  
  // Radio buttons come in pairs: [Yes/True, No/False] for each question
  // Identify which ones are "No" (value="false") and which are "Yes" (value="true")
  
  // Click "No" (value="false") for the first 7 questions
  const noRadios = page.locator('input[type="radio"][data-isuiradiobutton="true"][value="false"]');
  const noRadiosCount = await noRadios.count();
  console.log(`Found ${noRadiosCount} "No" (false) radio buttons`);
  
  for (let i = 0; i < Math.min(8, noRadiosCount); i++) {
    try {
      const noRadio = noRadios.nth(i);
      const isChecked = await noRadio.isChecked();
      
      if (!isChecked) {
        const radioParent = noRadio.locator('..').locator('.ui-radiobutton-icon');
        // Check if element is visible before trying to scroll
        const isVisible = await radioParent.isVisible().catch(() => false);
        if (!isVisible) {
          console.log(`⏭️  Question ${i + 1} radio button not visible, skipping`);
          continue;
        }
        await radioParent.scrollIntoViewIfNeeded({ timeout: 3000 });
        await radioParent.click({ timeout: 5000 });
        console.log(`✓ Clicked No for question ${i + 1}`);
      } else {
        console.log(`⏭️  No already selected for question ${i + 1}`);
      }
    } catch (e) {
      console.log(`⚠️  Could not click question ${i + 1}, skipping: ${e.message.split('\n')[0]}`);
    }
  }
  
  // Click "Yes" (value="true") for the last (certification) question
  const yesRadios = page.locator('input[type="radio"][data-isuiradiobutton="true"][value="true"]');
  const yesRadiosCount = await yesRadios.count();
  console.log(`Found ${yesRadiosCount} "Yes" (true) radio buttons`);
  
  if (yesRadiosCount > 0) {
    try {
      const lastYesRadio = yesRadios.last();
      const isChecked = await lastYesRadio.isChecked();
      
      if (!isChecked) {
        const radioParent = lastYesRadio.locator('..').locator('.ui-radiobutton-icon');
        const isVisible = await radioParent.isVisible().catch(() => false);
        if (!isVisible) {
          console.log('⏭️  Certification question radio button not visible, skipping');
        } else {
          await radioParent.scrollIntoViewIfNeeded({ timeout: 3000 });
          await radioParent.click({ timeout: 5000 });
          console.log('✓ Clicked Yes for certification question');
        }
      } else {
        console.log('⏭️  Yes already selected for certification question');
      }
    } catch (e) {
      console.log(`⚠️  Could not click certification question, skipping: ${e.message.split('\n')[0]}`);
    }
  }
  
  await page.getByRole('button', { name: 'Next ' }).click();
  trackMilestone('Commercial Auto Product Eligibility Completed');

  //await page.getByRole('button', { name: 'Finish' }).click();


  await page.locator('#ddlPriorCarrier').selectOption('Progressive');
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
  await page.getByRole('button', { name: 'Next ' }).click();
  trackMilestone('Commercial Auto Coverage Completed');

  // Initialize global tracking arrays if not already present
  if (!global.testData.coverageChanges) global.testData.coverageChanges = [];
  if (!global.testData.coverageSectionStats) global.testData.coverageSectionStats = [];
  if (!global.testData.addCoverageTimings) global.testData.addCoverageTimings = [];

  // Generic function to handle multiple "Add coverage" buttons
  async function processAllAddCoverageButtons() {
    console.log('🔍 Starting to process all "Add coverage" buttons...');
    const addCoverageTimings = [];
    
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
        
        // Capture coverage name from button's parent container (look for nearby text/label)
        let coverageName = 'Unknown Coverage';
        try {
          // Try to find the coverage label near the button (parent chain)
          const parentText = await currentButton.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card")][1]').locator('h3, h4, .section-title, label').first().textContent({ timeout: 500 }).catch(() => '');
          if (parentText?.trim()) {
            coverageName = parentText.trim();
          }
        } catch (e) {
          // If not found, try to get button's title attribute
          coverageName = await currentButton.getAttribute('title').catch(() => 'Unknown Coverage');
          if (!coverageName || coverageName === 'Add') {
            coverageName = 'Unknown Coverage';
          }
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
            addCoverageTimings.push({ index: processedCount, action: 'Remove Coverage', duration, coverage: coverageName });
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
          addCoverageTimings.push({ index: processedCount, action: 'Add Coverage', duration, coverage: coverageName });
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
    // APPEND to global array instead of replacing
    global.testData.addCoverageTimings.push(...addCoverageTimings);
  }
  
  // Generic function to process all coverage dropdowns and select 2nd value
  async function processCoverageDropdowns() {
    console.log('\n🔍 Starting to process coverage dropdowns...');

    const coverageChanges = [];
    const coverageSectionStats = [];
    const coverageHeaders = ['Liability', 'Uninsured Motorists Coverage', 'Uninsured Motorists Property Damage', 'PIP Coverage', 'Added Personal Injury Protection', 'Private Passenger Liability', 'Private Passenger Other Than Collision', 'Private Passenger Collision', 'Private Passenger Towing Labor', 'Private Passenger Uninsured Motorists Property Damage', 'Private Passenger Uninsured Motorists', 'Private Passenger Underinsured Motorists','Truck Liability','Truck Other Than Collision','Truck Collision','Truck Towing Labor','Truck Uninsured Motorists Property Damage','Truck Uninsured Motorists','Truck Underinsured Motorists','Rental Reimbursement','Medical Payments Coverage','Comprehensive Coverage','Collision Coverage','Truck Personal Injury Protection'];

    // Find all coverage sections by headers
    for (const headerText of coverageHeaders) {
      const sectionStartTime = Date.now();
      let sectionDropdownChanges = 0;
      let sectionDropdownsFound = 0;
      
      try {
        // Find the header element
        const headerLocator = page.locator(`text="${headerText}"`).first();
        const headerVisible = await headerLocator.isVisible().catch(() => false);
        
        if (!headerVisible) {
          console.log(`⏭️  Coverage section "${headerText}" not visible, skipping`);
          continue;
        }

        console.log(`📋 Processing coverage section: "${headerText}"`);

        // Wait 100ms before processing next coverage section to allow DOM to settle
        await page.waitForTimeout(100);

        // Get the parent container - look for nearest panel/card around the header
        let coverageSection = headerLocator.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card") or contains(@class,"ui-widget")][1]');
        let sectionCount = await coverageSection.count().catch(() => 0);
        if (sectionCount === 0) {
          // Fallback: go two levels up from header
          coverageSection = headerLocator.locator('..').locator('..').first();
          sectionCount = await coverageSection.count().catch(() => 0);
        }
        if (sectionCount === 0) {
          console.log(`  ⏭️  Could not locate container for "${headerText}", skipping`);
          continue;
        }

        // ✨ OPTIONAL: Try to click Edit Coverage button if present
        let modalOpened = false;
        let workingContainer = coverageSection; // Default to the coverage section
        try {
          const editButton = coverageSection.locator('i[title="Edit Coverage"]').first();
          const editExists = await editButton.count().catch(() => 0);
          
          if (editExists > 0) {
            const editVisible = await editButton.isVisible().catch(() => false);
            if (editVisible) {
              console.log(`  ✏️  Found Edit Coverage button, clicking it...`);
              await editButton.click({ timeout: 5000 });
              
              // Wait for modal to actually open and have content
              const modalLocator = page.locator('.modal, [role="dialog"]').first();
              await modalLocator.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
              
              // Wait for modal to have SELECT elements or other controls
              console.log(`  ✏️  Waiting for modal content to load...`);
              await page.waitForTimeout(500); // Wait for modal content to render
              
              modalOpened = true;
              workingContainer = modalLocator;
              console.log(`  ✏️  Edit Coverage modal opened, using modal as container`);
            }
          }
        } catch (e) {
          console.log(`  ⏭️  Edit Coverage button not found or not clickable for "${headerText}", continuing...`);
        }

        // Strategy: Look for SELECT elements in the working container (either section or modal)
        // If modal is open, we need to find SELECT elements inside the modal
        let selectElements = [];
        
        if (modalOpened) {
          // Look for SELECT elements in modal with extended wait
          console.log(`  🔍 Searching for SELECT elements in modal...`);
          
          // Wait LONGER for modal content to render - this is critical!
          console.log(`  ⏳ Waiting 2s for modal content to fully load...`);
          await page.waitForTimeout(2000);
          
          const modal = page.locator('.modal.show, [role="dialog"]:visible, .ui-dialog').first();
          
          // Try to find SELECT elements
          selectElements = await modal.locator('select').all().catch(() => []);
          console.log(`  🔍 Found ${selectElements.length} SELECT element(s) in modal after wait`);
          
          // If no SELECTs found, check if modal is actually there
          if (selectElements.length === 0) {
            try {
              const modalInfo = await modal.evaluate(el => ({
                isVisible: el.offsetHeight > 0 && el.offsetWidth > 0,
                hasContent: el.innerHTML.length > 0,
                selectCount: el.querySelectorAll('select').length,
                buttonCount: el.querySelectorAll('button').length,
                inputCount: el.querySelectorAll('input').length,
                classList: Array.from(el.classList).join(' ')
              })).catch(() => null);
              
              if (modalInfo) {
                console.log(`  🔍 Modal info - Visible: ${modalInfo.isVisible}, Content: ${modalInfo.hasContent}, SELECT: ${modalInfo.selectCount}, BUTTON: ${modalInfo.buttonCount}, INPUT: ${modalInfo.inputCount}`);
              }
            } catch (e) {
              console.log(`  🔍 Could not inspect modal: ${e.message.split('\n')[0]}`);
            }
          }
          
          workingContainer = modal;
        } else {
          // Look for SELECT elements in coverage section
          selectElements = await workingContainer.locator('select').all().catch(() => []);
          console.log(`  🔍 Found ${selectElements.length} SELECT element(s) in coverage section`);
        }
        
        console.log(`  📊 Found ${selectElements.length} SELECT element(s) in "${headerText}"`);
        sectionDropdownsFound = selectElements.length;
        
        const dropdowns = [];
        
        for (let idx = 0; idx < selectElements.length; idx++) {
          try {
            const select = selectElements[idx];
            
            // Get the hidden select's info
            const selectInfo = await select.evaluate(el => ({
              id: el.id,
              name: el.name,
              optionCount: el.querySelectorAll('option').length
            })).catch(() => ({}));
            
            if (!selectInfo.optionCount || selectInfo.optionCount < 2) {
              console.log(`    Candidate ${idx + 1}: SELECT id=${selectInfo.id} - only ${selectInfo.optionCount} option(s), skipping`);
              continue;
            }
            
            // Find the paired BUTTON (usually next sibling)
            const nextBtn = await select.locator('xpath=following-sibling::button[1]').first();
            const btnExists = await nextBtn.count().catch(() => 0);
            
            if (!btnExists) {
              console.log(`    Candidate ${idx + 1}: SELECT id=${selectInfo.id} - no paired button found`);
              continue;
            }
            
            // Verify button is visible
            const btnVisible = await nextBtn.isVisible().catch(() => false);
            if (!btnVisible) {
              console.log(`    Candidate ${idx + 1}: SELECT id=${selectInfo.id} - paired button not visible`);
              continue;
            }
            
            console.log(`    Candidate ${idx + 1}: SELECT id=${selectInfo.id} with ${selectInfo.optionCount} options - ADDED`);
            dropdowns.push({ select, button: nextBtn, selectId: selectInfo.id, optionCount: selectInfo.optionCount });
          } catch (e) {
            console.log(`    Candidate ${idx + 1}: Error - ${e.message.split('\n')[0]}`);
          }
        }
        
        const maxPerSection = 4; // Real dropdowns per section
        console.log(`  📊 Found ${dropdowns.length} valid dropdown(s) in "${headerText}" (processing up to ${maxPerSection})`);

        for (let j = 0; j < Math.min(dropdowns.length, maxPerSection); j++) {
          try {
            const { select, button, selectId } = dropdowns[j];
            const dropdownStartTime = Date.now(); // Track individual dropdown time

            // Get current select value as old value
            const oldValue = await select.evaluate(el => {
              const selected = el.querySelector('option:checked');
              return selected ? selected.textContent.trim() : 'Current';
            }).catch(() => 'Current');
            
            console.log(`    Processing #${j + 1} (${selectId}): current = "${oldValue}"`);

            // Try direct select option change instead of clicking button
            try {
              // Find the 2nd option in the select
              const options = await select.locator('option').all();
              if (options.length < 2) {
                console.log(`      SELECT has only ${options.length} option(s), skipping`);
                continue;
              }
              
              // Get 2nd option value
              const secondOptionValue = await options[1].getAttribute('value');
              const secondOptionText = await options[1].textContent();
              
              console.log(`      Found 2nd option: "${secondOptionText.trim()}"`);
              
              // Change select directly
              await select.selectOption(secondOptionValue);
              await page.waitForTimeout(300); // Reduced wait time
              
              // Trigger change event
              await select.evaluate(el => {
                const event = new Event('change', { bubbles: true });
                el.dispatchEvent(event);
              });
              
              const dropdownDuration = ((Date.now() - dropdownStartTime) / 1000).toFixed(2);
              console.log(`    ✓ "${selectId}": "${oldValue}" → "${secondOptionText.trim()}" (${dropdownDuration}s)`);
              coverageChanges.push({ 
                quoteNumber: global.testData.quoteNumber || 'N/A',
                coverageSection: headerText,
                coverage: selectId,
                oldValue,
                newValue: secondOptionText.trim(),
                status: 'Updated',
                durationSeconds: dropdownDuration
              });
              sectionDropdownChanges += 1;
              
              // Wait before processing next dropdown to allow DOM to settle
              if (j < Math.min(dropdowns.length, maxPerSection) - 1) {
                console.log(`    ⏳ Waiting for next dropdown to be ready...`);
                await page.waitForTimeout(500); // Reduced from 1000ms to 500ms
              }
            } catch (e) {
              console.log(`      Direct select failed: ${e.message.split('\n')[0]}`);
            }
          } catch (e) {
            console.log(`    ⚠️  Error processing dropdown ${j + 1}: ${e.message.split('\n')[0]}`);
          }
        }

        // ✨ OPTIONAL: Click Save button after processing dropdowns (if modal was opened OR if regular save button exists)
        if (modalOpened) {
          // Modal was opened, so click the Save button in the modal to close it
          try {
            const modalSaveButton = page.locator('button:has-text("Save")').first();
            const modalSaveVisible = await modalSaveButton.isVisible().catch(() => false);
            if (modalSaveVisible) {
              console.log(`  💾 Closing Edit Coverage modal with Save button...`);
              await modalSaveButton.click({ timeout: 5000 });
              await page.waitForTimeout(1000); // Wait for modal to close
              console.log(`  💾 Modal closed`);
            }
          } catch (e) {
            console.log(`  ⏭️  Could not close modal for "${headerText}", continuing...`);
          }
        } else {
          // No modal, try to find Save button in the coverage section itself
          try {
            const saveButton = coverageSection.locator('button:has-text("Save"), button[title*="Save"]').first();
            const saveExists = await saveButton.count().catch(() => 0);
            
            if (saveExists > 0) {
              const saveVisible = await saveButton.isVisible().catch(() => false);
              if (saveVisible) {
                console.log(`  💾 Found Coverage Section Save button, clicking it...`);
                await saveButton.click({ timeout: 5000 });
                console.log(`  💾 Save button clicked, waiting for processing...`);
                await page.waitForTimeout(2000); // Wait for backend to process and UI to update
                console.log(`  💾 Processing complete`);
              }
            }
          } catch (e) {
            console.log(`  ⏭️  Save button not found or not clickable for "${headerText}", continuing...`);
          }
        }

      } catch (e) {
        console.log(`⚠️  Error processing coverage section "${headerText}": ${e.message.split('\n')[0]}`);
      }
      
      // Capture section timing (always capture if section exists and has dropdowns)
      const sectionDuration = ((Date.now() - sectionStartTime) / 1000).toFixed(2);
      if (sectionDropdownsFound > 0 || sectionDropdownChanges > 0) {
        console.log(`⏱️  Section "${headerText}" took ${sectionDuration}s, ${sectionDropdownChanges} dropdown(s) changed out of ${sectionDropdownsFound} found`);
        coverageSectionStats.push({
          quoteNumber: global.testData.quoteNumber || 'N/A',
          coverageSection: headerText,
          durationSeconds: sectionDuration,
          dropdownsFound: sectionDropdownsFound,
          dropdownsUpdated: sectionDropdownChanges
        });
      }
    }

    console.log(`\n✅ Completed processing coverage dropdowns`);
    console.table(coverageChanges);

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
  await page.getByRole('button', { name: 'Next ' }).click(); 
  trackMilestone('locations tab navigated');
  await page.waitForTimeout(150);
  // State specific info page
  await page.getByRole('button', { name: 'Next ' }).click();
    trackMilestone('State specific info tab navigated');
  await page.waitForTimeout(150);
  // Ensure coverages page is loaded before processing dropdowns
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  
  await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
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
        await modalCloseButton.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  } catch (e) {
    console.log('⏭️ No modal to close, continuing...');
  }
  
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(150);
  // Vehicles page
  //Private pessanger vehicles
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
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
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
  await page.getByRole('gridcell', { name: '03 - Truckers - Tow Trucks' }).click();
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
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
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





















  // Capture quote number with proper wait and fallback options
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});
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
