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

    // Scoped to the submission we're actually processing - an account can have
    // multiple entries in the cart (e.g. a separate Commercial Umbrella
    // submission), and the unscoped selector hit a strict-mode violation
    // when more than one row was present.
    const rowCheckbox = page.locator('#tblSubmitForApproval tbody tr')
        .filter({ hasText: submissionNumber.toString() })
        .locator('input[type="checkbox"]')
        .first();
    await rowCheckbox.check();
    await page.waitForLoadState('domcontentloaded');
    // Shrunk from 2000ms - safeClickBtn() below already waits up to 30s for its target.
    await page.waitForTimeout(400);
    await dismissStatusModal();

    await safeClickBtn(page.getByRole('button', { name: 'Request Purchase Approval' }), 'Request Purchase Approval');
    // Shrunk from 1000ms - safeClickBtn() below already waits up to 30s for its target.
    await page.waitForTimeout(300);
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
    // This is a toggle, not a one-way "expand" - all states log in as the
    // same hardcoded PolicyCenter user, so if this panel was left expanded
    // by a previous or concurrent run, blindly clicking it here would
    // collapse it instead, permanently hiding the search box (the PA
    // failure: fill() retried for the full 60s against a hidden input that
    // was never going to reappear). Check the actual current state first.
    const submissionSearchInput = page1.locator('input[name="TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem"]');
    const alreadyExpanded = await submissionSearchInput.isVisible().catch(() => false);
    if (!alreadyExpanded) {
        await page1.locator('#TabBar-PolicyTab > .gw-action--expand-button > .gw-icon').click();
        await submissionSearchInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    } else {
        console.log('Policy Tab already expanded, skipping toggle click');
    }

    console.log(`Searching for submission: ${submissionNumber}...`);
    await submissionSearchInput.fill(submissionNumber);
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
    // Wait for a Special Approve row (or confirmation there are none) instead of
    // a blind 10s sleep - exits as soon as the risk analysis grid has rendered.
    await page1.waitForFunction(() => {
        const spinner = document.querySelector('.loading, .spinner, [aria-busy="true"]');
        if (spinner && getComputedStyle(spinner).display !== 'none') return false;
        return document.querySelector('[id*="RiskEvaluationPanelSet"]') !== null
            || document.querySelector('[id$="-UWIssueRowSet-SpecialApprove"]') !== null;
    }, { timeout: 10000 }).catch(() => {});

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
    await page.waitForLoadState('load').catch(() => {});
    // Poll for the WB tab to actually be ready (was idle during PC approval)
    // instead of a blind 5s + 8s sleep - same 13s ceiling, exits as soon as ready.
    await page.waitForFunction(() => {
        const spinner = document.querySelector('.loading, .spinner, [aria-busy="true"]');
        return document.readyState === 'complete' && (!spinner || getComputedStyle(spinner).display === 'none');
    }, { timeout: 13000 }).catch(() => {});

    // The backend can take a few seconds after UW approval to actually register
    // the submission as ready for issuance, so the row may not be present on the
    // first reload even though the table itself has rendered. Retry with fresh
    // reloads (bounded) instead of assuming one reload is enough.
    const row = page.locator('#tblSubmitForIssuance tbody tr')
        .filter({ hasText: submissionNumber.toString() });

    let rowReady = false;
    for (let attempt = 1; attempt <= 6 && !rowReady; attempt++) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#tblSubmitForIssuance', { timeout: 5000 }).catch(() => {});
        await dismissStatusModal();
        rowReady = await row.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        if (!rowReady) {
            console.log(`Issuance row for ${submissionNumber} not visible yet (attempt ${attempt}) - retrying...`);
            await page.waitForTimeout(3000);
        }
    }

    await row.locator('input[type="checkbox"]').check();
    console.log('Submission row clicked for issuance');

    await page.waitForLoadState('domcontentloaded');
    // Shrunk from 2000ms - safeClickBtn() below already waits up to 30s for its target.
    await page.waitForTimeout(400);
    await dismissStatusModal();

    await safeClickBtn(page.locator('button:has-text("Buy Now")'), 'Buy Now');
    await page.waitForLoadState('domcontentloaded');
    console.log('Buy Now clicked');

    // Optional "Confirm" dialog - only appears when the account has other
    // submissions still pending UW approval ("...proceed with issuance of
    // the selected submissions only"). Fast presence probe, not a blind
    // sleep, since most runs won't hit this at all.
    const confirmPendingApprovalYes = page.locator('.modal.show')
        .filter({ hasText: 'pending approval from the Underwriter' })
        .getByRole('button', { name: 'Yes' });
    const pendingApprovalVisible = await confirmPendingApprovalYes
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false);
    if (pendingApprovalVisible) {
        await confirmPendingApprovalYes.click();
        console.log('Confirmed issuance of selected submission only (pending-UW-approval dialog)');
    }

    await page.waitForTimeout(3000);
    await dismissStatusModal();

    await page.locator('#ddlBillingMethodAll').selectOption('insured');
    await page.waitForLoadState('domcontentloaded');
    // Shrunk from 2000ms - the waitForFunction() below already polls up to 10s
    // for the payment plan dropdown to populate.
    await page.waitForTimeout(400);
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
    // Graduated backoff: check quickly at first (issuance often finishes fast
    // right after Bind and Issue), then back off to avoid hammering the
    // server while waiting on a slow issuance. Previously a flat 10s between
    // every attempt, so a policy that was ready 1s after a check still took
    // up to 10s to be noticed.
    function nextPollDelayMs(attemptNum) {
        if (attemptNum <= 3) return 3000;
        if (attemptNum <= 6) return 5000;
        if (attemptNum <= 10) return 7000;
        return 10000;
    }
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

        const sleepMs = Math.min(nextPollDelayMs(attempt), remainingMs);
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
