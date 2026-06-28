/**
 * helpers/bopCoverageHelper.js
 * BOP-specific coverage flow: additional coverages, building, classification,
 * business personal property, underwriting questions.
 *
 * Extracted from Create_BOP.test.js to keep the test file clean and match
 * the Package/CA helper pattern.
 */

const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./coverageHelpers');

/**
 * Runs the full BOP post-policy-details coverage workflow.
 * Call after prior carrier is selected and first Next is clicked.
 */
async function runBopCoverageFlow(page, { testState, trackMilestone, clickIfExists }) {

  // ── Location selection ────────────────────────────────────────────────────
  await page.getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-2-3').click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');

  // ── Contractors Tools & Equipment ─────────────────────────────────────────
  const contractorsEdit = page.getByTitle('Edit Coverage').nth(3);
  if (await contractorsEdit.count() > 0) {
    await contractorsEdit.click();
    await page.locator('#xrgn_CoverageDetails').getByRole('combobox', { name: '500' }).click();
    await page.locator('#bs-select-13-0').click();
    await page.getByRole('button', { name: ' Save' }).click();
  }

  // ── Contractors Installation ───────────────────────────────────────────────
  const installBtn = page.locator('#xacc_BP7ContrctrsInstalltnToolsAndEquipmtInstalltn').getByTitle('Add Coverage');
  if (await installBtn.count() > 0) {
    await installBtn.click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).first().click();
    await page.locator('#bs-select-13-1').click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-20-1').click();
    await page.getByRole('button', { name: ' Save' }).click();
  }

  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForLoadState('domcontentloaded');

  // ── Additional coverages: Waiver Of Transfer ──────────────────────────────
  const addlCov1 = page.locator('#z9ui28llcn0ikdavhkktuu7uqpa > td:nth-child(4) > .btn-sm');
  if (await addlCov1.count() > 0) {
    await addlCov1.click();
    await page.locator('#z0lhi64ee7joqeidb4r7kqm5bp9 > td:nth-child(4) > .btn-sm').click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).first().click();
    await page.locator('#bs-select-1-1').click();
    await page.getByRole('combobox', { name: 'Nothing selected' }).click();
    await page.locator('#bs-select-5-1').click();
    await page.getByRole('button', { name: ' Save' }).click();
  }

  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(5000);
  await page.waitForTimeout(5000);
  console.log('BOP preliminary info completed');
  trackMilestone('BOP Preliminary Info Completed');

  // ── Add Building ──────────────────────────────────────────────────────────
  await page.locator('#xrgn_AddBuilding button.dropdown-toggle[role="combobox"]').click();
  await page.locator('.dropdown-menu.show .text').filter({ hasText: /^[0-9]+: .*/ }).first().click();
  await page.waitForTimeout(3000);

  await page.locator('button[data-id="ddlConstructionType"]').click();
  const menu = page.locator('#bs-select-6');
  await menu.waitFor({ state: 'visible' });
  await menu.locator('li span.text', { hasText: 'Frame Construction' }).click();

  await page.locator('#xrgn_CLBOPBuildingDetails_RoofTypeValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-7-0').first().click();
  await page.locator('#txtYearOfConstruction').fill('2015');
  console.log('Building details filled');
  await page.getByRole('button', { name: 'Next ' }).click();

  // ── Structure Building coverage ───────────────────────────────────────────
  await page.locator('#xacc_BP7StructureBuilding').getByTitle('Add Coverage').click();
  await page.locator('#xrgn_BP7RatingBasisValue').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.locator('#bs-select-1-1').click();

  // Estimator
  const createEst = page.getByRole('link', { name: 'Create Estimator' });
  const editEst   = page.getByRole('link', { name: 'Edit Estimator' });
  if (await createEst.isVisible().catch(() => false)) await createEst.click();
  else if (await editEst.isVisible().catch(() => false)) await editEst.click();

  const sqFt = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
  await sqFt.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('999');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
  await page.getByText('Apartment / Condominium').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Calculate Now' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Import Data' }).click();
  await page.waitForTimeout(200);

  await processCoverageDropdowns(page);
  await page.waitForTimeout(200);

  // Copy estimated replacement cost → building limit field
  const sourceInput = page.locator('#xtxt_EstimatedReplacementCost');
  const limit52     = page.locator('#txt_CP7Limit52_integerWithCommas');
  await limit52.waitFor({ state: 'visible', timeout: 10000 });

  const sourceVisible = await sourceInput.isVisible().catch(() => false);
  let limitValue = '1000000';
  if (sourceVisible) {
    const raw = await sourceInput.inputValue();
    limitValue = raw.replace(/,/g, '').trim();
    console.log('Estimated replacement cost: ' + raw + ' -> ' + limitValue);
  }
  await limit52.click({ clickCount: 3 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(limitValue);
  await limit52.blur();
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(200);
  await processAllAddCoverageButtons(page);

  // Close any lingering modals
  try {
    const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } catch (_) {}

  await page.getByRole('button', { name: 'Save Building & Add Business' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  // ── Business Income ───────────────────────────────────────────────────────
  await page.locator('#txtBusinessIncomeDescription').fill('test desc');
  await page.waitForTimeout(1200);
  await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.waitForTimeout(1200);
  await page.locator('#bs-select-2-1').click();
  await page.waitForTimeout(200);
  await page.locator('#xrgn_TypeOfRisk_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
  await page.waitForTimeout(1200);
  await page.locator('#bs-select-6-0').click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Next ' }).click();

  const limit53 = page.locator('#txt_CP7Limit53_integerWithCommas');
  await limit53.waitFor({ state: 'visible', timeout: 10000 });
  await limit53.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('155666');
  await limit53.blur();
  await page.waitForTimeout(1500);

  await processCoverageDropdowns(page);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await processAllAddCoverageButtons(page);

  const saveBI = page.locator('#btnNext_CLPropertyBuildingBusinessIncomeAdditionalCoverages');
  await saveBI.waitFor({ state: 'visible', timeout: 30000 });
  await saveBI.click();
  trackMilestone('BOP Building and Business Income Added');

  // ── Add Occupancy ──────────────────────────────────────────────────────────
  await page.getByTitle('Add Occupancy Building').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await page.locator('#txtOccupancyDescription').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#txtOccupancyDescription').fill('occupancy desc');
  await page.locator('#txtSquareFootage').fill('15656');
  await page.locator('button[data-id="ddlSprinkler"]').click();
  await page.locator('.dropdown-menu').getByText('Sprinklered Building, but Not Rated as Sprinklered').click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.locator('button[data-id="ddlOccupancyCategory"]').click();
  await page.locator('.dropdown-menu.show').getByText('Residential Apartments and Condominiums', { exact: true }).click();
  await processAllAddCoverageButtons(page);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(500);

  const saveOcc = page.locator('#btnNext_CLPropertyBuildingOccupancyCoverages');
  await saveOcc.waitFor({ state: 'visible' });
  await saveOcc.click();

  // ── Add Personal Property ──────────────────────────────────────────────────
  await page.waitForTimeout(200);
  await page.getByTitle('Add Personal Property').click();
  await page.waitForTimeout(500);
  await page.locator('#txtPersonalPropertyDescription').fill('Personal property description');
  await page.getByRole('button', { name: 'Next ' }).click();

  const limit54 = page.locator('#txt_CP7Limit54_integerWithCommas');
  await limit54.waitFor({ state: 'visible', timeout: 10000 });
  await limit54.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('156566');
  await limit54.blur();
  await page.waitForTimeout(1500);

  await processCoverageDropdowns(page);
  await page.waitForTimeout(300);
  await processAllAddCoverageButtons(page);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.locator('#btnNext_CLPropertyBuildingPersonalPropertyAdditionalCoverages').click();
  await page.getByRole('button', { name: 'Next ' }).click();
  await processAllAddCoverageButtons(page);
  trackMilestone('BOP Building Configuration Completed');

  // ── Underwriting questions ────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);
  await page.locator('#for_xrdo_Question_Form_BP7UnderwritingQuestion_Ext_0_BP7MortgageonProp_Ext_No').click();
  await page.locator('#for_xrdo_Question_Form_BP7UnderwritingQuestion_Ext_0_BP7CertificateQuestion_Ext_Yes').click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);

  // ── Classification: Carpentry ─────────────────────────────────────────────
  await page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll > .input-group-text > .fas').click();
  await page.getByRole('gridcell', { name: 'Carpentry - Interior - Office' }).click();

  const sqFootage = page.locator('#txtClassificationSquareFootage_integerWithCommas');
  await sqFootage.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('999');
  await sqFootage.blur();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(5000);

  // ── Business Personal Property ────────────────────────────────────────────
  await page.getByTitle('Edit Coverage').click();
  const exposure = page.locator('#txtexposure_integerWithCommas');
  await exposure.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('25300');
  await exposure.blur();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.getByRole('button', { name: 'Save Building/Classification' }).click();
  console.log('BOP building and classification saved');

  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Next ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Continue ' }).click();
  await page.waitForTimeout(5000);

  const closeBtn = page.getByRole('button', { name: 'Close' });
  await closeBtn.waitFor({ state: 'visible', timeout: 60000 });
  await closeBtn.click({ force: true });
  trackMilestone('BOP Coverage Flow Completed');
}

module.exports = { runBopCoverageFlow };
