// helpers/bopCoverageHelper.js
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./coverageHelpers');

async function clickIfVisible(locator, timeout = 3000) {
    const visible = await locator
        .waitFor({ state: 'visible', timeout })
        .then(() => true)
        .catch(() => false);

    if (visible) {
        await locator.click();
        return true;
    }

    return false;
}

async function runBopCoverageFlow(page, { testState, trackMilestone, dismissStatusModal, safeNextClick, safeContinueClick, safeClick }) {

  await dismissStatusModal();

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

  // ── Helper: select first non-empty option in Bootstrap Select ─────────────
  async function selectBootstrapFirst(dataId, menuId) {
    const btn = page.locator('button[data-id="' + dataId + '"]');
    if (!await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(dataId + ' not visible, skipping');
      return;
    }
    const currentTitle = await btn.getAttribute('title').catch(() => '');
    if (currentTitle && currentTitle.trim() !== '' && currentTitle.trim() !== 'Nothing selected') {
      console.log(dataId + ' already set: ' + currentTitle);
      return;
    }
    await btn.click();
    await page.waitForTimeout(600);
    const selected = await page.evaluate((mid) => {
      const menu = document.querySelector('#' + mid);
      if (!menu) return null;
      const items = menu.querySelectorAll('li a span.text');
      for (const span of items) {
        const txt = span.textContent.trim();
        if (txt) { span.closest('a').click(); return txt; }
      }
      return null;
    }, menuId);
    console.log(dataId + ' selected: ' + selected);
    await page.waitForFunction((did) => {
      const b = document.querySelector('button[data-id="' + did + '"]');
      return b && b.title && b.title.trim() !== '' && b.title.trim() !== 'Nothing selected';
    }, dataId, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // ── Helper: robust integer field fill ─────────────────────────────────────
  async function fillIntegerField(selector, value) {
    const input = page.locator(selector).first();
    if (!await input.isVisible({ timeout: 3000 }).catch(() => false)) return;
    const strVal = String(value);
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.bringToFront();
        await input.click({ clickCount: 3, force: true });
        await page.waitForTimeout(300);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        await input.fill(strVal);
        await page.waitForTimeout(300);
        await input.blur();
        await page.waitForTimeout(800);
        const filled = (await input.inputValue()).replace(/,/g, '').trim();
        if (filled === strVal) { console.log(selector + ' filled: ' + strVal + ' (attempt ' + attempt + ')'); success = true; break; }
        await page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur',   { bubbles: true }));
        }, selector, strVal);
        await page.waitForTimeout(800);
        const evalFilled = (await input.inputValue()).replace(/,/g, '').trim();
        if (evalFilled === strVal) { console.log(selector + ' filled via evaluate: ' + strVal); success = true; break; }
      } catch (e) {
        console.log(selector + ' fill attempt ' + attempt + ' error: ' + e.message.split('\n')[0]);
      }
      await page.waitForTimeout(500);
    }
    if (!success) {
      await input.click({ clickCount: 3, force: true });
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);
      await page.keyboard.type(strVal, { delay: 100 });
      await page.waitForTimeout(300);
      await input.blur();
      await page.waitForTimeout(1000);
      console.log(selector + ' filled via slow type: ' + strVal);
    }
  }

  // ── Helper: verify-and-retry for Verisk360 numeric fields ──────────────────
  // Types the value, reads it back after blur, and re-types if empty/wrong.
  // Returns true only when the field is confirmed to hold the value.
  async function setNumericVerified(locator, value, label, attempts = 3) {
    const strVal = String(value);
    for (let i = 1; i <= attempts; i++) {
      try {
        await locator.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.keyboard.type(strVal, { delay: 50 });
        await locator.blur();
        await page.waitForTimeout(300);

        const current = (await locator.inputValue().catch(() => '')).replace(/,/g, '').trim();
        if (current === strVal || current.startsWith(strVal)) {
          console.log(label + ': ' + current + ' (attempt ' + i + ')');
          return true;
        }
        console.log(label + ' not set (got "' + current + '"), retry ' + i + '/' + attempts);
      } catch (e) {
        console.log(label + ' attempt ' + i + ' error: ' + e.message.split('\n')[0]);
      }
      await page.waitForTimeout(300);
    }
    console.warn(label + ': FAILED after ' + attempts + ' attempts');
    return false;
  }

  // ── Helper: verify-and-retry for Verisk360 type-ahead "Use" field ──────────
  // Types the text, picks the matching suggestion (or keyboard fallback),
  // then confirms the input actually committed the value. Retries the whole
  // type-and-select if the dropdown never rendered.
  async function selectUseVerified(input, typeText, optionText, label, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
      try {
        await input.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.keyboard.type(typeText, { delay: 100 });
        await page.waitForTimeout(1000);

        const suggestion = page.locator(
          '.dropdown-menu.show li:has-text("' + optionText + '"), ' +
          '[role="option"]:has-text("' + optionText + '"), ' +
          'li:has-text("' + optionText + '")'
        ).first();

        if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
          await suggestion.click({ force: true });
          console.log(label + ': selected via suggestion (attempt ' + i + ')');
        } else {
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(300);
          await page.keyboard.press('Enter');
          console.log(label + ': selected via keyboard (attempt ' + i + ')');
        }
        await page.waitForTimeout(500);

        const current = (await input.inputValue().catch(() => '')).trim();
        if (current.toLowerCase().includes(typeText.toLowerCase())) {
          console.log(label + ': "' + current + '" confirmed (attempt ' + i + ')');
          return true;
        }
        console.log(label + ' not committed (got "' + current + '"), retry ' + i + '/' + attempts);
      } catch (e) {
        console.log(label + ' attempt ' + i + ' error: ' + e.message.split('\n')[0]);
      }
      await page.waitForTimeout(300);
    }
    console.warn(label + ': FAILED after ' + attempts + ' attempts');
    return false;
  }

  // ── Businessowners details tab ─────────────────────────────────────────────
  console.log('BOP - Details tab...');
  const bizTypeSelect = page.locator('#ddlBusinessType');
  if (await bizTypeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await bizTypeSelect.selectOption('Apartment');
    console.log('Business type: Apartment');
  }
  await dismissStatusModal();
  await safeNextClick(); // Details → Coverages
  await dismissStatusModal();
  await safeNextClick(); // Coverages → Additional Coverages
  await dismissStatusModal();
  await safeNextClick(); // Additional Coverages → Locations
  trackMilestone('BOP Businessowners Details Completed');

  // ── Locations tab ──────────────────────────────────────────────────────────
  console.log('BOP - Locations tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  const editLocationBtn = page.locator('button[title="Edit Location"]');
  if (await editLocationBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editLocationBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    console.log('Edit Location clicked');
  } else {
    console.log('Already on Location Details - skipping Edit Location');
  }

  const verifyAddressBtn = page.locator('#btnVerifyAddress');
  await verifyAddressBtn.waitFor({ state: 'visible', timeout: 15000 });
  await verifyAddressBtn.click();
  // Shrunk from 2000ms - dismissStatusModal() already polls/retries for the modal.
  await page.waitForTimeout(400);
  await dismissStatusModal();

  const useSuggestedBtn = page.locator('#ValidateAddress_SuggestedAddress_dialog_btn_1');
  if (await useSuggestedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await useSuggestedBtn.click();
    console.log('Used suggested address');
    // Shrunk from 1000ms - referralContinueBtn.waitFor() below already polls up to 3s.
    await page.waitForTimeout(300);
  }

  const referralContinueBtn = page.getByRole('button', { name: 'Continue' });
  if (await referralContinueBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
    console.log('Referral Required dialog - clicking Continue...');
    await referralContinueBtn.click();
  }

  const noAddrModal = page.locator('#dgic-modal-validateaddress_noaddressfound');
  if (await noAddrModal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await noAddrModal.locator('button').first().click({ force: true }).catch(() => {});
    await noAddrModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await dismissStatusModal();

  // Territory Code
  const territoryCode = page.locator('#ddlTerritoryCode, select[id*="Territory"]').first();
  if (await territoryCode.count() > 0 && await territoryCode.isVisible().catch(() => false)) {
    const val = await territoryCode.inputValue().catch(() => '');
    if (!val) {
      const firstVal = await territoryCode.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
      if (firstVal) { await territoryCode.selectOption(firstVal); console.log('Territory Code: ' + firstVal); }
    } else { console.log('Territory Code: ' + val); }
  }

  // Protection Class
  const protectionClass = page.locator('#ddlProtectionClass, select[id*="ProtectionClass"]').first();
  if (await protectionClass.count() > 0 && await protectionClass.isVisible().catch(() => false)) {
    const val = await protectionClass.inputValue().catch(() => '');
    if (!val) {
      const firstVal = await protectionClass.locator('option:not([value=""])').first().getAttribute('value').catch(() => null);
      if (firstVal) { await protectionClass.selectOption(firstVal); console.log('Protection Class: ' + firstVal); }
    } else { console.log('Protection Class: ' + val); }
  }

  await dismissStatusModal();
  await safeNextClick(); // Location Details → Coverages
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
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  for (let i = 0; i < 4; i++) {
    const url = page.url();
    const pageName = url.split('p=')[1]?.split('&')[0] || url;
    console.log('State Specific Info step ' + (i + 1) + ' - URL: ' + pageName);
    if (url.includes('CLBOPBuildingsClassifications') || url.includes('CLBOPBuilding')) {
      console.log('Already reached Buildings tab, stopping');
      break;
    }
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    await page.waitForTimeout(300);
  }

  const onBuildingsTab = await page.locator('button[data-id="ddlAddBuilding"]')
    .isVisible({ timeout: 5000 }).catch(() => false);
  console.log('On Buildings/Classifications tab: ' + onBuildingsTab);

  if (!onBuildingsTab) {
    const buildingsTab = page.locator('a:has-text("Buildings/Classifications"), li:has-text("Buildings/Classifications") a').first();
    if (await buildingsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buildingsTab.click();
      await page.waitForLoadState('domcontentloaded');
      await dismissStatusModal();
      console.log('Clicked Buildings/Classifications tab directly');
    }
  }

  trackMilestone('BOP State Specific Info Completed');

  // ── Buildings/Classifications tab ──────────────────────────────────────────
  console.log('BOP - Buildings/Classifications tab...');
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  const addBuildingBtn = page.locator('button[data-id="ddlAddBuilding"]');
  await addBuildingBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBuildingBtn.click();
  // Shrunk from 800ms - locationLink.isVisible({timeout}) below already polls.
  await page.waitForTimeout(300);
  console.log('Add Building dropdown opened');

  const locationLink = page.locator('button[data-id="ddlAddBuilding"]')
    .locator('xpath=following-sibling::div[contains(@class,"dropdown-menu")]//a').first();

  if (await locationLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await locationLink.click({ force: true });
    console.log('Location clicked via sibling locator');
  } else {
    await page.evaluate(() => {
      const links = document.querySelectorAll('.dropdown-menu.show a, .dropdown-menu.show li a');
      for (const el of links) {
        if (/^\d+:/.test(el.textContent.trim())) {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
          el.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
          break;
        }
      }
    });
    console.log('Location clicked via JS dispatchEvent');
  }

  console.log('Waiting for Building Details page...');
  try {
    await page.waitForFunction(() => {
      return document.querySelector('#txtYearOfConstruction') !== null ||
             document.querySelector('#txtBuildingDescription') !== null ||
             document.querySelector('button[data-id="ddlConstructionType"]') !== null;
    }, { timeout: 30000 });
    console.log('Building Details confirmed - URL: ' + page.url().split('p=')[1]?.split('&')[0]);
  } catch (e) {
    console.log('Building Details not found. URL: ' + page.url());
    await page.goBack().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    const addBtnRetry = page.locator('button[data-id="ddlAddBuilding"]');
    if (await addBtnRetry.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtnRetry.click();
      // Shrunk from 800ms - the locationLink click below has its own actionability wait.
      await page.waitForTimeout(300);
      await locationLink.click({ force: true }).catch(async () => {
        await page.evaluate(() => {
          const links = document.querySelectorAll('.dropdown-menu.show a, .dropdown-menu.show li a');
          for (const el of links) {
            if (/^\d+:/.test(el.textContent.trim())) { el.click(); break; }
          }
        });
      });
      await page.waitForFunction(() => {
        return document.querySelector('#txtYearOfConstruction') !== null ||
               document.querySelector('#txtBuildingDescription') !== null;
      }, { timeout: 15000 }).catch(() => console.log('Retry also failed'));
    }
  }

  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Building Details form ──────────────────────────────────────────────────
  const bldgDesc = page.locator('#txtBuildingDescription');
  if (await bldgDesc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await bldgDesc.fill('Main building');
    console.log('Building description: Main building');
  }

  await selectBootstrapFirst('ddlConstructionType', 'bs-select-6');

  const yearField = page.locator('#txtYearOfConstruction');
  if (await yearField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await yearField.fill('2015');
    await yearField.blur();
    console.log('Year of Construction: 2015');
    await page.waitForTimeout(300);
  }

  await selectBootstrapFirst('ddlRoofType', 'bs-select-7');

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

    await selectBootstrapFirst('ddlBP7RatingBasis', 'bs-select-1');

    // Estimator
    const estimatorLink = page.locator('a:has-text("Create Estimator"), a:has-text("Edit Estimator")').first();
    if (await estimatorLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await estimatorLink.click();
      // Shrunk from 2000ms - the isVisible({timeout}) checks just below already
      // poll for the modal/old-estimator field to appear.
      await page.waitForTimeout(400);

      const verisk360Modal  = page.locator('#dgic-modal-editverisk360valuation');
      const oldEstimatorFld = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
      const isVerisk360     = await verisk360Modal.isVisible({ timeout: 3000 }).catch(() => false);
      const isOldEstimator  = await oldEstimatorFld.isVisible({ timeout: 2000 }).catch(() => false);

      if (isVerisk360) {
        console.log('Verisk360 Valuation modal detected');

        // Screen 1 — Total Sq. Ft. (verify-and-retry)
        const totalSqFt = verisk360Modal.locator('input').first();
        await totalSqFt.waitFor({ state: 'visible', timeout: 5000 });
        const okTotal = await setNumericVerified(totalSqFt, '999', 'Verisk360 Total Sq. Ft.');

        // Use field — type-ahead select (verify-and-retry)
        const useInput = verisk360Modal.locator('input').nth(1);
        await useInput.waitFor({ state: 'visible', timeout: 5000 });
        const okUse = await selectUseVerified(
          useInput, 'Apartment', 'Apartment / Condominium', 'Verisk360 Use'
        );

        // Close any lingering type-ahead dropdown and let the modal reflow,
        // otherwise the dropdown's hidden filter input pollutes .last()
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(600);

        // Diagnostic: how many text inputs the modal reports now
        const inputCount = await verisk360Modal.locator('input[type="text"]').count().catch(() => -1);
        console.log('Verisk360 modal text inputs after Use select: ' + inputCount);

        // Primary Building Sq. Ft.* — target by attribute, NOT positional .last()
        let primarySqFt = verisk360Modal.locator(
          'input[placeholder*="Primary" i], ' +
          'input[aria-label*="Primary" i], ' +
          'input[id*="Primary" i], ' +
          'input[name*="Primary" i]'
        ).first();

        // Fallback: last VISIBLE text input in the modal (dropdown input is hidden by now)
        if (!(await primarySqFt.isVisible({ timeout: 2000 }).catch(() => false))) {
          primarySqFt = verisk360Modal.locator('input[type="text"]:visible').last();
          console.log('Verisk360 Primary Sq. Ft.: using visible-input fallback');
        }

        let okPrimary = false;
        if (await primarySqFt.isVisible({ timeout: 5000 }).catch(() => false)) {
          okPrimary = await setNumericVerified(primarySqFt, '999', 'Verisk360 Primary Sq. Ft.');
        } else {
          console.warn('Verisk360 Primary Sq. Ft. field not found — may not be required for this Use type');
          okPrimary = true; // don't hard-crash; let CONTINUE surface a real validation error if needed
        }

        // Gate: Total and Use must be confirmed; Primary handled above
        if (!okTotal || !okUse) {
          throw new Error(
            'Verisk360 screen-1 fields incomplete — Total:' + okTotal + ' Use:' + okUse
          );
        }
        console.log('Verisk360 screen-1 ready (Primary:' + okPrimary + '), proceeding to CONTINUE');

        // CONTINUE (screen 1 → 2)
        const continueVerisk = verisk360Modal.locator('button:has-text("CONTINUE"), button:has-text("Continue")').first();
        await continueVerisk.waitFor({ state: 'visible', timeout: 10000 });
        await continueVerisk.click();
        // Shrunk from 1500ms - calculateBtn.waitFor() below already polls up to 10s.
        await page.waitForTimeout(300);
        console.log('Verisk360 CONTINUE clicked');

        // CALCULATE NOW (screen 2)
        const calculateBtn = verisk360Modal.locator('button:has-text("CALCULATE NOW"), button:has-text("Calculate Now")').first();
        await calculateBtn.waitFor({ state: 'visible', timeout: 10000 });
        await calculateBtn.click();
        // Shrunk from 2000ms - finishBtn.waitFor() below already polls up to 15s.
        await page.waitForTimeout(300);
        console.log('Verisk360 CALCULATE NOW clicked');

        // FINISH (screen 3)
        const finishBtn = verisk360Modal.locator('button:has-text("FINISH"), button:has-text("Finish")').first();
        await finishBtn.waitFor({ state: 'visible', timeout: 15000 });
        await finishBtn.click();
        // Shrunk from 1500ms - importBtn.waitFor() below already polls up to 10s.
        await page.waitForTimeout(300);
        console.log('Verisk360 FINISH clicked');

        // Import Data (screen 4)
        const importBtn = page.locator('button:has-text("Import Data")').first();
        await importBtn.waitFor({ state: 'visible', timeout: 10000 });
        await importBtn.click();
        // Shrunk from 1500ms - verisk360Modal.waitFor('hidden') below already polls up to 15s.
        await page.waitForTimeout(300);
        console.log('Verisk360 Import Data clicked');

        await verisk360Modal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        await dismissStatusModal();
        console.log('Verisk360 flow completed');

      } else if (isOldEstimator) {
        console.log('Old estimator detected');
        await oldEstimatorFld.click({ clickCount: 3 });
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
        console.log('Old estimator completed');

      } else {
        console.log('No estimator modal detected, skipping');
      }

      await dismissStatusModal();
    } // end estimator

    // % Owner Occupied
    await selectBootstrapFirst('ddlpctOwnerOccupied', 'bs-select-3');

  } // end structureSection

  await dismissStatusModal();
  await safeNextClick(); // Bldg Cov → Bldg Add'l Cov
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

  // ── Bldg Add'l Cov → Class Details ────────────────────────────────────────
  await safeNextClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();

// ── Class Details tab ──────────────────────────────────────────────────────
  const classInput = page.locator('#txtClassificationDescriptionValueAutoComplete_input, #txtClassificationDescriptionValueAutoComplete').first();
  const classLookupIcon = page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll > .input-group-text > .fas');

  if (await classInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Type to filter — much faster than opening full lookup grid
    await classInput.click({ clickCount: 3 });
    await classInput.type('Over 4 families with no office occupancy', { delay: 80 });
    // Shrunk from 800ms - firstSuggestion.isVisible({timeout}) below already polls.
    await page.waitForTimeout(300);

    // Pick first result from autocomplete dropdown
    const firstSuggestion = page.locator(
      '#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr, ' +
      '.ui-autocomplete .ui-menu-item, ' +
      '[role="option"]:has-text("Over 4 families with no office occupancy")'
    ).first();

    if (await firstSuggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstSuggestion.click({ force: true });
      console.log('Classification selected via type-ahead');
    } else {
      // Fallback: open full lookup grid
      if (await classLookupIcon.isVisible({ timeout: 2000 }).catch(() => false)) {
        await classLookupIcon.click();
        await page.getByRole('gridcell', { name: 'Over 4 families with no office occupancy' }).click().catch(async () => {
          await page.locator('#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr').first().click().catch(() => {});
        });
        console.log('Classification selected via grid lookup');
      }
    }
  } else if (await classLookupIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Input not found — fall back to icon click
    await classLookupIcon.click();
    await page.locator('#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr').first()
      .click({ timeout: 10000 }).catch(() => {});
    console.log('Classification selected via icon fallback');
  }


// Classification Square Footage — dgic-integerwithcommas field
  const sqFtClassInput = page.locator('#txtClassificationSquareFootage_integerWithCommas');
  if (await sqFtClassInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sqFtClassInput.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // Use native setter to bypass dgic-integerwithcommas formatter restrictions
    await page.evaluate(() => {
      const el = document.querySelector('#txtClassificationSquareFootage_integerWithCommas');
      if (!el) return;
      el.focus();
      // Native value setter bypasses React/custom input handlers
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, '1999');
      el.dispatchEvent(new Event('focus',  { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // Verify
    let val = await sqFtClassInput.inputValue().catch(() => '');
    console.log('Classification sq ft after evaluate: ' + val);

    // If still blank — click field and type slowly as last resort
    if (!val || val.replace(/,/g, '').trim() === '') {
      await sqFtClassInput.click({ force: true });
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
      for (const ch of '1999') {
        await page.keyboard.press(ch);
        await page.waitForTimeout(100);
      }
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);
      val = await sqFtClassInput.inputValue().catch(() => '');
      console.log('Classification sq ft after char-by-char: ' + val);
    }
  }
  await page.waitForTimeout(1000);
  await safeNextClick(); // Class Details → Class Cov
  await page.waitForLoadState('domcontentloaded');
  

  // Handle any dialog/modal that appears after Next (e.g. attention/info dialog)
  // Try multiple close button patterns
  const closeDialogSelectors = [
    'button[data-dismiss="modal"]',
    'button.close',
    'button:has-text("Close")',
    'button:has-text("OK")',
    'button:has-text("Ok")',
    '#dgic-status-message button',
    '.modal.show .modal-footer button',
    '.modal.show button[aria-label="Close"]',
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    // Check if any modal is blocking
    const anyModal = page.locator('.modal.show, #dgic-status-message:visible').first();
    if (!await anyModal.isVisible({ timeout: 2000 }).catch(() => false)) break;

    console.log('Dialog detected after Class Details Next (attempt ' + (attempt + 1) + ')');

    let closed = false;
    for (const sel of closeDialogSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        // Shrunk from 800ms - the loop's next-iteration isVisible({timeout:2000}) already re-polls.
        await page.waitForTimeout(300);
        console.log('Dialog closed via: ' + sel);
        closed = true;
        break;
      }
    }

    if (!closed) {
      // Try pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log('Dialog closed via Escape');
    }
  }

  await dismissStatusModal();
  await page.waitForLoadState('domcontentloaded');

  // ── Class Cov tab — Business Personal Property ─────────────────────────────
  const bppEditBtn = page.getByTitle('Edit Coverage').first();
  if (await bppEditBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await bppEditBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    await fillIntegerField('#txtexposure_integerWithCommas', '25300');
  }

  // Handle optional Attention dialog before next click
  await dismissStatusModal();
  const attentionHeading = page.getByRole('heading', { name: 'Attention' });
  if (await attentionHeading.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Attention dialog - clicking Close...');
    await page.getByRole('button', { name: 'Close' }).click({ force: true });
    await attentionHeading.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  await dismissStatusModal();
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
  await safeNextClick(); 
  trackMilestone('BOP Buildings/Classifications Completed');

  // ── Blankets tab ───────────────────────────────────────────────────────────
  console.log('BOP - Blankets tab...');
  await safeContinueClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP Blankets Tab Completed');

  // ── Mortgagees tab ─────────────────────────────────────────────────────────
  console.log('BOP - Mortgagees tab...');
  await dismissStatusModal();
  await safeContinueClick();
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