const { blinqClick } = require('../utils/blinqClick');

async function submitPolicyForApproval(page, page1, submissionNumber) {
  submissionNumber = submissionNumber || "3003177786";

  // 1️⃣ Login
  await page1.goto('https://qa-policycenter.donegalgroup.com/pc/PolicyCenter.do');
  await page1.getByRole('textbox', { name: 'Username' }).fill('amitmish');
  await page1.getByRole('textbox', { name: 'Password' }).fill('gw');
  await page1.getByRole('textbox', { name: 'Password' }).press('Enter');

  // 2️⃣ Navigate to submission
  await page1.getByRole('menuitem', { name: 'Policy', exact: true }).click();
  await page1.locator('#TabBar-PolicyTab > .gw-action--expand-button > .gw-icon').click();
  await page1.locator('input[name="TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem"]').fill(submissionNumber);
  await page1.getByLabel('Sub #').getByRole('button', { name: 'gw-search-icon' }).click();
  await page.waitForLoadState('networkidle');

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
      const loc = page1.locator(s);
      if (await loc.count() > 0) {
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

  // 4️⃣ Special Approve - SIMPLIFIED APPROACH
  // Wait for Risk Analysis panel to load and stabilize
  console.log('⏳ Waiting for Risk Analysis screen to load...');
  try {
    const riskPanel = page1.locator('div[id*="RiskAnalysis"], #SubmissionWizard-Job_RiskAnalysisScreen');
    await riskPanel.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    console.log('✅ Risk Analysis screen visible');
  } catch (e) {
    console.warn('Risk Analysis screen not found, continuing anyway');
  }

  // Wait for page to fully settle after Risk Analysis loads
  await page1.waitForTimeout(2000);

  // Since the DOM reuses IDs after each click, we just need to keep clicking the same ID until no more buttons exist
  const specialApproveId = 'SubmissionWizard-Job_RiskAnalysisScreen-RiskAnalysisCV-RiskEvaluationPanelSet-issueIterator-1-UWIssueRowSet-SpecialApprove';
  
  console.log('🔘 Starting Special Approve button clicks (will repeat until no more buttons found)...');
  
  let clickCount = 0;
  let continueClicking = true;

  while (continueClicking) {
    try {
      const locator = page1.locator(`#${specialApproveId}`);
      const exists = await locator.count().catch(() => 0);
      
      if (exists > 0) {
        clickCount++;
        console.log(`\n🔘 Click #${clickCount}: Found Special Approve button`);
        
        // Scroll into view
        try {
          await locator.scrollIntoViewIfNeeded();
          await page1.waitForTimeout(300);
        } catch (e) {
          console.warn(`Failed to scroll: ${e.message}`);
        }

        // Set up dialog handler BEFORE clicking to accept any dialogs automatically
        console.log(`⚙️  Setting up dialog auto-accept handler...`);
        page1.once('dialog', dialog => {
          console.log(`📍 Dialog detected: ${dialog.type()} - "${dialog.message()}"`);
          // Auto-accept/confirm the dialog
          if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            dialog.accept().catch(() => {});
            console.log(`✅ Dialog auto-accepted`);
          } else {
            dialog.dismiss().catch(() => {});
            console.log(`✅ Dialog auto-dismissed`);
          }
        });

        // Click using exact codegen pattern
        console.log(`⏳ Clicking Special Approve...`);
        await page1.locator(`#${specialApproveId}`).click();
        
        console.log(`✅ Successfully clicked Special Approve`);
        
        // Wait for dialog to be processed
        await page1.waitForTimeout(1000);
        
        // Click OK button if it appears (exact codegen pattern)
        try {
          const okBtn = page1.getByRole('button', { name: 'OK' });
          const okExists = await okBtn.count().catch(() => 0);
          if (okExists > 0) {
            console.log(`🔘 OK button found, clicking...`);
            await okBtn.click();
            console.log(`✅ Clicked OK button`);
          }
        } catch (okErr) {
          console.warn(`OK button click failed: ${okErr.message}`);
        }
        
        // Wait before checking for next button
        await page1.waitForTimeout(1000);
        
      } else {
        console.log(`\n✅ No more Special Approve buttons found. Total clicks: ${clickCount}`);
        continueClicking = false;
      }
    } catch (e) {
      console.warn(`Error in click loop: ${e.message}`);
      continueClicking = false;
    }
  }
}

module.exports = { submitPolicyForApproval };
