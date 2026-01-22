import { test, expect } from '@playwright/test';
const { randCompany, randFirstName, randLastName, randDriverLicense } = require('./helpers/randomData');
const { randAddressForState, TARGET_STATES } = require('./stateConfig');
const { generateVIN } = require('./helpers/vin');
const fs = require('fs');
const path = require('path');

// Global array to store all quote results across all states
const quoteResults = [];

// Helper: auto-fill any visible, enabled dropdowns with the first non-placeholder option
async function autoFillMissingDropdowns(page) {
  try {
    console.log('Auto-filling missing dropdowns before submit...');
    const dropdowns = page.locator('select:visible:not([disabled])');
    const count = await dropdowns.count();
    
    // Collect all unselected dropdowns first, then fill them all quickly
    const unselectedIndices = [];
    for (let i = 0; i < count; i++) {
      const dd = dropdowns.nth(i);
      const isVisible = await dd.isVisible().catch(() => false);
      if (!isVisible) continue;

      const selectedIndex = await dd.evaluate(el => el.selectedIndex).catch(() => -1);
      if (selectedIndex <= 0) {
        unselectedIndices.push(i);
      }
    }
    
    // Fast fill all unselected dropdowns without long waits
    for (const i of unselectedIndices) {
      const dd = dropdowns.nth(i);
      const optionTexts = await dd.locator('option').allTextContents().catch(() => []);
      let idxToSelect = -1;
      
      // Find first valid (non-placeholder) option
      for (let j = 1; j < optionTexts.length; j++) {
        const t = (optionTexts[j] || '').trim();
        if (!t || /^(select|please select|choose|--|none)/i.test(t)) continue;
        idxToSelect = j;
        break;
      }
      
      if (idxToSelect > 0) {
        await dd.selectOption({ index: idxToSelect }).catch(async () => {
          // Quick keyboard fallback
          await dd.focus().catch(() => {});
          await dd.press('ArrowDown').catch(() => {});
          await dd.press('Enter').catch(() => {});
        });
        // Only wait 100ms instead of 600ms for validation
        await page.waitForTimeout(100);
      }
    }
    
    if (unselectedIndices.length > 0) {
      console.log(`Auto-filled ${unselectedIndices.length} dropdowns`);
    }
  } catch (e) {
    console.log('Auto-fill dropdowns encountered an issue:', e.message);
  }
}

for (const STATE of (process.env.TEST_STATES ? process.env.TEST_STATES.split(',').map(s => s.trim().toUpperCase()) : TARGET_STATES)) {
test(`CA flow - ${STATE}`, async ({ page }) => {
  await page.goto('https://demo.tarmika.com/agentportal/');
  await page.getByRole('textbox', { name: 'Login Name' }).click();
  await page.getByRole('textbox', { name: 'Login Name' }).fill('amitmishra@donegalgroup.com');
  await page.getByRole('textbox', { name: 'Login Name' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('Donegal$1');
  await page.getByRole('button', { name: 'SIGN IN' }).click();
  await page.getByRole('button', { name: 'CREATE QUOTE', exact: true }).click();
  await page.getByRole('button', { name: 'Commercial Automobile This' }).click();
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  await page.locator('#mat-input-2').click();
  await page.locator('#mat-input-2').fill('238220');
  await page.getByText('[238220] HVAC (heating,').click();
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  // Randomize business name per state
  const bizName = `${randCompany()} ${STATE}`;
  await page.locator('app-field-label').filter({ hasText: 'Business/Organization Name (' }).getByRole('textbox').click();
  await page.locator('app-field-label').filter({ hasText: 'Business/Organization Name (' }).getByRole('textbox').fill(bizName);
  
  // Get a real address for this state (street, city, state, zip)
  const realAddress = randAddressForState(STATE);
  const fullAddress = `${realAddress.street}, ${realAddress.city}, ${STATE} ${realAddress.zip}`;
  
  // Try Primary Location Address button approach first
  let addressSaved = false;
  try {
    const primaryLocationButton = page.locator('app-quote-group').filter({ hasText: 'Primary Location Address' }).getByRole('button');
    if (await primaryLocationButton.count() > 0) {
      await primaryLocationButton.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      
      const enterAddressInput = page.getByRole('textbox', { name: 'Enter address' });
      await enterAddressInput.waitFor({ state: 'visible', timeout: 2000 });
      await enterAddressInput.click();
      
      // Clear any existing content first
      await enterAddressInput.fill('');
      await page.waitForTimeout(300);
      
      // Type slowly with longer delays to allow system to process and validate
      await enterAddressInput.type(fullAddress, { delay: 100 });
      await page.waitForTimeout(1000); // Allow address validation/suggestion system to process
      
      // Check if address suggestions appeared
      const suggestionsPanel = page.locator('.mat-autocomplete-panel[role="listbox"], [role="listbox"]');
      const suggestionsVisible = await suggestionsPanel.count().catch(() => 0);
      
      if (suggestionsVisible > 0) {
        // Wait for suggestions to be ready and select first one
        await page.waitForTimeout(500);
        const firstSuggestion = suggestionsPanel.locator('[role="option"]').first();
        if (await firstSuggestion.count() > 0) {
          await firstSuggestion.click({ timeout: 2000 });
          await page.waitForTimeout(800);
        }
      }
      
      // Click confirm/next button
      await page.getByRole('button').nth(1).click({ timeout: 2000 });
      await page.waitForTimeout(600);
      
      // Click SAVE button
      await page.getByRole('button', { name: 'SAVE' }).click({ timeout: 2000 });
      await page.waitForTimeout(1000);
      
      addressSaved = true;
    }
  } catch (e) {
    console.log('Primary Location Address button not available, using autocomplete method:', e.message);
  }
  
  // Fallback: Use autocomplete method if button approach didn't work
  if (!addressSaved) {
    const streetAddressInput = page.getByPlaceholder('Start typing to see Address suggestions').first();
    await streetAddressInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    await streetAddressInput.click();
    await streetAddressInput.fill('');
    await streetAddressInput.type(fullAddress, { delay: 40 });

    // wait for mat-autocomplete panel and select first matching suggestion
    const autoPanel = page.locator('.mat-autocomplete-panel[role="listbox"]');
    await autoPanel.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800); // Allow options to fully render
    
    // Try to select the first available option with fallback to keyboard
    try {
      const firstOption = autoPanel.locator('[role="option"]').first();
      await firstOption.waitFor({ state: 'attached', timeout: 2000 });
      await page.waitForTimeout(300);
      await firstOption.hover({ timeout: 2000 });
      await page.waitForTimeout(200);
      await firstOption.click({ force: true, timeout: 2000 });
    } catch (e) {
      console.log('Click failed, using keyboard navigation');
      // Fallback: use keyboard to select
      await streetAddressInput.press('ArrowDown');
      await page.waitForTimeout(300);
      await streetAddressInput.press('Enter');
    }
    
    // blur to persist value
    await page.waitForTimeout(500);
    await streetAddressInput.press('Tab');
    await page.waitForTimeout(300);
    
    // Verify the address contains the state, city, and zip
    await expect(streetAddressInput).toHaveValue(new RegExp(`${realAddress.city}.*${STATE}.*${realAddress.zip}`, 'i'));
  }
  
  // Is the mailing address the same as the primary location? - Click Yes by clicking the label
  // Close any overlays that might be blocking clicks
  const overlays = page.locator('.cdk-overlay-container, .mat-autocomplete-panel');
  const overlayCount = await overlays.count().catch(() => 0);
  if (overlayCount > 0) {
    await page.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  
  // Click the radio button with force if needed
  const radioYes = page.locator('app-boolean-field').filter({ hasText: 'Is the mailing address the' }).locator('label.ym_radio_button_check.check_yes');
  await radioYes.click({ force: true, timeout: 2000 }).catch(async () => {
    // Fallback: scroll and try again
    await radioYes.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await radioYes.click({ force: true, timeout: 2000 });
  });
  
  //await page.locator('#mat-input-4').click();
  //await page.locator('#mat-input-4').fill('785 PARK ST CASTLE ROCK, CO 80109-1523');
  //await page.getByText('Park St Castle Rock, CO 80109').click();
  await page.locator('app-field-label').filter({ hasText: 'Business Phone' }).getByRole('textbox').click();
  await page.locator('app-field-label').filter({ hasText: 'Business Phone' }).getByRole('textbox').fill('(717)555-1212');
  const contactFirst = randFirstName();
  const contactLast = randLastName();
  await page.locator('app-field-label').filter({ hasText: 'Contact First Name' }).getByRole('textbox').click();
  await page.locator('app-field-label').filter({ hasText: 'Contact First Name' }).getByRole('textbox').fill(contactFirst);
  await page.locator('app-field-label').filter({ hasText: 'Contact First Name' }).getByRole('textbox').press('Tab');

  await page.locator('app-field-label').filter({ hasText: 'Contact Last Name' }).getByRole('textbox').fill(contactLast);
  await page.locator('app-field-label').filter({ hasText: 'Contact Last Name' }).getByRole('textbox').press('Tab');
  await page.locator('input[type="email"]').fill('donegal@group.com');
  await page.locator('app-field-label').filter({ hasText: 'Corporate/Organizational' }).getByRole('combobox').selectOption('1: Corporation');
  await page.getByRole('textbox', { name: 'Enter or Select a Date' }).click();
  await page.getByRole('button', { name: 'Open calendar' }).click();
  await page.getByRole('button', { name: 'January 13,' }).click();
  await page.locator('app-quote-field:nth-child(3) > app-field-label > .ym_form_group > .ng-untouched').click();
  await page.locator('app-quote-field:nth-child(3) > app-field-label > .ym_form_group > .ng-untouched').fill('62-4354563');
  const yearsInput = page.locator('app-quote-field').filter({ hasText: 'Years of Management Experience' })
    .locator('input[type="number"], input[type="text"], textarea')
    .first();
  await yearsInput.click();
  await yearsInput.fill('');
  await yearsInput.type('15', { delay: 50 });
  await yearsInput.press('Tab');
  await expect(yearsInput).toHaveValue(/15/);
  await page.locator('div').filter({ hasText: 'Corporate/Organizational' }).nth(5).click();
  await page.locator('app-field-label').filter({ hasText: 'Does the insured currently' }).getByRole('combobox').selectOption('2: No');

  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  await page.locator('app-field-label').filter({ hasText: 'Vehicle or Trailer Please' }).getByRole('combobox').selectOption('2: Trailer');
  await page.locator('app-field-label').filter({ hasText: 'Vehicle or Trailer Please' }).getByRole('combobox').selectOption('1: Vehicle');
  await page.getByRole('textbox').first().click();
  await page.getByRole('textbox').first().fill(generateVIN());
  // Fill Year field (next textbox) with extra persistence checks
  const yearBox = page.getByRole('textbox').nth(1);
  await yearBox.click({ trial: true }).catch(() => {});
  await yearBox.fill('');
  await yearBox.type('2021', { delay: 80 }).catch(() => {});
  await yearBox.press('Tab').catch(() => {});
  await expect(yearBox).toHaveValue(/2021/);

  await page.locator('div').filter({ hasText: 'Quote DetailsAppetiteApplicant InformationRisk InformationMarket' }).first().click();
  await page.getByRole('textbox').nth(1).click();
  await page.getByRole('textbox').nth(1).press('Tab');
  // Make / Model / Trim with explicit inputs to avoid clearing
  const makeInput = page.locator('app-field-label', { hasText: 'Make' }).locator('input[type="text"], textarea').first();
  await makeInput.click();
  await makeInput.fill('');
  await makeInput.type('Ford', { delay: 50 });
  await makeInput.press('Tab');

  const modelInput = page.locator('app-field-label', { hasText: 'Model' }).locator('input[type="text"], textarea').first();
  await modelInput.click();
  await modelInput.fill('');
  await modelInput.type('Edge', { delay: 50 });
  await modelInput.press('Tab');

  const trimInput = page.locator('app-field-label', { hasText: 'Trim' }).locator('input[type="text"], textarea').first();
  await trimInput.click();
  await trimInput.fill('');
  await trimInput.type('SEL', { delay: 50 });
  await trimInput.press('Tab');


  await page.locator('app-field-label').filter({ hasText: 'Body Type Please select' }).getByRole('combobox').selectOption('2: Sport Utility Vehicle');
  await page.locator('app-field-label').filter({ hasText: 'Vehicle Class Please select' }).getByRole('combobox').selectOption('1: Private Passenger');

  // Gross Vehicle Weight
  const gvwInput = page.locator('app-field-label', { hasText: 'Gross Vehicle Weight' })
    .locator('input[type="text"], input[type="number"], textarea').first();
  await gvwInput.click({ trial: true }).catch(() => {});
  await gvwInput.fill('');
  await gvwInput.type('4500', { delay: 60 }).catch(() => {});
  await gvwInput.press('Tab').catch(() => {});
  await page.waitForTimeout(500);

  // Cost New - fill immediately after GVW before dropdowns to avoid clearing
  const costNewInput = page.locator('app-field-label', { hasText: 'Cost New' })
    .locator('input[type="text"], input[type="number"], textarea').first();
  await costNewInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
  await costNewInput.click();
  await costNewInput.fill('');
  await costNewInput.type('30000', { delay: 80 });
  await page.waitForTimeout(300);
  await costNewInput.press('Tab');
  await page.waitForTimeout(800);

  await page.locator('app-field-label').filter({ hasText: 'Do you lease or own? Please' }).getByRole('combobox').selectOption('1: Leased by Insured');
  await page.waitForTimeout(500);
  
  await page.locator('app-field-label').filter({ hasText: 'Is the vehicle used for' }).getByRole('combobox').selectOption('1: Business');
  await page.waitForTimeout(500);
  
  await page.locator('app-field-label').filter({ hasText: 'Nature of Use Please select' }).getByRole('combobox').selectOption('1: Drive to Work or School Over 15 Miles');
  await page.waitForTimeout(1000); // Nature of Use may trigger validation/updates
  
  // Primary Use of Vehicle - select first available option
  const primaryUseDropdown = page.locator('app-field-label', { hasText: 'Primary Use of Vehicle' }).getByRole('combobox');
  await primaryUseDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const primaryOptions = await primaryUseDropdown.locator('option').allTextContents().catch(() => []);
  if (primaryOptions.length > 1) {
    await primaryUseDropdown.selectOption({ index: 1 }); // Select first non-placeholder option
    await page.waitForTimeout(800); // Wait for any validation/updates
  }

  // Driving Radius - select first available option
  const drivingRadiusDropdown = page.locator('app-field-label', { hasText: 'Driving Radius' }).getByRole('combobox');
  await drivingRadiusDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const radiusOptions = await drivingRadiusDropdown.locator('option').allTextContents().catch(() => []);
  if (radiusOptions.length > 1) {
    await drivingRadiusDropdown.selectOption({ index: 1 }); // Select first non-placeholder option
    await page.waitForTimeout(2000); // Wait for page to process the selection (AJAX/validation)
  }

  // Liability / medical limits - select first available real options
  const liabilityDropdown = page.locator('app-field-label', { hasText: 'Liability' }).getByRole('combobox');
  await liabilityDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400); // Extra wait for dropdown to fully render
  const liabilityOptions = await liabilityDropdown.locator('option').allTextContents().catch(() => []);
  console.log('Liability Deductible options:', liabilityOptions);
  if (liabilityOptions.length > 1) {
    await liabilityDropdown.selectOption({ index: 1 }).catch(async () => {
      console.log('selectOption failed for Liability Deductible, using keyboard');
      await liabilityDropdown.focus().catch(() => {});
      await liabilityDropdown.press('ArrowDown').catch(() => {});
      await liabilityDropdown.press('Enter').catch(() => {});
    });
    await page.waitForTimeout(700); // Wait for value to persist
  }

  const medPayDropdown = page.locator('app-quote-field:nth-child(3) app-dropdown-field select').first();
  await medPayDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await medPayDropdown.selectOption({ index: 1 }).catch(() => {});

  // PIP fields - select first non-placeholder options
  const basicPipDropdown = page.locator('app-field-label', { hasText: 'Basic PIP Limit' }).getByRole('combobox');
  await basicPipDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await basicPipDropdown.selectOption({ index: 1 }).catch(() => {});

  const pipDeductibleDropdown = page.locator('app-field-label', { hasText: 'PIP Deductible' }).getByRole('combobox').first();
  await pipDeductibleDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  const pipDeductOptions = await pipDeductibleDropdown.locator('option:not([disabled])').allTextContents().catch(() => []);
  if (pipDeductOptions.length > 1) {
    await pipDeductibleDropdown.selectOption({ index: 1 }).catch(async () => {
      await pipDeductibleDropdown.focus().catch(() => {});
      await pipDeductibleDropdown.press('ArrowDown').catch(() => {});
      await pipDeductibleDropdown.press('Enter').catch(() => {});
    });
  }

  const pipDeductibleAppDropdown = page.locator('app-field-label', { hasText: 'PIP Deductible Application' }).getByRole('combobox');
  await pipDeductibleAppDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400); // Extra wait for dropdown to fully render
  const pipAppOptions = await pipDeductibleAppDropdown.locator('option').allTextContents().catch(() => []);
  console.log('PIP Deductible Application options:', pipAppOptions);
  if (pipAppOptions.length > 1) {
    await pipDeductibleAppDropdown.selectOption({ index: 1 }).catch(async () => {
      console.log('selectOption failed for PIP Deductible Application, using keyboard');
      await pipDeductibleAppDropdown.focus().catch(() => {});
      await pipDeductibleAppDropdown.press('ArrowDown').catch(() => {});
      await pipDeductibleAppDropdown.press('Enter').catch(() => {});
    });
    await page.waitForTimeout(700); // Wait for value to persist
  }

  // Added PIP Coverage - select No
  const addedPipField = page.locator('app-boolean-field').filter({ hasText: 'Added PIP Coverage' });
  await addedPipField.locator('label.ym_radio_button_check.check_no').click().catch(() => {});

  await page.locator('.w-100.ng-untouched').first().click();
  await page.locator('.w-100.ng-untouched').first().fill('Caleb');
  await page.locator('.w-100.ng-untouched').first().press('Tab');
  await page.locator('.w-100.ng-untouched').first().fill('Murphy');
  await page.locator('.w-100.ng-untouched').first().press('Tab');
  
  // Date of Birth - first date field (placeholder Enter or Select a Date)
  const dobInput = page.getByPlaceholder('Enter or Select a Date').first();
  await dobInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await dobInput.click();
  await dobInput.fill('');
  await dobInput.type('01/01/1967', { delay: 50 });
  await dobInput.press('Tab');
  
  await page.locator('app-quote-field:nth-child(4) > app-dropdown-field > app-field-label > .ym_form_group > .ym_form_select > .ng-untouched').selectOption('2: Male');
  
  // Date First Licensed - second date field (placeholder Enter or Select a Date)
  const dateFirstLicensedInput = page.getByPlaceholder('Enter or Select a Date').nth(1);
  await dateFirstLicensedInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await dateFirstLicensedInput.click();
  await dateFirstLicensedInput.fill('');
  await dateFirstLicensedInput.type('01/01/2002', { delay: 50 });
  await dateFirstLicensedInput.press('Tab');
  
  await page.locator('.w-100.ng-untouched').click();
  await page.locator('.w-100.ng-untouched').fill(randDriverLicense(STATE));
  await page.locator('.w-100.ng-untouched').press('Tab');
  
  // State Issuing Driver's License - select the STATE being tested
  const driverLicenseStateDropdown = page.locator('app-field-label', { hasText: 'State Issuing Driver\'s License' }).getByRole('combobox');
  await driverLicenseStateDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  console.log(`Selecting driver's license state: ${STATE}`);
  
  // Get all options for debugging
  const allOptions = await driverLicenseStateDropdown.locator('option').allTextContents().catch(() => []);
  console.log('Available state options:', allOptions);
  
  // Try selecting by label matching STATE, fallback to value, then search by text
  let stateSelected = false;
  try {
    await driverLicenseStateDropdown.selectOption({ label: STATE });
    stateSelected = true;
    console.log(`Selected state by label: ${STATE}`);
  } catch (e1) {
    try {
      await driverLicenseStateDropdown.selectOption({ value: STATE });
      stateSelected = true;
      console.log(`Selected state by value: ${STATE}`);
    } catch (e2) {
      // If STATE format doesn't match, try finding option containing STATE
      const options = await driverLicenseStateDropdown.locator('option').all();
      for (let i = 0; i < options.length; i++) {
        const text = await options[i].textContent();
        if (text && (text.trim() === STATE || text.includes(STATE))) {
          await driverLicenseStateDropdown.selectOption({ index: i });
          stateSelected = true;
          console.log(`Selected state by text match at index ${i}: ${text}`);
          break;
        }
      }
    }
  }
  
  if (!stateSelected) {
    console.log(`⚠️ WARNING: Could not select state ${STATE}, may have defaulted to first option`);
  }
  
  // Verify selection
  const selectedValue = await driverLicenseStateDropdown.inputValue().catch(() => 'unknown');
  console.log(`Driver's license state selected value: ${selectedValue}`);

  // License Status - select first available option
  const licenseStatusDropdown = page.locator('app-field-label', { hasText: 'License Status' }).getByRole('combobox');
  await licenseStatusDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const licenseStatusOptions = await licenseStatusDropdown.locator('option').allTextContents().catch(() => []);
  if (licenseStatusOptions.length > 1) {
    await licenseStatusDropdown.selectOption({ index: 1 });
  }

  // Driver Marital Status - select first available option
  const maritalStatusDropdown = page.locator('app-field-label', { hasText: 'Driver Marital Status' }).getByRole('combobox');
  await maritalStatusDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const maritalStatusOptions = await maritalStatusDropdown.locator('option').allTextContents().catch(() => []);
  if (maritalStatusOptions.length > 1) {
    await maritalStatusDropdown.selectOption({ index: 1 });
  }

  // Years of Driving Experience - select first available option
  const drivingExpDropdown = page.locator('app-field-label', { hasText: 'Years of Driving Experience' }).getByRole('combobox');
  await drivingExpDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const drivingExpOptions = await drivingExpDropdown.locator('option').allTextContents().catch(() => []);
  if (drivingExpOptions.length > 1) {
    await drivingExpDropdown.selectOption({ index: 1 });
  }

  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();

  // Vehicle Operator Experience: pick last available option
  const operatorExperienceDropdown = page.locator('app-field-label', { hasText: 'Vehicle Operator Experience' })
    .locator('select')
    .first();

  if (await operatorExperienceDropdown.count() > 0) {
    try {
      await operatorExperienceDropdown.waitFor({ state: 'visible', timeout: 4000 });
      await operatorExperienceDropdown.scrollIntoViewIfNeeded().catch(() => {});
      // Select the last non-disabled option (skip placeholder)
      const optionCount = await operatorExperienceDropdown.locator('option:not([disabled])').count();
      const lastIndex = optionCount > 1 ? optionCount - 1 : 1; // if only placeholder +1 option, pick index 1
      await operatorExperienceDropdown.selectOption({ index: lastIndex }, { timeout: 3000 }).catch(async () => {
        // Hard fallback: set selectedIndex via DOM and dispatch change
        await operatorExperienceDropdown.evaluate((el, idx) => {
          const safeIdx = Math.max(1, idx);
          el.selectedIndex = safeIdx;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, lastIndex).catch(() => {});
      });
      await page.waitForTimeout(200);
    } catch (e) {
      console.log('⚠️ Vehicle Operator Experience selection failed:', e.message);
    }
  }
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  await page.locator('app-market-selection-page a').click();
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  await page.getByRole('button', { name: 'SAVE & CONTINUE' }).click();
  
  // Producer Contact First Name - label-based locator
  const producerFirstNameInput = page.locator('app-field-label', { hasText: 'Producer Contact First Name' })
    .locator('input[type="text"], input[type="email"], textarea').first();
  await producerFirstNameInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await producerFirstNameInput.click();
  await producerFirstNameInput.fill('');
  await producerFirstNameInput.type('John', { delay: 50 });
  await producerFirstNameInput.press('Tab');

  // Producer Contact Last Name - label-based locator
  const producerLastNameInput = page.locator('app-field-label', { hasText: 'Producer Contact Last Name' })
    .locator('input[type="text"], input[type="email"], textarea').first();
  await producerLastNameInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await producerLastNameInput.click();
  await producerLastNameInput.fill('');
  await producerLastNameInput.type('Doe', { delay: 50 });
  await producerLastNameInput.press('Tab');

  // Additional Notes textarea
  const notesTextarea = page.locator('textarea').first();
  await notesTextarea.click();
  await notesTextarea.fill('test');

  await page.locator('app-field-label').filter({ hasText: 'Donegal AUTOB QuestionBody' }).getByRole('combobox').selectOption('2: Sport Utility Vehicle');
  await page.waitForTimeout(500);
  
  await page.locator('app-field-label').filter({ hasText: 'Donegal AUTOB QuestionVehicle' }).getByRole('combobox').selectOption('1: Private Passenger');
  await page.waitForTimeout(500);
  
  await page.locator('app-field-label').filter({ hasText: 'Donegal AUTOB QuestionNature' }).getByRole('combobox').selectOption('1: Commercial');
  await page.waitForTimeout(500);
  
  await page.locator('app-field-label').filter({ hasText: 'Donegal AUTOB QuestionDriving' }).getByRole('combobox').selectOption('1: Local');
  await page.waitForTimeout(800);
  
  // State Coverages dropdown - pick first real option (avoid hardcoded value)
  const stateCoverageDropdown = page.locator('app-quote-group').filter({ hasText: 'State CoveragesDonegal AUTOB' }).getByRole('combobox');
  await stateCoverageDropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const stateCoverageOptions = await stateCoverageDropdown.locator('option').allTextContents().catch(() => []);
  if (stateCoverageOptions.length > 1) {
    await stateCoverageDropdown.selectOption({ index: 1 }).catch(() => {}); // first non-placeholder
    await page.waitForTimeout(1000); // State Coverage may trigger backend validation
  }
  
  // What is the maximum value of - label-based locator with persistence
  const maxValueInput = page.locator('app-field-label').filter({ hasText: 'What is the maximum value of' }).getByRole('textbox');
  await maxValueInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await maxValueInput.click();
  await maxValueInput.fill('');
  await maxValueInput.type('50000', { delay: 50 });
  await maxValueInput.press('Tab');
  await expect(maxValueInput).toHaveValue(/50,?000/);

  // What is the maximum square - label-based locator with persistence
  const maxSquareInput = page.locator('app-field-label').filter({ hasText: 'What is the maximum square' }).getByRole('textbox');
  await maxSquareInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await maxSquareInput.click();
  await maxSquareInput.fill('');
  await maxSquareInput.type('25000', { delay: 50 });
  await maxSquareInput.press('Tab');
  await expect(maxSquareInput).toHaveValue(/25,?000/);

  // What is the maximum height in - label-based locator with persistence
  const maxHeightInput = page.locator('app-field-label').filter({ hasText: 'What is the maximum height in' }).getByRole('textbox');
  await maxHeightInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await maxHeightInput.click();
  await maxHeightInput.fill('');
  await maxHeightInput.type('20', { delay: 50 });
  await maxHeightInput.press('Tab');
  await expect(maxHeightInput).toHaveValue(/20/);

  // What is the percent of work subcontracted? - label-based locator
  const percentSubcontractedInput = page.locator('app-field-label', { hasText: 'What is the percent of work subcontracted' })
    .locator('input[type="text"], input[type="number"], textarea').first();
  await percentSubcontractedInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await percentSubcontractedInput.click();
  await percentSubcontractedInput.fill('');
  await percentSubcontractedInput.type('25', { delay: 50 });
  await percentSubcontractedInput.press('Tab');

  // Total Revenue - label-based locator
  const totalRevenueInput = page.locator('app-field-label', { hasText: 'Total Revenue' })
    .locator('input[type="text"], input[type="number"], textarea').first();
  await totalRevenueInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await totalRevenueInput.click();
  await totalRevenueInput.fill('');
  await totalRevenueInput.type('500000', { delay: 50 });
  await totalRevenueInput.press('Tab');

  // Total Annual Payroll - label-based locator
  const totalPayrollInput = page.locator('app-field-label', { hasText: 'Total Annual Payroll' })
    .locator('input[type="text"], input[type="number"], textarea').first();
  await totalPayrollInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  await totalPayrollInput.click();
  await totalPayrollInput.fill('');
  await totalPayrollInput.type('150000', { delay: 50 });
  await totalPayrollInput.press('Tab');

  // === RE-VERIFY AND RESELECT CRITICAL DROPDOWNS BEFORE SUBMIT ===
  console.log('Re-verifying critical dropdown selections before submit...');
  
  // Reselect Liability Deductible
  const liabilityReselect = page.locator('app-field-label', { hasText: 'Liability' }).getByRole('combobox');
  if (await liabilityReselect.count() > 0) {
    const currentLiabilityValue = await liabilityReselect.inputValue().catch(() => '');
    console.log('Current Liability Deductible value:', currentLiabilityValue);
    await liabilityReselect.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    const liabilityReselectOptions = await liabilityReselect.locator('option').allTextContents().catch(() => []);
    console.log('Liability Deductible options:', liabilityReselectOptions);
    if (liabilityReselectOptions.length > 1) {
      console.log('Reselecting Liability Deductible to ensure persistence...');
      await liabilityReselect.selectOption({ index: 1 }).catch(async () => {
        console.log('selectOption failed for Liability Deductible, using keyboard');
        await liabilityReselect.focus().catch(() => {});
        await liabilityReselect.press('ArrowDown').catch(() => {});
        await liabilityReselect.press('Enter').catch(() => {});
      });
      await page.waitForTimeout(800);
      const verifyLiabilityValue = await liabilityReselect.inputValue().catch(() => '');
      console.log('Verified Liability Deductible value after reselect:', verifyLiabilityValue);
    }
  }

  // Reselect PIP Deductible
  const pipDeductibleReselect = page.locator('app-field-label', { hasText: 'PIP Deductible' }).getByRole('combobox').first();
  if (await pipDeductibleReselect.count() > 0) {
    const currentPipValue = await pipDeductibleReselect.inputValue().catch(() => '');
    console.log('Current PIP Deductible value:', currentPipValue);
    await pipDeductibleReselect.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    const pipReselectOptions = await pipDeductibleReselect.locator('option:not([disabled])').allTextContents().catch(() => []);
    console.log('PIP Deductible options:', pipReselectOptions);
    if (pipReselectOptions.length > 1) {
      console.log('Reselecting PIP Deductible to ensure persistence...');
      await pipDeductibleReselect.selectOption({ index: 1 }).catch(async () => {
        console.log('selectOption failed for PIP Deductible, using keyboard');
        await pipDeductibleReselect.focus().catch(() => {});
        await pipDeductibleReselect.press('ArrowDown').catch(() => {});
        await pipDeductibleReselect.press('Enter').catch(() => {});
      });
      await page.waitForTimeout(800);
      const verifyPipValue = await pipDeductibleReselect.inputValue().catch(() => '');
      console.log('Verified PIP Deductible value after reselect:', verifyPipValue);
    }
  }

  // Reselect PIP Deductible Application
  const pipDeductibleAppReselect = page.locator('app-field-label', { hasText: 'PIP Deductible Application' }).getByRole('combobox');
  if (await pipDeductibleAppReselect.count() > 0) {
    const currentPipAppValue = await pipDeductibleAppReselect.inputValue().catch(() => '');
    console.log('Current PIP Deductible Application value:', currentPipAppValue);
    await pipDeductibleAppReselect.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    const pipAppReselectOptions = await pipDeductibleAppReselect.locator('option').allTextContents().catch(() => []);
    console.log('PIP Deductible Application options:', pipAppReselectOptions);
    if (pipAppReselectOptions.length > 1) {
      console.log('Reselecting PIP Deductible Application to ensure persistence...');
      await pipDeductibleAppReselect.selectOption({ index: 1 }).catch(async () => {
        console.log('selectOption failed for PIP Deductible Application, using keyboard');
        // Fallback to keyboard if selectOption fails
        await pipDeductibleAppReselect.focus().catch(() => {});
        await pipDeductibleAppReselect.press('ArrowDown').catch(() => {});
        await pipDeductibleAppReselect.press('Enter').catch(() => {});
      });
      await page.waitForTimeout(800);
      const verifyPipAppValue = await pipDeductibleAppReselect.inputValue().catch(() => '');
      console.log('Verified PIP Deductible Application value after reselect:', verifyPipAppValue);
    }
  }

  // Try to submit quote with validation error handling
  let submitAttempts = 0;
  const maxSubmitAttempts = 2;
  let quoteSubmitted = false;
  let shouldRetry = true;

  while (submitAttempts < maxSubmitAttempts && !quoteSubmitted && shouldRetry) {
    shouldRetry = false; // Default to no retry unless error handling sets it to true
    
    try {
      submitAttempts++;
      console.log(`Submit Quote attempt ${submitAttempts}...`);
      // Auto-fill any missing dropdowns on the current page before submitting
      await autoFillMissingDropdowns(page);
      
      const submitButton = page.getByRole('button', { name: 'SUBMIT QUOTE' });
      await submitButton.waitFor({ state: 'visible', timeout: 2000 });
      await submitButton.click();
      
      // Wait to see if validation error appears
      await page.waitForTimeout(2000);
      
      // Check for various error message patterns
      const errorPatterns = [
        '[role="alert"]',
        '.error',
        '.validation-error',
        'mat-error',
        '[class*="error"]',
        'div:has-text("Please complete all required")',
        'div:has-text("required fields")',
        'div:has-text("validation")',
        '.mat-error-wrapper'
      ];
      
      let hasErrors = false;
      let errorMessages = [];
      
      for (const pattern of errorPatterns) {
        try {
          const elements = await page.locator(pattern).allTextContents().catch(() => []);
          if (elements.length > 0) {
            errorMessages = [...errorMessages, ...elements];
            hasErrors = true;
          }
        } catch (e) {
          // Continue checking other patterns
        }
      }
      
      // Also check page content for common error keywords
      const pageText = await page.textContent('body');
      if (pageText && (pageText.includes('Please complete all required') || 
                       pageText.includes('required field') ||
                       pageText.includes('validation error') ||
                       pageText.includes('Please provide') ||
                       pageText.includes('must be'))) {
        hasErrors = true;
        console.log('Error keywords detected in page content');
      }
      
      if (hasErrors) {
        console.log('Validation error detected after submit:', errorMessages);
        console.log('Page contains error messages - attempting to fix and resubmit...');
        
        if (submitAttempts < maxSubmitAttempts) {
          console.log('Attempting to fix address and resubmit...');
          
          // Navigate back to address section (step 3)
          await page.locator('div:nth-child(3) > .ym_quote_progress_step > .ym_quote_progress_icon').click();
          await page.waitForTimeout(2000); // Give page time to navigate
          
          // Re-attempt Primary Location Address button approach
          let addressFixed = false;
          try {
            const primaryLocationButton = page.locator('app-quote-group').filter({ hasText: 'Primary Location Address' }).getByRole('button');
            if (await primaryLocationButton.count() > 0) {
              await primaryLocationButton.click({ timeout: 2000 });
              await page.waitForTimeout(500);
              
              const enterAddressInput = page.getByRole('textbox', { name: 'Enter address' });
              await enterAddressInput.waitFor({ state: 'visible', timeout: 2000 });
              await enterAddressInput.click();
              
              // Clear and re-enter address with longer delays
              await enterAddressInput.fill('');
              await page.waitForTimeout(300);
              await enterAddressInput.type(fullAddress, { delay: 100 });
              await page.waitForTimeout(1000);
              
              // Select first suggestion if available
              const suggestionsPanel = page.locator('.mat-autocomplete-panel[role="listbox"], [role="listbox"]');
              if (await suggestionsPanel.count() > 0) {
                await page.waitForTimeout(500);
                const firstSuggestion = suggestionsPanel.locator('[role="option"]').first();
                if (await firstSuggestion.count() > 0) {
                  await firstSuggestion.click({ timeout: 2000 });
                  await page.waitForTimeout(800);
                }
              }
              
              await page.getByRole('button').nth(1).click({ timeout: 2000 });
              await page.waitForTimeout(600);
              await page.getByRole('button', { name: 'SAVE' }).click({ timeout: 2000 });
              await page.waitForTimeout(1000);
              
              addressFixed = true;
              console.log('Address fixed via Primary Location Address button');
            }
          } catch (e) {
            console.log('Primary Location Address button fix failed:', e.message);
          }
          
          // Navigate to supplementary section to proceed to submit
          console.log('Navigating back to Supplementary section...');
          await page.locator('div').filter({ hasText: /^Supplementary$/ }).nth(1).click();
          await page.waitForTimeout(1500); // Extra time for page to fully load
          
          // Scroll to ensure submit button is visible
          await page.getByRole('button', { name: 'SUBMIT QUOTE' }).scrollIntoViewIfNeeded();
          await page.waitForTimeout(1000);
          
          console.log('Ready to retry submit...');
          shouldRetry = true; // Set flag to retry the submit
        }
      } else {
        // No errors detected - submit was successful
        quoteSubmitted = true;
        console.log('Quote submitted successfully');
      }
    } catch (e) {
      console.error(`Submit attempt ${submitAttempts} failed with exception:`, e.message);
      if (submitAttempts >= maxSubmitAttempts) {
        throw new Error(`Failed to submit quote after ${maxSubmitAttempts} attempts: ${e.message}`);
      }
    }
  }

  await page.getByLabel('Quote Responses').getByRole('button', { name: 'View' }).click();

  // Capture quote data from the results table
  await page.waitForTimeout(500); // Allow results to load
  
  try {
    // Get the entire first row text to extract quote number
    const firstRowText = await page.locator('table tbody tr:first-child').textContent().catch(() => '');
    const quoteNumberMatch = firstRowText.match(/(\d{10})/);
    const quoteRequestNumber = quoteNumberMatch ? quoteNumberMatch[1] : 'N/A';
    
    // Extract all data from the row
    const cellCount = await page.locator('table tbody tr:first-child td').count();
    
    // Get all cells
    let insuredName = 'N/A';
    let status = 'N/A';
    let lineOfBusiness = 'N/A';
    
    if (cellCount >= 1) {
      insuredName = await page.locator('table tbody tr:first-child td:nth-child(1)').textContent().then(t => t?.trim() || 'N/A').catch(() => 'N/A');
    }
    if (cellCount >= 2) {
      status = await page.locator('table tbody tr:first-child td:nth-child(2)').textContent().then(t => t?.trim() || 'N/A').catch(() => 'N/A');
    }
    if (cellCount >= 3) {
      lineOfBusiness = await page.locator('table tbody tr:first-child td:nth-child(3)').textContent().then(t => t?.trim() || 'N/A').catch(() => 'N/A');
    }
    
    // Store result in global array
    quoteResults.push({
      state: STATE,
      quoteRequestNumber,
      insuredName,
      status,
      lineOfBusiness
    });

    // Persist per-state result for PowerShell email aggregation
    try {
      const resultPayload = {
        State: STATE,
        QuoteRequestNumber: quoteRequestNumber,
        InsuredName: insuredName,
        Status: status,
        LineOfBusiness: lineOfBusiness
      };
      const resultPath = path.join(__dirname, `ca-result-${STATE}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(resultPayload, null, 2), 'utf8');
    } catch (e) {
      console.log('⚠️ Failed to persist CA result file:', e.message);
    }
  } catch (e) {
    // Store N/A result on error
    quoteResults.push({
      state: STATE,
      quoteRequestNumber: 'N/A',
      insuredName: 'N/A',
      status: 'N/A',
      lineOfBusiness: 'N/A'
    });

    try {
      const resultPayload = {
        State: STATE,
        QuoteRequestNumber: 'N/A',
        InsuredName: 'N/A',
        Status: 'N/A',
        LineOfBusiness: 'N/A'
      };
      const resultPath = path.join(__dirname, `ca-result-${STATE}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(resultPayload, null, 2), 'utf8');
    } catch (err) {
      console.log('⚠️ Failed to persist CA result file (error branch):', err.message);
    }
  }

});
}

// Email reporting will be handled by the parallel runner after all states complete
