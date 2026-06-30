/**
 * helpers/coverageHelpers.js
 * Multi-pass dropdown processor.
 * Waits for WB's conditional-render AJAX to actually settle between passes
 * (networkidle + DOM-stability check) instead of a fixed sleep, falling
 * back to a fixed wait only if the settle signal never resolves.
 */

async function processCoverageDropdowns(page) {
  console.log('\nSTART processCoverageDropdowns()');

  const coverageChanges      = [];
  const coverageSectionStats = [];
  const sectionStats         = {};
  const processedIds         = new Set();
  const MAX_PASSES           = 6;

  // Wait until the page has genuinely stopped changing:
  // 1. networkidle (no more than 2 connections for 500ms) - catches AJAX calls
  // 2. DOM mutation quiet period - catches client-side re-renders with no network call
  async function waitForPageSettle(maxWaitMs = 8000) {
    await page.waitForLoadState('networkidle', { timeout: maxWaitMs }).catch(() => {});

    // DOM stability: poll the count of select[id*="ddl"] elements + their disabled
    // states until they stop changing for 2 consecutive checks (400ms apart)
    let lastSnapshot = null;
    let stableCount   = 0;
    const deadline    = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select[id*="ddl"]'));
        return selects.map(s => s.id + ':' + s.disabled).join('|');
      }).catch(() => null);

      if (snapshot === null) break;

      if (snapshot === lastSnapshot) {
        stableCount++;
        if (stableCount >= 2) return; // stable for 2 consecutive checks - done
      } else {
        stableCount = 0;
      }
      lastSnapshot = snapshot;
      await page.waitForTimeout(400);
    }
    // Timed out waiting for stability - proceed anyway, the pass logic
    // will simply find fewer changes and stop naturally
  }

  try {
    let previousDisabledIds = new Set();

    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      const allSelects = await page.locator('select[id*="ddl"]').all();
      console.log(`Pass ${pass}: found ${allSelects.length} SELECT element(s)`);

      let changedThisPass     = 0;
      const currentDisabledIds = new Set();

      for (let i = 0; i < allSelects.length; i++) {
        try {
          const select   = allSelects[i];
          const selectId = await select.getAttribute('id').catch(() => `select_${i}`);

          if (processedIds.has(selectId)) continue;
          if (!await select.isVisible().catch(() => false)) continue;

          const isDisabled = await select.evaluate(el => el.disabled || el.readOnly).catch(() => true);
          if (isDisabled) {
            currentDisabledIds.add(selectId);
            console.log(`  Skipping ${selectId}: disabled or readonly`);
            continue;
          }

          let sectionName = 'Unknown Section';
          try {
            const container = select.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card") or contains(@class,"section") or contains(@class,"container")][1]');
            let h = await container.locator('h3,h4,h5,.panel-heading,.card-header,strong').first().textContent({ timeout: 300 }).catch(() => '');
            if (!h?.trim()) h = await select.locator('xpath=preceding::h3[1]|preceding::h4[1]').first().textContent({ timeout: 300 }).catch(() => '');
            if (h?.trim()) sectionName = h.trim().replace(/\n+/g,' ').substring(0,100).replace(/\s+(Save|Edit|Close|Add|Remove|Cancel|Next|Back|Finish|Submit)\s*$/i,'').trim();
          } catch (_) {}

          if (/structure\s*building/i.test(sectionName)) {
            console.log(`  Skipping ${selectId}: Structure Building section`);
            continue;
          }

          const options = await select.locator('option').all();
          if (options.length < 1) continue;

          const oldValue = await select.evaluate(el => {
            const s = el.querySelector('option:checked');
            return s ? s.textContent.trim() : '';
          }).catch(() => '');

          const isEmpty = !oldValue || /^(nothing selected|current|select\.\.\.)$/i.test(oldValue.trim());

          let targetOption = null, targetValue = null, targetText = null;

          for (const opt of options) {
            const txt = (await opt.textContent())?.trim() || '';
            if (!txt || /^(nothing selected|select\.\.\.)$/i.test(txt)) continue;
            if (isEmpty) {
              targetOption = opt; targetValue = await opt.getAttribute('value'); targetText = txt;
              break;
            } else if (txt !== oldValue) {
              targetOption = opt; targetValue = await opt.getAttribute('value'); targetText = txt;
              break;
            }
          }

          if (!targetOption) { processedIds.add(selectId); continue; }

          console.log(`  ${selectId}: "${oldValue}" -> "${targetText}" ${isEmpty ? '[REQUIRED]' : ''}`);

          await select.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, targetValue);

          // Wait for THIS specific change to settle before reading back the value
          await waitForPageSettle(6000);

          let newValue = await select.evaluate(el => {
            const s = el.querySelector('option:checked');
            return s ? s.textContent.trim() : '';
          }).catch(() => '');

          if (newValue !== targetText) {
            try {
              await select.selectOption(targetValue);
              await waitForPageSettle(4000);
              newValue = await select.evaluate(el => {
                const s = el.querySelector('option:checked');
                return s ? s.textContent.trim() : '';
              }).catch(() => '');
            } catch (_) {}
          }

          if (newValue === targetText) {
            console.log(`  SUCCESS: ${selectId} = "${newValue}"`);
            processedIds.add(selectId);
            changedThisPass++;
            coverageChanges.push({
              quoteNumber: global.testData?.quoteNumber || 'N/A',
              coverage: selectId, coverageSection: sectionName,
              oldValue, newValue, status: 'Updated',
            });
            const now = Date.now();
            if (!sectionStats[sectionName]) sectionStats[sectionName] = { startTime: now, lastTime: now, dropdownsUpdated: 0 };
            sectionStats[sectionName].dropdownsUpdated++;
            sectionStats[sectionName].lastTime = now;
          } else {
            console.log(`  FAILED: ${selectId} still shows "${newValue}" (wanted "${targetText}")`);
          }

        } catch (e) {
          console.log(`  Error on SELECT: ${e.message.split('\n')[0]}`);
        }
      }

      console.log(`Pass ${pass} complete: changed ${changedThisPass} dropdown(s), total processed: ${processedIds.size}`);

      let newlyEnabledDetected = false;
      for (const id of previousDisabledIds) {
        if (!currentDisabledIds.has(id)) { newlyEnabledDetected = true; break; }
      }

      const selectCountChanged = allSelects.length !== (await page.locator('select[id*="ddl"]').all()).length;

      previousDisabledIds = currentDisabledIds;

      if (changedThisPass === 0 && !newlyEnabledDetected && !selectCountChanged) {
        console.log('No changes, no newly-enabled fields, no new dropdowns - stopping early');
        break;
      }

      if (changedThisPass === 0 && (newlyEnabledDetected || selectCountChanged)) {
        console.log('No changes this pass but newly-enabled/injected dropdowns detected - continuing');
      }

      // Before starting the NEXT pass, explicitly wait for the page to fully
      // settle from whatever the last change in THIS pass triggered.
      // This is the wait that was missing - it runs once per pass, after all
      // dropdowns in the pass are processed, before Pass N+1 begins.
      if (changedThisPass > 0 || newlyEnabledDetected || selectCountChanged) {
        console.log(`Waiting for application to finish rendering before Pass ${pass + 1}...`);
        await waitForPageSettle(8000);
        console.log('Application settled, proceeding to next pass');
      }
    }

  } catch (e) {
    console.log(`Error in processCoverageDropdowns: ${e.message.split('\n')[0]}`);
  }

  console.log(`END processCoverageDropdowns() - total dropdowns changed: ${processedIds.size}\n`);

  for (const [name, info] of Object.entries(sectionStats)) {
    coverageSectionStats.push({
      quoteNumber: global.testData?.quoteNumber || 'N/A',
      coverageSection: name,
      durationSeconds: ((info.lastTime - info.startTime) / 1000).toFixed(2),
      dropdownsUpdated: info.dropdownsUpdated,
    });
  }

  if (global.testData) {
    global.testData.coverageChanges.push(...coverageChanges);
    global.testData.coverageSectionStats.push(...coverageSectionStats);
  }

  await page.waitForTimeout(300);
  return coverageChanges;
}


async function processAllAddCoverageButtons(page) {
  console.log('Processing all Add coverage buttons...');
  const addCoverageDetails = [];
  const MAX_ITERATIONS     = 15;
  let processedCount       = 0;
  let previousButtonCount  = -1;
  let sameCountIterations  = 0;

  while (true) {
    try {
      const iterationStart = Date.now();
      if (processedCount >= MAX_ITERATIONS) { console.log(`Reached max iterations (${MAX_ITERATIONS})`); break; }

      let addButtons = page.locator('button[data-action="Add"]');
      let buttonCount = await addButtons.count();
      if (buttonCount === 0) {
        addButtons  = page.locator('button:has(i.fa-plus-circle)');
        buttonCount = await addButtons.count();
      }

      console.log(`Iteration ${processedCount + 1}: found ${buttonCount} Add button(s)`);

      if (buttonCount === previousButtonCount) {
        sameCountIterations++;
        if (sameCountIterations >= 3) { console.log('Count unchanged 3x, stopping'); break; }
      } else { sameCountIterations = 0; }
      previousButtonCount = buttonCount;

      if (buttonCount === 0) { console.log('No more Add buttons. Done.'); break; }

      let buttonClicked = false;
      const allBtns     = await addButtons.all();

      for (const button of allBtns) {
        try {
          if (!await button.isVisible().catch(() => false)) continue;
          if (!await button.isEnabled().catch(() => false)) continue;

          const label = ((await button.textContent().catch(() => '')) || await button.getAttribute('title').catch(() => '') || 'Unknown').trim();
          console.log(`  Clicking: "${label}"`);

          await button.click({ timeout: 5000, force: true });
          await page.waitForTimeout(500);

          if (await page.locator('button:has-text("Add Scheduled Item")').count() > 0) {
            const removeBtn = page.locator('button:has-text("Remove Coverage")');
            if (await removeBtn.count() > 0) {
              await removeBtn.first().click();
              console.log('  Clicked Remove Coverage');
              await page.waitForTimeout(2000);
              addCoverageDetails.push({ coverage: label, action: 'Removed', duration: ((Date.now()-iterationStart)/1000).toFixed(2) });
              buttonClicked = true; processedCount++; break;
            }
          }

          const modal       = page.locator('.modal.show, [role="dialog"]').first();
          const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
          if (modalVisible) {
            console.log('  Modal opened');
            const opts = await modal.locator('select, input[type="checkbox"], li').all();
            if (opts.length > 0) {
              const tag = await opts[0].evaluate(el => el.tagName.toLowerCase()).catch(() => '');
              if (tag === 'select') {
                const selectOpts = await opts[0].locator('option').all();
                if (selectOpts.length > 1) await opts[0].selectOption(await selectOpts[1].getAttribute('value'));
              } else if (tag === 'input') { await opts[0].check(); }
              else if (tag === 'li') { await opts[0].click(); }
            }
            const saveBtn = modal.locator('button:has-text("Save"), button:has-text("Add")').first();
            if (await saveBtn.count() > 0) { await saveBtn.click({ timeout: 5000 }); await page.waitForTimeout(1000); }
            if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
              const closeBtn = modal.locator('button:has-text("Close"), button[data-dismiss="modal"]').first();
              if (await closeBtn.count() > 0) { await closeBtn.click({ timeout: 5000 }); await page.waitForTimeout(500); }
            }
          } else {
            await page.waitForTimeout(3000);
            const saveBtn = page.locator('button:has-text("Save"), button[title*="Save"]');
            if (await saveBtn.count() > 0) { await saveBtn.first().click(); await page.waitForTimeout(1000); }
            else {
              const closeBtn = page.locator('button:has-text("Close"), button:has-text("Cancel"), button.close');
              if (await closeBtn.count() > 0) { await closeBtn.first().click(); await page.waitForTimeout(1000); }
            }
          }

          addCoverageDetails.push({ coverage: label, action: 'Added', duration: ((Date.now()-iterationStart)/1000).toFixed(2) });
          buttonClicked = true; processedCount++; break;

        } catch (e) { console.log(`  Button error: ${e.message.split('\n')[0]}`); }
      }

      if (!buttonClicked) { console.log('Could not click any Add button. Stopping.'); break; }
      await page.waitForTimeout(1000);

    } catch (e) { console.log(`Iteration error: ${e.message.split('\n')[0]}`); break; }
  }

  console.log(`Add coverage buttons done. Total: ${processedCount}`);
  if (global.testData?.addCoverageTimings) global.testData.addCoverageTimings.push(...addCoverageDetails);
  return addCoverageDetails;
}

module.exports = { processCoverageDropdowns, processAllAddCoverageButtons };
