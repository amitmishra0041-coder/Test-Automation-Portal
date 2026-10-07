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

  // ── Helper: answer every Yes/No question visible on the current screen ─────
  // Confirmed live via screenshot: the UW Questions tab's question set
  // varies by classification (e.g. "mortgagees on this property" vs
  // "Condominiums, Co-ops, Associations - D&O Liability" vs "cremations for
  // other funeral homes" depending on run) - hardcoding specific question
  // text left whichever question didn't match completely unanswered,
  // Continue then rejected/stayed disabled, and safeContinueClick's own
  // retry loop burned through its budget before eventually muscling
  // through with a force click. Answer whatever IS actually on screen
  // instead of guessing the wording in advance.
  async function answerAllYesNoQuestions(affirmativeKeywords = ['best of my knowledge']) {
    // Three prior attempts assumed a markup problem (wrong tag, then
    // whitespace, then a whole-page XPath leaf scan that matched unrelated
    // "Yes" text elsewhere on the page - confirmed live it grabbed inline
    // script text). Confirmed live via screenshot: the real markup IS the
    // classic label.btn toggle-pill pattern the original code targeted -
    // the actual bug is timing. This runs right after domcontentloaded with
    // no wait for the UW Questions tab's own content (loaded separately) to
    // render, so every attempt ran before the real rows existed. Wait for a
    // real toggle first instead of guessing the selector again.
    const toggleScope = 'label.btn, button, [role="button"]';
    const yesButtons = page.locator(toggleScope).filter({ hasText: /^\s*Yes\s*$/i });
    await yesButtons.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    const count = await yesButtons.count().catch(() => 0);
    console.log('UW Questions: found ' + count + ' Yes/No question row(s)');
    if (count === 0) {
      // Still nothing - dump real candidates instead of guessing a fourth
      // time. Any leaf whose exact text is Yes/No anywhere on the page.
      const diag = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('body *'))
          .filter(el => el.children.length === 0 && /^(Yes|No)$/.test((el.textContent || '').trim()))
          .slice(0, 8)
          .map(el => ({ tag: el.tagName, cls: el.className, html: el.outerHTML.slice(0, 150) }));
      }).catch(() => []);
      console.log('UW Questions: 0 rows - diagnostic candidates: ' + JSON.stringify(diag));
    }
    for (let i = 0; i < count; i++) {
      const yesBtn = yesButtons.nth(i);
      const row = yesBtn.locator('xpath=ancestor::tr[1] | ancestor::div[contains(@class,"row")][1] | ancestor::li[1]').first();
      const questionText = (await row.textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
      const isAffirmative = affirmativeKeywords.some(k => questionText.toLowerCase().includes(k.toLowerCase()));
      if (isAffirmative) {
        await yesBtn.click({ force: true }).catch(() => {});
        console.log('UW Question: "' + questionText.slice(0, 70) + '" = Yes');
      } else {
        const noBtn = row.locator(toggleScope).filter({ hasText: /^\s*No\s*$/i }).first();
        if (await noBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await noBtn.click({ force: true }).catch(() => {});
          console.log('UW Question: "' + questionText.slice(0, 70) + '" = No');
        } else {
          console.log('UW Question: "' + questionText.slice(0, 70) + '" - No button not found, leaving unanswered');
        }
      }
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
    // Read the real menu id from the button's own aria-owns instead of
    // trusting the passed-in menuId - bootstrap-select's auto-generated
    // bs-select-N number depends on how many other selectpickers exist on
    // the page, which can shift by classification/state. aria-owns is
    // always accurate at runtime; the parameter is just a fallback.
    const realMenuId = await btn.getAttribute('aria-owns').catch(() => null);
    const effectiveMenuId = realMenuId || menuId;
    const selected = await page.evaluate((mid) => {
      const menu = document.querySelector('#' + mid);
      if (!menu) return null;
      const items = menu.querySelectorAll('li a span.text');
      for (const span of items) {
        const txt = span.textContent.trim();
        if (txt) { span.closest('a').click(); return txt; }
      }
      return null;
    }, effectiveMenuId);
    console.log(dataId + ' selected: ' + selected);
    await page.waitForFunction((did) => {
      const b = document.querySelector('button[data-id="' + did + '"]');
      return b && b.title && b.title.trim() !== '' && b.title.trim() !== 'Nothing selected';
    }, dataId, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // ── Helper: select first real option in a Bootstrap Select found by its
  // OWN label text, for dropdowns whose data-id/menu-id are not known in
  // advance (unlike selectBootstrapFirst above). Confirmed live via
  // diagnostic: "Class Group is required." / "Liability Exposure Base is
  // required." were blocking Save Building/Classification on every run -
  // these two fields were never being filled at all.
  async function selectBootstrapByLabel(labelText) {
    // Confirmed live via screenshot: chaining these calls back-to-back with
    // no settle time can fire while the PREVIOUS field's own change is still
    // propagating (Guidewire's dependent-field postback re-renders parts of
    // this panel), so the click either hits a stale/about-to-be-replaced
    // button or silently doesn't take. Verify the value actually stuck and
    // retry after a settle pause instead of trusting a single pass.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const label = page.getByText(labelText, { exact: true }).first();
      if (!await label.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(labelText + ': label not found, skipping');
        return false;
      }
      const btn = label.locator('xpath=following::button[1]');
      if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(labelText + ': dropdown button not found, skipping');
        return false;
      }
      const currentTitle = await btn.getAttribute('title').catch(() => '');
      if (currentTitle && currentTitle.trim() !== '' && currentTitle.trim() !== 'Nothing selected') {
        console.log(labelText + ' already set: ' + currentTitle);
        return true;
      }
      await btn.click();
      await page.waitForTimeout(400);
      const menuId = await btn.getAttribute('aria-owns');
      const optionLocator = menuId
        ? page.locator('#' + menuId + ' [role="option"], #' + menuId + ' li a')
        : page.locator('.dropdown-menu.show [role="option"], .dropdown-menu.show li a');
      const firstOpt = optionLocator.filter({ hasNotText: 'Nothing selected' }).first();
      if (await firstOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOpt.click();
        await page.waitForTimeout(300);
        const finalVal = await btn.getAttribute('title').catch(() => '');
        if (finalVal && finalVal.trim() !== '' && finalVal.trim() !== 'Nothing selected') {
          console.log(labelText + ' selected: ' + finalVal);
          return true;
        }
        console.log(labelText + ': selection did not stick (attempt ' + attempt + ') - retrying after settle');
      } else {
        console.log(labelText + ': dropdown opened but no selectable options found (attempt ' + attempt + ')');
      }
      await page.waitForTimeout(700);
    }
    console.log(labelText + ': failed to select after 3 attempts');
    return false;
  }

  // ── Helper: same label-lookup as selectBootstrapByLabel, but targets a
  // specific option text instead of just "first real option". Confirmed
  // live via screenshot (WI): the "Property Type" field on Bldg Details had
  // no fill logic at all and needs to land on "Auto Services" specifically,
  // not just whatever happens to be first in the list.
  async function selectBootstrapByLabelText(labelText, preferredText) {
    const label = page.getByText(labelText, { exact: true }).first();
    if (!await label.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(labelText + ': label not found, skipping');
      return false;
    }
    const btn = label.locator('xpath=following::button[1]');
    if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(labelText + ': dropdown button not found, skipping');
      return false;
    }
    const currentTitle = await btn.getAttribute('title').catch(() => '');
    if (currentTitle && currentTitle.trim() === preferredText) {
      console.log(labelText + ' already set: ' + currentTitle);
      return true;
    }
    await btn.click();
    await page.waitForTimeout(400);
    const menuId = await btn.getAttribute('aria-owns');
    const optionLocator = menuId
      ? page.locator('#' + menuId + ' [role="option"], #' + menuId + ' li a')
      : page.locator('.dropdown-menu.show [role="option"], .dropdown-menu.show li a');
    let target = optionLocator.filter({ hasText: preferredText }).first();
    if (!await target.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(labelText + ': "' + preferredText + '" option not found, falling back to first available');
      target = optionLocator.filter({ hasNotText: 'Nothing selected' }).first();
    }
    if (await target.isVisible({ timeout: 2000 }).catch(() => false)) {
      await target.click();
      await page.waitForTimeout(300);
      const finalVal = await btn.getAttribute('title').catch(() => '');
      console.log(labelText + ' selected: ' + finalVal);
      return true;
    }
    console.log(labelText + ': dropdown opened but no selectable options found');
    return false;
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
      await page.keyboard.type(strVal, { delay: 50 });
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
        await page.keyboard.type(strVal, { delay: 30 });
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
        await page.keyboard.type(typeText, { delay: 50 });
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

  // ── Helper: verify-and-retry for Verisk360 Construction Class dropdown ─────
  // Confirmed live: it defaults to "Unknown", and Guidewire's own Calculate
  // Now validation rejects that with "The Estimator returned an Unknown
  // construction type, which is not a valid selection." A first attempt at
  // locating this field via a loose ancestor "contains" xpath landed on the
  // WRONG input (any element whose combined text happened to contain the
  // phrase matched, not just the field's own label) - the value stayed
  // "Unknown" and Calculate Now kept failing. Anchor on the label's own EXACT
  // text instead, then verify the input actually changed before proceeding.
  async function selectConstructionClassVerified(attempts = 3) {
    const classLabel = page.getByText('Construction Class', { exact: true }).first();
    if (!await classLabel.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Construction Class label not found on Structure Options screen');
      return false;
    }
    const classInput = classLabel.locator('xpath=following::input[1]');

    for (let i = 1; i <= attempts; i++) {
      const current = (await classInput.inputValue().catch(() => '')).trim();
      if (current && !/unknown/i.test(current)) {
        console.log('Verisk360 Construction Class already valid: ' + current);
        return true;
      }
      try {
        // Per user direction: stop relying on clicking a pre-rendered
        // option in the full unfiltered list - neither an untrusted
        // synthetic dispatchEvent click NOR a real trusted Playwright click
        // via role=option/mat-option made any difference (both hit the
        // identical "input value updates but widget's committed state
        // stays Unknown" race). This field is a "searchable-select"
        // (iv360-searchable-select-input) - the "Use" field on screen 1 is
        // the SAME kind of widget and has been reliable all session by
        // TYPING to filter the list first, then selecting, rather than
        // opening the full list and hunting for a match. Apply that
        // identical, proven approach here: clear the field and type a
        // substring only "1 - Frame" matches (no other option contains
        // "Frame"), narrowing the list to one unambiguous result.
        await classInput.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.keyboard.type('Frame', { delay: 50 });
        await page.waitForTimeout(1000);

        const suggestion = page.locator(
          '.dropdown-menu.show li:has-text("1 - Frame"), ' +
          '[role="option"]:has-text("1 - Frame"), ' +
          'mat-option:has-text("1 - Frame"), ' +
          'li:has-text("1 - Frame")'
        ).first();

        if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
          await suggestion.click();
          console.log('Construction Class: selected "1 - Frame" via filtered suggestion');
        } else {
          console.log('Construction Class: filtered suggestion not visible - trying ArrowDown+Enter');
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(300);
          await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(1200);
      } catch (e) {
        console.log('Construction Class attempt ' + i + ' error: ' + e.message.split('\n')[0]);
      }
      const after = (await classInput.inputValue().catch(() => '')).trim();
      console.log('Construction Class attempt ' + i + ': "' + after + '"');
      // Reverted the modal-text cross-check added earlier: it matched
      // "Construction Class ... Unknown" against the whole modal's text,
      // but the diagnostic dump shows a SEPARATE element,
      // class="iv360-originalDefaultsText" with text "Unknown" - almost
      // certainly a permanent "original value" reference label, not live
      // current state. That made the cross-check a false positive,
      // rejecting a genuinely valid "1 - Frame" selection every time and
      // forcing pointless retries. Trust inputValue() directly, exactly
      // like the proven selectUseVerified() above does for the Use field -
      // it never cross-checks the modal text either.
      if (after && !/unknown/i.test(after)) return true;
    }

    // Still stuck - reopen the dropdown and dump every visible leaf element
    // whose text mentions "Frame" or "Unknown" anywhere in the document,
    // plus the input's own tag/attrs, instead of guessing a fourth time.
    // This tells us definitively whether the option text exists and is
    // visible at all (timing issue), lives outside the DOM subtree we're
    // searching (structure issue), or is rendered some other way entirely
    // (e.g. canvas/shadow DOM - a fundamentally different control).
    await classInput.click().catch(() => {});
    await page.waitForTimeout(700);
    const domDump = await page.evaluate(() => {
      const isVisible = (el) => !!el.offsetParent;
      const active = document.activeElement;
      const matches = [...document.querySelectorAll('*')]
        .filter(el => el.children.length === 0 && isVisible(el) && /frame|unknown/i.test((el.textContent || '').trim()))
        .slice(0, 15)
        .map(el => ({
          tag: el.tagName, cls: (el.className || '').toString().slice(0, 60),
          text: (el.textContent || '').trim().slice(0, 40),
        }));
      return {
        activeElement: active ? { tag: active.tagName, id: active.id, cls: (active.className || '').toString().slice(0, 60) } : null,
        visibleMatches: matches,
      };
    }).catch(() => ({ error: true }));
    console.log('Construction Class DOM diagnostic: ' + JSON.stringify(domDump));

    console.warn('Construction Class: FAILED to set a valid value after ' + attempts + ' attempts - still "Unknown"');
    return false;
  }

  // ── Verify Import Data actually populated the property data ────────────────
  // Clicking Import Data does not mean it worked - the coverage panel keeps
  // showing the red "Property Information Not Found" banner until the import
  // genuinely completes, which can take a while. Confirmed live via
  // screenshot: success flips it to a GREEN "Property Information Found"
  // banner with Estimated Replacement Cost / Estimator ID Number populated.
  // Poll for that real signal instead of assuming a fixed wait is enough.
  async function waitForPropertyInformationFound(timeout = 45000) {
    const foundLocator = page.locator('text=Property Information Found').first();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await foundLocator.isVisible({ timeout: 1000 }).catch(() => false)) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }

  // ── Generic blocking-dialog closer ──────────────────────────────────────────
  // Any modal left over the page (Verisk360 valuation, Additional Coverages
  // Schedule, "Attention" info dialogs, etc.) eats every subsequent click as a
  // dead actionability timeout instead of failing fast. Try known close-button
  // patterns, then Escape, then force-remove the modal + its backdrop from the
  // DOM as a last resort so navigation can proceed. Originally only ran once,
  // right after the Class Details "Next" click - now also called right after
  // the estimator flow, since that is where a stuck Verisk360 modal (Import
  // Data failing to fully close it) has been confirmed to block the page.
  async function closeAnyBlockingDialog(maxAttempts = 3) {
    const closeSelectors = [
      'button[data-dismiss="modal"]',
      'button.close',
      'button:has-text("Close")',
      'button:has-text("OK")',
      'button:has-text("Ok")',
      '#dgic-status-message button',
      '.modal.show .modal-footer button',
      '.modal.show button[aria-label="Close"]',
    ];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const anyModal = page.locator('.modal.show, #dgic-status-message:visible').first();
      if (!await anyModal.isVisible({ timeout: 2000 }).catch(() => false)) return;

      console.log('closeAnyBlockingDialog: modal detected (attempt ' + (attempt + 1) + '/' + maxAttempts + ')');
      let closed = false;
      for (const sel of closeSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(300);
          console.log('closeAnyBlockingDialog: closed via ' + sel);
          closed = true;
          break;
        }
      }
      if (!closed) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        console.log('closeAnyBlockingDialog: tried Escape');
      }
    }

    if (await page.locator('.modal.show').first().isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('closeAnyBlockingDialog: modal still open after retries - force-removing from DOM');
      await page.evaluate(() => {
        document.querySelectorAll('.modal.show').forEach(el => el.remove());
        document.querySelectorAll('.modal-backdrop, .ui-widget-overlay').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      });
      await page.waitForTimeout(500);
    }
  }

  // ── Businessowners details tab ─────────────────────────────────────────────
  console.log('BOP - Details tab...');
  const bizTypeSelect = page.locator('#ddlBusinessType');
  if (await bizTypeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Was selectOption('Auto services') - a guessed literal option value.
    // Confirmed live across all 4 states: "did not find some options" after
    // the full 60s retry budget, since that string never matched any real
    // <option value="..."> - identical bug class to the Property Type field
    // above, just earlier in the flow and blocking everything downstream.
    // Inspect the real options instead of guessing the value string.
    const bizTypeValue = await bizTypeSelect.evaluate(el => {
      const opts = Array.from(el.options);
      const match = opts.find(o => /auto\s*services/i.test(o.textContent) || /auto\s*services/i.test(o.value));
      const first = opts.find(o => o.value && o.value.trim() !== '');
      return (match || first || {}).value || null;
    });
    if (bizTypeValue) {
      await bizTypeSelect.selectOption(bizTypeValue);
      console.log('Business type selected: ' + bizTypeValue);
    } else {
      console.log('Business type: no options available to select');
    }
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

  // Widened from an immediate 2s check - confirmed live this intermittently
  // fails to find the Edit Location button not because we are genuinely
  // already on Location Details, but because the page from the previous
  // "Additional Coverages -> Locations" transition had not finished
  // rendering EITHER element yet, so the code wrongly assumed "already
  // there" and then #btnVerifyAddress never showed up either.
  await page.waitForTimeout(500);
  const editLocationBtn = page.locator('button[title="Edit Location"]');
  if (await editLocationBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await editLocationBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
    console.log('Edit Location clicked');
  } else {
    console.log('Already on Location Details - skipping Edit Location');
  }

  const verifyAddressBtn = page.locator('#btnVerifyAddress');
  let verifyAddressVisible = await verifyAddressBtn.waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true).catch(() => false);
  if (!verifyAddressVisible) {
    // We may have wrongly assumed "already on Location Details" above while
    // the page was still on the Locations summary/list screen - check for
    // Edit Location again now that more time has passed, and click it as a
    // recovery instead of failing outright.
    console.log('#btnVerifyAddress not visible after 25s - rechecking for Edit Location button');
    if (await editLocationBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editLocationBtn.click();
      await page.waitForLoadState('domcontentloaded');
      await dismissStatusModal();
      console.log('Edit Location clicked (recovery)');
      verifyAddressVisible = await verifyAddressBtn.waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true).catch(() => false);
    }
  }
  if (!verifyAddressVisible) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      heading: (document.querySelector('h1, h2, .gw-title, [role="heading"]')?.textContent || '').trim().slice(0, 200),
      visibleButtons: [...document.querySelectorAll('button')]
        .filter(el => el.offsetParent !== null)
        .map(el => (el.textContent || el.title || '').trim()).filter(Boolean).slice(0, 15),
    })).catch(() => ({}));
    console.log('#btnVerifyAddress still not visible after recovery attempt - page diagnostic: ' + JSON.stringify(diag));
  }
  await verifyAddressBtn.waitFor({ state: 'visible', timeout: verifyAddressVisible ? 1000 : 5000 });
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

  // Widened from 5s - confirmed live that missing this window left the
  // screen unsaved (still on CLBOPLocationAdditionalCoverages.aspx, whose
  // only real button is "Save Location") and silently fell through into
  // the State Specific Info loop below, which then hunted for a "Next "
  // button that does not exist on this screen - a 30s dead timeout with no
  // trace of what actually went wrong.
  const saveLocationBtn = page.locator('#btnNext_CLBOPLocationAdditionalCoverages');
  const saveLocationVisible = await saveLocationBtn.waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true).catch(() => false);
  if (saveLocationVisible) {
    await saveLocationBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();
  } else {
    const saveLocationTextBtn = page.getByRole('button', { name: 'Save Location' });
    if (await saveLocationTextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveLocationTextBtn.click();
      await page.waitForLoadState('domcontentloaded');
      await dismissStatusModal();
      console.log('Save Location clicked via text fallback');
    } else {
      console.log('Save Location button not found by id or text after waiting - continuing (may already be past this screen)');
    }
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

  await selectBootstrapByLabelText('Property Type', 'Auto Services');

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
  // Confirmed live: structureSection.count() is an instant, non-polling
  // check - if the Bldg Cov page had not fully rendered by that exact
  // millisecond, it read 0 even though the section (and the whole Rating
  // Basis/Estimator/Construction Class/Limit block behind it) existed a
  // moment later, silently skipping the entire Building coverage section
  // with zero trace. Poll for the real, confirmed-working signal (the "Add
  // Coverage" icon itself) instead of an instant count on the container.
  const structureAddCoverageIcon = page.locator('[title="Add Coverage"][coverageid="BP7StructureBuilding"]');
  const hasStructureBuilding = await structureAddCoverageIcon.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true).catch(() => false);
  if (hasStructureBuilding) {
    // Confirmed live via screenshot: the "Building" coverage panel can stay
    // COLLAPSED because this click was silently swallowed by .catch(() =>
    // {}) with no visibility wait and no logging - the whole rest of this
    // section (Rating Basis, Estimator, Construction Class, Limit, % Owner
    // Occupied) then got skipped with zero trace of why. Confirmed live via
    // the actual element HTML: <i title="Add Coverage"
    // coverageid="BP7StructureBuilding" onclick="...addCoverage(...)"
    // class="fa fa-plus-circle cardAdd"> - this icon carries its own
    // coverageid attribute, so target it directly by that instead of
    // scoping through #xacc_BP7StructureBuilding, which may not actually
    // contain it (that id likely belongs to the panel body that only
    // appears AFTER this icon is clicked, not the header the icon lives
    // in) - a plausible reason the scoped search kept finding nothing.
    const addCoverageBtn = structureAddCoverageIcon;
    await addCoverageBtn.click();
    console.log('Building coverage panel: Add Coverage clicked');
    await page.waitForLoadState('domcontentloaded');
    await dismissStatusModal();

    // Verify the panel actually expanded - if the Rating Basis dropdown
    // still is not there after a real wait, the panel is genuinely
    // collapsed/unopened and everything below will silently no-op.
    const ratingBasisBtn = page.locator('button[data-id="ddlBP7RatingBasis"]');
    const ratingBasisVisible = await ratingBasisBtn.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false);
    if (!ratingBasisVisible) {
      console.log('Building coverage panel: Rating Basis still not visible after expand attempt - retrying Add Coverage click');
      await addCoverageBtn.click({ force: true }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');
      await dismissStatusModal();
      const retryVisible = await ratingBasisBtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      console.log('Building coverage panel: Rating Basis visible after retry? ' + retryVisible);
    }

    await selectBootstrapFirst('ddlBP7RatingBasis', 'bs-select-1');

    // Estimator
    const estimatorLink = page.locator('a:has-text("Create Estimator"), a:has-text("Edit Estimator")').first();
    const verisk360Modal  = page.locator('#dgic-modal-editverisk360valuation');
    const oldEstimatorFld = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
    let isVerisk360 = false;
    let isOldEstimator = false;
    let estimatorLinkWasVisible = false;

    // Confirmed live (user watching the real browser): the modal opens and
    // then closes itself almost immediately, before any field gets filled -
    // a single isVisible(timeout) check after the click can straddle that
    // open/close window and wrongly report "never opened". Poll frequently
    // right after each click instead of one long wait, and retry the click
    // itself up to 3 times so a self-closing first attempt isn't fatal.
    for (let openAttempt = 1; openAttempt <= 3 && !isVerisk360 && !isOldEstimator; openAttempt++) {
      const linkVisible = await estimatorLink.isVisible({ timeout: 5000 }).catch(() => false);
      if (!linkVisible) {
        if (openAttempt === 1) console.log('Estimator link not visible');
        break;
      }
      estimatorLinkWasVisible = true;
      await estimatorLink.click();
      console.log('Estimator link clicked (open attempt ' + openAttempt + ')');

      const pollDeadline = Date.now() + 8000;
      let sawItOpen = false;
      while (Date.now() < pollDeadline) {
        const v360 = await verisk360Modal.isVisible().catch(() => false);
        const old  = await oldEstimatorFld.isVisible().catch(() => false);
        if (v360 || old) {
          sawItOpen = true;
          isVerisk360 = v360;
          isOldEstimator = !v360 && old;
          console.log('Estimator opened (attempt ' + openAttempt + ') - Verisk360:' + v360 + ' Old:' + old);
          break;
        }
        await page.waitForTimeout(300);
      }

      if (!sawItOpen) {
        console.log('Estimator did not open within 8s (attempt ' + openAttempt + ') - retrying click');
        await page.waitForTimeout(500);
      } else if (isVerisk360) {
        // Confirm it's still open a moment later rather than trusting the
        // first sighting, since the observed failure mode is a near-instant
        // self-close.
        await page.waitForTimeout(600);
        const stillOpen = await verisk360Modal.isVisible().catch(() => false);
        if (!stillOpen) {
          console.log('Verisk360 modal closed itself within ~600ms of opening (attempt ' + openAttempt + ') - retrying');
          isVerisk360 = false;
        }
      }
    }

    if (estimatorLinkWasVisible) {
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

        // Screen 2 - "Structure Options": Construction Class defaults to
        // "Unknown", which CALCULATE NOW rejects with:
        // "The Estimator returned an Unknown construction type, which is not
        // a valid selection. Please reopen the Estimator and select a valid
        // Construction Class before importing." Confirmed live via
        // screenshot - fix it before ever clicking CALCULATE NOW.
        const constructionClassOk = await selectConstructionClassVerified();

        // CALCULATE NOW (screen 2) onward - skip the whole rest of the wizard
        // if Construction Class could not be fixed, since clicking Calculate
        // Now is guaranteed to reproduce the exact same validation error and
        // leave the wizard stuck on screen 2 - FINISH/Import Data would then
        // never appear and their unguarded waitFor() calls would throw and
        // crash the coverage flow instead of falling back gracefully.
        let importedOk = false;
        if (constructionClassOk) {
          const calculateBtn = verisk360Modal.locator('button:has-text("CALCULATE NOW"), button:has-text("Calculate Now")').first();
          await calculateBtn.waitFor({ state: 'visible', timeout: 10000 });
          await calculateBtn.click();
          // Shrunk from 2000ms - finishBtn.waitFor() below already polls up to 15s.
          await page.waitForTimeout(300);
          console.log('Verisk360 CALCULATE NOW clicked');

          // FINISH (screen 3) - widened from 15s: confirmed live on CP that
          // Calculate Now's own processing can take longer than that under
          // load, and a bare "never appeared" log gives no way to tell a
          // slow calculation apart from a silent validation error.
          const finishBtn = verisk360Modal.locator('button:has-text("FINISH"), button:has-text("Finish")').first();
          const finishVisible = await finishBtn.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
          if (!finishVisible) {
            const modalDiag = await verisk360Modal.evaluate(el => ({
              text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
              buttons: [...el.querySelectorAll('button')]
                .filter(b => b.offsetParent !== null)
                .map(b => (b.textContent || '').trim()).filter(Boolean),
            })).catch(() => ({ text: '(modal not found)', buttons: [] }));
            console.log('Verisk360 modal state when FINISH did not appear: ' + JSON.stringify(modalDiag));
          }
          if (finishVisible) {
            await finishBtn.click();
            // Shrunk from 1500ms - importBtn.waitFor() below already polls up to 10s.
            await page.waitForTimeout(300);
            console.log('Verisk360 FINISH clicked');

            // Import Data (screen 4)
            const importBtn = page.locator('button:has-text("Import Data")').first();
            const importVisible = await importBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
            if (importVisible) {
              await importBtn.click();
              // Shrunk from 1500ms - verisk360Modal.waitFor('hidden') below already polls up to 15s.
              await page.waitForTimeout(300);
              console.log('Verisk360 Import Data clicked');

              await verisk360Modal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
              importedOk = await waitForPropertyInformationFound(45000);
            } else {
              console.log('Import Data button never appeared after FINISH');
            }
          } else {
            console.log('FINISH button never appeared after CALCULATE NOW - Calculate Now likely hit another validation error');
          }
        } else {
          console.log('Skipping CALCULATE NOW/FINISH/Import Data - Construction Class still invalid, would fail validation');
        }
        console.log(importedOk
          ? 'Property Information Found - Import Data succeeded'
          : 'Property Information still shows Not Found - estimator flow did not complete, falling back to default limit');
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
        const importedOkOld = await waitForPropertyInformationFound(45000);
        console.log(importedOkOld
          ? 'Property Information Found - Import Data succeeded'
          : 'Property Information still shows Not Found after 45s - Import Data likely failed');
        console.log('Old estimator completed');

      } else {
        // Dump what's actually on screen instead of guessing - the estimator
        // link click can open something neither selector recognizes (a slow
        // Verisk360 render past the 10s window, a differently-ided modal,
        // etc.), and the previous silent skip left the coverage unfilled with
        // no trace of what needed handling.
        const diag = await page.evaluate(() => {
          const modals = [...document.querySelectorAll('.modal.show, [id*="modal"], [id*="Modal"]')]
            .filter(el => el.offsetParent !== null)
            .map(el => ({ id: el.id, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
          return modals.slice(0, 5);
        }).catch(() => []);
        console.log('No estimator modal detected via known selectors - visible modal-like elements: ' + JSON.stringify(diag));
      }

      // Import Data (or Finish, on the old estimator) can leave the modal up
      // if any step above silently failed - force it closed rather than
      // letting every click downstream, including the Bldg Cov -> Bldg Add'l
      // Cov Next click, inherit the same dead actionability timeout.
      await closeAnyBlockingDialog();
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
  // Per user direction: replicate the same grid-lookup logic already proven
  // working for CP's Special Classes lookup (identical UI pattern - a
  // _displayAll icon opens a grid, the first row in its _resultsTable is
  // picked) instead of hardcoding a specific classification text that does
  // not exist for every Property Type. An earlier attempt at this failed
  // because it only gave the grid ~800ms to render before checking for rows
  // with a 3s timeout; CP's own working code waits up to 8s for the first
  // result row to appear, which is the timing this actually needs.
  const classLookupTrigger = page.locator('#txtClassificationDescriptionValueAutoComplete_displayAll');
  const classLookupVisible = await classLookupTrigger.waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true).catch(() => false);

  if (classLookupVisible) {
    await classLookupTrigger.click();
    const firstClassRow = page.locator('#txtClassificationDescriptionValueAutoComplete_resultsTable tbody tr').first();
    const firstClassRowVisible = await firstClassRow.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false);
    if (firstClassRowVisible) {
      await firstClassRow.click();
      console.log('Classification selected: first available option from grid lookup');
    } else {
      console.log('Classification grid lookup opened but no rows found within 8s');
    }
  } else {
    console.log('Classification lookup icon not found - skipping');
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

  // Confirmed live via diagnostic dump: "Class Group is required." and
  // "Liability Exposure Base is required." were blocking Save
  // Building/Classification on every prior run - these two required
  // dropdowns were never being filled at all.
  await selectBootstrapByLabel('Class Group');
  await selectBootstrapByLabel('Liability Exposure Base');
  // Confirmed live via screenshot (Automobile Body Shops classification):
  // "Gasoline sales is required." - same gap, this conditional field (only
  // appears for some classifications) had no fill logic either.
  // Was selectBootstrapByLabel(...) - confirmed live via inspect element its
  // Locator-based option .click() can leave the button's title showing
  // "Yes" (decorative state) without actually syncing the underlying
  // <select id="ddlClassificationGasolineSales">, so validation still sees
  // it unfilled. Now that we have the real data-id/menu-id, use
  // selectBootstrapFirst instead - it clicks options via an in-page
  // evaluate() call, the same mechanism already proven reliable for
  // Construction Type/Roof Type.
  await selectBootstrapFirst('ddlClassificationGasolineSales', 'bs-select-4');

  await page.waitForTimeout(1000);
  await safeNextClick(); // Class Details → Class Cov
  await page.waitForLoadState('domcontentloaded');

  // Handle any dialog/modal that appears after Next (e.g. attention/info dialog)
  await closeAnyBlockingDialog();

  await dismissStatusModal();
  await page.waitForLoadState('domcontentloaded');

  // ── Class Cov tab — Business Personal Property (and any other coverage
  // panels on this screen) ────────────────────────────────────────────────
  // Widened from .first() only: this screen's "Coverages" layout can show
  // more than one panel needing "Edit Coverage" (confirmed live via
  // diagnostic - the screen stayed on CLBOPBuildingClassificationCoverages
  // with no validation error text, meaning Next was clicked but something
  // on this page was never actually filled). Process every panel found.
  const editCoverageCount = await page.getByTitle('Edit Coverage').count().catch(() => 0);
  console.log('Class Cov: found ' + editCoverageCount + ' "Edit Coverage" panel(s)');
  for (let i = 0; i < editCoverageCount; i++) {
    // Re-query by index each time rather than caching locators - the DOM
    // can re-render between panels as each one is filled and saved.
    const editBtn = page.getByTitle('Edit Coverage').nth(i);
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) continue;
    await editBtn.click();
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
  // Confirmed live via diagnostic: which real button is present on this
  // screen varies by run - some show only "Save Building/Classification",
  // others only "Next ". Trying one for a fixed window (8s) then switching
  // to the other failed even when the first one WAS actually present, just
  // not rendered yet within that window (the diagnostic dump proved it was
  // there right after we'd already given up and moved on). Poll for
  // whichever real button appears first instead of committing to an order.
  const saveClassBtn = page.locator('#btnNext_CLBOPBuildingClassificationAdditionalCoverages');
  if (await saveClassBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Confirmed live: the button can become visible/clickable before the
    // Class Add'l Cov grid has actually finished rendering right after
    // landing on this sub-tab - give it a beat to settle before submitting.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    await saveClassBtn.click();
  } else {
    // Confirmed live: a single race between "Save Building/Classification"
    // and "Next " isn't enough - this screen can have multiple sub-steps
    // (e.g. an "Exclusions" tab) where "Next " is the real button for one
    // step, only for "Save Building/Classification" to be the real button
    // on the NEXT step after that. Loop through intermediate "Next " clicks
    // until the actual Save button shows up, instead of treating a single
    // "Next " click as the end of the job.
    // Was getByRole('button', {name: 'Save Building/Classification'}) - a
    // guessed accessible-name match. Confirmed live via inspect element this
    // button's real id is the same btnNext_CLBOPBuildingClassificationAdditionalCoverages
    // as saveClassBtn above; using the id directly is more precise than
    // recomputing an accessible name, and this loop still earns its keep by
    // polling across intermediate "Next " sub-steps before the id-matched
    // button actually appears.
    const saveTextBtn = page.locator('#btnNext_CLBOPBuildingClassificationAdditionalCoverages');
    const nextTextBtn = page.getByRole('button', { name: 'Next ' });
    let saved = false;
    for (let step = 1; step <= 5 && !saved; step++) {
      const stepDeadline = Date.now() + 15000;
      let which = null;
      while (Date.now() < stepDeadline && !which) {
        if (await saveTextBtn.isVisible().catch(() => false)) { which = 'save'; break; }
        if (await nextTextBtn.isVisible().catch(() => false)) { which = 'next'; break; }
        await page.waitForTimeout(500);
      }
      if (which === 'save') {
        console.log(`"Save Building/Classification" button found (step ${step})`);
        await safeClick(saveTextBtn);
        saved = true;
      } else if (which === 'next') {
        console.log(`"Next" button found (step ${step}) - clicking through to next sub-screen`);
        await safeNextClick();
        await page.waitForLoadState('domcontentloaded');
        await dismissStatusModal();
      } else {
        console.log(`Neither button appeared within 15s (step ${step})`);
        break;
      }
    }
    if (!saved) {
      console.log('Save Building/Classification never confirmed clicked - trying Next as last resort');
      await safeNextClick();
    }
  }
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  console.log('Building and classification saved');

  // Confirmed live: saving can surface a confirmation dialog with its own
  // "Close" button, which sat over the page and made the immediate
  // safeNextClick() below time out hunting for "Next " while the real
  // blocking button was "Close".
  const postSaveCloseBtn = page.getByRole('button', { name: 'Close' });
  if (await postSaveCloseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Post-save Close dialog detected - dismissing');
    await postSaveCloseBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await closeAnyBlockingDialog();
  await dismissStatusModal();

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

  await answerAllYesNoQuestions();

  await dismissStatusModal();
  await safeContinueClick();
  await page.waitForLoadState('domcontentloaded');
  await dismissStatusModal();
  trackMilestone('BOP UW Questions Completed');
}

module.exports = { runBopCoverageFlow };