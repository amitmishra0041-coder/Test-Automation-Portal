// helpers/bopCoverageHelper.js
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./coverageHelpers');

async function runBopCoverageFlow(page, { testState, trackMilestone, dismissStatusModal, safeNextClick, safeContinueClick, safeClick }) {

  // ── Helper: click Yes/No by question text ─────────────────────────────────
  async function clickYesNoByQuestion(questionSnippet, answer) {
    const label = page.locator(
      'xpath=//*[contains(normalize-space(.), ' + JSON.stringify(questionSnippet) + ')]' +
      '/following::label[contains(@class,"btn") and normalize-space(text())=' + JSON.stringify(answer) + '][1]'
    ).first();
    if (await label.count() > 0 && await label.isVisible().catch(() => false)) {
      await label.click({ force: true, timeout: 5000 }).catch(() => {});
      console.log('"' + questionSnippet.substring(0, 40) + '..." = ' + answer);
    } else {
      console.log('WARNING: toggle not found for "' + questionSnippet.substring(0, 40) + '"');
    }
  }

  // ── Businessowners product selection ─────────────────────────────────────
  console.log('Selecting Businessowners product...');
  await page.getByText('Businessowners', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.getByText('Businessowners (v7)', { exact: false }).click().catch(async () => {
    await page.getByText('Businessowners').first().click().catch(() => {});
  });
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Product Selected');

  // ── Product eligibility questions ─────────────────────────────────────────
  console.log('Answering BOP Product Eligibility questions...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Q1: Property or GL losses = No
  await clickYesNoByQuestion('Property or General Liability losses', 'No');
  // Q2: Cremations for other funeral homes = No
  await clickYesNoByQuestion('cremations for other funeral homes', 'No');
  // Q3: Best of my knowledge = Yes
  await clickYesNoByQuestion('best of my knowledge', 'Yes');

  await safeClick(page.getByRole('button', { name: 'Finish' }));
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Eligibility Questions Completed');

  // ── Businessowners coverages (Details tab) ────────────────────────────────
  console.log('BOP - Details tab...');
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(1).click().catch(() => {});
  await dismissStatusModal();

  // Prior carrier already selected in main test, skip to coverage type
  const bopCoverageSelect = page.locator('select[id*="ddl"]').first();
  if (await bopCoverageSelect.isVisible().catch(() => false)) {
    await page.getByRole('combobox', { name: 'Nothing selected' }).first().click().catch(() => {});
    await page.locator('#bs-select-2-3').click().catch(() => {});
  }
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Businessowners Details Completed');

  // ── Coverages tab ─────────────────────────────────────────────────────────
  console.log('BOP - Coverages tab...');
  await dismissStatusModal();

  // Edit Contractors Tools & Equipment coverage
  const editCovBtn = page.getByTitle('Edit Coverage').nth(3);
  if (await editCovBtn.count() > 0 && await editCovBtn.isVisible().catch(() => false)) {
    await editCovBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    // Select first non-empty option in coverage details
    const covDetailSelect = page.locator('#xrgn_CoverageDetails').getByRole('combobox').first();
    if (await covDetailSelect.count() > 0) {
      await covDetailSelect.click().catch(() => {});
      await page.locator('#bs-select-13-0').click().catch(() => {});
    }
    await safeClick(page.getByRole('button', { name: /Save/i }));
    await dismissStatusModal();
  }

  // Add Contractors Installation coverage
  const contrInstallSection = page.locator('#xacc_BP7ContrctrsInstalltnToolsAndEquipmtInstalltn');
  if (await contrInstallSection.count() > 0) {
    await contrInstallSection.getByTitle('Add Coverage').click().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    const firstCombo = page.getByRole('combobox', { name: 'Nothing selected' }).first();
    if (await firstCombo.count() > 0) {
      await firstCombo.click().catch(() => {});
      await page.locator('#bs-select-13-1').click().catch(() => {});
      const secondCombo = page.getByRole('combobox', { name: 'Nothing selected' }).first();
      await secondCombo.click().catch(() => {});
      await page.locator('#bs-select-20-1').click().catch(() => {});
    }
    await safeClick(page.getByRole('button', { name: /Save/i }));
    await dismissStatusModal();
  }

  await processCoverageDropdowns(page);
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Coverages Tab Completed');

  // ── Additional Coverages tab ──────────────────────────────────────────────
  console.log('BOP - Additional Coverages tab...');
  await processAllAddCoverageButtons(page);
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Additional Coverages Tab Completed');

  // ── Locations tab ─────────────────────────────────────────────────────────
  console.log('BOP - Locations tab (Physical Location Address)...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Click Verify Address button
  const verifyAddrBtn = page.getByRole('button', { name: 'Verify Address' });
  if (await verifyAddrBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await verifyAddrBtn.click();
    await page.waitForTimeout(2000);
    await dismissStatusModal();

    // Handle address suggestion modal
    const suggestedModal = page.locator('#dgic-modal-validateaddress_suggestedaddress');
    if (await suggestedModal.isVisible({ timeout: 3000 }).catch(() => false)) {
      const useSuggestedBtn = page.locator('#ValidateAddress_SuggestedAddress_dialog_btn_1');
      if (await useSuggestedBtn.isVisible().catch(() => false)) {
        await useSuggestedBtn.click();
        console.log('Used suggested address');
      }
      await suggestedModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    // Handle no address found modal
    const noAddrModal = page.locator('#dgic-modal-validateaddress_noaddressfound');
    if (await noAddrModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const okBtn = noAddrModal.locator('button').first();
      if (await okBtn.count() > 0) await okBtn.click({ force: true });
      await noAddrModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    await dismissStatusModal();
    console.log('Address verified');
  }

  // Territory Code - auto-populated after verify, just confirm it has a value
  const territoryCode = page.locator('select[id*="Territory"], #ddlTerritoryCode').first();
  if (await territoryCode.count() > 0 && await territoryCode.isVisible().catch(() => false)) {
    const val = await territoryCode.inputValue().catch(() => '');
    console.log('Territory Code: ' + (val || 'auto-populated'));
  }

  // Protection Class - select first non-empty option if not set
  const protectionClass = page.locator('select[id*="ProtectionClass"], #ddlProtectionClass').first();
  if (await protectionClass.count() > 0 && await protectionClass.isVisible().catch(() => false)) {
    const currentVal = await protectionClass.inputValue().catch(() => '');
    if (!currentVal || currentVal === '') {
      const firstOpt = protectionClass.locator('option:not([value=""])').first();
      const firstVal = await firstOpt.getAttribute('value').catch(() => null);
      if (firstVal) {
        await protectionClass.selectOption(firstVal);
        console.log('Protection Class selected: ' + firstVal);
      }
    } else {
      console.log('Protection Class already set: ' + currentVal);
    }
  }

  await dismissStatusModal();
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Locations Tab Completed');

  // ── State Specific Info tab ───────────────────────────────────────────────
  console.log('BOP - State Specific Info tab...');
  await processCoverageDropdowns(page);
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP State Specific Info Completed');

  // ── Buildings/Classifications tab ─────────────────────────────────────────
  console.log('BOP - Buildings/Classifications tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Add building - select location
  const addBuildingDropdown = page.locator('#xrgn_AddBuilding button.dropdown-toggle[role="combobox"]');
  if (await addBuildingDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
    await addBuildingDropdown.click();
    await page.locator('.dropdown-menu.show .text').filter({ hasText: /^[0-9]+: .*/ }).first().click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    console.log('Building location selected');

    // Construction type
    const constructionBtn = page.locator('button[data-id="ddlConstructionType"]');
    if (await constructionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await constructionBtn.click();
      const menu = page.locator('#bs-select-6');
      await menu.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await menu.locator('li span.text', { hasText: 'Frame Construction' }).click().catch(async () => {
        await menu.locator('li').first().click().catch(() => {});
      });
      console.log('Construction type selected');
    }

    // Roof type
    const roofTypeCombo = page.locator('#xrgn_CLBOPBuildingDetails_RoofTypeValue').getByRole('combobox', { name: 'Nothing selected' });
    if (await roofTypeCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
      await roofTypeCombo.click();
      await page.locator('#bs-select-7-0').first().click().catch(() => {});
      console.log('Roof type selected');
    }

    // Year of construction
    const yearField = page.locator('#txtYearOfConstruction');
    if (await yearField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await yearField.fill('2015');
      console.log('Year of construction: 2015');
    }

    await dismissStatusModal();
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Structure Building - Add Coverage and set limit via Estimator
    const structureSection = page.locator('#xacc_BP7StructureBuilding');
    if (await structureSection.count() > 0) {
      await structureSection.getByTitle('Add Coverage').click().catch(() => {});
      await page.waitForLoadState('domcontentloaded');
      await dismissStatusModal();

      // Rating basis
      const ratingBasisCombo = page.locator('#xrgn_BP7RatingBasisValue').getByRole('combobox', { name: 'Nothing selected' });
      if (await ratingBasisCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
        await ratingBasisCombo.click();
        await page.locator('#bs-select-1-1').click().catch(() => {});
      }

      // Estimator
      const estimatorLink = page.locator('a:has-text("Create Estimator"), a:has-text("Edit Estimator")').first();
      if (await estimatorLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await estimatorLink.click();
        await page.waitForTimeout(2000);

        // Square footage
        const sqFt = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
        if (await sqFt.isVisible({ timeout: 5000 }).catch(() => false)) {
          await sqFt.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.keyboard.type('999');
          await page.keyboard.press('Tab');
          await page.waitForTimeout(500);

          // Template
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

    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Classification
    const classLookup = page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll > .input-group-text > .fas');
    if (await classLookup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await classLookup.click();
      await page.getByRole('gridcell', { name: 'Carpentry - Interior - Office' }).click().catch(async () => {
        await page.locator('#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr').first().click().catch(() => {});
      });
      console.log('Classification selected');
    }

    // Square footage for classification
    const sqFtClassInput = page.locator('#txtClassificationSquareFootage_integerWithCommas');
    if (await sqFtClassInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sqFtClassInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type('999');
      await sqFtClassInput.blur();
      await page.waitForTimeout(1000);
      console.log('Classification square footage: 999');
    }

    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Business Personal Property
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
        console.log('Business Personal Property exposure: 25300');
      }

      await safeClick(page.getByRole('button', { name: /^Save$/i }));
      await dismissStatusModal();
    }

    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    await safeClick(page.getByRole('button', { name: 'Save Building/Classification' }));
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    console.log('Building and classification saved');
  }

  trackMilestone('BOP Buildings/Classifications Completed');

  // ── Blankets tab (optional - navigate through) ────────────────────────────
  console.log('BOP - Blankets tab...');
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Blankets Tab Completed');

  // ── Mortgagees tab ────────────────────────────────────────────────────────
  console.log('BOP - Mortgagees tab...');
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Mortgagees Tab Completed');

  // ── UW Questions tab ──────────────────────────────────────────────────────
  console.log('BOP - UW Questions tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // Q1: Mortgagees on this property = No
  await clickYesNoByQuestion('mortgagees on this property', 'No');
  // Q2: Cremations for other funeral homes = No
  await clickYesNoByQuestion('cremations for other funeral homes', 'No');
  // Q3: Best of my knowledge = Yes
  await clickYesNoByQuestion('best of my knowledge', 'Yes');

  await dismissStatusModal();
  await safeContinueClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP UW Questions Completed');
}

module.exports = { runBopCoverageFlow };