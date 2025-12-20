// Set suite type for email reporter
process.env.TEST_TYPE = 'PACKAGE';

import { test, expect } from '@playwright/test';
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./tests/helpers');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }) => {
  test.setTimeout(1200000); // 20 minutes total test timeout
  page.setDefaultTimeout(60000); // 60 seconds default timeout for all actions

  // Select environment via TEST_ENV (qa|test). Defaults to qa.
  const envName = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

  // Select state via TEST_STATE (DE|PA|MD|OH|MI). Defaults to DE.
  const testState = process.env.TEST_STATE || 'DE';
  const stateConfig = getStateConfig(testState);
  console.log(`🗺️ Running test for state: ${testState} (${stateConfig.name})`);

  // Initialize milestone tracking for email report
  global.testData = {
    state: testState,
    stateName: stateConfig.name,
    milestones: []
  };
  let currentStepStartTime = null;
  let testFailed = false;

  // Helper to persist test data to JSON file
  function saveTestData() {
    try {
      const testDataFile = path.join(__dirname, 'test-data.json');
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
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');

    // Select Commercial Package by clicking its visible UI checkbox icon
    const commercialPackageIcon = page.locator('#chk_CommercialPackage + .ui-checkbox-icon');
    await commercialPackageIcon.scrollIntoViewIfNeeded();
    await commercialPackageIcon.waitFor({ state: 'visible', timeout: 15000 });
    await commercialPackageIcon.click();

    await page.getByRole('button', { name: 'Next' }).click();
    // Wait for any overlay to disappear
    await page.waitForSelector('.ui-widget-overlay.ui-front', { state: 'hidden' }).catch(() => { });
    // Click button with force to bypass pointer interception
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click({ force: true });

  // Wait for page to load after button click
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle');

  await page.locator('#ddlPriorCarrier').selectOption('Allstate');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');

  // Toggle Inland Marine and Crime to "Yes" if not already selected (slider style controls)
  // Scroll into view and use JavaScript to click the actual checkbox element
  await page.waitForTimeout(1000); // Wait for slider rendering

  // Toggle Inland Marine - scroll and click via JavaScript
  await page.locator('#cbInlandMarine').scrollIntoViewIfNeeded();
  const inlandChecked = await page.locator('#cbInlandMarine').isChecked();
  if (!inlandChecked) {
    await page.locator('#cbInlandMarine').evaluate(el => el.click());
    await page.waitForTimeout(500);
    console.log('✅ Inland Marine toggled to Yes');
  }

  // Toggle Crime - scroll and click via JavaScript
  await page.locator('#cbCrime').scrollIntoViewIfNeeded();
  const crimeChecked = await page.locator('#cbCrime').isChecked();
  if (!crimeChecked) {
    await page.locator('#cbCrime').evaluate(el => el.click());
    await page.waitForTimeout(500);
    console.log('✅ Crime toggled to Yes');
  }

  // Click Confirm Selections button after both toggles are selected
  await page.waitForTimeout(1000);
  await page.locator('#btnConfirmSelections').click();
  await page.waitForTimeout(1500);
  console.log('✅ Confirm Selections clicked');

  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
  console.log('Commercial Package data entry started.');
  await page.waitForTimeout(2500);
  await page.getByTitle('Edit Location').click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: ' Cancel' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(2000);
  await page.getByTitle('Add the Coverage').click();
  await page.getByRole('button', { name: ' Add Scheduled Item' }).click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.getByRole('button', { name: 'Add New' }).click();

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

  await page.locator('#xrgn_CLANIAddressTypeValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-3-1').click();
  await page.getByRole('textbox', { name: 'Name' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('gfdgdf');
  await page.locator('#ThirdPartyContactsDialog_dialog_btn_0').click();
  await page.locator('#txtNoticeDaysID').click();
  await page.locator('#txtNoticeDaysID').fill('15');
  await page.locator('#CLPropertyAddlCoveragesScheduleItemDialog_dialog_btn_0').click();
  // Click Save on the parent schedule dialog (avoid strict-mode ambiguity)
  await page.locator('#CLPropertyAddlCoveragesScheduleDialog_dialog_btn_0').click();
  await page.getByRole('button', { name: 'Next ' }).click();
  //Commercial property locations
  await page.getByTitle('Edit Location').click();
  await page.getByRole('button', { name: 'Next ' }).click();
  //State specific info, Blankets and Buildings

  await page.getByRole('button', { name: 'Save Location ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.locator('button').filter({ hasText: 'Add Building' }).click();
  await page.locator('#bs-select-1-0').click();
  await page.locator('#txtBuildingDescription').click();
  await page.locator('#txtBuildingDescription').fill('test desc');
  await page.locator('#txtClassDescription_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Airports - Hangars with repairing or servicing' }).click();
  await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-6-0').click();
  await page.waitForTimeout(1000);
  await page.locator('#txtNumberOfStories').click();
  await page.locator('#txtNumberOfStories').fill('15');
  await page.waitForTimeout(1000);
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.waitForTimeout(1200);
  await page.locator('#bs-select-19-0').click();
  await page.waitForTimeout(1000);
  await page.locator('#txtYearOfConstruction').click();
  await page.locator('#txtYearOfConstruction').fill('2015');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.locator('#xacc_CP7StructureBldg').getByTitle('Edit Coverage').click();
  await page.getByRole('link', { name: 'Create Estimator' }).click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
  await page.waitForTimeout(500);
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(2000);
  await page.locator('#CP7OutdoorTreesShrubsAndPlants > td:nth-child(4) > .btn-sm').click();
  await page.locator('#txtCP7EachTreeLimit_integerWithCommas').click();
  await page.locator('#txtCP7EachTreeLimit_integerWithCommas').fill('015');
  await page.locator('#txtCP7EachTreeLimit_integerWithCommas').press('Tab');
  await page.locator('#txtCP7EachShrubLimit_integerWithCommas').fill('15');
  await page.locator('#txtCP7EachShrubLimit_integerWithCommas').press('Tab');
  await page.locator('#txtCP7EachPlantLimit_integerWithCommas').fill('15');
  await page.locator('#txtCP7EachPlantLimit_integerWithCommas').press('Tab');
  //await page.locator('#txtCP7AllItemLimit_integerWithCommas').fill('15');


  const allItemInput = page.locator('#txtCP7AllItemLimit_integerWithCommas');
  await allItemInput.click({ clickCount: 3 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  await page.keyboard.type('155');
  await page.waitForTimeout(800);
  await allItemInput.blur();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: ' Save' }).click();
  //await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
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
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-7-2').click();
  await page.locator('#dgic-modal-clpropertybuildingbusinessincomecoveragesdialog').click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.locator('#xacc_CP7BusinessIncomeCvrg').getByTitle('Edit Coverage').click();
  await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-11-2').click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Occupancy ' }).click();
  await page.getByTitle('Add Personal Property').click();
  await page.locator('#txtPersonalPropertyDescription').click();
  await page.locator('#txtPersonalPropertyDescription').fill('test personal property desc');
  await page.locator('#txtPersonalPropertyDescription').press('Home');
  await page.locator('#txtPersonalPropertyDescription').fill(' personal property desc');
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Building Personal' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  //Error handeling for buildings tab 
  // Check if Attention dialog is visible
  const attentionHeading = page.getByRole('heading', { name: 'Attention' });
  try {
    await attentionHeading.waitFor({ state: 'visible', timeout: 5000 });
    // Attention dialog found - execute the block
    console.log('⏭️  Attention dialog found')
    await page.getByRole('heading', { name: 'Attention' }).click();
    await page.getByRole('button', { name: ' Close' }).click();
    await page.getByTitle('Edit Building').click();
    await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-6-0').click();
    //await page.locator('#bs-select-6-0').click();
    await page.waitForTimeout(1000);
    //await page.getByRole('button', { name: 'Next ' }).click();
    await page.locator('#btnNext_CLPropertyBuildingDetails').click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertyBuildingCoverages.aspx&sid=8FF799FC9CCA4036945F7A17BAD76A22');
    await page.getByRole('button', { name: 'Next ' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000)
    //await page.getByRole('button', { name: 'Save Building ' }).click();
    await page.locator('#btnNext_CLPackageBuildingAdditionalCoverages').click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Next ' }).click();
  } catch (error) {
    console.log('⏭️  Attention dialog not found, skipping block');
  }

  // Special Classes
  await page.locator('div.filter-option-inner-inner').filter({ hasText: 'Add Special Class' }).click();
  await page.locator('#bs-select-1-0').click();
  await page.locator('#txtNewSpecialClassDescription').click();
  await page.locator('#txtNewSpecialClassDescription').fill('special class desc');
  await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-1-1').click();
  await page.locator('#txtSpecialClassesClassificationDescriptions_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Awnings or Canopies (when Insured Separately) - Entirely Non-combustible,' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertySpecialClassCoverages.aspx&sid=0780278C9FB44ABCADFEB9E0ED129FBC');
  await page.locator('#xacc_CP7SpecialClassCvrg').getByTitle('Edit Coverage').click();
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
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.locator('.input-group-text').first().click();
  await page.getByRole('cell', { name: '31' }).click();
  await page.locator('#xrgn_zgni6as6fl4tt7q4qkleqpts9jaValue > .ui-xcontrols > .input-group-append > .input-group-text > .fas').click();
  await page.getByTitle('Next Month').click();
  await page.getByRole('cell', { name: '30' }).nth(1).click();
  await page.getByRole('button', { name: ' Save' }).click();
  //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLAdditionalCoverages.aspx&sid=C44457B5B33B46888B07158DDD5B9F24');
  await page.locator('#GL7AddlInsdChurchMbrOffcrVolunWrkr').getByTitle('Add the Coverage').click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
  await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Add Exposure ' }).click();
  await page.getByRole('combobox', { name: 'Select Location' }).click();
  await page.locator('#bs-select-1-1').click();
  //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E9265AB5DF924567BB72F7434525E340');
  await page.getByRole('combobox', { name: 'Select Class Code' }).click();
  await page.locator('#bs-select-2-1').click();
  //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E1A86E1405BA4536A6D78577D333850B');
  await page.locator('#txtExposure_Prem').click();
  await page.locator('#txtExposure_Prem').click();
  await page.locator('#txtExposure_Prem').fill('15566');
  await page.getByRole('button', { name: 'Next ' }).click();
  //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresCoverages.aspx&sid=B7D53EFD48D34942B45549FB2627936C');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Exposure ' }).click();
  
  // Wait for any navigation to complete and optional modal to close
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
  } catch (e) {
    // Navigation might already be complete
  }
  await page.waitForTimeout(1000);
  
  // Try to close any modal that might be blocking (GL section)
  const statusModalGL = page.locator('#dgic-status-message');
  try {
    await statusModalGL.waitFor({ state: 'visible', timeout: 2000 });
    const closeBtnGL = statusModalGL.getByRole('button', { name: /close|ok|done/i }).first();
    await closeBtnGL.click().catch(() => {});
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
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Save Form' }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Continue ' }).click();
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

  // Append to file
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] Quote Number: ${submissionNumber}\n`;

  const filePath = path.join(__dirname, 'quoteNumbers.txt');
  fs.appendFileSync(filePath, line, 'utf8');

  console.log(`Quote Number appended to ${filePath}`);

  // Store submission number globally for email reporter
  global.testData.quoteNumber = submissionNumber;
  saveTestData();

  // Now submit policy for approval in the same browser session
  console.log('Starting policy submission workflow...');
  trackMilestone('Submitting for Approval');

  const policyNumber = await submitPolicyForApproval(page, submissionNumber, { policyCenterUrl });

  trackMilestone('UW Issues Approved');
  trackMilestone('Policy Issued Successfully', 'PASSED', `Policy #: ${policyNumber}`);

  // Store quote and policy numbers globally for email reporter
  global.testData.policyNumber = policyNumber;
  global.testData.quoteNumber = submissionNumber;
  global.testData.status = 'PASSED';
  saveTestData();
  console.log('📋 Test Data:', global.testData);

  // Write test data to JSON file so reporter can read it
  const testDataFile = path.join(__dirname, 'test-data.json');
  fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
  console.log('💾 Test data written to test-data.json');

  console.log('✅ Test completed successfully');

  } catch (error) {
    // Test failed - mark the failure as a milestone
    testFailed = true;
    console.error('❌ Test execution failed:', error.message);
    console.error('📍 Stack:', error.stack);

    trackMilestone('Test Execution Failed', 'FAILED', `${error.message}`);

    // Ensure test data has failure status
    global.testData.status = 'FAILED';
    global.testData.error = error.message;

    // Write final test data with failure info
    const testDataFile = path.join(__dirname, 'test-data.json');
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log('💾 Test data written to test-data.json with failure info');

    // Re-throw to mark test as failed in Playwright
    throw error;
  }
});



