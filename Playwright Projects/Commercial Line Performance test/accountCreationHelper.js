/**
 * accountCreationHelper.js
 * Creates a WB account and completes qualification.
 * Credentials from .env (WB_USER_* / WB_PASS_*) - never hardcoded.
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
  const ctx = sectionText
    ? page.locator('xpath=//*[contains(normalize-space(.), ' + JSON.stringify(sectionText) + ')]')
    : page;

  const direct = {
    'City':          ['#txtLocationCity', 'input[name="txtLocationCity"]', 'input[id*="LocationCity"]'],
    'Zip Code':      ['#txtLocationZip', 'input[name="txtLocationZip"]', 'input[id*="LocationZip"]', 'input[name*="Zip"]'],
    'Phone Number':  ['#txtLocationPhone', 'input[name="txtLocationPhone"]', 'input[id*="LocationPhone"]', '#txtPhone'],
    'Email Address': ['#txtClientInformationEmail', 'input[name="txtClientInformationEmail"]', 'input[id="txtClientInformationEmail"]', 'input[type="email"]'],
    'Business Name': ['#txtBusinessName', 'input[name="txtBusinessName"]', 'input[id*="BusinessName"]'],
    'Street Line 1': ['#txtLocationStreet', 'input[name="txtLocationStreet"]', 'input[id*="LocationStreet"]'],
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
    const gfb = ctx.locator(
      'xpath=//label[contains(normalize-space(.), ' + JSON.stringify(lbl) + ')]/following::input[1]' +
      ' | //input[contains(@id, ' + JSON.stringify(lbl) + ')]' +
      ' | //input[contains(@placeholder, ' + JSON.stringify(lbl) + ')]'
    ).first();
    if (await gfb.count() > 0) { await gfb.fill(value); return; }
  }
  throw new Error('Cannot find textbox for: ' + JSON.stringify(labelTextOrList));
}

// ── Fast-path modal dismissal ───────────────────────────────────────────────
async function dismissStatusModal(page) {
  const modal = page.locator('#dgic-status-message');
  const isVisible = await modal.isVisible().catch(() => false);
  if (!isVisible) return;

  console.log('Status modal visible - dismissing...');
  const btn = modal.locator('button').first();
  if (await btn.count() > 0) await btn.click({ force: true }).catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

async function safeNextClick(page) {
  const btn = page.getByRole('button', { name: 'Next' });
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  await dismissStatusModal(page);

  const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false);
  if (isDisabled) {
    await page.waitForFunction(() => {
      const candidates = Array.from(document.querySelectorAll('button'));
      const nextBtn = candidates.find(b => b.textContent.trim().startsWith('Next') && b.classList.contains('btn-primary'));
      return nextBtn ? !nextBtn.disabled && !nextBtn.classList.contains('disabled') : true;
    }, { timeout: 15000 }).catch(() => {});
    await dismissStatusModal(page);
  }

  await btn.click();
}

async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone }) {
  const state = testState;
  console.log('createAccountAndQualify: state=' + state);

  const creds = STATE_USERS[state] || STATE_USERS.DE;
  if (!creds.username || !creds.password)
    throw new Error('Missing credentials for ' + state + '. Set WB_USER_' + state + ' / WB_PASS_' + state + ' in .env');

  let helperAddress = null;
  try { helperAddress = getRandomAddressByState(state); }
  catch (err) { console.log('Address helper failed: ' + err.message); }

  const mailingStreet = helperAddress ? helperAddress.street : randAddress();
  const mailingCity   = helperAddress ? helperAddress.city   : randCityForState(testState);
  const mailingZip    = helperAddress ? helperAddress.zip    : randZipForState(testState);
  console.log('Address: ' + mailingStreet + ', ' + mailingCity + ', ' + mailingZip);

  // ── Login ────────────────────────────────────────────────────────────────────
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill(creds.username);
  await page.getByRole('textbox', { name: 'Password:' }).fill(creds.password);
  await page.locator('#btnLogin').click({ timeout: 30000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await dismissStatusModal(page);
  console.log('WB Login successful');
  trackMilestone('Logged in to WB');

  // ── Create new client ────────────────────────────────────────────────────────
  await page.locator('#btn_CreateClient').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await dismissStatusModal(page);

  await page.waitForFunction(() => {
    const selectors = ['#acg_agency_input','#txtAgency_input','input.dgic-autocomplete-grid','input[data-toggle="dropdown"]','input[placeholder*="Enter Search Text"]','input[placeholder*="Search Text here"]'];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden') return true;
    }
    return false;
  }, { timeout: 25000 });

  // ── Agency selection ─────────────────────────────────────────────────────────
  const { agencyCode, producerName } = getAgencyConfig(testState);

  const agencySels = ['#acg_agency_input','#txtAgency_input','input.dgic-autocomplete-grid','input[data-toggle="dropdown"]','input[placeholder*="Enter Search Text"]','input[placeholder*="Search Text here"]'];
  let agencyInput = null;
  for (const sel of agencySels) {
    const c = page.locator(sel).first();
    if (await c.count() > 0 && await c.isVisible().catch(() => false)) { agencyInput = c; break; }
  }
  if (!agencyInput) throw new Error('Agency search input not found');

  const searchTextField = page.locator(agencySels.join(', '));
  if (await searchTextField.count() > 0) await searchTextField.first().click();

  await agencyInput.click({ clickCount: 3, timeout: 10000 });
  await agencyInput.fill(agencyCode).catch(() => {});
  await page.waitForTimeout(500);

  let curVal = await agencyInput.inputValue().catch(() => '');
  if (curVal !== agencyCode) {
    await agencyInput.click({ clickCount: 1 });
    await agencyInput.press('Control+A');
    await page.keyboard.type(agencyCode, { delay: 60 });
    await page.waitForTimeout(500);
    curVal = await agencyInput.inputValue().catch(() => '');
    console.log('Agency value after typing: ' + curVal);
  }

  if (curVal !== agencyCode) {
    await agencyInput.click({ clickCount: 1 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type(agencyCode, { delay: 60 });
    await page.waitForTimeout(500);
  }

  const searchTrigger = page.locator('div.input-group-text:has(i.fas.fa-th)').first();
  if (await searchTrigger.count() > 0 && await searchTrigger.isVisible().catch(() => false)) {
    await searchTrigger.click({ force: true });
    await page.waitForTimeout(800);
  }

  await agencyInput.press('ArrowDown').catch(() => {});
  await page.waitForTimeout(600);

  const gridcellOption = page.getByRole('gridcell', { name: agencyCode }).first();
  if (await gridcellOption.count() > 0) {
    await gridcellOption.waitFor({ state: 'visible', timeout: 15000 });
    await gridcellOption.click({ force: true });
  } else {
    const agencyOption = page.locator('.ui-menu.ui-widget:visible, .dropdown-menu.show, .bs-select .dropdown-menu.show, [role="option"]:visible').filter({ hasText: agencyCode }).first();
    await agencyOption.waitFor({ state: 'visible', timeout: 15000 });
    await agencyOption.click({ force: true });
  }

  // ── Producer selection ───────────────────────────────────────────────────────
  await page.waitForTimeout(2000);
  await dismissStatusModal(page);

  let producerItems = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .ui-menu.ui-widget:visible a');
  if (await producerItems.count() === 0) {
    const producerToggle = page.locator('button[data-id="ddlProducer"]').first();
    await producerToggle.waitFor({ state: 'visible', timeout: 10000 });
    await producerToggle.click({ force: true });
    await page.waitForTimeout(500);
    producerItems = page.locator('div.dropdown.bootstrap-select:has(button[data-id="ddlProducer"]) .dropdown-menu.show .dropdown-item');
  }

  const allProducers = await producerItems.allTextContents();
  console.log('Producers available: ' + JSON.stringify(allProducers));
  const producerIdx = allProducers.findIndex(p => p === producerName);
  if (producerIdx === -1) throw new Error('Producer "' + producerName + '" not found in dropdown');

  const producerItem = producerItems.filter({ hasText: producerName }).first();
  await producerItem.waitFor({ state: 'visible', timeout: 15000 });
  await producerItem.click({ force: true });

  const producerSelect = page.locator('#ddlProducer');
  if (await producerSelect.count() > 0) {
    await producerSelect.selectOption({ label: producerName }).catch(() => {});
  }

  await page.waitForTimeout(500);
  await safeNextClick(page);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);
  await dismissStatusModal(page);

  // ── Client info ──────────────────────────────────────────────────────────────
  await fillLabeledTextbox(page, ['Business Name','Company/ Individual Name','Company Name'], randCompany(), 'Account Information');
  await page.waitForTimeout(800);
  await fillLabeledTextbox(page, 'Street Line 1', mailingStreet, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'City', mailingCity, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'Zip Code', mailingZip, 'Account Mailing Address');
  await page.waitForTimeout(800);

  // ── State selection ──────────────────────────────────────────────────────────
  let stateSet = false;
  const stateSelect = page.locator('#ddlLocationState, select[name="ddlLocationState"], select[id*="LocationState"], select[name*="LocationState"]');
  if (await stateSelect.count() > 0 && await stateSelect.first().isVisible().catch(() => false)) {
    try { await stateSelect.first().selectOption({ value: testState }); console.log('State selected: ' + testState); stateSet = true; }
    catch (e) { console.log('Native state select failed: ' + e.message); }
  }

  if (!stateSet) {
    const stateCombo = page.getByRole('combobox', { name: 'State' }).first();
    if (await stateCombo.count() > 0 && await stateCombo.isVisible().catch(() => false)) {
      try {
        await stateCombo.click({ force: true });
        await page.waitForTimeout(600);
        const menuOpt = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item').filter({ hasText: testState }).first();
        if (await menuOpt.count() > 0) { await menuOpt.click({ force: true }); stateSet = true; }
      } catch (e) { console.log('Combobox state failed: ' + e.message); }
    }
  }

  if (!stateSet) throw new Error('Unable to select state: ' + testState);
  await page.waitForTimeout(800);

  // ── Phone ────────────────────────────────────────────────────────────────────
  const mailingPhone = page.locator('input[name="txtClientInformationPhone"]:visible').first();
  const phoneVal = randPhone717();
  if (await mailingPhone.count() > 0 && await mailingPhone.isVisible().catch(() => false)) {
    await mailingPhone.click({ clickCount: 3 });
    await mailingPhone.press('Control+A');
    await mailingPhone.press('Delete');
    await mailingPhone.fill(phoneVal);
    await mailingPhone.blur();
    const expectedDigits = phoneVal.replace(/\D/g, '');
    let normalized = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const val = await page.locator('input[name="txtClientInformationPhone"]:visible').first().inputValue().catch(() => '');
      if (val.replace(/\D/g, '') === expectedDigits) { normalized = true; break; }
      await page.waitForTimeout(500);
    }
    if (!normalized) console.log('Phone did not normalize, continuing anyway');
    else console.log('Phone entered: ' + phoneVal);
  } else {
    await fillLabeledTextbox(page, 'Phone Number', phoneVal, 'Account Mailing Address');
  }
  await page.waitForTimeout(1000);

  // ── Email ────────────────────────────────────────────────────────────────────
  const emailSelectors = ['input[name="txtClientInformationEmail"]:visible','#txtClientInformationEmail:visible','input[type="email"]:visible','input[name*="mail"]:visible'];
  let emailField = null;
  for (const sel of emailSelectors) {
    const c = page.locator(sel).first();
    if (await c.count() > 0 && await c.isVisible().catch(() => false)) { emailField = c; break; }
  }
  if (!emailField) emailField = page.getByRole('textbox', { name: 'Email Address' }).first();

  const emailVal = randEmail();
  await emailField.fill(emailVal);
  await emailField.blur();
  const filledEmail = await emailField.inputValue();
  if (filledEmail.trim() !== emailVal) throw new Error('Email not filled correctly; got: ' + filledEmail);
  console.log('Email entered: ' + emailVal);
  await page.waitForTimeout(1000);

  // ── Submit client info ───────────────────────────────────────────────────────
  await safeNextClick(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await dismissStatusModal(page);

  await clickIfExists('Accept As-Is'); await page.waitForTimeout(2000);
  await clickIfExists('Use Suggested'); await page.waitForTimeout(500);
  await clickIfExists('Account not listed'); await page.waitForTimeout(500);
  await clickIfExists('Continue'); await page.waitForTimeout(800);
  await dismissStatusModal(page);

  // ── Business details ─────────────────────────────────────────────────────────
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

  // ── Inspection Contact Information (MI-specific - not present in all states) ──
  const addLaterBtn = page.getByRole('button', { name: 'Add Later' });
  if (await addLaterBtn.count() > 0 && await addLaterBtn.isVisible().catch(() => false)) {
      await addLaterBtn.click();
      console.log('Inspection Contact Information: clicked Add Later');
      await page.waitForTimeout(500);
  }

  // ── NAICS code ───────────────────────────────────────────────────────────────
  const naicsInput = page.locator('#txtNAICSCode_input').first();
  if (await naicsInput.count() > 0 && await naicsInput.isVisible().catch(() => false)) {
    await naicsInput.click({ clickCount: 3 });
    await naicsInput.fill('');
    await page.waitForTimeout(200);
    await naicsInput.type('812210', { delay: 150 });

    const suggestion = page.locator(
      '.ui-menu.ui-widget .ui-menu-item, .ui-autocomplete .ui-menu-item, [role="option"], .dgic-autocomplete-grid tr, .dropdown-menu.show .dropdown-item'
    ).filter({ hasText: 'Director services, funeral' }).first();

    try {
      await suggestion.waitFor({ state: 'visible', timeout: 8000 });
      await suggestion.click({ force: true });
      console.log('NAICS suggestion clicked');
    } catch (_) {
      const gridCell = page.getByRole('gridcell', { name: /Director services, funeral/i }).first();
      if (await gridCell.count() > 0) {
        await gridCell.click({ force: true });
        console.log('NAICS clicked via gridcell');
      } else {
        await naicsInput.press('ArrowDown');
        await page.waitForTimeout(500);
        await naicsInput.press('Enter');
        console.log('NAICS selected via keyboard');
      }
    }

    await page.waitForTimeout(1000);
    const naicsVal = await naicsInput.inputValue().catch(() => '');
    console.log('NAICS field after selection: "' + naicsVal + '"');
  } else {
    console.log('NAICS input not found or not visible');
  }

  // ── Contact info ─────────────────────────────────────────────────────────────
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
    console.log('Contact phone retry ' + (i + 1) + ': digits=' + digits);
  }
  if (!contactOk) console.log('Contact phone failed after 3 attempts');

  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Email' }).fill(randEmail());
  await page.waitForTimeout(1000);

  // Final check for Inspection Contact toggle right before Next
  const addLaterBtn2 = page.getByRole('button', { name: 'Add Later' });
  if (await addLaterBtn2.isVisible().catch(() => false)) {
      await addLaterBtn2.click();
      console.log('Inspection Contact Information: clicked Add Later (pre-Next check)');
      await page.waitForTimeout(500);
  }

  await safeNextClick(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await dismissStatusModal(page);
  console.log('Account creation completed');

  // ── Qualification ────────────────────────────────────────────────────────────
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await dismissStatusModal(page);

  const coverageDropdown = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');

  const dropdownVisible = await coverageDropdown.waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

  if (!dropdownVisible) {
      console.log('Coverage dropdown not visible after 20s - diagnosing page state');
      console.log('Current URL: ' + page.url());

      const addLaterBtn3 = page.getByRole('button', { name: 'Add Later' });
      if (await addLaterBtn3.isVisible().catch(() => false)) {
          console.log('Account Details modal still open - clicking Add Later and retrying Next');
          await addLaterBtn3.click();
          await safeNextClick(page);
          await page.waitForLoadState('domcontentloaded');
          await coverageDropdown.waitFor({ state: 'visible', timeout: 15000 });
      } else {
          const errorVisible = await page.locator('.alert-danger, .validation-error, .field-error').first().isVisible().catch(() => false);
          if (errorVisible) {
              const errorText = await page.locator('.alert-danger, .validation-error, .field-error').first().innerText().catch(() => '');
              console.log('Validation error found: ' + errorText);
          }
          throw new Error('Coverage dropdown not visible and no recovery path found. URL: ' + page.url());
      }
  }

  await coverageDropdown.selectOption('BOP');

  // Power units - first non-empty option
  const powerUnitsSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').first();
  if (await powerUnitsSelect.count() > 0 && await powerUnitsSelect.isVisible().catch(() => false)) {
    const pwrVal = await powerUnitsSelect.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
    if (pwrVal) {
      await powerUnitsSelect.selectOption(pwrVal);
      console.log('Power units: ' + pwrVal);
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    }
  }

  // Vehicle type = Yes
  const vehicleYesLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1_Yes').first();
  await vehicleYesLabel.click({ force: true, timeout: 5000 }).catch(async () => {
    const vehicleYesInput = page.locator('input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1"][value$="_Yes"]').first();
    await vehicleYesInput.check().catch(() => {});
  });
  console.log('Vehicle type = Yes');

  // Building coverage = Yes
  const buildingYesSel = 'input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124"][value$="_Yes"]';
  const buildingYes    = page.locator(buildingYesSel).first();
  const buildingLabel  = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124_Yes').first();

  let buildingOk = await buildingLabel.click({ force: true, timeout: 5000 })
      .then(() => true)
      .catch(() => false);

  if (!buildingOk) {
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel);
      if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, buildingYesSel);
    console.log('Building coverage Yes selected via JS fallback');
  } else {
    console.log('Building coverage Yes selected via label click');
  }

  if (!await buildingYes.isChecked().catch(() => false))
    throw new Error('Unable to select Building Coverage = Yes');

  // Employees - first non-empty option
  const employeesSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').first();
  if (await employeesSelect.count() > 0 && await employeesSelect.isVisible().catch(() => false)) {
    const empVal = await employeesSelect.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
    if (empVal) { await employeesSelect.selectOption(empVal); console.log('Employees: ' + empVal); }
  }

  // ── Generic helper for the remaining Yes/No questions ─────────────────────────
  // Searches for a question by text snippet, then clicks the Yes/No label
  // that appears after it in document order.
  async function clickYesNoByQuestionText(questionSnippet, desiredAnswer) {
    const directLabel = page.locator(
      'xpath=//*[contains(normalize-space(.), ' + JSON.stringify(questionSnippet) + ')]' +
      '/following::label[contains(@class,"btn") and normalize-space(text())=' + JSON.stringify(desiredAnswer) + '][1]'
    ).first();

    if (await directLabel.count() > 0 && await directLabel.isVisible().catch(() => false)) {
      await directLabel.click({ force: true, timeout: 5000 }).catch(() => {});
      console.log('"' + questionSnippet.substring(0, 40) + '..." = ' + desiredAnswer);
      return true;
    }
    console.log('WARNING: could not find Yes/No toggle for: "' + questionSnippet.substring(0, 50) + '"');
    return false;
  }

  // "This quote is based on the representation that the applicant is requesting
  //  coverage for an active business operation." = Yes
  await clickYesNoByQuestionText('active business operation', 'Yes');

  // "During the last five (5) years, has the applicant been indicted for or
  //  convicted of any degree of crime of Fraud, Bribery, Arson..." = No
  await clickYesNoByQuestionText('Fraud, Bribery, Arson', 'No');

  // "Any bankruptcies, tax or credit liens against the applicant in the past
  //  five (5) years?" = No
  await clickYesNoByQuestionText('bankruptcies, tax or credit liens', 'No');

  // "Any foreign operations or foreign products distributed in the USA?" = No
  await clickYesNoByQuestionText('foreign operations or foreign products', 'No');

  // "Has the applicant always carried insurance coverage while conducting
  //  business operations?" = Yes
  await clickYesNoByQuestionText('always carried insurance coverage', 'Yes');

  // "Any policy or coverage declined, cancelled, or non-renewed during the
  //  prior three (3) years..." = No
  await clickYesNoByQuestionText('declined, cancelled, or non-renewed', 'No');

  // ── Annual Gross Sales (original working keyboard.type pattern) ──────────────
  const grossSalesSel = '#txt_Question_Form_CLAcctProdEligibility_Ext_0_AnnualGrossSales_All_008_Integer_Question_integerWithCommas';
  const grossSalesField = page.locator(grossSalesSel).first();
  if (await grossSalesField.count() > 0 && await grossSalesField.isVisible().catch(() => false)) {
    await grossSalesField.click({ clickCount: 3 }).catch(() => {});
    await grossSalesField.press('Control+A').catch(() => {});
    await grossSalesField.press('Delete').catch(() => {});
    await page.keyboard.type('45555', { delay: 120 });
    await grossSalesField.blur().catch(() => {});
    for (let i = 0; i < 10; i++) {
      const cur = await grossSalesField.inputValue().catch(() => '');
      if (cur.replace(/\D/g, '') === '45555') break;
      await page.waitForTimeout(200);
    }
    console.log('Gross sales: ' + await grossSalesField.inputValue().catch(() => ''));
  }
  await page.waitForTimeout(1200);

  // OccupySquareFeet = No
  const occupyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_OccupySquareFeetOneLocation_All_010_No').first();
  await occupyLabel.click({ force: true, timeout: 10000 });
  console.log('OccupySquareFeet = No');

  // CertifyQuestion = Yes
  const certifyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_CertifyQuestion_101_Ext_Yes').first();
  await certifyLabel.click({ force: true, timeout: 10000 });
  console.log('CertifyQuestion = Yes');
  await dismissStatusModal(page);

  await page.waitForLoadState('domcontentloaded');
  await safeNextClick(page);
  if (trackMilestone) trackMilestone('Account Created');
  console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };
