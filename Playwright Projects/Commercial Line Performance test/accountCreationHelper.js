/**
 * accountCreationHelper.js
 * Credentials from .env (WB_USER_* / WB_PASS_*) - never hardcoded.
 * Cleaned: duplicate randPhone717 removed, dead commented code removed.
 */
require('dotenv').config();
const { randEmail, randCompany, randAddress, randSSN } = require('./helpers/randomData');
const { randCityForState, randZipForState }            = require('./stateConfig');
const { stateToZips, zipToCityState }                  = require('./address-helper/dist/zipData');

const STATE_USERS = {
  DE: { username: process.env.WB_USER_DE, password: process.env.WB_PASS_DE },
  PA: { username: process.env.WB_USER_PA, password: process.env.WB_PASS_PA },
  MI: { username: process.env.WB_USER_MI, password: process.env.WB_PASS_MI },
  WI: { username: process.env.WB_USER_WI, password: process.env.WB_PASS_WI },
};

function getRandomAddressByState(state) {
  const zips = stateToZips[state];
  if (!zips || zips.length === 0) throw new Error('No zips for state: ' + state);
  const zip = zips[Math.floor(Math.random() * zips.length)];
  const loc = zipToCityState[zip];
  if (!loc) throw new Error('No city/state for zip: ' + zip);
  return { street: Math.floor(Math.random() * 900 + 100) + ' Main St', city: loc.city, state: loc.state, zip };
}

function randPhone717() {
  return '717' + Math.floor(1000000 + Math.random() * 9000000);
}

function getAgencyConfig(testState) {
  if (['CO', 'IL', 'IN'].includes(testState)) return { agencyCode: '4501307', producerName: 'JEFFERY S. REYNOLDS' };
  if (testState === 'AZ') return { agencyCode: '9000325', producerName: 'CHRISTINA M. BOWER' };
  return { agencyCode: '0000988', producerName: 'CHRISTINA M. BOWER' };
}

async function fillLabeledTextbox(page, labelTextOrList, value, sectionText) {
  const labelList = Array.isArray(labelTextOrList) ? labelTextOrList : [labelTextOrList];
  const ctx = sectionText ? page.locator('xpath=//*[contains(normalize-space(.), ' + JSON.stringify(sectionText) + ')]') : page;
  const direct = {
    'City':          ['#txtLocationCity', 'input[name="txtLocationCity"]'],
    'Zip Code':      ['#txtLocationZip', 'input[name="txtLocationZip"]', 'input[name*="Zip"]'],
    'Phone Number':  ['#txtLocationPhone', 'input[name="txtLocationPhone"]', '#txtPhone'],
    'Email Address': ['#txtClientInformationEmail', 'input[name="txtClientInformationEmail"]', 'input[type="email"]'],
    'Business Name': ['#txtBusinessName', 'input[name="txtBusinessName"]'],
    'Street Line 1': ['#txtLocationStreet', 'input[name="txtLocationStreet"]'],
  };
  for (const lbl of labelList) {
    for (const sel of (direct[lbl] || [])) {
      const el = ctx.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) { await el.clear(); await el.fill(value); return; }
    }
    const ex = ctx.getByRole('textbox', { name: lbl }).first();
    if (await ex.count() > 0) { await ex.fill(value); return; }
    const fb = ctx.locator('xpath=//*[normalize-space(.)=' + JSON.stringify(lbl) + ']/following::input[1]').first();
    if (await fb.count() > 0) { await fb.fill(value); return; }
  }
  throw new Error('Cannot find textbox for: ' + labelTextOrList);
}

async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone }) {
  const state = testState;
  const creds = STATE_USERS[state] || STATE_USERS.DE;
  if (!creds.username || !creds.password)
    throw new Error('Missing credentials for ' + state + '. Set WB_USER_' + state + ' / WB_PASS_' + state + ' in .env');

  let helperAddress = null;
  try { helperAddress = getRandomAddressByState(state); } catch (_) {}
  const mailingStreet = helperAddress ? helperAddress.street : randAddress();
  const mailingCity   = helperAddress ? helperAddress.city   : randCityForState(testState);
  const mailingZip    = helperAddress ? helperAddress.zip    : randZipForState(testState);

  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill(creds.username);
  await page.getByRole('textbox', { name: 'Password:' }).fill(creds.password);
  await page.locator('#btnLogin').click({ timeout: 5000 });
  console.log('WB Login successful');
  trackMilestone('Logged in to WB');

  await page.locator('#btn_CreateClient').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.waitForFunction(() => {
    return ['#acg_agency_input', '#txtAgency_input', 'input.dgic-autocomplete-grid'].some(s => {
      const el = document.querySelector(s); if (!el) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
  }, { timeout: 25000 });

  const { agencyCode, producerName } = getAgencyConfig(testState);
  const agencySels = ['#acg_agency_input', '#txtAgency_input', 'input.dgic-autocomplete-grid', 'input[placeholder*="Enter Search Text"]'];
  let agencyInput = null;
  for (const sel of agencySels) {
    const c = page.locator(sel).first();
    if (await c.count() > 0 && await c.isVisible().catch(() => false)) { agencyInput = c; break; }
  }
  if (!agencyInput) throw new Error('Agency search input not found');

  await agencyInput.click({ clickCount: 3 });
  await agencyInput.fill(agencyCode).catch(() => {});
  await page.waitForTimeout(500);
  let curVal = await agencyInput.inputValue().catch(() => '');
  if (curVal !== agencyCode) {
    await agencyInput.click({ clickCount: 1 });
    await agencyInput.press('Control+A');
    await page.keyboard.type(agencyCode, { delay: 60 });
    await page.waitForTimeout(500);
  }

  const trigger = page.locator('div.input-group-text:has(i.fas.fa-th)').first();
  if (await trigger.count() > 0) await trigger.click({ force: true });
  await agencyInput.press('ArrowDown').catch(() => {});
  await page.waitForTimeout(600);

  const gc = page.getByRole('gridcell', { name: agencyCode }).first();
  if (await gc.count() > 0) await gc.click({ force: true });
  else await page.locator('.ui-menu.ui-widget:visible, .dropdown-menu.show, [role="option"]:visible').filter({ hasText: agencyCode }).first().click({ force: true });

  await page.waitForTimeout(2000);

  let pItems = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .ui-menu.ui-widget:visible a');
  if (await pItems.count() === 0) {
    const tog = page.locator('button[data-id="ddlProducer"]').first();
    await tog.waitFor({ state: 'visible', timeout: 10000 });
    await tog.click({ force: true });
    await page.waitForTimeout(500);
    pItems = page.locator('div.dropdown.bootstrap-select:has(button[data-id="ddlProducer"]) .dropdown-menu.show .dropdown-item');
  }
  const allProducers = await pItems.allTextContents();
  const producerIdx = allProducers.findIndex(p => p === producerName);
  if (producerIdx === -1) throw new Error('Producer "' + producerName + '" not found in dropdown');
  const pItem = pItems.filter({ hasText: producerName }).first();
  await pItem.waitFor({ state: 'visible', timeout: 15000 });
  await pItem.click({ force: true });

  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  await fillLabeledTextbox(page, ['Business Name', 'Company/ Individual Name', 'Company Name'], randCompany(), 'Account Information');
  await page.waitForTimeout(800);
  await fillLabeledTextbox(page, 'Street Line 1', mailingStreet, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'City', mailingCity, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'Zip Code', mailingZip, 'Account Mailing Address');
  await page.waitForTimeout(800);

  let stateSet = false;
  const stateSel = page.locator('#ddlLocationState, select[name="ddlLocationState"], select[id*="LocationState"]');
  if (await stateSel.count() > 0 && await stateSel.first().isVisible().catch(() => false)) {
    try { await stateSel.first().selectOption({ value: testState }); stateSet = true; } catch (e) {}
  }
  if (!stateSet) throw new Error('Unable to select state: ' + testState);
  await page.waitForTimeout(800);

  const mailingPhone = page.locator('input[name="txtClientInformationPhone"]:visible').first();
  const phoneVal = randPhone717();
  if (await mailingPhone.count() > 0 && await mailingPhone.isVisible().catch(() => false)) {
    await mailingPhone.click({ clickCount: 3 });
    await mailingPhone.press('Control+A');
    await mailingPhone.press('Delete');
    await mailingPhone.fill(phoneVal);
    await mailingPhone.blur();
  } else {
    await fillLabeledTextbox(page, 'Phone Number', phoneVal, 'Account Mailing Address');
  }
  await page.waitForTimeout(1000);

  let emailField = null;
  for (const s of ['input[name="txtClientInformationEmail"]:visible', '#txtClientInformationEmail:visible', 'input[type="email"]:visible']) {
    const c = page.locator(s).first();
    if (await c.count() > 0 && await c.isVisible().catch(() => false)) { emailField = c; break; }
  }
  if (!emailField) emailField = page.getByRole('textbox', { name: 'Email Address' }).first();
  const emailVal = randEmail();
  await emailField.fill(emailVal);
  await emailField.blur();
  console.log('Contact email entered: ' + emailVal);
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await clickIfExists('Accept As-Is'); await page.waitForTimeout(500);
  await clickIfExists('Use Suggested'); await page.waitForTimeout(500);
  await clickIfExists('Account not listed'); await page.waitForTimeout(500);
  await clickIfExists('Continue'); await page.waitForTimeout(800);

  const businessDescField = page.getByRole('textbox', { name: 'Business Description' });
  await businessDescField.waitFor({ state: 'visible', timeout: 30000 });
  await businessDescField.fill('test desc');

  const businessEntitySelect = page.locator('#ddlBusinessEntity').first();
  await businessEntitySelect.waitFor({ state: 'visible', timeout: 20000 });
  const firstOpt = businessEntitySelect.locator('option:not([value=""])').first();
  const firstVal = await firstOpt.getAttribute('value');
  if (!firstVal) throw new Error('No Business Entity option found');
  await businessEntitySelect.selectOption(firstVal);
  console.log('Business Entity selected: ' + firstVal);

  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());

  const naicsInput = page.locator('#txtNAICSCode_input').first();
  if (await naicsInput.count() > 0 && await naicsInput.isVisible().catch(() => false)) {
    await naicsInput.click({ force: true });
    for (const ch of '812210') { await naicsInput.type(ch, { delay: 120 }); }
    await page.waitForTimeout(2000);
    const sug = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item, [role="option"]:visible').filter({ hasText: 'Director services, funeral' }).first();
    if (await sug.count() > 0) await sug.click({ force: true }).catch(() => {});
  }

  await page.locator('#txtContactFirstName').fill('test');
  await page.waitForTimeout(800);
  await page.locator('#txtContactLastName').fill('test');
  await page.waitForTimeout(800);

  const contactPhoneField = page.locator('#txtContactPhoneNumber');
  let contactOk = false;
  for (let i = 0; i < 3; i++) {
    await contactPhoneField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await contactPhoneField.press('Control+A');
    await contactPhoneField.press('Delete');
    await page.keyboard.type('7175551212');
    await contactPhoneField.blur();
    await page.waitForTimeout(500);
    const digits = ((await contactPhoneField.inputValue()) || '').replace(/\D/g, '');
    if (digits.length === 10) { contactOk = true; console.log('Contact phone filled OK'); break; }
  }
  if (!contactOk) console.log('Contact phone fill failed after 3 attempts');

  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Email' }).fill(randEmail());
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('Account creation completed');

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  const coverageDropdown = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');
  await coverageDropdown.waitFor({ state: 'visible', timeout: 30000 });
  await coverageDropdown.selectOption('BOP');
  await page.waitForTimeout(1200);

  const powerUnitsSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').first();
  if (await powerUnitsSelect.count() > 0 && await powerUnitsSelect.isVisible().catch(() => false)) {
    const firstPwrOpt = powerUnitsSelect.locator('option:not([value=""])').first();
    if (await firstPwrOpt.count() > 0) {
      const val = await firstPwrOpt.getAttribute('value');
      if (val) await powerUnitsSelect.selectOption(val).catch(() => {});
    }
  }
  await page.waitForTimeout(600);

  const vehicleYesLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1_Yes').first();
  if (await vehicleYesLabel.count() > 0) await vehicleYesLabel.click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);

  const buildingYesSelector = 'input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124"][value$="_Yes"]';
  const buildingYes = page.locator(buildingYesSelector).first();
  await buildingYes.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  await buildingYes.check({ timeout: 5000 }).catch(async () => {
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel);
      if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, buildingYesSelector);
  });
  const isChecked = await buildingYes.isChecked().catch(() => false);
  if (!isChecked) throw new Error('Unable to select Building Coverage = Yes');
  await page.waitForTimeout(1000);

  const employeesSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').first();
  if (await employeesSelect.count() > 0 && await employeesSelect.isVisible().catch(() => false)) {
    const firstEmpOpt = employeesSelect.locator('option:not([value=""])').first();
    if (await firstEmpOpt.count() > 0) {
      const empVal = await firstEmpOpt.getAttribute('value');
      if (empVal) await employeesSelect.selectOption(empVal).catch(() => {});
    }
  }
  await page.waitForTimeout(1200);

  const grossSalesSelector = '#txt_Question_Form_CLAcctProdEligibility_Ext_0_AnnualGrossSales_All_008_Integer_Question_integerWithCommas';
  const grossSalesField = page.locator(grossSalesSelector).first();
  if (await grossSalesField.count() > 0 && await grossSalesField.isVisible().catch(() => false)) {
    await grossSalesField.click({ clickCount: 3 }).catch(() => {});
    await grossSalesField.press('Control+A').catch(() => {});
    await grossSalesField.press('Delete').catch(() => {});
    await page.keyboard.type('45555', { delay: 120 });
    await grossSalesField.blur().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);

  const occupyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_OccupySquareFeetOneLocation_All_010_No').first();
  await occupyLabel.waitFor({ state: 'visible', timeout: 15000 });
  await occupyLabel.click({ force: true });
  await page.waitForTimeout(800);

  const certifyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_CertifyQuestion_101_Ext_Yes').first();
  await certifyLabel.waitFor({ state: 'visible', timeout: 15000 });
  await certifyLabel.click({ force: true });
  await page.waitForTimeout(800);

  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);
  if (trackMilestone) trackMilestone('Account Created');
  console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };
