const { randEmail, randCompany, randAddress, randSSN } = require('./tests/helpers');
const { randCityForState, randZipForState } = require('./stateConfig');

// Create account and reach the package selection stage, reusing the same page/tab.
async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone }) {
  // Local helper to generate a random 717 phone number
  function randPhone717() {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000); // 7 random digits
    return `717${randomDigits}`;
  }

  // Navigate and login
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill('amitmish');
  await page.getByRole('textbox', { name: 'Password:' }).fill('Bombay12$');
  await page.getByRole('button', { name: 'Log In' }).click();
  console.log('WB Login successful');

  
    await page.getByRole('button', { name: 'Create a New Client' }).click();
    await page.getByText('Enter Search Text here or').click();
    await page.locator('#txtAgency_input').fill('0000988');
    await page.getByRole('gridcell', { name: '0000988' }).click();
    await page.locator('#ui-id-9').getByText('CHRISTINA M. BOWER').click();
    await page.getByRole('button', { name: 'Next' }).click();
    
  // Create new client - retry until "Accept As-Is" is presented (not "Use Suggested")
  let acceptAsIsPresented = false;
  let retryCount = 0;
  const maxRetries = 5;

  while (!acceptAsIsPresented && retryCount < maxRetries) {
    if (retryCount > 0) {
      console.log(`🔄 Retry attempt ${retryCount} - re-entering client information`);
    }


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
    // Retry phone fill until it sticks - use keyboard typing to trigger mask, validate 10 digits
    const phoneNumber = randPhone717();
    let phoneFilledCorrectly = false;
    const phoneField = page.locator('#txtPhone');
    for (let i = 0; i < 3; i++) {
      await phoneField.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type(phoneNumber);
      await phoneField.blur();
      await page.waitForTimeout(500);
      const phoneValue = await phoneField.inputValue();
      const digits = (phoneValue || '').replace(/\D/g, '');
      if (digits.length === 10) {
        phoneFilledCorrectly = true;
        console.log(`✅ Phone number filled successfully: ${phoneValue}`);
        break;
      }
      console.log(`⚠️ Phone fill failed (got: '${phoneValue}', digits: '${digits}') - retrying (attempt ${i + 1})`);
    }
    if (!phoneFilledCorrectly) {
      const lastVal = await phoneField.inputValue();
      console.log(`❌ Phone number failed to fill after 3 attempts. Last value: ${lastVal}`);
    }
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Email Address' }).fill(randEmail());
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Require "Accept As-Is" to proceed, otherwise retry with new data
    const acceptAsIsButton = page.getByRole('button', { name: 'Accept As-Is' });
    const acceptAsIsVisible = await acceptAsIsButton.isVisible().catch(() => false);

    if (acceptAsIsVisible) {
      console.log('✅ "Accept As-Is" detected - proceeding');
      // Click Accept As-Is if the dialog requires explicit confirmation
      await acceptAsIsButton.click().catch(() => {});
      acceptAsIsPresented = true;
    } else {
      console.log('⚠️ "Accept As-Is" not found - retrying with new client info');
      // If validation dialog is present (e.g., showing "Use Suggested"), click Cancel to close it
      const cancelButton = page.getByLabel('Address Validation').getByRole('button', { name: 'Cancel' });
      const cancelVisible = await cancelButton.isVisible().catch(() => false);
      if (cancelVisible) {
        await cancelButton.click();
        await page.waitForTimeout(1000);
      }
      retryCount++;
    }
  }

  if (retryCount >= maxRetries) {
    console.log(`⚠️ Max retries (${maxRetries}) reached, proceeding anyway`);
  }

  // Click optional buttons - they may or may not appear depending on the flow
  await clickIfExists('Accept As-Is');
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
  const businessEntityInput = page.locator('#xrgn_det_BusinessEntity > div > div > div:nth-child(2) > div > div > span > input');
  const menuOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item').first();

  // If the menu is already open, skip clicking the input; otherwise click to open
  const menuVisible = await menuOption.isVisible().catch(() => false);
  if (!menuVisible) {
    await businessEntityInput.click();
  }

  // Wait for dropdown and click first option
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);
  await menuOption.waitFor({ state: 'visible', timeout: 15000 });
  await menuOption.click();
  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());
  await page.locator('#txtNAICSCode_input').fill('812210');
  await page.getByRole('gridcell', { name: 'Director services, funeral' }).click();

  // Contact info
  await page.getByRole('textbox', { name: 'Contact First Name' }).fill('test');
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Contact Last Name' }).fill('desc');
  await page.waitForTimeout(800);
  // Retry contact phone fill until it sticks - keyboard typing, validate 10 digits
  const expectedContactPhone = '7175551212';
  let contactPhoneFilledCorrectly = false;
  const contactPhoneField = page.getByRole('textbox', { name: 'Contact Phone' });
  for (let i = 0; i < 3; i++) {
    await contactPhoneField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(expectedContactPhone);
    await contactPhoneField.blur();
    await page.waitForTimeout(500);
    const contactPhoneValue = await contactPhoneField.inputValue();
    const digits = (contactPhoneValue || '').replace(/\D/g, '');
    if (digits.length === 10) {
      contactPhoneFilledCorrectly = true;
      console.log(`✅ Contact phone number filled successfully: ${contactPhoneValue}`);
      break;
    }
    console.log(`⚠️ Contact phone fill failed (got: '${contactPhoneValue}', digits: '${digits}') - retrying (attempt ${i + 1})`);
  }
  if (!contactPhoneFilledCorrectly) {
    const lastVal = await contactPhoneField.inputValue();
    console.log(`❌ Contact phone number failed to fill after 3 attempts. Last value: ${lastVal}`);
  }
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
  if (trackMilestone) {
    trackMilestone('Account Qualification Completed');
  }
  console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };
