/**
 * Coverage Helper Functions
 * Reusable functions for processing coverage dropdowns and add coverage buttons
 */

/**
 * Process all coverage dropdowns on the current page
 * @param {Page} page - Playwright page object
 * @returns {Array} coverageChanges - Array of dropdown changes made
 */
async function processCoverageDropdowns(page) {
  console.log('\n🚀 START processCoverageDropdowns() 🚀');
  
  const coverageChanges = [];
  const coverageSectionStats = [];
  const sectionStats = {}; // Track per-coverage-section timing and counts
  const maxDropdownsPerSection = 3;

  try {
    // Find all SELECT elements (we'll filter for visibility/enabled state in the loop)
    console.log('  🔍 Searching for SELECT elements on current page...');
    
    const allSelects = await page.locator('select[id*="ddl"]').all();
    console.log(`  📊 Found ${allSelects.length} SELECT element(s) with ID containing "ddl"`);
    
    if (allSelects.length === 0) {
      console.log('  ⚠️  No SELECT elements found. Dropdown processing complete.');
      global.testData.coverageChanges.push(...coverageChanges);
      global.testData.coverageSectionStats.push(...coverageSectionStats);
      return coverageChanges;
    }

    // Process each SELECT element
    let processedCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < allSelects.length && processedCount < (maxDropdownsPerSection * 3); i++) {
      try {
        const select = allSelects[i];
        
        // Get select ID early for logging
        const selectId = await select.getAttribute('id').catch(() => `select_${i}`);

        // Quick visibility check - skip immediately if not visible
        const isVisible = await select.isVisible().catch(() => false);
        if (!isVisible) {
          skippedCount++;
          continue; // Skip silently for non-visible
        }

        // Quick check if disabled or readonly (early exit before any heavy processing)
        const isDisabled = await select.evaluate(el => el.disabled).catch(() => false);
        if (isDisabled) {
          console.log(`  ⏭️  Skipping ${selectId}: disabled`);
          skippedCount++;
          continue;
        }
        
        const isReadonly = await select.evaluate(el => el.readOnly).catch(() => false);
        if (isReadonly) {
          console.log(`  ⏭️  Skipping ${selectId}: readonly`);
          skippedCount++;
          continue;
        }

        // Quick section name check to exclude "Structure Building" early (before expensive lookups)
        let sectionName = 'Unknown Section';
        try {
          // Fast check: Look for closest heading with shorter timeout
          const container = select.locator('xpath=ancestor::*[contains(@class,"panel") or contains(@class,"card") or contains(@class,"section") or contains(@class,"container")][1]');
          let headingText = await container.locator('h3, h4, h5, .panel-heading, .card-header, .section-header, strong').first().textContent({ timeout: 300 }).catch(() => '');
          
          if (!headingText || headingText.trim().length === 0) {
            headingText = await select.locator('xpath=preceding::h3[1] | preceding::h4[1]').first().textContent({ timeout: 300 }).catch(() => '');
          }
          
          if (headingText && headingText.trim().length > 0) {
            sectionName = headingText.trim().replace(/\n+/g, ' ').substring(0, 100);
          }
        } catch (e) {
          // Leave as Unknown Section
        }
        
        // EXCLUDE "Structure Building" coverage section EARLY
        if (sectionName.toLowerCase().includes('structure building') || 
            (sectionName.toLowerCase().includes('structure') && sectionName.toLowerCase().includes('building'))) {
          console.log(`  ⏭️  Skipping ${selectId}: excluded coverage section "Structure Building"`);
          skippedCount++;
          continue;
        }
        
        // Check number of options - skip silently if insufficient
        const options = await select.locator('option').all();
        if (options.length < 1) {
          skippedCount++;
          continue;
        }
        
        // Get current value
        const oldValue = await select.evaluate(el => {
          const selected = el.querySelector('option:checked');
          return selected ? selected.textContent.trim() : 'Current';
        }).catch(() => 'Current');
        
        console.log(`\n  🎯 Processing #${processedCount + 1}: ${selectId} [${sectionName}]`);
        console.log(`      Current value: "${oldValue}"`);
        console.log(`      Options available: ${options.length}`);
        
        // Pick the first option that is DIFFERENT from the current value
        let targetOption = null;
        for (const opt of options) {
          const txt = (await opt.textContent())?.trim() || '';
          if (txt.length === 0) continue;
          if (txt !== oldValue) { // choose any value other than the current selection
            targetOption = opt;
            break;
          }
        }

        // Fallback: if every option matches oldValue (unlikely), keep current and skip
        if (!targetOption) {
          console.log(`      ⏭️  Skipping ${selectId}: no alternative option found (all match "${oldValue}")`);
          continue;
        }

        const targetOptionValue = await targetOption.getAttribute('value');
        const targetText = (await targetOption.textContent() || '').trim();

        // If the dropdown is already on the target option, just log and record a no-op
        if (oldValue === targetText) {
          console.log(`      ℹ️  Skipping change: already set to "${targetText}"`);
          coverageChanges.push({
            quoteNumber: global.testData.quoteNumber || 'N/A',
            coverage: selectId,
            coverageSection: sectionName,
            oldValue,
            newValue: targetText,
            status: 'NoChange'
          });

          // Track per-section stats even for no-op to capture timing/count
          const now = Date.now();
          if (!sectionStats[sectionName]) {
            sectionStats[sectionName] = {
              startTime: now,
              lastTime: now,
              dropdownsUpdated: 0
            };
          }
          sectionStats[sectionName].lastTime = now;
          continue;
        }

        console.log(`      Changing to: "${targetText}"`);
        
        // Change the dropdown value using JavaScript directly
        await select.evaluate((el, val) => {
          el.value = val;
          const event = new Event('change', { bubbles: true });
          el.dispatchEvent(event);
        }, targetOptionValue);
        console.log(`      ✅ Dropdown value set via JavaScript`);
        
        await page.waitForTimeout(1500);
        
        // Verify change
        const newValue = await select.evaluate(el => {
          const selected = el.querySelector('option:checked');
          return selected ? selected.textContent.trim() : '';
        }).catch(() => '');
        
        if (newValue === targetText) {
          console.log(`      ✅ SUCCESS: Dropdown changed from "${oldValue}" → "${newValue}"`);
          coverageChanges.push({
            quoteNumber: global.testData.quoteNumber || 'N/A',
            coverage: selectId,
            coverageSection: sectionName,
            oldValue,
            newValue: newValue,
            status: 'Updated'
          });

          // Track per-section timing and counts
          const now = Date.now();
          if (!sectionStats[sectionName]) {
            sectionStats[sectionName] = {
              startTime: now,
              lastTime: now,
              dropdownsUpdated: 0
            };
          }
          sectionStats[sectionName].dropdownsUpdated += 1;
          sectionStats[sectionName].lastTime = now;

          processedCount++;
        } else {
          console.log(`      ⚠️  Value verification failed. Expected "${targetText}", got "${newValue}"`);
        }
        
      } catch (e) {
        console.log(`    ❌ Error processing SELECT: ${e.message.split('\n')[0]}`);
      }

      // Give UI a breather before the next dropdown (only if we plan to process more)
      if (processedCount < (maxDropdownsPerSection * 3) && i < allSelects.length - 1) {
        // Check if there are any more visible, non-disabled dropdowns ahead
        let hasMoreDropdowns = false;
        for (let j = i + 1; j < allSelects.length; j++) {
          const nextSelect = allSelects[j];
          const isNextVisible = await nextSelect.isVisible().catch(() => false);
          const isNextDisabled = await nextSelect.evaluate(el => el.disabled).catch(() => true);
          if (isNextVisible && !isNextDisabled) {
            hasMoreDropdowns = true;
            break;
          }
        }
        
        if (hasMoreDropdowns) {
          console.log('  ⏳ Waiting 2s before next dropdown...');
          await page.waitForTimeout(2000).catch(() => {
            // If page closes during wait, that's fine - just exit
            console.log('  ℹ️  Page closed during wait, exiting dropdown processing');
          });
        }
      }
    }
    
    console.log(`\n✅ Processed ${processedCount} dropdown(s) successfully (skipped ${skippedCount} non-applicable)`);

    // Build per-section stats (total time and count)
    for (const [sectionName, info] of Object.entries(sectionStats)) {
      const durationMs = info.lastTime - info.startTime;
      const durationSeconds = (durationMs / 1000).toFixed(2);
      
      // Use milliseconds if duration is less than 100ms, otherwise seconds
      const formattedDuration = durationMs < 100 ? `${durationMs}ms` : `${durationSeconds}s`;
      
      coverageSectionStats.push({
        quoteNumber: global.testData.quoteNumber || 'N/A',
        coverageSection: sectionName,
        durationSeconds,
        durationFormatted: formattedDuration,
        dropdownsUpdated: info.dropdownsUpdated
      });
    }
    
  } catch (e) {
    console.log(`❌ Error in processCoverageDropdowns: ${e.message.split('\n')[0]}`);
  }

  console.log('\n🏁 END processCoverageDropdowns() 🏁\n');
  
  // APPEND to global arrays instead of replacing
  global.testData.coverageChanges.push(...coverageChanges);
  global.testData.coverageSectionStats.push(...coverageSectionStats);
  
  await page.waitForTimeout(500);
  return coverageChanges;
}

/**
 * Process all "Add coverage" buttons on the page
 * @param {Page} page - Playwright page object
 * @returns {Array} addCoverageDetails - Array of coverage additions made
 */
async function processAllAddCoverageButtons(page) {
  console.log('🔍 Starting to process all "Add coverage" buttons...');
  const addCoverageDetails = [];
  
  // Debug: Check what buttons exist on the page
  const allButtons = await page.locator('button').count();
  console.log(`🔍 Total buttons on page: ${allButtons}`);
  
  const dataActionAddButtons = await page.locator('button[data-action="Add"]').count();
  console.log(`🔍 Buttons with data-action="Add": ${dataActionAddButtons}`);
  
  const titleAddButtons = await page.locator('button[title*="Add"]').count();
  console.log(`🔍 Buttons with title containing "Add": ${titleAddButtons}`);
  
  const iconButtons = await page.locator('button i.fa-plus-circle').count();
  console.log(`🔍 Buttons with fa-plus-circle icon: ${iconButtons}`);
  
  const MAX_ITERATIONS = 15; // Safety limit to prevent infinite loops
  let processedCount = 0;
  let continueProcessing = true;
  let previousButtonCount = -1;
  let sameCountIterations = 0;
  
  while (continueProcessing) {
    try {
      const iterationStart = Date.now();
      // Safety check: stop if we've processed too many
      if (processedCount >= MAX_ITERATIONS) {
        console.log(`⚠️ Reached maximum iteration limit (${MAX_ITERATIONS}). Stopping.`);
        break;
      }
      
      // Find all "Add coverage" buttons (using multiple selectors for robustness)
      const addButtons = await page.locator('button[data-action="Add"], button:has(i.fa-plus-circle), button[title*="Add"]').all();
      const currentButtonCount = addButtons.length;
      
      console.log(`\n🔄 Iteration ${processedCount + 1}: Found ${currentButtonCount} "Add coverage" button(s)`);
      
      // Safety check: If button count hasn't changed in 3 consecutive iterations, stop
      if (currentButtonCount === previousButtonCount) {
        sameCountIterations++;
        if (sameCountIterations >= 3) {
          console.log(`⚠️ Button count unchanged for ${sameCountIterations} iterations. Stopping.`);
          break;
        }
      } else {
        sameCountIterations = 0; // Reset counter when count changes
      }
      previousButtonCount = currentButtonCount;
      
      if (addButtons.length === 0) {
        console.log('✅ No more "Add coverage" buttons found. Processing complete.');
        break;
      }
      
      // Process the FIRST visible and enabled button
      let buttonClicked = false;
      for (const button of addButtons) {
        try {
          // Check if button is visible
          const isVisible = await button.isVisible().catch(() => false);
          if (!isVisible) {
            continue; // Skip silently
          }
          
          // Check if button is enabled
          const isEnabled = await button.isEnabled().catch(() => false);
          if (!isEnabled) {
            continue; // Skip silently
          }
          
          // Get button text/title for logging
          const buttonText = await button.textContent().catch(() => '');
          const buttonTitle = await button.getAttribute('title').catch(() => '');
          const buttonLabel = buttonText || buttonTitle || 'Unknown';
          
          console.log(`  🎯 Clicking "Add coverage" button: "${buttonLabel.trim()}"`);
          
          // Click the button with force to bypass any overlay issues
          await button.click({ timeout: 5000, force: true });
          await page.waitForTimeout(500); // Brief pause to allow modal/dropdown to appear
          
          // Check if popup has "Add Scheduled Item" button - if so, click "Remove Coverage" instead
          const addScheduleItemButton = page.locator('button:has-text("Add Scheduled Item")');
          const hasScheduleItem = await addScheduleItemButton.count().catch(() => 0);
          
          if (hasScheduleItem > 0) {
            console.log('  🔄 Found "Add Scheduled Item" button - clicking "Remove Coverage" instead');
            
            // Look for "Remove Coverage" button - be specific with text match
            const removeCoverageButton = page.locator('button:has-text("Remove Coverage")');
            const hasRemoveButton = await removeCoverageButton.count().catch(() => 0);
            
            if (hasRemoveButton > 0) {
              await removeCoverageButton.first().click();
              console.log('  ✓ Clicked "Remove Coverage" button');
              await page.waitForTimeout(2000); // Wait for dialog to close
              
              const iterationDuration = ((Date.now() - iterationStart) / 1000).toFixed(2);
              addCoverageDetails.push({
                iteration: processedCount + 1,
                coverageName: buttonLabel.trim(),
                durationSeconds: iterationDuration,
                action: 'Removed',
                status: 'Removed'
              });
              
              console.log(`  ✅ Coverage removed successfully (${iterationDuration}s)`);
              buttonClicked = true;
              processedCount++;
              break; // Exit the for loop after successful removal
            } else {
              console.log('  ⚠️ "Remove Coverage" button not found');
            }
          }
          
          // Wait for modal to appear (if applicable)
          const modal = page.locator('.modal, [role="dialog"]').first();
          const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
          
          if (modalVisible) {
            console.log('  📋 Modal opened, looking for coverage options...');
            
            // Look for coverage options in the modal (dropdowns, checkboxes, or list items)
            const coverageOptions = await modal.locator('select, input[type="checkbox"], li, .coverage-option').all();
            
            if (coverageOptions.length > 0) {
              console.log(`  📊 Found ${coverageOptions.length} coverage option(s) in modal`);
              
              // Try to select/click the FIRST option
              const firstOption = coverageOptions[0];
              const tagName = await firstOption.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
              
              if (tagName === 'select') {
                // Handle dropdown
                const options = await firstOption.locator('option').all();
                if (options.length > 1) {
                  const secondOption = options[1];
                  const optionValue = await secondOption.getAttribute('value');
                  await firstOption.selectOption(optionValue);
                  console.log(`  ✅ Selected option in dropdown`);
                }
              } else if (tagName === 'input') {
                // Handle checkbox
                await firstOption.check();
                console.log(`  ✅ Checked checkbox option`);
              } else if (tagName === 'li') {
                // Handle list item click
                await firstOption.click();
                console.log(`  ✅ Clicked list item option`);
              }
            }
            
            // Look for "Save" or "Add" button in modal
            const saveButton = modal.locator('button:has-text("Save"), button:has-text("Add"), button[data-action="Save"]').first();
            const saveExists = await saveButton.count().catch(() => 0);
            
            if (saveExists > 0) {
              console.log('  💾 Clicking Save/Add button in modal...');
              await saveButton.click({ timeout: 5000 });
              await page.waitForTimeout(1000);
            }
            
            // Look for "Close" button if Save didn't close the modal
            const modalStillVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
            if (modalStillVisible) {
              const closeButton = modal.locator('button:has-text("Close"), button[data-dismiss="modal"], button.close').first();
              const closeExists = await closeButton.count().catch(() => 0);
              if (closeExists > 0) {
                console.log('  ❌ Clicking Close button in modal...');
                await closeButton.click({ timeout: 5000 });
                await page.waitForTimeout(500);
              }
            }
          } else {
            console.log('  ℹ️  No modal detected, coverage may have been added directly');
            await page.waitForTimeout(1000);
          }
          
          const iterationDuration = ((Date.now() - iterationStart) / 1000).toFixed(2);
          addCoverageDetails.push({
            iteration: processedCount + 1,
            coverageName: buttonLabel.trim(),
            durationSeconds: iterationDuration,
            status: 'Added'
          });
          
          console.log(`  ✅ Coverage button processed successfully (${iterationDuration}s)`);
          buttonClicked = true;
          processedCount++;
          break; // Exit the for loop after successful click
          
        } catch (e) {
          console.log(`  ⚠️ Error clicking button: ${e.message.split('\n')[0]}`);
          continue; // Try next button
        }
      }
      
      if (!buttonClicked) {
        console.log('⚠️ Could not click any "Add coverage" button. Stopping.');
        break;
      }
      
      // Wait before next iteration to allow page to update
      await page.waitForTimeout(1000);
      
    } catch (e) {
      console.log(`❌ Error in processAllAddCoverageButtons iteration: ${e.message.split('\n')[0]}`);
      break;
    }
  }
  
  console.log(`\n✅ Finished processing "Add coverage" buttons. Total processed: ${processedCount}`);
  
  // Store timings in global test data
  if (global.testData && global.testData.addCoverageTimings) {
    global.testData.addCoverageTimings.push(...addCoverageDetails);
  }
  
  return addCoverageDetails;
}

module.exports = {
  processCoverageDropdowns,
  processAllAddCoverageButtons
};
