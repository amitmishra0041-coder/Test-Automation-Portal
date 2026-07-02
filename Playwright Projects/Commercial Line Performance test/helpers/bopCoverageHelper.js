// helpers/bopCoverageHelper.js
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./coverageHelpers');

async function runBopCoverageFlow(page, { testState, trackMilestone, dismissStatusModal, safeNextClick, safeContinueClick, safeClick }) {

  // ── Helper: click Yes/No by question text ──────────────────────────────────
  async function clickYesNoByQuestion(questionSnippet, answer) {
    const byXpath = page.locator(
      'xpath=//*[contains(normalize-space(.), ' + JSON.stringify(questionSnippet) + ')]' +
      '/following::label[contains(@class,"btn") and normalize-space(.)=' + JSON.stringify(answer) + '][1]'
    ).first();

    let clicked = false;

    if (!clicked && await byXpath.isVisible({ timeout: 2000 }).catch(() => false)) {
      await byXpath.click({ force: true, timeout: 5000 }).catch(() => {});
      clicked = true;
      console.log('"' + questionSnippet.substring(0, 40) + '..." = ' + answer + ' (xpath)');
    }

    if (!clicked) {
      try {
        const questionEl = page.locator('*').filter({ hasText: questionSnippet }).last();
        const row = questionEl.locator('xpath=ancestor::tr[1] | ancestor::div[contains(@class,"row")][1] | ancestor::li[1]');
        const answerBtn = row.locator('label.btn, button').filter({ hasText: new RegExp('^' + answer + '$') }).first();
        if (await answerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await answerBtn.click({ force: true });
          clicked = true;
          console.log('"' + questionSnippet.substring(0, 40) + '..." = ' + answer + ' (row sibling)');
        }
      } catch (_) {}
    }

    if (!clicked) {
      console.log('WARNING: could not find Yes/No toggle for: "' + questionSnippet.substring(0, 40) + '"');
    }
  }

  // ── Businessowners details tab ─────────────────────────────────────────────
  console.log('BOP - Details tab...');
  const bizTypeSelect = page.locator('#ddlBusinessType');
  if (await bizTypeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await bizTypeSelect.selectOption('Apartment');
    console.log('Business type: Apartment');
  }
  await dismissStatusModal();
  await safeNextClick();
  await dismissStatusModal();
  await safeNextClick();
  await dismissStatusModal();
  await safeNextClick();
  trackMilestone('BOP Businessowners Details Completed');

  // ── Locations tab ──────────────────────────────────────────────────────────
  console.log('BOP - Locations tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Edit Location is optional — sometimes page lands directly on Location Details
  const editLocationBtn = page.locator('button[title="Edit Location"]');
  if (await editLocationBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editLocationBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    console.log('Edit Location clicked');
  } else {
    console.log('Already on Location Details - skipping Edit Location');
  }

  // Verify Address
  const verifyAddressBtn = page.locator('#btnVerifyAddress');
  await verifyAddressBtn.waitFor({ state: 'visible', timeout: 15000 });
  await verifyAddressBtn.click();
  await page.waitForTimeout(2000);
  await dismissStatusModal();

  const useSuggestedBtn = page.locator('#ValidateAddress_SuggestedAddress_dialog_btn_1');
  if (await useSuggestedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await useSuggestedBtn.click();
    console.log('Used suggested address');
    await page.waitForTimeout(1000);
  }

  const noAddrModal = page.locator('#dgic-modal-validateaddress_noaddressfound');
  if (await noAddrModal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await noAddrModal.locator('button').first().click({ force: true }).catch(() => {});
    await noAddrModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await dismissStatusModal();

  // Territory Code — select first non-empty if blank
  const territoryCode = page.locator('#ddlTerritoryCode, select[id*="Territory"]').first();
  if (await territoryCode.count() > 0 && await territoryCode.isVisible().catch(() => false)) {
    const val = await territoryCode.inputValue().catch(() => '');
    if (!val) {
      const firstVal = await territoryCode.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
      if (firstVal) { await territoryCode.selectOption(firstVal); console.log('Territory Code: ' + firstVal); }
    } else {
      console.log('Territory Code: ' + val);
    }
  }

  // Protection Class — select first non-empty if blank
  const protectionClass = page.locator('#ddlProtectionClass, select[id*="ProtectionClass"]').first();
  if (await protectionClass.count() > 0 && await protectionClass.isVisible().catch(() => false)) {
    const val = await protectionClass.inputValue().catch(() => '');
    if (!val) {
      const firstVal = await protectionClass.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
      if (firstVal) { await protectionClass.selectOption(firstVal); console.log('Protection Class: ' + firstVal); }
    } else {
      console.log('Protection Class: ' + val);
    }
  }

  await dismissStatusModal();
  await safeNextClick(); // Details → Coverages
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  await safeNextClick(); // Coverages → Additional Coverages
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Locations Tab Completed');

  const saveLocationBtn = page.locator('#btnNext_CLBOPLocationAdditionalCoverages');
  if (await saveLocationBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await saveLocationBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
  }

  // ── State Specific Info tab ────────────────────────────────────────────────
  console.log('BOP - State Specific Info tab...');
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP State Specific Info Completed');

  // ── Buildings/Classifications tab ──────────────────────────────────────────
  console.log('BOP - Buildings/Classifications tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Target Add Building button by data-id — confirmed from debug output
  const addBuildingBtn = page.locator('button[data-id="ddlAddBuilding"]');
  await addBuildingBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBuildingBtn.click();
  await page.waitForTimeout(500);
  console.log('Add Building dropdown opened');

  // JS evaluate click — standard click fails due to navigation detaching DOM
  const locationClicked = await page.evaluate(() => {
    const items = document.querySelectorAll('.dropdown-menu.show a.dropdown-item, .dropdown-menu.show li a, .dropdown-menu.show li');
    for (const el of items) {
      const text = el.textContent.trim();
      if (/^\d+:/.test(text)) {
        el.click();
        return text;
      }
    }
    return null;
  });
  console.log('Location clicked: ' + locationClicked);

  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  console.log('Navigated to Building Details');

  // ── Building Details form ──────────────────────────────────────────────────
  const bldgDesc = page.locator('#txtBuildingDescription');
  if (await bldgDesc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await bldgDesc.fill('Main building');
    console.log('Building description: Main building');
  }

  // Construction Type
  const constructionBtn = page.locator('button[data-id="ddlConstructionType"]');
  if (await constructionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await constructionBtn.click();
    await page.waitForTimeout(500);
    const firstItem = page.locator('#bs-select-6 li:not(.disabled)').first();
    if (await firstItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstItem.click();
      console.log('Construction Type selected');
    } else {
      await page.locator('.dropdown-menu.show li:not(.disabled)').first().click({ force: true }).catch(() => {});
      console.log('Construction Type selected (fallback)');
    }
    await page.waitForTimeout(300);
  }

  // Year of Construction
  const yearField = page.locator('#txtYearOfConstruction');
  if (await yearField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await yearField.fill('2015');
    await yearField.blur();
    console.log('Year of Construction: 2015');
    await page.waitForTimeout(300);
  }

  // Roof Type
  const roofBtn = page.locator('button[data-id="ddlRoofType"], button[data-id*="RoofType"]').first();
  if (await roofBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await roofBtn.click();
    await page.waitForTimeout(500);
    await page.locator('.dropdown-menu.show li:not(.disabled)').first().click({ force: true }).catch(() => {});
    console.log('Roof Type selected');
    await page.waitForTimeout(300);
  }

  await dismissStatusModal();
  await safeNextClick(); // Bldg Details → Bldg Cov
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  console.log('Moved to Bldg Cov tab');

  // ── Bldg Cov tab ──────────────────────────────────────────────────────────
  const structureSection = page.locator('#xacc_BP7StructureBuilding');
  if (await structureSection.count() > 0) {
    await structureSection.getByTitle('Add Coverage').click().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    const ratingBasisCombo = page.locator('#xrgn_BP7RatingBasisValue').getByRole('combobox', { name: 'Nothing selected' });
    if (await ratingBasisCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ratingBasisCombo.click();
      await page.locator('#bs-select-1-1').click().catch(() => {});
    }

    const estimatorLink = page.locator('a:has-text("Create Estimator"), a:has-text("Edit Estimator")').first();
    if (await estimatorLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await estimatorLink.click();
      await page.waitForTimeout(2000);
      const sqFt = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
      if (await sqFt.isVisible({ timeout: 5000 }).catch(() => false)) {
        await sqFt.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.keyboard.type('999');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);
        await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click().catch(() => {});
        await page.getByText('Apartment / Condominium').click().catch(() => {});
        await page.getByRole('button', { name: 'Continue' }).click().catch(() => {});
        await page.getByRole('button', { name: 'Calculate Now' }).click().catch(() => {});
        await page.getByRole('button', { name: 'Finish' }).click().catch(() => {});
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Import Data' }).click().catch(() => {});
        await page.waitForTimeout(1000);
        console.log('Estimator completed');
      }
    }

    await safeClick(page.getByRole('button', { name: /Save/i }));
    await dismissStatusModal();
  }

  await safeNextClick(); // Bldg Cov → Bldg Add'l Cov
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Bldg Add'l Cov → Class Details ────────────────────────────────────────
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Class Details tab ──────────────────────────────────────────────────────
  const classLookup = page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll > .input-group-text > .fas');
  if (await classLookup.isVisible({ timeout: 5000 }).catch(() => false)) {
    await classLookup.click();
    await page.getByRole('gridcell', { name: 'Carpentry - Interior - Office' }).click().catch(async () => {
      await page.locator('#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr').first().click().catch(() => {});
    });
    console.log('Classification selected');
  }

  const sqFtClassInput = page.locator('#txtClassificationSquareFootage_integerWithCommas');
  if (await sqFtClassInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sqFtClassInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('999');
    await sqFtClassInput.blur();
    await page.waitForTimeout(1000);
    console.log('Classification square footage: 999');
  }

  await safeNextClick(); // Class Details → Class Cov
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Class Cov tab ──────────────────────────────────────────────────────────
  const bppEditBtn = page.getByTitle('Edit Coverage').first();
  if (await bppEditBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await bppEditBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    const exposureInput = page.locator('#txtexposure_integerWithCommas');
    if (await exposureInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exposureInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type('25300');
      await exposureInput.blur();
      await page.waitForTimeout(500);
      console.log('BPP exposure: 25300');
    }

    await safeClick(page.getByRole('button', { name: /^Save$/i }));
    await dismissStatusModal();
  }

  await safeNextClick(); // Class Cov → Class Add'l Cov
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Save Building ──────────────────────────────────────────────────────────
  const saveClassBtn = page.locator('#btnNext_CLBOPBuildingClassificationAdditionalCoverages');
  if (await saveClassBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await saveClassBtn.click();
  } else {
    await safeClick(page.getByRole('button', { name: 'Save Building/Classification' }));
  }
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  console.log('Building and classification saved');

  trackMilestone('BOP Buildings/Classifications Completed');

  // ── Blankets tab ───────────────────────────────────────────────────────────
  console.log('BOP - Blankets tab...');
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Blankets Tab Completed');

  // ── Mortgagees tab ─────────────────────────────────────────────────────────
  console.log('BOP - Mortgagees tab...');
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Mortgagees Tab Completed');

  // ── UW Questions tab ───────────────────────────────────────────────────────
  console.log('BOP - UW Questions tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  await clickYesNoByQuestion('mortgagees on this property', 'No');
  await clickYesNoByQuestion('cremations for other funeral homes', 'No');
  await clickYesNoByQuestion('best of my knowledge', 'Yes');

  await dismissStatusModal();
  await safeContinueClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP UW Questions Completed');
}

module.exports = { runBopCoverageFlow };
