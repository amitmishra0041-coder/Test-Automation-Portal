/**
 * helpers/coverageHelpers.js
 * Reusable functions for processing coverage dropdowns and add coverage buttons.
 * Fixed: processes ALL dropdowns including "Nothing selected" required fields,
 *        removed artificial limits that caused required fields to be skipped.
 */

/**
 * Process all coverage dropdowns on the current page.
 * Selects a value for every visible, enabled dropdown including required
 * "Nothing selected" fields that block the Next button.
 */
async function processCoverageDropdowns(page) {
  console.log('\nSTART processCoverageDropdowns()');

  const coverageChanges      = [];
  const coverageSectionStats = [];
  const sectionStats         = {};

  try {
    const allSelects = await page.locator('select[id*="ddl"]').all();
    console.log(`Found ${allSelects.length} SELECT element(s) with id containing "ddl"`);

    if (allSelects.length === 0) {
      console.log('No SELECT elements found. Done.');
      global.testData.coverageChanges.push(...coverageChanges);
      global.testData.coverageSectionStats.push(...coverageSectionStats);
      return coverageChanges;
    }

    let processedCount = 0;
    let skippedCount   = 0;

    // Process ALL selects - no artificial cap
    for (let i = 0; i < allSelects.length; i++) {
      try {
        const select   = allSelects[i];
        const selectId = await select.getAttribute('id').catch(() => `select_${i}`);

        // Skip non-visible
        if (!await select.isVisible().catch(() => false)) { skippedCount++; continue; }

        // Skip disabled or readonly
        if (await select.evaluate(el => el.disabled).catch(() => false)) {
          console.log(`  Skipping ${selectId}: disabled`);
          skippedCount++;
          continue;
        }
        if (await select.evaluate(el => el.readOnly).catch(() => false)) {
          console.log(`  Skipping ${selectId}: readonly`);
          skippedCount++;
          continue;
        }

        // Identify section name (best-effort)
        let sectionName = 'Unknown Section';
        try {
          const container  = select.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card") or contains(@class,"section") or contains(@class,"container")][1]');
          let headingText  = await container.locator('h3, h4, h5, .panel-heading, .card-header, .section-header, strong').first().textContent({ timeout: 300 }).catch(() => '');
          if (!headingText?.trim())
            headingText = await select.locator('xpath=preceding::h3[1] | preceding::h4[1]').first().textContent({ timeout: 300 }).catch(() => '');
          if (headingText?.trim())
            sectionName = headingText.trim().replace(/\n+/g, ' ').substring(0, 100).replace(/\s+(Save|Edit|Close|Add|Remove|Cancel|Next|Back|Finish|Submit)\s*$/i, '').trim();
        } catch (e) {}

        // Skip Structure Building section (handled separately in Package test)
        if (/structure\s*building/i.test(sectionName)) {
          console.log(`  Skipping ${selectId}: excluded section "Structure Building"`);
          skippedCount++;
          continue;
        }

        // Get all options
        const options = await select.locator('option').all();
        if (options.length < 1) { skippedCount++; continue; }

        // Get current value
        const oldValue = await select.evaluate(el => {
          const sel = el.querySelector('option:checked');
          return sel ? sel.textContent.trim() : '';
        }).catch(() => '');

        // Determine if this is a required empty field
        const isEmpty = !oldValue || oldValue === 'Nothing selected' || oldValue === 'Current' || oldValue === '';

        console.log(`\n  Processing #${processedCount + 1}: ${selectId} [${sectionName}]`);
        console.log(`      Current: "${oldValue}" | isEmpty: ${isEmpty} | Options: ${options.length}`);

        // Pick target option:
        // - If empty/required: first non-empty, non-placeholder option
        // - If already set:    first option that differs from current value
        let targetOption = null;
        for (const opt of options) {
          const txt = (await opt.textContent())?.trim() || '';
          if (!txt || txt === 'Nothing selected' || txt === 'Select...') continue;
          if (isEmpty) {
            // Any real value works for required fields
            targetOption = opt;
            break;
          } else {
            // Pick a different value for optional fields
            if (txt !== oldValue) { targetOption = opt; break; }
          }
        }

        if (!targetOption) {
          console.log(`      Skipping: no valid target option found`);
          skippedCount++;
          continue;
        }

        const targetValue = await targetOption.getAttribute('value');
        const targetText  = (await targetOption.textContent() || '').trim();

        if (!isEmpty && oldValue === targetText) {
          console.log(`      Already set to "${targetText}", no change needed`);
          skippedCount++;
          continue;
        }

        console.log(`      Changing to: "${targetText}"`);

        // Set value via evaluate (most reliable across WB versions)
        await select.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, targetValue);
        await page.waitForTimeout(1000);

        // Verify
        const newValue = await select.evaluate(el => {
          const sel = el.querySelector('option:checked');
          return sel ? sel.textContent.trim() : '';
        }).catch(() => '');

        if (newValue === targetText) {
          console.log(`      SUCCESS: "${oldValue}" -> "${newValue}"`);
          coverageChanges.push({
            quoteNumber   : global.testData?.quoteNumber || 'N/A',
            coverage      : selectId,
            coverageSection: sectionName,
            oldValue,
            newValue,
            status        : 'Updated',
          });
          const now = Date.now();
          if (!sectionStats[sectionName])
            sectionStats[sectionName] = { startTime: now, lastTime: now, dropdownsUpdated: 0 };
          sectionStats[sectionName].dropdownsUpdated++;
          sectionStats[sectionName].lastTime = now;
          processedCount++;
        } else {
          console.log(`      WARNING: expected "${targetText}", got "${newValue}" - trying selectOption()`);
          // Fallback: Playwright selectOption
          try {
            await select.selectOption(targetValue);
            await page.waitForTimeout(1000);
            const retryValue = await select.evaluate(el => {
              const sel = el.querySelector('option:checked');
              return sel ? sel.textContent.trim() : '';
            }).catch(() => '');
            if (retryValue === targetText) {
              console.log(`      SUCCESS via selectOption(): "${retryValue}"`);
              coverageChanges.push({ quoteNumber: global.testData?.quoteNumber || 'N/A', coverage: selectId, coverageSection: sectionName, oldValue, newValue: retryValue, status: 'Updated' });
              const now = Date.now();
              if (!sectionStats[sectionName]) sectionStats[sectionName] = { startTime: now, lastTime: now, dropdownsUpdated: 0 };
              sectionStats[sectionName].dropdownsUpdated++;
              sectionStats[sectionName].lastTime = now;
              processedCount++;
            } else {
              console.log(`      FAILED: could not set value for ${selectId}`);
            }
          } catch (e) {
            console.log(`      selectOption() fallback failed: ${e.message.split('\n')[0]}`);
          }
        }

        // Brief pause between dropdowns
        if (i < allSelects.length - 1) {
          await page.waitForTimeout(500).catch(() => {});
        }

      } catch (e) {
        console.log(`  Error processing SELECT: ${e.message.split('\n')[0]}`);
      }
    }

    console.log(`\nProcessed ${processedCount} dropdown(s), skipped ${skippedCount}`);

    for (const [name, info] of Object.entries(sectionStats)) {
      coverageSectionStats.push({
        quoteNumber     : global.testData?.quoteNumber || 'N/A',
        coverageSection : name,
        durationSeconds : ((info.lastTime - info.startTime) / 1000).toFixed(2),
        dropdownsUpdated: info.dropdownsUpdated,
      });
    }

  } catch (e) {
    console.log(`Error in processCoverageDropdowns: ${e.message.split('\n')[0]}`);
  }

  console.log('END processCoverageDropdowns()\n');

  if (global.testData) {
    global.testData.coverageChanges.push(...coverageChanges);
    global.testData.coverageSectionStats.push(...coverageSectionStats);
  }

  await page.waitForTimeout(500);
  return coverageChanges;
}


/**
 * Process all "Add coverage" buttons on the page.
 * Handles modals, schedule dialogs, and remove-coverage flows.
 */
async function processAllAddCoverageButtons(page) {
  console.log('Processing all Add coverage buttons...');
  const addCoverageDetails = [];
  const MAX_ITERATIONS     = 15;
  let processedCount       = 0;
  let continueProcessing   = true;
  let previousButtonCount  = -1;
  let sameCountIterations  = 0;

  while (continueProcessing) {
    try {
      const iterationStart = Date.now();

      if (processedCount >= MAX_ITERATIONS) {
        console.log(`Reached max iterations (${MAX_ITERATIONS}). Stopping.`);
        break;
      }

      // Find buttons
      let addCoverageButtons = page.locator('button[data-action="Add"]');
      let buttonCount        = await addCoverageButtons.count();
      if (buttonCount === 0) {
        addCoverageButtons = page.locator('button:has(i.fa-plus-circle)');
        buttonCount        = await addCoverageButtons.count();
      }

      console.log(`Iteration ${processedCount + 1}: Found ${buttonCount} Add button(s)`);

      if (buttonCount === previousButtonCount) {
        sameCountIterations++;
        if (sameCountIterations >= 3) { console.log('Button count unchanged 3x, stopping.'); break; }
      } else {
        sameCountIterations = 0;
      }
      previousButtonCount = buttonCount;

      if (buttonCount === 0) { console.log('No more Add coverage buttons. Done.'); break; }

      // Click first visible enabled button
      let buttonClicked = false;
      const allAddBtns  = await addCoverageButtons.all();

      for (const button of allAddBtns) {
        try {
          if (!await button.isVisible().catch(() => false)) continue;
          if (!await button.isEnabled().catch(() => false)) continue;

          const buttonText  = (await button.textContent().catch(() => '')).trim();
          const buttonTitle = await button.getAttribute('title').catch(() => '');
          const buttonLabel = buttonText || buttonTitle || 'Unknown';
          console.log(`  Clicking Add button: "${buttonLabel}"`);

          await button.click({ timeout: 5000, force: true });
          await page.waitForTimeout(500);

          // Check for "Add Scheduled Item" -> click Remove Coverage instead
          const addScheduleBtn = page.locator('button:has-text("Add Scheduled Item")');
          if (await addScheduleBtn.count() > 0) {
            console.log('  Found Add Scheduled Item - clicking Remove Coverage instead');
            const removeBtn = page.locator('button:has-text("Remove Coverage")');
            if (await removeBtn.count() > 0) {
              await removeBtn.first().click();
              console.log('  Clicked Remove Coverage');
              await page.waitForTimeout(2000);
              addCoverageDetails.push({ coverage: buttonLabel, action: 'Removed', duration: ((Date.now() - iterationStart) / 1000).toFixed(2) });
              buttonClicked = true;
              processedCount++;
              break;
            }
          }

          // Check for a modal
          const modal        = page.locator('.modal.show, [role="dialog"]').first();
          const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);

          if (modalVisible) {
            console.log('  Modal opened');
            // Try to interact with options in modal
            const coverageOptions = await modal.locator('select, input[type="checkbox"], li').all();
            if (coverageOptions.length > 0) {
              const first   = coverageOptions[0];
              const tagName = await first.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
              if (tagName === 'select') {
                const opts = await first.locator('option').all();
                if (opts.length > 1) {
                  const val = await opts[1].getAttribute('value');
                  await first.selectOption(val);
                }
              } else if (tagName === 'input') {
                await first.check();
              } else if (tagName === 'li') {
                await first.click();
              }
            }
            // Save/Close modal
            const saveBtn = modal.locator('button:has-text("Save"), button:has-text("Add"), button[data-action="Save"]').first();
            if (await saveBtn.count() > 0) {
              await saveBtn.click({ timeout: 5000 });
              await page.waitForTimeout(1000);
            }
            const stillVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
            if (stillVisible) {
              const closeBtn = modal.locator('button:has-text("Close"), button[data-dismiss="modal"], button.close').first();
              if (await closeBtn.count() > 0) { await closeBtn.click({ timeout: 5000 }); await page.waitForTimeout(500); }
            }
          } else {
            await page.waitForTimeout(3000);
            // Try closing any dialog
            const saveBtn = page.locator('button:has-text("Save"), button[title*="Save"]');
            if (await saveBtn.count() > 0) { await saveBtn.first().click(); await page.waitForTimeout(1000); }
            else {
              const closeBtn = page.locator('button:has-text("Close"), button:has-text("Cancel"), button.close');
              if (await closeBtn.count() > 0) { await closeBtn.first().click(); await page.waitForTimeout(1000); }
            }
          }

          addCoverageDetails.push({ coverage: buttonLabel, action: 'Added', duration: ((Date.now() - iterationStart) / 1000).toFixed(2) });
          buttonClicked = true;
          processedCount++;
          break;

        } catch (e) {
          console.log(`  Error clicking button: ${e.message.split('\n')[0]}`);
          continue;
        }
      }

      if (!buttonClicked) { console.log('Could not click any Add button. Stopping.'); break; }

      await page.waitForTimeout(1000);

    } catch (e) {
      console.log(`Error in processAllAddCoverageButtons: ${e.message.split('\n')[0]}`);
      break;
    }
  }

  console.log(`Finished processing Add coverage buttons. Total: ${processedCount}`);

  if (global.testData?.addCoverageTimings) {
    global.testData.addCoverageTimings.push(...addCoverageDetails);
  }

  return addCoverageDetails;
}

module.exports = { processCoverageDropdowns, processAllAddCoverageButtons };
