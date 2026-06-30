// helpers/SFA_SFI_Workflow.js
const { blinqClick } = require('../utils/blinqClick');

async function submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone } = {}) {
    page.setDefaultTimeout(60000);

    function isPageAlive(p) {
        try { return !p.isClosed(); } catch { return false; }
    }

    async function safeCount(locator) {
        try { return await locator.count(); } catch { return 0; }
    }

    // ── Dismiss WB status modal ───────────────────────────────────────────────
    async function dismissStatusModal() {
        try {
            for (let i = 0; i < 5; i++) {
                const statusModal = page.locator('#dgic-status-message');
                const isVisible = await statusModal.isVisible().catch(() => false);
                if (!isVisible) return;
                console.log(`SFA: Status modal visible (attempt ${i + 1}) - dismissing...`);
                const btn = statusModal.locator('button').first();
                if (await btn.count() > 0) await btn.click({ force: true }).catch(() => {});
                await statusModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(300);
            }
        } catch (e) {}
    }

    async function safeClickBtn(locator, label) {
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        let clicked = false;
        for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
            try {
                await dismissStatusModal();
                await locator.click({ timeout: 10000 });
                clicked = true;
            } catch (e) {
                console.log(`${label} attempt ${attempt} blocked: ${e.message.split('\n')[0]}`);
                await dismissStatusModal();
                await page.waitForTimeout(500);
            }
        }
        if (!clicked) {
            console.log(`${label}: forcing click`);
            await locator.click({ force: true });
        }
    }

    // ===== PART 1: WriteBiz submission ========================================
    console.log('Step 1: Submitting policy in WriteBiz...');
    await page.waitForTimeout(1000);

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
        if (await page.locator('#ShoppingCart').count() > 0) {
            await page.locator('#ShoppingCart').click()
                .catch(async () => { await page.locator('#ShoppingCart').evaluate(n => n.click()); });
        } else {
            await reviewCartLocator.first().click({ force: true })
                .catch(async () => { await reviewCartLocator.first().evaluate(n => n.click()); });
        }
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await dismissStatusModal();

    const rowCheckbox = page.locator('#tblSubmitForApproval tbody tr td input[type="checkbox"]');
    await rowCheckbox.check();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await dismissStatusModal();

    await safeClickBtn(page.getByRole('button', { name: 'Request Purchase Approval' }), 'Request Purchase Approval');
    await page.waitForTimeout(1000);
    await dismissStatusModal();
    await safeClickBtn(page.getByRole('button', { name: 'Send' }), 'Send');
    await page.waitForLoadState('domcontentloaded');

    console.log('WriteBiz submission completed');
    if (trackMilestone) trackMilestone('Submitting for Approval', 'PASSED');

    // ===== PART 2: PolicyCenter approval =====================================
    console.log('Step 2: Logging into PolicyCenter in new tab...');

    const context = page.context();
    const page1 = await context.newPage();
    page1.setDefaultTimeout(60000);
    await page1.waitForTimeout(2000);

    console.log(`Submitting number to PolicyCenter: ${submissionNumber}`);
    const pcUrl = policyCenterUrl || 'http://test-policycenter.donegalgroup.com/pc/PolicyCenter.do';
    await page1.goto(pcUrl);

    await page1.getByRole('textbox', { name: 'Username' }).waitFor({ state: 'visible', timeout: 10000 });
    await page1.getByRole('textbox', { name: 'Username' }).fill('amitmish');
    await page1.getByRole('textbox', { name: 'Password' }).fill('gw');
    await page1.getByRole('textbox', { name: 'Password' }).press('Enter');
    await page1.waitForLoadState('networkidle').catch(() => {});
    await page1.waitForTimeout(5000);

    try {
        const errorText = await page1.locator('text=/user configuration|error occurred/i')
            .first().textContent({ timeout: 5000 });
        if (errorText && (errorText.includes('error') || errorText.includes('configuration'))) {
            throw new Error(`PolicyCenter login error: ${errorText}`);
        }
    } catch (e) {
        if (e.message.includes('PolicyCenter login error')) throw e;
    }

    console.log('Opening Policy menu...');
    await page1.getByRole('menuitem', { name: 'Policy', exact: true }).click();
    await page1.waitForTimeout(2000);

    console.log('Expanding Policy Tab...');
    await page1.locator('#TabBar-PolicyTab > .gw-action--expand-button > .gw-icon').click();
    await page1.waitForTimeout(2000);

    console.log(`Searching for submission: ${submissionNumber}...`);
    await page1.locator('input[name="TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem"]').fill(submissionNumber);
    await page1.getByLabel('Sub #').getByRole('button', { name: 'gw-search-icon' }).click();
    await page1.waitForLoadState('networkidle').catch(() => {});
    await page1.waitForTimeout(3000);
    console.log('Submission search completed');

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
            if (await page1.locator(s).count() > 0) { foundScope = s; break; }
        } catch { }
    }

    const ok = await blinqClick(page1, riskAnalysisLocators, { scope: foundScope || undefined, aggressive: true });
    if (!ok) throw new Error('Risk Analysis click failed');

    try {
        await page1.locator('div[id*="RiskAnalysis"], #SubmissionWizard-Job_RiskAnalysisScreen')
            .first()
            .waitFor({ state: 'visible', timeout: 15000 })
            .catch(() => {});
    } catch { }

    await page1.waitForLoadState('networkidle').catch(() => {});
    await page1.waitForTimeout(10000);

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
            if (count > bestCount) { bestLocator = loc; bestCount = count; }
        }
        return bestLocator ? bestLocator.first() : null;
    }

    while (true) {
        const locator = await findSpecialApproveLocator();
        if (!locator) {
            try {
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                await page1.screenshot({ path: `test-results/special-approve-not-found-${ts}.png`, fullPage: true });
            } catch { }
            break;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await page1.waitForLoadState('domcontentloaded');

        page1.once('dialog', dialog => {
            if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
                dialog.accept().catch(() => {});
            } else {
                dialog.dismiss().catch(() => {});
            }
        });

        await locator.focus().catch(() => {});
        await locator.click({ timeout: 10000 }).catch(async (err) => {
            try {
                const el = await locator.elementHandle();
                if (el) await page1.evaluate((node) => node.click(), el);
            } catch (e2) { throw e2; }
        });

        await page1.waitForTimeout(500);
        await page1.waitForLoadState('networkidle').catch(() => {});
        await page1.waitForTimeout(1000);

        try {
            const okBtn = page1.getByRole('button', { name: 'OK' });
            if ((await okBtn.count().catch(() => 0)) > 0) {
                await okBtn.click({ timeout: 5000 });
                await page1.waitForLoadState('networkidle').catch(() => {});
                await page1.waitForTimeout(500);
                await page1.waitForLoadState('domcontentloaded');
                await page1.waitForTimeout(2000);
            }
        } catch { }
    }

    if (trackMilestone) trackMilestone('UW Issues Approved in PolicyCenter', 'PASSED');

    // ===== PART 3: Submit for issuance =======================================
    console.log('Step 3: Submitting for issuance in WriteBiz...');

    try {
        const releaseLock = page1.locator('div[aria-label="Release Lock"]');
        if (await releaseLock.count({ timeout: 2000 }).catch(() => 0)) {
            await releaseLock.click({ timeout: 5000 });
            await page1.waitForTimeout(500);
        }
    } catch (e) {
        console.warn(`Release Lock not clicked (continuing): ${e?.message}`);
    }

    await page1.close();
    await page.bringToFront();
    await page.waitForTimeout(5000);
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(8000);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
    await dismissStatusModal();

    const row = page.locator('#tblSubmitForIssuance tbody tr')
        .filter({ hasText: submissionNumber.toString() });
    await row.locator('input[type="checkbox"]').check();
    console.log('Submission row clicked for issuance');

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await dismissStatusModal();

    await safeClickBtn(page.locator('button:has-text("Buy Now")'), 'Buy Now');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    console.log('Buy Now clicked');
    await dismissStatusModal();

    await page.locator('#ddlBillingMethodAll').selectOption('insured');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    console.log('Billing method selected');

    await page.waitForFunction(() => {
        const ddl = document.querySelector('#ddlPaymentPlanAll');
        return ddl && ddl.options.length > 1;
    }, { timeout: 10000 });

    await page.locator('#ddlPaymentPlanAll').selectOption({ label: 'Full Pay' });
    console.log('Selected Payment Plan: Full Pay');

    await page.waitForTimeout(2000);
    await page.locator('#ddlPaymentMethodAll').selectOption('Bill Insured By Mail');
    console.log('Selected Payment Method: Bill Insured By Mail');

    await page.locator('#chkIncludeDeposit').scrollIntoViewIfNeeded();
    const depositChecked = await page.locator('#chkIncludeDeposit').isChecked();
    if (depositChecked) {
        await page.locator('#chkIncludeDeposit').evaluate(el => el.click());
        await page.waitForTimeout(500);
        console.log('Include Deposit toggled to No');
    }

    await dismissStatusModal();
    await safeClickBtn(page.getByRole('button', { name: 'Bind and Issue' }), 'Bind and Issue');
    await page.waitForLoadState('domcontentloaded');
    // Wait for bind/issue to settle - poll for spinner instead of fixed 30s sleep
    await page.waitForFunction(() => {
        const spinner = document.querySelector('.loading, .spinner, [aria-busy="true"]');
        return !spinner || getComputedStyle(spinner).display === 'none';
    }, { timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
    await dismissStatusModal();

    const esignButton = page.getByRole('button', { name: 'Esign' });
    if (await safeCount(esignButton) > 0) {
        await safeClickBtn(esignButton, 'Esign');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
    }

    const finishButton = page.getByRole('button', { name: 'Finish' });
    if (await safeCount(finishButton) > 0) {
        await safeClickBtn(finishButton, 'Finish');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
    }

    const clientSummaryTab = page.locator('a[title="Client Summary"]');
    if (await safeCount(clientSummaryTab) > 0) {
        await clientSummaryTab.click();
    }

    // ===== PART 4: Poll for policy number ====================================
    const POLL_INTERVAL_MS = 20000; // reduced from 30s to 20s
    const MAX_POLL_MS = 10 * 60 * 1000;
    const pollDeadline = Date.now() + MAX_POLL_MS;

    let policyNumber = null;
    let attempt = 0;

    while (Date.now() < pollDeadline) {
        attempt++;
        console.log(`Policy number poll attempt ${attempt}...`);

        if (!isPageAlive(page)) {
            console.log('Page closed during policy number polling - stopping');
            break;
        }

        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForLoadState('networkidle').catch(() => {});
            await dismissStatusModal();

            const policyCell = page.locator('#tblPolicies tbody tr:first-child td:nth-child(3)');
            const count = await safeCount(policyCell);
            if (count > 0) {
                const value = (await policyCell.textContent({ timeout: 5000 }))?.trim();
                if (value) {
                    policyNumber = value;
                    console.log(`Policy Number Found: ${policyNumber}`);
                    break;
                }
            }
        } catch (e) {
            console.warn(`Poll attempt ${attempt} error (will retry): ${e.message}`);
        }

        const remainingMs = pollDeadline - Date.now();
        if (remainingMs <= 0) break;

        const sleepMs = Math.min(POLL_INTERVAL_MS, remainingMs);
        console.log(`Policy not yet issued, waiting ${sleepMs / 1000}s before next reload...`);
        await page.waitForTimeout(sleepMs).catch(() => {});
    }

    if (!policyNumber) {
        throw new Error(`Policy number not found after ${attempt} attempt(s)`);
    }

    console.log(`Policy Number confirmed: ${policyNumber}`);
    if (trackMilestone) {
        trackMilestone('Policy Issued Successfully', 'PASSED', `Policy #: ${policyNumber}`);
    }

    return policyNumber;
}

module.exports = { submitPolicyForApproval };
