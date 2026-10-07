// helpers/SFA_SFI_Workflow.js
const { blinqClick } = require('../utils/blinqClick');
const { randSSN } = require('./randomData');

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
    console.log('Review Cart opened, locating submission row...');

    // DIAGNOSTIC (Training env investigation): confirmed live that this can
    // fail after every reload with no clue whether the #tblSubmitForApproval
    // TABLE itself is even on the page (wrong screen after "Review Cart") or
    // whether the table is present but this specific submission's row just
    // hasn't synced into it yet. Log both possibilities explicitly on the
    // FIRST check only - not on every reload - so the log stays readable.
    try {
        const tableCount = await page.locator('#tblSubmitForApproval').count();
        if (tableCount === 0) {
            console.log(`DIAGNOSTIC: #tblSubmitForApproval table not found on page at all. Current URL/heading: ${page.url()}`);
            const heading = await page.locator('h1, h2, .page-title, [role="heading"]').first()
                .textContent({ timeout: 2000 }).catch(() => null);
            if (heading) console.log(`DIAGNOSTIC: page heading = "${heading.trim()}"`);
        } else {
            const rowTexts = await page.locator('#tblSubmitForApproval tbody tr').allTextContents().catch(() => []);
            console.log(`DIAGNOSTIC: #tblSubmitForApproval table found with ${rowTexts.length} row(s): ${JSON.stringify(rowTexts.map(t => t.trim().slice(0, 80)))}`);
        }
    } catch (e) {
        console.log(`DIAGNOSTIC: table-presence check failed: ${e.message.split('\n')[0]}`);
    }

    // Scoped to the submission we're actually processing - an account can have
    // multiple entries in the cart (e.g. a separate Commercial Umbrella
    // submission), and the unscoped selector hit a strict-mode violation
    // when more than one row was present.
    // The backend can take a few seconds after quote rating to actually
    // register the submission in the cart table, so the row may not be
    // present yet even though the table itself has rendered - confirmed live
    // on BOP (30s straight timeout, no retry). Mirrors the same bounded
    // reload-retry already proven for the later Submit For Issuance step.
    const submissionRow = page.locator('#tblSubmitForApproval tbody tr')
        .filter({ hasText: submissionNumber.toString() });

    // Adaptive instead of a fixed "5 reloads, N-second waits each" budget:
    // poll cheaply first (no reload) since the cart table may just need an
    // AJAX-driven refresh, which is far faster than a full page reload -
    // only pay the expensive reload cost if that genuinely doesn't work,
    // and time-box the whole thing rather than counting fixed attempts, so
    // it exits the instant the row appears instead of always waiting out a
    // per-attempt timeout.
    let submissionRowReady = false;
    const approvalPollDeadline = Date.now() + 15000;
    while (Date.now() < approvalPollDeadline && !submissionRowReady) {
        submissionRowReady = await submissionRow.first().isVisible().catch(() => false);
        if (!submissionRowReady) await page.waitForTimeout(1000);
    }

    const approvalReloadDeadline = Date.now() + 90000;
    let reloadAttempt = 0;
    // Confirmed live: this loop spun 160-1929 "reload attempts" inside its
    // 90s budget - physically impossible for real page.reload() cycles
    // (~10s each), which only happens if the page/context went dead and
    // every awaited call inside the loop was rejecting near-instantly
    // instead of actually reloading. Bail out immediately once the page is
    // gone instead of burning the full 90s spinning on a dead page, and cap
    // attempts as a hard safety valve regardless of cause.
    while (!submissionRowReady && Date.now() < approvalReloadDeadline && reloadAttempt < 20) {
        if (!isPageAlive(page)) {
            console.log('Page closed during Submit For Approval reload polling - stopping');
            break;
        }
        reloadAttempt++;
        console.log(`Submit For Approval row for ${submissionNumber} not visible yet (reload attempt ${reloadAttempt}) - reloading...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await dismissStatusModal();
        submissionRowReady = await submissionRow.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    }

    if (!submissionRowReady) {
        throw new Error(`Submit For Approval row for ${submissionNumber} never appeared after ${reloadAttempt} reload(s) - the captured quote/submission number may be wrong, or the submission never finished rating.`);
    }
    console.log('Submission row found, selecting checkbox...');
    const rowCheckbox = submissionRow.locator('input[type="checkbox"]').first();
    await rowCheckbox.check();
    await page.waitForLoadState('domcontentloaded');
    // Shrunk from 2000ms - safeClickBtn() below already waits up to 30s for its target.
    await page.waitForTimeout(400);
    await dismissStatusModal();

    console.log('Clicking Request Purchase Approval...');
    await safeClickBtn(page.getByRole('button', { name: 'Request Purchase Approval' }), 'Request Purchase Approval');
    console.log('Request Purchase Approval submitted, checking Federal ID...');
    // Shrunk from 1000ms - safeClickBtn() below already waits up to 30s for its target.
    await page.waitForTimeout(300);
    await dismissStatusModal();

    // Confirmed live via screenshot: this "Client Information" panel's
    // Federal ID Number can be blank here even though it was already filled
    // during account creation - reusing the same dummy-SSN logic
    // (randSSN(), same as accountCreationHelper.js) rather than leaving it
    // empty and letting Send's own validation/retry silently eat time.
    const federalIdInput = page.getByRole('textbox', { name: 'Federal ID Number' });
    if (await federalIdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        const currentFederalId = await federalIdInput.inputValue().catch(() => '');
        if (!currentFederalId.trim()) {
            await federalIdInput.fill(randSSN());
            console.log('Federal ID Number was blank on Request Purchase Approval screen - filled with dummy SSN');
        }
    }

    console.log('Clicking Send...');
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

    // The backend can take a while after UW approval to actually register the
    // submission as ready for issuance. Confirmed live on both Training and QA:
    // the old fixed 6-reload budget (~90s) regularly isn't enough, which left
    // the unconditional row.check() below hanging the full 60s actionTimeout
    // against a row that was always going to show up a little later and
    // throwing a confusing low-level "locator.check: Timeout" instead of a
    // clear "it never showed up" error. Mirrors the same two-phase
    // poll-then-reload pattern already proven above for the Submit For
    // Approval row: poll cheaply first (no reload - an AJAX-driven refresh
    // can beat a full page reload), then fall back to bounded reloads under a
    // generous overall time budget instead of a small fixed attempt count.
    const row = page.locator('#tblSubmitForIssuance tbody tr')
        .filter({ hasText: submissionNumber.toString() });

    let rowReady = false;
    const issuancePollDeadline = Date.now() + 15000;
    while (Date.now() < issuancePollDeadline && !rowReady) {
        rowReady = await row.first().isVisible().catch(() => false);
        if (!rowReady) await page.waitForTimeout(1000);
    }

    const issuanceReloadDeadline = Date.now() + 150000;
    let issuanceAttempt = 0;
    while (!rowReady && Date.now() < issuanceReloadDeadline && issuanceAttempt < 20) {
        if (!isPageAlive(page)) {
            console.log('Page closed during Submit For Issuance reload polling - stopping');
            break;
        }
        issuanceAttempt++;
        console.log(`Issuance row for ${submissionNumber} not visible yet (reload attempt ${issuanceAttempt}) - reloading...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await dismissStatusModal();
        rowReady = await row.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    }

    if (!rowReady) {
        throw new Error(`Issuance row for ${submissionNumber} never appeared after ${issuanceAttempt} reload(s) - the submission may still be propagating from UW approval, or the submission number may be wrong.`);
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
        if (attemptNum <= 15) return 2000;
        if (attemptNum <= 20) return 1000;
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

        const policyCell = page.locator('#tblPolicies tbody tr:first-child td:nth-child(3)');

        // Confirmed live in training env: page.reload() below was timing
        // out on every single attempt for the full 10-minute budget, and
        // since the table check only ran AFTER a successful reload, it
        // never once looked at the current page - even though the policy
        // number was already sitting on screen the whole time. Check
        // before reloading so a slow/failing reload can't hide an answer
        // that's already visible.
        try {
            const count = await safeCount(policyCell);
            if (count > 0) {
                const value = (await policyCell.textContent({ timeout: 5000 }))?.trim();
                if (value) {
                    policyNumber = value;
                    console.log(`Policy Number Found (pre-reload check): ${policyNumber}`);
                    break;
                }
            }
        } catch (e) {
            console.warn(`Poll attempt ${attempt} pre-reload check error (will retry): ${e.message}`);
        }

        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForLoadState('networkidle').catch(() => {});
            await dismissStatusModal();

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
