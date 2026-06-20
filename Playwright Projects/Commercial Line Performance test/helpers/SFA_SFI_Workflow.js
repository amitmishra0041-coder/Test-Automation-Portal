const { blinqClick } = require('../utils/blinqClick');
const { expect } = require('@playwright/test');

async function submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone } = {}) {
  // Set 60 second timeout for this workflow
  page.setDefaultTimeout(60000);

  // ===== PART 1: WriteBiz submission (uses same tab 'page') =====
  console.log('📋 Step 1: Submitting policy in WriteBiz...');

  // Wait for page to fully settle after quote creation

  await page.waitForTimeout(1000);




  //  await page.waitForTimeout(2000);
  // Click "Client Summary" accordion header
  // await page.waitForLoadState('networkidle');
  // await page.waitForTimeout(2000);
  //await page.locator('h3#GeneralInfo.xaccordion-sectionheader').click();
  // await page.locator('a[title="Client Summary"]').click()
  // await page.waitForLoadState('networkidle');
  // await page.waitForTimeout(2500);

  // Click "Contact Underwriter" accordion header

  //await page.locator('h3#UnderwriterComm.xaccordion-sectionheader').click();
  // Click the visible 'Review Cart' link — avoid strict-mode errors when multiple anchors exist
  const reviewCartLocator = page.locator('a[title="Review Cart"]');
  const reviewCartCount = await reviewCartLocator.count();
  if (reviewCartCount === 0) throw new Error('Review Cart link not found');
  let clicked = false;
  for (let i = 0; i < reviewCartCount; i++) {
    const loc = reviewCartLocator.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      await loc.click().catch(async () => { await loc.evaluate(n => n.click()); });
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    // Prefer known id if present, otherwise click the first locator with force
    if (await page.locator('#ShoppingCart').count() > 0) {
      await page.locator('#ShoppingCart').click().catch(async () => { await page.locator('#ShoppingCart').evaluate(n => n.click()); });
    } else {
      await reviewCartLocator.first().click({ force: true }).catch(async () => { await reviewCartLocator.first().evaluate(n => n.click()); });
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);



  // Re-locate before clicking to avoid stale/undefined references

  const rowCheckbox = page.locator('#tblSubmitForApproval tbody tr td input[type="checkbox"]');
  await rowCheckbox.check();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Click Submit For Approval with retry logic

  await page.getByRole('button', { name: 'Request Purchase Approval' }).click({ timeout: 15000 });


  // Wait before clicking SEND button
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Send' }).click();

  // Wait for page to load after Next click
  await page.waitForLoadState('domcontentloaded');
  //await page.waitForTimeout(2000);

  console.log('✅ WriteBiz submission completed');
  if (trackMilestone) {
    trackMilestone('Submitting for Approval', 'PASSED');
  }

  // ===== PART 2: PolicyCenter approval (uses new tab 'page1') =====
  console.log('🔐 Step 2: Logging into PolicyCenter in new tab...');

  // Create new page for PolicyCenter
  const context = page.context();
  const page1 = await context.newPage();
  page1.setDefaultTimeout(60000); // Set 60 second timeout for page1 as well
  await page1.waitForTimeout(2000); // Let new tab stabilize

  // 1️⃣ Login to PolicyCenter
  console.log(`🔎 Submitting number to PolicyCenter: ${submissionNumber}`);
  const pcUrl = policyCenterUrl || 'http://test-policycenter.donegalgroup.com/pc/PolicyCenter.do';
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
  await page.waitForTimeout(5000);
  await page.waitForLoadState('load').catch(() => { });
  await page.waitForTimeout(8000); // Give time for tab to focus and stabilize

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle').catch(() => { });
  await page.waitForTimeout(5000);

  // Click the submission using the same selector as Part 1 with retry


  const row = page.locator('#tblSubmitForIssuance tbody tr')
    .filter({ hasText: submissionNumber.toString() });

  await row.locator('input[type="checkbox"]').check();

  console.log('Submission row clicked for issuance');


  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Buy Now")').click();
  //await page.waitForLoadState('networkidle').catch(() => { });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  console.log('⏳ Buy Now clicked');

  // Click "Bill Insured By Mail" radio button (rbBIM_FullPay)

  await page.locator('#ddlBillingMethodAll').selectOption('insured');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('⏳ Billing method selected: Bill Insured By Mail');



  // Wait until more than one option exists
  const paymentPlanDropdown = page.locator('#ddlPaymentPlanAll');

  await page.waitForFunction(() => {
    const ddl = document.querySelector('#ddlPaymentPlanAll');
    return ddl && ddl.options.length > 1;
  }, { timeout: 10000 });

  await paymentPlanDropdown.selectOption({ label: 'Full Pay' });

  console.log('✅ Selected Payment Plan: Full Pay');


  await page.waitForTimeout(2000);

  //select payment method
  await page.locator('#ddlPaymentMethodAll').selectOption('Bill Insured By Mail');
  console.log('✅   Selected Payment Method: Bill Insured By Mail');




  // Toggle Include Deposit checkbox - scroll and click via JavaScript
  await page.locator('#chkIncludeDeposit').scrollIntoViewIfNeeded();

  const depositChecked = await page.locator('#chkIncludeDeposit').isChecked();

  if (depositChecked) {
    await page.locator('#chkIncludeDeposit').evaluate(el => el.click());

    await page.waitForTimeout(500);
    console.log('✅ Include Deposit toggled to No');
  }



  await page.getByRole('button', { name: 'Bind and Issue' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(30000);


  const esignButton = page.getByRole('button', { name: 'Esign' });
  if (await esignButton.count() > 0) {
    await esignButton.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  }

  const Finishbutton = page.getByRole('button', { name: 'Finish' });
  if (await Finishbutton.count() > 0) {
    await Finishbutton.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  }

const clientSummaryTab = page.locator('a[title="Client Summary"]');

if (await clientSummaryTab.count() > 0) {
  await clientSummaryTab.click();
}



  const policyNumber = (
    await page
      .locator('#tblPolicies tbody tr')
      .first()
      .locator('td')
      .nth(2)
      .textContent()
  )?.trim() ?? '';

  console.log(`Policy Number: ${policyNumber}`);
  if (trackMilestone) {
    trackMilestone('Submit for issuance', 'PASSED', `Policy #: ${policyNumber}`);
  }
  return policyNumber;
}

module.exports = { submitPolicyForApproval };

