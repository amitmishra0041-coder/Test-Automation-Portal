const { randEmail, randCompany, randAddress, randSSN } = require('./helpers/randomData');

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

  // Create new client (using Dec 15 working approach)
  await page.getByRole('button', { name: 'Create a New Client' }).click();
  await page.getByText('Enter Search Text here or').click();
  await page.locator('#txtAgency_input').fill('8707');
  await page.getByRole('gridcell', { name: '0008707' }).click();
  await page.locator('#ui-id-9').getByText('BRENT W. PARENTEAU').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Fill client info (simplified - using hardcoded values that work)
  await page.getByRole('textbox', { name: 'Company/ Individual Name' }).fill(randCompany());
  await page.getByRole('textbox', { name: 'Street Line 1' }).fill(randAddress());
  await page.getByRole('textbox', { name: 'City' }).fill('Wilmington');
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

  if (trackMilestone) {
    trackMilestone('Account Created');
  }
}

module.exports = { createAccountAndQualify };
