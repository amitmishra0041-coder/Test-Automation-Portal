import { test, expect } from '@playwright/test';
const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./tests/helpers');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');

test('test', async ({ page }) => {
  test.setTimeout(480000); // 8 minutes total test timeout
  page.setDefaultTimeout(60000); // 60 seconds default timeout for all actions

  // Select environment via TEST_ENV (qa|test). Defaults to qa.
  const envName = process.env.TEST_ENV || 'qa';
  const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

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
  await page.locator('#txtAgency_input').fill('8707');
  await page.getByRole('gridcell', { name: '0008707' }).click();
  await page.locator('#ui-id-9').getByText('BRENT W. PARENTEAU').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Fill client info
  await page.getByRole('textbox', { name: 'Company/ Individual Name' }).fill(randCompany());
  await page.getByRole('textbox', { name: 'Street Line 1' }).fill(randAddress());
  await page.getByRole('textbox', { name: 'City' }).fill(randCity());
  await page.locator('.ui-xcontrols > .ui-combobox > .ui-widget.ui-widget-content').first().click();
  await page.locator('#ui-id-30').click();
  await page.getByRole('textbox', { name: 'Zip Code Phone Number' }).fill('19709');
  await page.locator('#txtPhone').fill(randPhone717());
  await page.getByRole('textbox', { name: 'Email Address' }).fill(randEmail());
  await page.getByRole('button', { name: 'Next' }).click();
  
  // Click optional buttons - they may or may not appear depending on the flow
  await clickIfExists('Use Suggested');
  await clickIfExists('Accept As-Is');
  await clickIfExists('Client not listed');
  await clickIfExists('Continue');

  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');

  // Business Description
  await page.getByRole('textbox', { name: 'Business Description' }).fill('test desc');
  await page.locator('#xrgn_det_BusinessEntity > div > div > div:nth-child(2) > div > div > span > input').click();
  await page.locator('#ui-id-67').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#ui-id-67').click();
  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());
  await page.locator('#txtNAICSCode_input').fill('812210');
  await page.getByRole('gridcell', { name: 'Director services, funeral' }).click();

  // Contact info
  await page.getByRole('textbox', { name: 'Contact First Name' }).fill('test');
  await page.getByRole('textbox', { name: 'Contact Last Name' }).fill('desc');
  await page.getByRole('textbox', { name: 'Contact Phone' }).fill('7175551212');
  await page.getByRole('textbox', { name: 'Contact Email' }).fill(randEmail());
  await page.getByRole('button', { name: 'Next' }).click();
  console.log('Account creation completed');
  // Coverage selections
  await page.locator('#xddl_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question').selectOption('BOP');
  await page.locator('#xrgn_WillBuildingCoverageBeRequested_124_WillBuildingCoverageBeRequested_124_Question_Control').getByText('No', { exact: true }).click();
  await page.getByRole('radio').first().click();
  await page.locator('#xddl_WhatIsTheTotalNumberOfPowerUnits_121_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').selectOption('01');
  await page.getByRole('radio').nth(2).click();
  await page.locator('#xddl_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').selectOption('13');
  await page.locator('#txt_AnnualGrossSales_All_008_AnnualGrossSales_All_008_Integer_Question').fill('45555');
  await page.locator('#xrgn_CertifyQuestion_101_Ext_CertifyQuestion_101_Ext_Question_Control > div > .ui-xcontrols-row > div > div > .ui-xcontrols > div:nth-child(2) > span').first().click();
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('networkidle');
  console.log('Account qualification completed');
  // Businessowners quote
  await page.getByText('Businessowners (v7)').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click();
  await page.locator('#ddlPriorCarrier').selectOption('Allstate');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-2-3').click();
  await page.getByRole('button', { name: 'Next ' }).click();
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
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  //await page.getByRole('button', { name: 'Next ' }).click();
  //await page.waitForLoadState('networkidle');
  //await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('networkidle');
  console.log('BOP quote - preliminary info completed');
  // Add building
  await page.locator('#xrgn_AddBuilding button.dropdown-toggle[role="combobox"]').click();
  await page.locator('.dropdown-menu.show .text').filter({ hasText: /^[0-9]+: .*/ }).first().click();
  await page.waitForLoadState('load');
  // Click the dropdown button
  await page.locator('button[data-id="ddlConstructionType"]').click();

  // Wait for the dropdown menu to appear
  const menu = page.locator('#bs-select-6');
  await menu.waitFor({ state: 'visible' });

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
  await page.keyboard.type('999');
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
  await page.keyboard.type('25300');
  await page.waitForTimeout(500);
  
  // Blur to trigger validation
  await exposureInput.blur();
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Save' }).click();

  //await page.getByRole('button', { name: ' Close' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Building/Classification' }).click();
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

  // Add these at the very top of your test file
  const fs = require('fs');
  const path = require('path');

  // Append to file
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] Quote Number: ${submissionNumber}\n`;

  const filePath = path.join(__dirname, 'quoteNumbers.txt');
  fs.appendFileSync(filePath, line, 'utf8');

  console.log(`Quote Number appended to ${filePath}`);

  // Now submit policy for approval in the same browser session
  console.log('Starting policy submission workflow...');

  await submitPolicyForApproval(page, submissionNumber, { policyCenterUrl });

  console.log('Test completed successfully');
});
