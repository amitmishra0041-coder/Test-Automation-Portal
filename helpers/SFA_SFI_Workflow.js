const { blinqClick } = require('../utils/blinqClick');

async function submitPolicyForApproval(page, submissionNumber) {
  // Set 40 second timeout for this workflow
  page.setDefaultTimeout(40000);

  // ===== PART 1: WriteBiz submission (uses same tab 'page') =====
  console.log('📋 Step 1: Submitting policy in WriteBiz...');

  // Click Contact Underwriter accordion header
  await page.locator('#UnderwriterComm').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(10000); // Wait for grid to load
  await page.locator(`span.ui-jqgrid-cursor-default:text("${submissionNumber}")`).click();
  await page.getByRole('button', { name: 'Submit For Approval' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Ok' }).click();

  console.log('✅ WriteBiz submission completed');

  // ===== PART 2: PolicyCenter approval (uses new tab 'page1') =====
  console.log('🔐 Step 2: Logging into PolicyCenter in new tab...');

  // Create new page for PolicyCenter
  const context = page.context();
  const page1 = await context.newPage();
  page1.setDefaultTimeout(40000); // Set 40 second timeout for page1 as well

  // 1️⃣ Login to PolicyCenter
  console.log(`🔎 Submitting number to PolicyCenter: ${submissionNumber}`);
  await page1.goto('https://qa-policycenter.donegalgroup.com/pc/PolicyCenter.do');
  await page1.getByRole('textbox', { name: 'Username' }).fill('amitmish');
  await page1.getByRole('textbox', { name: 'Password' }).fill('gw');
  await page1.getByRole('textbox', { name: 'Password' }).press('Enter');

  // 2️⃣ Navigate to submission
  await page1.getByRole('menuitem', { name: 'Policy', exact: true }).click();
  await page1.locator('#TabBar-PolicyTab > .gw-action--expand-button > .gw-icon').click();
  await page1.locator('input[name="TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem"]').fill(submissionNumber);
  await page1.getByLabel('Sub #').getByRole('button', { name: 'gw-search-icon' }).click();
  await page1.waitForLoadState('networkidle');

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
  console.log('⏳ Waiting for Risk Analysis screen to load...');
  try {
    await page1.locator('div[id*="RiskAnalysis"], #SubmissionWizard-Job_RiskAnalysisScreen')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => { });
  } catch (e) {
    console.warn('Risk Analysis screen not found, continuing anyway');
  }

  await page1.waitForLoadState('networkidle');

  // Wait for Risk Analysis elements to fully render and stabilize
  console.log('⏳ Waiting 3 seconds for Risk Analysis screen to fully render...');
  await page1.waitForTimeout(10000);

  // Diagnostics: log counts for each selector before attempting clicks
  try {
    const diagSelectors = [
      '#SubmissionWizard-Job_RiskAnalysisScreen-RiskAnalysisCV-RiskEvaluationPanelSet-issueIterator-1-UWIssueRowSet-SpecialApprove',
      '[id^="SubmissionWizard-Job_RiskAnalysisScreen-RiskAnalysisCV-RiskEvaluationPanelSet-issueIterator-"][id$="-UWIssueRowSet-SpecialApprove"]',
      '[data-gw-click*="UWIssueRowSet-SpecialApprove"]',
      '#SubmissionWizard-Job_RiskAnalysisScreen button:has-text("Special Approve")',
    ];
    for (const sel of diagSelectors) {
      const count = await page1.locator(sel).count().catch(() => 0);
      console.log(`🧪 Pre-check selector count: ${sel} -> ${count}`);
    }
  } catch (diagErr) {
    console.warn(`Diagnostics error: ${diagErr?.message}`);
  }
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
        console.log(`🔎 Selector: ${sel} (count=${count})`);
        // Prefer selectors that find more buttons (more likely to find all remaining ones)
        if (count > bestCount) {
          bestLocator = loc;
          bestCount = count;
        }
      }
    }

    if (bestLocator) {
      console.log(`✅ Selected best locator with ${bestCount} buttons available`);
      return bestLocator.first();
    }
    return null;
  }

  let clickCount = 0;
  while (true) {
    const locator = await findSpecialApproveLocator();
    if (!locator) {
      console.log(`✅ No Special Approve button found. Total clicked: ${clickCount}`);
      // Capture screenshot for troubleshooting
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await page1.screenshot({ path: `test-results/special-approve-not-found-${ts}.png`, fullPage: true });
        console.log('🖼️ Screenshot captured: test-results/special-approve-not-found-*.png');
      } catch (ssErr) {
        console.warn(`Screenshot capture failed: ${ssErr?.message}`);
      }
      break;
    }

    clickCount++;
    console.log(`🔘 Click #${clickCount}: Attempting Special Approve`);

    await locator.scrollIntoViewIfNeeded().catch(() => { });
    await page1.waitForLoadState('domcontentloaded');

    page1.once('dialog', dialog => {
      console.log(`📍 Dialog detected: ${dialog.type()}`);
      if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
        dialog.accept().catch(() => { });
      } else {
        dialog.dismiss().catch(() => { });
      }
    });

    await locator.focus().catch(() => { });
    await locator.click({ timeout: 10000 }).catch(async (err) => {
      console.warn(`⚠️ Click failed: ${err?.message}. Retrying via evaluate...`);
      try {
        const el = await locator.elementHandle();
        if (el) await page1.evaluate((node) => node.click(), el);
      } catch (e2) {
        throw e2;
      }
    });

    console.log(`✅ Clicked Special Approve`);

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
        console.log(`🔍 Found page OK button, attempting click...`);
        await okBtn.click({ timeout: 5000 });
        console.log(`✅ Clicked page OK button`);

        // Wait for this OK click to settle before next iteration
        await page1.waitForLoadState('networkidle');
        await page1.waitForTimeout(500);

        // Wait for the button to be removed from DOM and next button to render
        await page1.waitForLoadState('domcontentloaded');
        await page1.waitForTimeout(2000);
      } else {
        console.log(`⏭️ No page OK button found after Special Approve`);
      }
    } catch (okErr) {
      console.warn(`⚠️ Page OK click failed: ${okErr?.message}`);
    }
  }
  
  // ===== PART 3: Submit for issuance (back to WriteBiz tab 'page') =====
  console.log('⏳ Step 3: Submitting for issuance in WriteBiz...');
  await page1.locator('div[aria-label="Release Lock"]').click();
  // Close PolicyCenter tab to free up resources
  await page1.close();
  
  // Switch focus back to WriteBiz page
  await page.bringToFront();
  await page.waitForTimeout(2000); // Give time for tab to focus
  
  // Open the Contact Underwriter accordion and wait for grid
  //await page.locator('#UnderwriterComm').click();
  //await page.waitForLoadState('domcontentloaded');
  //await page.waitForTimeout(3000); // Wait for grid to load
  await page.reload();
  // Click the submission using the same selector as Part 1
  await page.locator(`span.ui-jqgrid-cursor-default:text("${submissionNumber}")`).click();
  await page.getByRole('button', { name: 'Submit For Issuance' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.ui-radiobutton.ui-state-default.ui-corner-all.ui-state-hover').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Bind and Issue' }).click();
  await page.locator('.esign-button.esign-paper').click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  //await page.getByText('1002228140').click();
  //await page.locator('.ui-widget-overlay.ui-front').click();
  //await page.getByLabel('', { exact: true }).click();
  await page.getByRole('button', { name: 'Ok' }).click();
  await page.getByRole('tab', { name: 'Client Summary' }).click();
  
  const policyCell = page.locator(
    'td[aria-describedby="dgPolicies_DISPLAY_POLICY_NUMBER"]').first();
  await policyCell.waitFor({ state: 'visible' });
  const policyNumber = (await policyCell.innerText()).trim();
  console.log(`📄 Policy Number generated: ${policyNumber}`);
}

module.exports = { submitPolicyForApproval };

