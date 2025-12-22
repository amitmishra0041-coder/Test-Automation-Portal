const { blinqClick } = require('../utils/blinqClick');

async function submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone } = {}) {
  // Set 40 second timeout for this workflow
  page.setDefaultTimeout(40000);

  // ===== PART 1: WriteBiz submission (uses same tab 'page') =====
  console.log('📋 Step 1: Submitting policy in WriteBiz...');

  // Click Submit For Approval button first
  try {
    const submitAgentBtn = page.locator('#btnSubmitAgent');
    const isVisible = await submitAgentBtn.isVisible({ timeout: 5000 });
    if (isVisible) {
      console.log('🔘 Clicking Submit For Approval button...');
      await submitAgentBtn.click({ timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      console.log('✅ Submit For Approval button clicked');
    }
  } catch (e) {
    console.log('⏭️ Submit For Approval button not found, continuing...');
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000); // Wait for grid to load

  // Try to reload, but handle errors gracefully
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('⚠️ Page reload failed, continuing without reload:', e.message);
  }

  // Wait for submission row to be visible before clicking (refresh/retry loop)
  const maxAttempts = 3;
  let submissionVisible = false;
  for (let attempt = 1; attempt <= maxAttempts && !submissionVisible; attempt++) {
    const submissionRow = page.locator(`span.ui-jqgrid-cursor-default:text("${submissionNumber}")`);
    try {
      await submissionRow.waitFor({ state: 'visible', timeout: 20000 });
      console.log(`✅ Submission row ${submissionNumber} is visible (attempt ${attempt})`);
      submissionVisible = true;
    } catch (e) {
      if (attempt === maxAttempts) {
        break; // exit loop and throw below
      }
      console.warn(`⚠️ Submission row not found (attempt ${attempt}) - refreshing and retrying...`);
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      } catch (reloadErr) {
        console.warn(`⚠️ Reload failed on attempt ${attempt}: ${reloadErr.message}`);
      }
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  if (!submissionVisible) {
    throw new Error(`Submission row ${submissionNumber} not visible after retries`);
  }

  // Re-locate before clicking to avoid stale/undefined references
  const rowToClick = page.locator(`span.ui-jqgrid-cursor-default:text("${submissionNumber}")`);
  await rowToClick.click();
  await page.getByRole('button', { name: 'Submit For Approval' }).click();

  await page.waitForTimeout(3000);
  
  // Fill Specify other entity Description field if present
  try {
    const businessDescInput = page.locator('#txtDescBusinessEnt');
    const isVisible = await businessDescInput.isVisible({ timeout: 3000 });

    if (isVisible) {
      console.log('✅ Business Entity Description field found, filling with "Test"...');
      await businessDescInput.fill('Test');
      console.log('✅ Business Entity Description filled');
    }
  } catch (e) {
    console.log('⏭️ Business Entity Description field not present, skipping...');
  }

  // Wait before clicking Next button
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next' }).click();
  
  // Wait for page to load after Next click
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  
  // Now click the radio button
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Ok' }).click();

  console.log('✅ WriteBiz submission completed');
  if (trackMilestone) {
    trackMilestone('Submitting for Approval', 'PASSED');
  }

  // ===== PART 2: PolicyCenter approval (uses new tab 'page1') =====
  console.log('🔐 Step 2: Logging into PolicyCenter in new tab...');

  // Create new page for PolicyCenter
  const context = page.context();
  const page1 = await context.newPage();
  page1.setDefaultTimeout(40000); // Set 40 second timeout for page1 as well

  // 1️⃣ Login to PolicyCenter
  console.log(`🔎 Submitting number to PolicyCenter: ${submissionNumber}`);
  const pcUrl = policyCenterUrl || 'https://qa-policycenter.donegalgroup.com/pc/PolicyCenter.do';
  await page1.goto(pcUrl);

  // Wait for login form to be visibleS
  await page1.getByRole('textbox', { name: 'Username' }).waitFor({ state: 'visible', timeout: 10000 });
  
  await page1.getByRole('textbox', { name: 'Username' }).fill('amitmish');
  await page1.getByRole('textbox', { name: 'Password' }).fill('gw');
  
  // Wait for login to complete
  await page1.getByRole('textbox', { name: 'Password' }).press('Enter');
  await page1.waitForLoadState('networkidle');
  await page1.waitForTimeout(5000); // Give the application time to initialize
  
  // Check if login was successful (look for any error messages)
  try {
    const errorText = await page1.locator('text=/user configuration|error occurred/i').first().textContent({ timeout: 5000 });
    if (errorText && errorText.includes('error') || errorText.includes('configuration')) {
      throw new Error(`PolicyCenter login error: ${errorText}`);
    }
  } catch (e) {
    if (e.message.includes('PolicyCenter login error')) throw e;
    // Otherwise just a timeout, which is fine
  }

  // 2️⃣ Navigate to submission
  console.log('📍 Opening Policy menu...');
  await page1.getByRole('menuitem', { name: 'Policy', exact: true }).click();
  await page1.waitForTimeout(2000);
  
  console.log('📍 Expanding Policy Tab...');
  await page1.locator('#TabBar-PolicyTab > .gw-action--expand-button > .gw-icon').click();
  await page1.waitForTimeout(2000);
  
  console.log(`📍 Searching for submission: ${submissionNumber}...`);
  await page1.locator('input[name="TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem"]').fill(submissionNumber);
  await page1.getByLabel('Sub #').getByRole('button', { name: 'gw-search-icon' }).click();
  await page1.waitForLoadState('networkidle');
  await page1.waitForTimeout(3000);
  console.log('✅ Submission search completed');

  // 3️⃣ Click Risk Analysis
  const riskAnalysisLocators = [
    'internal:text="Risk Analysis"i',
    'internal:text="Risk Analysis"s',
    'div >> internal:has-text=/^Risk Analysis$/',
    '#LeftNavContainer >> .gw-action--inner:has-text("Risk Analysis")',
    '.gw-action--inner:has-text("Risk Analysis")',
    '.gw-actionable:has-text("Risk Analysis")',
    'text=/^\\s*Risk Analysis\\s*$/i',
  ];

  const leftNavSelectors = ['#LeftNavContainer', '.leftNav', '#LeftNav', '.gw-left-nav', '#LeftNavContainer-0'];
  let foundScope = null;
  for (const s of leftNavSelectors) {
    try {
      if (await page1.locator(s).count() > 0) {
        foundScope = s;
        break;
      }
    } catch (err) {
      // ignore
    }
  }

  const ok = await blinqClick(page1, riskAnalysisLocators, { scope: foundScope || undefined, aggressive: true });
  if (!ok) {
    throw new Error("Risk Analysis click failed");
  }

  // 4️⃣ Special Approve Buttons
  try {
    await page1.locator('div[id*="RiskAnalysis"], #SubmissionWizard-Job_RiskAnalysisScreen')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => { });
  } catch (e) {
    // Risk Analysis screen not found, continuing anyway
  }

  await page1.waitForLoadState('networkidle');

  // Wait for Risk Analysis elements to fully render and stabilize
  await page1.waitForTimeout(10000);
  // Robust Special Approve detection: IDs can shift; try multiple selectors
  const specialApproveSelectors = [
    '#SubmissionWizard-Job_RiskAnalysisScreen-RiskAnalysisCV-RiskEvaluationPanelSet-issueIterator-1-UWIssueRowSet-SpecialApprove',
    '[id^="SubmissionWizard-Job_RiskAnalysisScreen-RiskAnalysisCV-RiskEvaluationPanelSet-issueIterator-"][id$="-UWIssueRowSet-SpecialApprove"]',
    '[data-gw-click*="UWIssueRowSet-SpecialApprove"]',
    '#SubmissionWizard-Job_RiskAnalysisScreen button:has-text("Special Approve")',
  ];

  async function findSpecialApproveLocator() {
    let bestLocator = null;
    let bestCount = 0;

    for (const sel of specialApproveSelectors) {
      const loc = page1.locator(sel);
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        // Prefer selectors that find more buttons (more likely to find all remaining ones)
        if (count > bestCount) {
          bestLocator = loc;
          bestCount = count;
        }
      }
    }

    if (bestLocator) {
      return bestLocator.first();
    }
    return null;
  }

  let clickCount = 0;
  while (true) {
    const locator = await findSpecialApproveLocator();
    if (!locator) {
      // Capture screenshot for troubleshooting
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await page1.screenshot({ path: `test-results/special-approve-not-found-${ts}.png`, fullPage: true });
      } catch (ssErr) {
        // Screenshot capture failed
      }
      break;
    }

    clickCount++;

    await locator.scrollIntoViewIfNeeded().catch(() => { });
    await page1.waitForLoadState('domcontentloaded');

    page1.once('dialog', dialog => {
      if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
        dialog.accept().catch(() => { });
      } else {
        dialog.dismiss().catch(() => { });
      }
    });

    await locator.focus().catch(() => { });
    await locator.click({ timeout: 10000 }).catch(async (err) => {
      try {
        const el = await locator.elementHandle();
        if (el) await page1.evaluate((node) => node.click(), el);
      } catch (e2) {
        throw e2;
      }
    });

    // Wait a moment for the dialog to appear
    await page1.waitForTimeout(500);

    // Dialog OK is auto-accepted via the 'page1.once' listener above
    // Now wait for page to settle after dialog closes
    await page1.waitForLoadState('networkidle');

    // Give page a moment to render the OK button after dialog closes
    await page1.waitForTimeout(1000);

    // Click the page-level OK button (appears after dialog closes)
    try {
      const okBtn = page1.getByRole('button', { name: 'OK' });
      const okExists = await okBtn.count().catch(() => 0);
      if (okExists > 0) {
        await okBtn.click({ timeout: 5000 });

        // Wait for this OK click to settle before next iteration
        await page1.waitForLoadState('networkidle');
        await page1.waitForTimeout(500);

        // Wait for the button to be removed from DOM and next button to render
        await page1.waitForLoadState('domcontentloaded');
        await page1.waitForTimeout(2000);
      }
    } catch (okErr) {
      // Page OK click failed
    }
  }
  if (trackMilestone) {
    trackMilestone('UW Issues Approved in PolicyCenter', 'PASSED');
  }
  // ===== PART 3: Submit for issuance (back to WriteBiz tab 'page') =====
  console.log('⏳ Step 3: Submitting for issuance in WriteBiz...');
  // Release lock in PolicyCenter if present (do not fail if absent)
  try {
    const releaseLock = page1.locator('div[aria-label="Release Lock"]');
    if (await releaseLock.count({ timeout: 2000 }).catch(() => 0)) {
      await releaseLock.click({ timeout: 5000 });
      await page1.waitForTimeout(500);
    }
  } catch (e) {
    console.warn(`Release Lock not clicked (continuing): ${e?.message}`);
  }
  // Close PolicyCenter tab to free up resources
  await page1.close();

  // Switch focus back to WriteBiz page
  await page.bringToFront();
  await page.waitForTimeout(10000); // Give time for tab to focus

  await page.reload();
  // Click the submission using the same selector as Part 1
  await page.locator(`span.ui-jqgrid-cursor-default:text("${submissionNumber}")`).click();
  await page.getByRole('button', { name: 'Submit For Issuance' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);

  // Wait for page to fully load and radio button to be available
  console.log('⏳ Waiting for radio button to be available...');
  await page.waitForLoadState('networkidle').catch(() => { });
  await page.waitForTimeout(2000);

  // Click "Bill Insured By Mail" radio button (rbBIM_FullPay)
  console.log('🔘 Clicking Bill Insured By Mail radio button...');
  try {
    // Remove overlay if present
    await page.evaluate(() => {
      const overlay = document.querySelector('.ui-widget-overlay.ui-front');
      if (overlay) overlay.remove();
    }).catch(() => { });
    await page.waitForTimeout(300);

    // Click the radio button by ID
    const radioButton = page.locator('#rbBIM_FullPay').locator('xpath=..'); // Get parent div
    await radioButton.click({ timeout: 10000, force: true });
    console.log('✅ Bill Insured By Mail radio button clicked');
  } catch (e) {
    console.warn(`⚠️ Failed to click rbBIM_FullPay: ${e?.message}. Trying fallback...`);
    // Fallback: click by CSS class
    await page.locator('div[role="radio"][aria-pressed="true"]').first().click({ timeout: 10000, force: true });
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Remove overlay before Bind and Issue click
  await page.evaluate(() => {
    const overlay = document.querySelector('.ui-widget-overlay.ui-front');
    if (overlay) overlay.remove();
  }).catch(() => { });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Bind and Issue' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(60000);

  await page.locator('.esign-button.esign-paper').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Ok' }).click();
  await page.getByRole('tab', { name: 'Client Summary' }).click();

  const policyCell = page.locator(
    'td[aria-describedby="dgPolicies_DISPLAY_POLICY_NUMBER"]').first();
  await policyCell.waitFor({ state: 'visible' });
  const policyNumber = (await policyCell.innerText()).trim();
  console.log(`📄 Policy Number generated: ${policyNumber}`);
  if (trackMilestone) {
    trackMilestone('Policy Issued Successfully', 'PASSED', `Policy #: ${policyNumber}`);
  }
  return policyNumber;
}

module.exports = { submitPolicyForApproval };

