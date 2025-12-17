import { test, expect } from '@playwright/test';
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./tests/helpers');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }) => {
  test.setTimeout(480000); // 8 minutes total test timeout
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

  // Main test flow
  // Helper function to generate a random 717 phone number
  function randPhone717() {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000); // 7 random digits
    return `717${randomDigits}`;
  }

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

  // Navigate and login
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill('amitmish');
  await page.getByRole('textbox', { name: 'Password:' }).fill('Bombay12$');
  await page.getByRole('button', { name: 'Log In' }).click();
  console.log('WB Login successful');
  // Create new client
  await page.getByRole('button', { name: 'Create a New Client' }).click();
  await page.getByText('Enter Search Text here or').click();
  await page.locator('#txtAgency_input').fill('0000988');
  await page.getByRole('gridcell', { name: '0000988' }).click();
  await page.locator('#ui-id-9').getByText('CHRISTINA M. BOWER').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Fill client info
  await page.getByRole('textbox', { name: 'Company/ Individual Name' }).fill(randCompany());
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Street Line 1' }).fill(randAddress());
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'City' }).fill(randCityForState(testState));
  await page.waitForTimeout(800);
  await page.locator('.ui-xcontrols > .ui-combobox > .ui-widget.ui-widget-content').first().click();
  await page.waitForTimeout(1000);
  await page.locator('.ui-menu.ui-widget').getByText(testState, { exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Zip Code Phone Number' }).fill(randZipForState(testState));
  await page.waitForTimeout(800);
  await page.locator('#txtPhone').fill(randPhone717());
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Email Address' }).fill(randEmail());
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Click optional buttons - they may or may not appear depending on the flow
  await clickIfExists('Use Suggested');
  await clickIfExists('Accept As-Is');
  await clickIfExists('Client not listed');
  await clickIfExists('Continue');

  // Wait for the page to be ready - more reliable than networkidle
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000); // Give page time to fully render

  // Business Description - wait for it to be visible and enabled
  const businessDescField = page.getByRole('textbox', { name: 'Business Description' });
  await businessDescField.waitFor({ state: 'visible', timeout: 30000 });
  await businessDescField.fill('test desc');

  // Click the Business Entity input to open dropdown
  await page.locator('#xrgn_det_BusinessEntity > div > div > div:nth-child(2) > div > div > span > input').click();

  // Wait for dropdown and click first non-empty option
  await page.waitForLoadState('networkidle');
  const firstOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item').first();
  await firstOption.waitFor({ state: 'visible', timeout: 15000 });
  await firstOption.click();
  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());
  await page.locator('#txtNAICSCode_input').fill('812210');
  await page.getByRole('gridcell', { name: 'Director services, funeral' }).click();

  // Contact info
  await page.getByRole('textbox', { name: 'Contact First Name' }).fill('test');
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Contact Last Name' }).fill('desc');
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Contact Phone' }).fill('7175551212');
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Contact Email' }).fill(randEmail());
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('Account creation completed');

  // Wait for the qualification page to load
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  // Coverage selections - wait for dropdown to be available
  const coverageDropdown = page.locator('#xddl_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');
  await coverageDropdown.waitFor({ state: 'visible', timeout: 30000 });
  await coverageDropdown.selectOption('BOP');
  await page.waitForTimeout(1200);
  await page.locator('#xrgn_WillBuildingCoverageBeRequested_124_WillBuildingCoverageBeRequested_124_Question_Control').getByText('No', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('radio').first().click();
  await page.waitForTimeout(1000);
  await page.locator('#xddl_WhatIsTheTotalNumberOfPowerUnits_121_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').selectOption('01');
  await page.waitForTimeout(1000);
  await page.getByRole('radio').nth(2).click();
  await page.waitForTimeout(1000);
  await page.locator('#xddl_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').selectOption('13');
  await page.waitForTimeout(1200);
  await page.locator('#txt_AnnualGrossSales_All_008_AnnualGrossSales_All_008_Integer_Question').fill('45555');
  await page.waitForTimeout(1200);
  await page.locator('#xrgn_CertifyQuestion_101_Ext_CertifyQuestion_101_Ext_Question_Control > div > .ui-xcontrols-row > div > div > .ui-xcontrols > div:nth-child(2) > span').first().click();
  await page.waitForTimeout(1500);
  await page.waitForTimeout(2000);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  trackMilestone('Account Qualification Completed');
  console.log('Account qualification completed');

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
  await page.getByRole('button', { name: 'Next ' }).click();

  // Toggle Inland Marine and Crime to "Yes" if not already selected (slider style controls)
  // Toggle Inland Marine and Crime via JS to bypass hidden slider labels
  await page.waitForTimeout(500); // slight pause to allow slider rendering
  await page.evaluate(() => {
    const inland = document.getElementById('cbInlandMarine');
    if (inland && !inland.checked) {
      inland.checked = true;
      inland.dispatchEvent(new Event('click', { bubbles: true }));
      inland.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const crime = document.getElementById('cbCrime');
    if (crime && !crime.checked) {
      crime.checked = true;
      crime.dispatchEvent(new Event('click', { bubbles: true }));
      crime.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');
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
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.getByRole('button', { name: ' Save' }).click();

  await page.getByRole('button', { name: 'Next ' }).click();
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

  await page.getByRole('button', { name: 'Next ' }).click();
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


  await page.locator('#xacc_CP7StructureBldg').getByTitle('Edit Coverage').click();
  await page.getByRole('link', { name: 'Create Estimator' }).click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.getByRole('button', { name: ' Save' }).click();
  await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertyBuildingCoverages.aspx&sid=A50D343A7A484188A618C62784EA98B8');
  await page.getByRole('combobox', { name: 'Location 1: 956 TRENTON PL,' }).click();
  await page.locator('#bs-select-1-0').click();
  await page.locator('#txtNewSpecialClassDescription').click();
  await page.locator('#txtNewSpecialClassDescription').fill('special class desc');
  await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-1-1').click();
  await page.locator('#txtSpecialClassesClassificationDescriptions_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Awnings or Canopies (when Insured Separately) - Entirely Non-combustible,' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertySpecialClassCoverages.aspx&sid=0780278C9FB44ABCADFEB9E0ED129FBC');
  await page.locator('#xacc_CP7SpecialClassCvrg').getByTitle('Edit Coverage').click();
  await page.locator('#txtCP7Limit19_integerWithCommas').click();
  await page.locator('#txtCP7Limit19_integerWithCommas').fill('6,5666');
  await page.getByRole('button', { name: ' Save' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Special Class ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Continue ' }).click();

  //special class and mortage
  await page.locator('#xacc_CP7StructureBldg').getByTitle('Edit Coverage').click();
  await page.getByRole('link', { name: 'Create Estimator' }).click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
  await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.getByRole('button', { name: ' Save' }).click();

  await page.getByRole('combobox', { name: 'Location 1: 956 TRENTON PL,' }).click();
  await page.locator('#bs-select-1-0').click();
  await page.locator('#txtNewSpecialClassDescription').click();
  await page.locator('#txtNewSpecialClassDescription').fill('special class desc');
  await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-1-1').click();
  await page.locator('#txtSpecialClassesClassificationDescriptions_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Awnings or Canopies (when Insured Separately) - Entirely Non-combustible,' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  
  await page.locator('#xacc_CP7SpecialClassCvrg').getByTitle('Edit Coverage').click();
  await page.locator('#txtCP7Limit19_integerWithCommas').click();
  await page.locator('#txtCP7Limit19_integerWithCommas').fill('6,5666');
  await page.getByRole('button', { name: ' Save' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Special Class ' }).click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Continue ' }).click();
});


  

