/**
 * accountCreationHelper.js
 * Credentials from .env (WB_USER_* / WB_PASS_*) — never hardcoded.
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
  if (!zips || zips.length === 0) throw new Error(`No zips for state: ${state}`);
  const zip = zips[Math.floor(Math.random() * zips.length)];
  const loc = zipToCityState[zip];
  if (!loc) throw new Error(`No city/state for zip: ${zip}`);
  return { street: `${Math.floor(Math.random() * 900 + 100)} Main St`, city: loc.city, state: loc.state, zip };
}

function randPhone717() {
  return `717${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;
}

function getAgencyConfig(testState) {
  if (['CO', 'IL', 'IN'].includes(testState)) return { agencyCode: '4501307', producerName: 'JEFFERY S. REYNOLDS' };
  if (testState === 'AZ') return { agencyCode: '9000325', producerName: 'CHRISTINA M. BOWER' };
  return { agencyCode: '0000988', producerName: 'CHRISTINA M. BOWER' };
}

async function fillLabeledTextbox(page, labelTextOrList, value, sectionText) {
  const labelList = Array.isArray(labelTextOrList) ? labelTextOrList : [labelTextOrList];
  const ctx = sectionText ? page.locator(`xpath=//*[contains(normalize-space(.), ${JSON.stringify(sectionText)})]`) : page;
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
    const fb = ctx.locator(`xpath=//*[normalize-space(.)=${JSON.stringify(lbl)}]/following::input[1]`).first();
    if (await fb.count() > 0) { await fb.fill(value); return; }
  }
  throw new Error(`Cannot find textbox for '${labelTextOrList}'`);
}

async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone }) {
  const state = testState;
  const creds = STATE_USERS[state] || STATE_USERS.DE;
  if (!creds.username || !creds.password)
    throw new Error(`Missing credentials for ${state}. Set WB_USER_${state} / WB_PASS_${state} in .env`);

  let helperAddress = null;
  try { helperAddress = getRandomAddressByState(state); } catch (_) {}
  const mailingStreet = helperAddress?.street || randAddress();
  const mailingCity   = helperAddress?.city   || randCityForState(testState);
  const mailingZip    = helperAddress?.zip    || randZipForState(testState);

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
  await page.keyboard.type(agencyCode, { delay: 60 });
  await page.waitForTimeout(600);
  const trigger = page.locator('div.input-group-text:has(i.fas.fa-th)').first();
  if (await trigger.count() > 0) await trigger.click({ force: true });
  await agencyInput.press('ArrowDown').catch(() => {});
  await page.waitForTimeout(600);
  const gc = page.getByRole('gridcell', { name: agencyCode }).first();
  if (await gc.count() > 0) await gc.click({ force: true });
  else await page.locator('.ui-menu.ui-widget:visible, .dropdown-menu.show, [role="option"]:visible').filter({ hasText: agencyCode }).first().click({ force: true });

  await page.waitForTimeout(2000);

  let pItems = page.locator('.ui-menu.ui-widget:visible .ui-menu-item');
  if (await pItems.count() === 0) {
    const tog = page.locator('button[data-id="ddlProducer"]').first();
    await tog.waitFor({ state: 'visible', timeout: 10000 });
    await tog.click({ force: true });
    await page.waitForTimeout(500);
    pItems = page.locator('div.dropdown.bootstrap-select:has(button[data-id="ddlProducer"]) .dropdown-menu.show .dropdown-item');
  }
  const pItem = pItems.filter({ hasText: producerName }).first();
  await pItem.waitFor({ state: 'visible', timeout: 15000 });
  await pItem.click({ force: true });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  await fillLabeledTextbox(page, ['Business Name', 'Company/ Individual Name'], randCompany(), 'Account Information');
  await fillLabeledTextbox(page, 'Street Line 1', mailingStreet, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'City', mailingCity, 'Account Mailing Address');
  await fillLabeledTextbox(page, 'Zip Code', mailingZip, 'Account Mailing Address');

  const stateSel = page.locator('#ddlLocationState, select[name="ddlLocationState"]').first();
  if (await stateSel.count() > 0 && await stateSel.isVisible().catch(() => false))
    await stateSel.selectOption({ value: testState });
  else throw new Error(`Cannot select state '${testState}'`);
  await page.waitForTimeout(800);

  const phoneF = page.locator('input[name="txtClientInformationPhone"]:visible').first();
  const pv = randPhone717();
  if (await phoneF.count() > 0) { await phoneF.click({ clickCount: 3 }); await page.keyboard.type(pv); await phoneF.blur(); }
  else await fillLabeledTextbox(page, 'Phone Number', pv, 'Account Mailing Address');
  await page.waitForTimeout(500);

  let emailF = null;
  for (const s of ['input[name="txtClientInformationEmail"]:visible', '#txtClientInformationEmail:visible', 'input[type="email"]:visible']) {
    const c = page.locator(s).first();
    if (await c.count() > 0 && await c.isVisible().catch(() => false)) { emailF = c; break; }
  }
  if (!emailF) emailF = page.getByRole('textbox', { name: 'Email Address' }).first();
  await emailF.fill(randEmail());
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await clickIfExists('Accept As-Is'); await page.waitForTimeout(500);
  await clickIfExists('Use Suggested'); await page.waitForTimeout(500);
  await clickIfExists('Account not listed'); await page.waitForTimeout(500);
  await clickIfExists('Continue'); await page.waitForTimeout(800);

  await page.getByRole('textbox', { name: 'Business Description' }).fill('test desc');
  const beS = page.locator('#ddlBusinessEntity').first();
  await beS.waitFor({ state: 'visible', timeout: 20000 });
  const beV = await beS.locator('option:not([value=""])').first().getAttribute('value');
  if (!beV) throw new Error('No Business Entity option found');
  await beS.selectOption(beV);
  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());

  const naics = page.locator('#txtNAICSCode_input').first();
  if (await naics.isVisible().catch(() => false)) {
    await naics.click({ force: true });
    await page.keyboard.type('812210', { delay: 120 });
    await page.waitForTimeout(2000);
    const sug = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, [role="option"]:visible').filter({ hasText: 'Director services, funeral' }).first();
    if (await sug.count() > 0) await sug.click({ force: true });
  }

  await page.locator('#txtContactFirstName').fill('Test');
  await page.locator('#txtContactLastName').fill('User');
  const cpF = page.locator('#txtContactPhoneNumber');
  await cpF.click({ clickCount: 3 }); await page.keyboard.type('7175551212'); await cpF.blur();
  await page.getByRole('textbox', { name: 'Email' }).fill(randEmail());
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('Account creation completed');

  const covDdl = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');
  await covDdl.waitFor({ state: 'visible', timeout: 30000 });
  await covDdl.selectOption('BOP');
  await page.waitForTimeout(1200);

  const pwrS = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').first();
  if (await pwrS.isVisible().catch(() => false)) {
    const v = await pwrS.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
    if (v) await pwrS.selectOption(v);
  }
  await page.waitForTimeout(600);

  const vehY = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1_Yes').first();
  if (await vehY.count() > 0) await vehY.click({ force: true });
  await page.waitForTimeout(600);

  const bldS = 'input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124"][value$="_Yes"]';
  const bldY = page.locator(bldS).first();
  await bldY.waitFor({ state: 'attached', timeout: 10000 });
  await bldY.check({ timeout: 5000 }).catch(async () => {
    await page.evaluate(s => {
      const e = document.querySelector(s);
      if (e) { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }
    }, bldS);
  });
  if (!await bldY.isChecked().catch(() => false)) throw new Error('Cannot select Building Coverage = Yes');
  await page.waitForTimeout(1000);

  const empS = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').first();
  if (await empS.isVisible().catch(() => false)) {
    const v = await empS.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
    if (v) await empS.selectOption(v);
  }
  await page.waitForTimeout(1200);

  const gsF = page.locator('#txt_Question_Form_CLAcctProdEligibility_Ext_0_AnnualGrossSales_All_008_Integer_Question_integerWithCommas').first();
  if (await gsF.isVisible().catch(() => false)) {
    await gsF.click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await page.keyboard.type('45555', { delay: 120 });
    await gsF.blur();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);

  const occN = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_OccupySquareFeetOneLocation_All_010_No').first();
  await occN.waitFor({ state: 'visible', timeout: 15000 });
  await occN.click({ force: true });
  await page.waitForTimeout(800);

  const cerY = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_CertifyQuestion_101_Ext_Yes').first();
  await cerY.waitFor({ state: 'visible', timeout: 15000 });
  await cerY.click({ force: true });
  await page.waitForTimeout(800);

  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);
  trackMilestone('Account Created');
  console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };
