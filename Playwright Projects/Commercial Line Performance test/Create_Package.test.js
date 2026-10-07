// Set suite type for email reporter
process.env.TEST_TYPE = 'PACKAGE';

const { test, expect } = require('@playwright/test');

const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify, isTrainingUrl, TRAINING_LICENSED_STATES } = require('./accountCreationHelper');
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./helpers/coverageHelpers');
const fs = require('fs');
const path = require('path');

// Runtime-generated test-data JSON lives in its own subfolder to keep the
// project root uncluttered (matches emailReporter.js's RUNTIME_DIR).
const RUNTIME_DIR = path.join(__dirname, 'runtime-data');
fs.mkdirSync(RUNTIME_DIR, { recursive: true });

test('Package Submission', async ({ page }, testInfo) => {
    test.setTimeout(1800000); // 30 minutes
    page.setDefaultTimeout(120000);

    const envName = process.env.TEST_ENV || 'qa';
    const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);
    // See Create_CA.test.js for why this is logged: getEnvUrls() previously
    // fell through to qa silently on a casing mismatch (e.g. TEST_ENV=Training
    // vs the declared key "Training").
    console.log(`Resolved environment "${envName}" -> writeBizUrl=${writeBizUrl}`);

    const allowedStates = Object.keys(STATE_CONFIG);
    let testState = (process.env.TEST_STATE || 'DE').toUpperCase();
    if (!allowedStates.includes(testState)) {
        console.log(`WARNING: TEST_STATE "${testState}" not allowed; defaulting to DE`);
        testState = 'DE';
    }
    const stateConfig = getStateConfig(testState);
    console.log(`Running test for state: ${testState} (${stateConfig.name})`);

    // See Create_CA.test.js for why: on Training the only confirmed-working
    // producer (Linda D. Strause, agency 0000988) is licensed in a specific
    // state list. Skip cleanly rather than burning a full run on a state
    // that can never succeed there.
    test.skip(isTrainingUrl(writeBizUrl) && !TRAINING_LICENSED_STATES.includes(testState),
      `Skipping ${testState} on Training - producer Linda D. Strause is only licensed in: ${TRAINING_LICENSED_STATES.join(', ')}`);

    global.testData = {
        state: testState,
        stateName: stateConfig.name,
        milestones: [],
        httpTimings: [],
        networkErrors: [],
        coverageChanges: [],
        coverageSectionStats: [],
        addCoverageTimings: [],
        retryCount: testInfo.retry || 0,
        quoteNumber: 'N/A',
        policyNumber: 'N/A'
    };

    const testDataFile = path.join(RUNTIME_DIR, `test-data-${testState}.json`);
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log(`Initialized test data for ${testState}`);

    page.on('response', async (response) => {
        try {
            const url = response.url();
            const status = response.status();
            const timing = response.timing();
            let duration = null;
            if (timing && timing.startTime && timing.responseEnd)
                duration = (timing.responseEnd - timing.startTime) / 1000;
            if (['xhr', 'fetch'].includes(response.request().resourceType()) || /api|service|rest|json|ajinvoke/i.test(url))
                global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
            if (status >= 400)
                global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
        } catch (e) { }
    });

    page.on('requestfailed', request => {
        global.testData.networkErrors.push({ url: request.url(), error: request.failure(), timestamp: new Date().toISOString() });
    });

    let currentStepStartTime = null;
    let waitBudgetMs = 0;
    let testFailed = false;

    const originalWaitForTimeout = page.waitForTimeout.bind(page);
    page.waitForTimeout = async (ms) => {
        try {
            if (page.isClosed()) return;
            await originalWaitForTimeout(ms);
            waitBudgetMs += ms;
        } catch (error) {
            if (!page.isClosed()) throw error;
        }
    };

    function saveTestData() {
        try {
            fs.writeFileSync(
                path.join(RUNTIME_DIR, `test-data-${testState}.json`),
                JSON.stringify(global.testData, null, 2)
            );
        } catch (e) { console.log('Could not save test-data.json:', e.message); }
    }

    function trackMilestone(name, status = 'PASSED', details = '') {
        const now = new Date();
        let duration = null;
        if (currentStepStartTime) {
            const elapsed = now - currentStepStartTime - waitBudgetMs;
            duration = (Math.max(elapsed, 0) / 1000).toFixed(2);
        }
        global.testData.milestones.push({ name, status, timestamp: now, details, duration: duration ? `${duration}s` : null });
        console.log(`${status === 'PASSED' ? 'OK' : 'FAIL'} ${name}${duration ? ` (${duration}s)` : ''}`);
        saveTestData();
        currentStepStartTime = new Date();
        waitBudgetMs = 0;
    }

    async function clickTextItem(text) {
        const gridItem = page.getByRole('gridcell', { name: text }).first();
        if (await gridItem.count() > 0) { await gridItem.click(); return; }
        // getByText accepts a string OR a RegExp natively - building the
        // locator as `text="${text}"` broke every RegExp caller (e.g.
        // clickTextItem(/Car washes/)): template-string interpolation
        // stringifies a RegExp to its literal source INCLUDING the slashes
        // ("/Car washes/"), so the locator was searching for text that
        // literally contains slashes and could never match real page text.
        const fallback = page.getByText(text).first();
        await fallback.waitFor({ state: 'visible', timeout: 10000 });
        await fallback.click({ force: true });
    }

    global.testData.retryCount = testInfo.retry || 0;
    currentStepStartTime = new Date();

    // ── Modal / status dismissal ───────────────────────────────────────────────
    async function dismissStatusModal() {
        try {
            // Loop up to 5 times - the modal can reappear right after being
            // dismissed while WB finishes rendering the next section
            for (let i = 0; i < 5; i++) {
                const statusModal = page.locator('#dgic-status-message');
                const isVisible = await statusModal.isVisible().catch(() => false);
                if (!isVisible) return;

                console.log(`Status modal visible (attempt ${i + 1}) - dismissing...`);
                const btn = statusModal.locator('button').first();
                if (await btn.count() > 0) await btn.click({ force: true }).catch(() => { });
                await statusModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(300);
            }
        } catch (e) { }
    }

    async function waitForModalsToClose(timeout = 8000) {
        await dismissStatusModal();
        try {
            const otherModals = [
                '.ui-widget-overlay',
                '#gw-click-overlay.gw-disable-click',
                '.gw-click-overlay',
                '#dgic-modal-clpropertyaddlcoveragesscheduledialog',
                '#dgic-modal-editverisk360valuation'
            ];
            for (const selector of otherModals) {
                const modal = page.locator(selector).first();
                const count = await modal.count().catch(() => 0);
                if (count === 0) continue;
                const isVisible = await modal.isVisible().catch(() => false);
                if (isVisible) await modal.waitFor({ state: 'hidden', timeout }).catch(() => { });
            }
        } catch (e) { }
    }

    // ── Generic blocking-dialog closer ────────────────────────────────────────
    // Any leftover modal (Verisk360 valuation, Additional Coverages Schedule,
    // "Attention" info dialogs, etc.) sitting over the Buildings page eats every
    // subsequent click as a 10-30s timeout instead of failing fast. Try known
    // close-button patterns, then Escape, then force-remove the modal + its
    // backdrop from the DOM as a last resort so navigation can proceed.
    async function closeAnyBlockingDialog(maxAttempts = 3) {
        const closeSelectors = [
            'button[data-dismiss="modal"]',
            'button.close',
            'button:has-text("Close")',
            'button:has-text("OK")',
            'button:has-text("Ok")',
            '#dgic-status-message button',
            '.modal.show .modal-footer button',
            '.modal.show button[aria-label="Close"]',
        ];
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const anyModal = page.locator('.modal.show, #dgic-status-message:visible').first();
            if (!await anyModal.isVisible({ timeout: 2000 }).catch(() => false)) return;

            console.log(`closeAnyBlockingDialog: modal detected (attempt ${attempt + 1}/${maxAttempts})`);
            let closed = false;
            for (const sel of closeSelectors) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await btn.click({ force: true }).catch(() => { });
                    await page.waitForTimeout(300);
                    console.log('closeAnyBlockingDialog: closed via ' + sel);
                    closed = true;
                    break;
                }
            }
            if (!closed) {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                console.log('closeAnyBlockingDialog: tried Escape');
            }
        }

        if (await page.locator('.modal.show').first().isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log('closeAnyBlockingDialog: modal still open after retries - force-removing from DOM');
            await page.evaluate(() => {
                document.querySelectorAll('.modal.show').forEach(el => el.remove());
                document.querySelectorAll('.modal-backdrop, .ui-widget-overlay').forEach(el => el.remove());
                document.body.classList.remove('modal-open');
                document.body.style.removeProperty('overflow');
                document.body.style.removeProperty('padding-right');
            });
            await page.waitForTimeout(500);
        }
    }

    // ── Safe click helpers ────────────────────────────────────────────────────
    async function safeClick(locator, options = {}) {
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        await waitForModalsToClose();

        let clicked = false;
        for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
            try {
                await dismissStatusModal();
                await locator.click({ ...options, timeout: 10000 });
                clicked = true;
            } catch (e) {
                console.log(`safeClick attempt ${attempt} blocked: ${e.message.split('\n')[0]}`);
                await dismissStatusModal();
                await page.waitForTimeout(500);
            }
        }
        if (!clicked) {
            console.log('safeClick: forcing click after modal kept reappearing');
            await locator.click({ ...options, force: true });
        }
    }

    // Several silent, hard-to-diagnose failures today traced back to one of
    // these navigation buttons simply never appearing - the bare TimeoutError
    // gave no clue whether the page was stuck on an earlier screen, showing
    // an unhandled validation error, or something else entirely. Dump what's
    // actually on screen before failing so the next occurrence is a fact,
    // not a guess.
    async function dumpNavFailureDiagnostic(label) {
        const diag = await page.evaluate(() => ({
            url: location.href,
            heading: (document.querySelector('h1, h2, .gw-title, [role="heading"]')?.textContent || '').trim().slice(0, 200),
            visibleButtons: [...document.querySelectorAll('button')]
                .filter(el => el.offsetParent !== null)
                .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 15),
            visibleErrors: [...document.querySelectorAll('[class*="error" i], [class*="alert" i], [class*="danger" i]')]
                .filter(el => el.offsetParent !== null)
                .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 5),
        })).catch(() => ({}));
        console.log(label + ': button not visible after 30s - page diagnostic: ' + JSON.stringify(diag));
    }

    async function safeNextClick() {
        const btn = page.getByRole('button', { name: 'Next ' });
        const nextVisible = await btn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
        if (!nextVisible) {
            await dumpNavFailureDiagnostic('safeNextClick');
            await btn.waitFor({ state: 'visible', timeout: 1000 });
        }
        await waitForModalsToClose();

        const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false);
        if (isDisabled) {
            await page.waitForFunction(() => {
                const candidates = Array.from(document.querySelectorAll('button'));
                const nextBtn = candidates.find(b =>
                    b.textContent.trim().startsWith('Next') && b.classList.contains('btn-primary')
                );
                return nextBtn ? !nextBtn.disabled && !nextBtn.classList.contains('disabled') : true;
            }, { timeout: 15000 }).catch(() => { });
            await waitForModalsToClose();
        }

        let clicked = false;
        for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
            try {
                await dismissStatusModal();
                await btn.click({ timeout: 10000 });
                clicked = true;
            } catch (e) {
                console.log(`safeNextClick attempt ${attempt} blocked: ${e.message.split('\n')[0]}`);
                await dismissStatusModal();
                await page.waitForTimeout(500);
            }
        }
        if (!clicked) {
            console.log('safeNextClick: forcing click after modal kept reappearing');
            await btn.click({ force: true });
        }
    }

    async function safeContinueClick() {
        let btn = page.getByRole('button', { name: 'Continue ' });
        let continueVisible = await btn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
        if (!continueVisible) {
            // Confirmed live: some screens in this wizard label their
            // "proceed" button "Next" instead of "Continue " - the
            // Mortgagees screen (CLPropertyMortgagees.aspx) only ever shows
            // "Next", so a caller expecting "Continue " here would hang for
            // the full 30s and fail even though the page was perfectly fine.
            const nextBtn = page.getByRole('button', { name: 'Next ' });
            const nextVisible = await nextBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
            if (nextVisible) {
                console.log('safeContinueClick: "Continue " not found, using "Next " instead');
                btn = nextBtn;
                continueVisible = true;
            }
        }
        if (!continueVisible) {
            await dumpNavFailureDiagnostic('safeContinueClick');
            await btn.waitFor({ state: 'visible', timeout: 1000 });
        }
        await waitForModalsToClose();

        let clicked = false;
        for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
            try {
                await dismissStatusModal();
                await btn.click({ timeout: 10000 });
                clicked = true;
            } catch (e) {
                console.log(`safeContinueClick attempt ${attempt} blocked: ${e.message.split('\n')[0]}`);
                await dismissStatusModal();
                await page.waitForTimeout(500);
            }
        }
        if (!clicked) {
            console.log('safeContinueClick: forcing click after modal kept reappearing');
            await btn.click({ force: true });
        }
    }

    async function safeSaveClick(buttonName = 'Save') {
        const btn = page.getByRole('button', { name: buttonName });
        const saveVisible = await btn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
        if (!saveVisible) {
            await dumpNavFailureDiagnostic(`safeSaveClick("${buttonName}")`);
            await btn.waitFor({ state: 'visible', timeout: 1000 });
        }
        await waitForModalsToClose();

        let clicked = false;
        for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
            try {
                await dismissStatusModal();
                await btn.click({ timeout: 10000 });
                clicked = true;
            } catch (e) {
                console.log(`safeSaveClick attempt ${attempt} blocked: ${e.message.split('\n')[0]}`);
                await dismissStatusModal();
                await page.waitForTimeout(500);
            }
        }
        if (!clicked) {
            console.log('safeSaveClick: forcing click after modal kept reappearing');
            await btn.click({ force: true });
        }
    }

    // ── Integer field fill ────────────────────────────────────────────────────
    async function fillIntegerField(locator, value) {
        const numericValue = String(value).replace(/,/g, '').trim();
        let fillSuccess = false;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page.bringToFront();
                await page.waitForTimeout(300);
                await locator.click({ clickCount: 3, force: true });
                await page.waitForTimeout(300);
                await page.keyboard.press('Control+A');
                await page.keyboard.press('Delete');
                await page.waitForTimeout(300);
                await locator.fill(numericValue);
                await page.waitForTimeout(300);
                await locator.blur();
                await page.waitForTimeout(800);

                const filled = (await locator.inputValue()).replace(/,/g, '').trim();
                if (filled === numericValue) {
                    console.log(`Field filled: ${numericValue} (attempt ${attempt})`);
                    fillSuccess = true;
                    break;
                }

                const selector = await locator.evaluate(el => el.id ? `#${el.id}` : null);
                if (selector) {
                    await page.evaluate((sel, val) => {
                        const el = document.querySelector(sel);
                        if (!el) return;
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(el, val);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('blur', { bubbles: true }));
                    }, selector, numericValue);
                    await page.waitForTimeout(800);
                    const evalFilled = (await locator.inputValue()).replace(/,/g, '').trim();
                    if (evalFilled === numericValue) {
                        console.log(`Field filled via evaluate(): ${numericValue}`);
                        fillSuccess = true;
                        break;
                    }
                }
                console.log(`Fill attempt ${attempt} gave "${await locator.inputValue()}"`);
            } catch (err) {
                console.log(`Fill attempt ${attempt} error: ${err.message}`);
            }
            await page.waitForTimeout(1000);
        }

        if (!fillSuccess) {
            console.log('All fill() attempts failed, using slow keyboard.type()');
            await locator.click({ clickCount: 3, force: true });
            await page.waitForTimeout(500);
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
            await page.waitForTimeout(500);
            await page.keyboard.type(numericValue, { delay: 50 });
            await page.waitForTimeout(300);
            await locator.blur();
            await page.waitForTimeout(1500);
            console.log(`Field filled via slow type(): ${numericValue}`);
        }
    }

    async function waitForVisible(locator, timeout = 5000) {
        return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
    }

    // ── Verify-and-retry for Verisk360 numeric fields ─────────────────────────
    // Types the value, reads it back after blur, and re-types if empty/wrong.
    async function setNumericVerified(locator, value, label, attempts = 3) {
        const strVal = String(value);
        for (let i = 1; i <= attempts; i++) {
            try {
                await locator.click({ clickCount: 3 });
                await page.keyboard.press('Delete');
                await page.keyboard.type(strVal, { delay: 30 });
                await locator.blur();
                await page.waitForTimeout(300);

                const current = (await locator.inputValue().catch(() => '')).replace(/,/g, '').trim();
                if (current === strVal || current.startsWith(strVal)) {
                    console.log(`${label}: ${current} (attempt ${i})`);
                    return true;
                }
                console.log(`${label} not set (got "${current}"), retry ${i}/${attempts}`);
            } catch (e) {
                console.log(`${label} attempt ${i} error: ${e.message.split('\n')[0]}`);
            }
            await page.waitForTimeout(300);
        }
        console.warn(`${label}: FAILED after ${attempts} attempts`);
        return false;
    }

    // ── Verify-and-retry for Verisk360 type-ahead "Use" field ─────────────────
    async function selectUseVerified(input, typeText, optionText, label, attempts = 3) {
        for (let i = 1; i <= attempts; i++) {
            try {
                await input.click({ clickCount: 3 });
                await page.keyboard.press('Delete');
                await page.keyboard.type(typeText, { delay: 50 });
                await page.waitForTimeout(1000);

                const suggestion = page.locator(
                    `.dropdown-menu.show li:has-text("${optionText}"), ` +
                    `[role="option"]:has-text("${optionText}"), ` +
                    `li:has-text("${optionText}")`
                ).first();

                if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await suggestion.click({ force: true });
                    console.log(`${label}: selected via suggestion (attempt ${i})`);
                } else {
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(300);
                    await page.keyboard.press('Enter');
                    console.log(`${label}: selected via keyboard (attempt ${i})`);
                }
                await page.waitForTimeout(500);

                const current = (await input.inputValue().catch(() => '')).trim();
                if (current.toLowerCase().includes(typeText.toLowerCase())) {
                    console.log(`${label}: "${current}" confirmed (attempt ${i})`);
                    return true;
                }
                console.log(`${label} not committed (got "${current}"), retry ${i}/${attempts}`);
            } catch (e) {
                console.log(`${label} attempt ${i} error: ${e.message.split('\n')[0]}`);
            }
            await page.waitForTimeout(300);
        }
        console.warn(`${label}: FAILED after ${attempts} attempts`);
        return false;
    }

    // ── Helper: verify-and-retry for Verisk360 Construction Class dropdown ────
    // Confirmed live: it defaults to "Unknown", and Guidewire's own Calculate
    // Now validation rejects that with "The Estimator returned an Unknown
    // construction type, which is not a valid selection." A first attempt at
    // locating this field via a loose ancestor "contains" xpath landed on the
    // WRONG input (any element whose combined text happened to contain the
    // phrase matched, not just the field's own label) - the value stayed
    // "Unknown" and Calculate Now kept failing. Anchor on the label's own
    // EXACT text instead, then verify the input actually changed.
    async function selectConstructionClassVerified(attempts = 3) {
        const classLabel = page.getByText('Construction Class', { exact: true }).first();
        if (!await classLabel.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Construction Class label not found on Structure Options screen');
            return false;
        }
        const classInput = classLabel.locator('xpath=following::input[1]');

        for (let i = 1; i <= attempts; i++) {
            const current = (await classInput.inputValue().catch(() => '')).trim();
            if (current && !/unknown/i.test(current)) {
                console.log(`Verisk360 Construction Class already valid: ${current}`);
                return true;
            }
            try {
                // Per user direction: stop relying on clicking a pre-rendered
                // option in the full unfiltered list - neither an untrusted
                // synthetic dispatchEvent click NOR a real trusted Playwright
                // click via role=option/mat-option made any difference (both
                // hit the identical "input value updates but widget's
                // committed state stays Unknown" race). This field is a
                // "searchable-select" (iv360-searchable-select-input) - the
                // "Use" field on screen 1 is the SAME kind of widget and has
                // been reliable all session by TYPING to filter the list
                // first, then selecting, rather than opening the full list
                // and hunting for a match. Apply that identical, proven
                // approach here: clear the field and type a substring only
                // "1 - Frame" matches (no other option contains "Frame"),
                // narrowing the list to one unambiguous result.
                await classInput.click({ clickCount: 3 });
                await page.keyboard.press('Delete');
                await page.keyboard.type('Frame', { delay: 50 });
                await page.waitForTimeout(1000);

                const suggestion = page.locator(
                    '.dropdown-menu.show li:has-text("1 - Frame"), ' +
                    '[role="option"]:has-text("1 - Frame"), ' +
                    'mat-option:has-text("1 - Frame"), ' +
                    'li:has-text("1 - Frame")'
                ).first();

                if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await suggestion.click();
                    console.log('Construction Class: selected "1 - Frame" via filtered suggestion');
                } else {
                    console.log('Construction Class: filtered suggestion not visible - trying ArrowDown+Enter');
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(300);
                    await page.keyboard.press('Enter');
                }
                await page.waitForTimeout(1200);
            } catch (e) {
                console.log(`Construction Class attempt ${i} error: ${e.message.split('\n')[0]}`);
            }
            const after = (await classInput.inputValue().catch(() => '')).trim();
            console.log(`Construction Class attempt ${i}: "${after}"`);
            // Reverted the modal-text cross-check added earlier: it matched
            // "Construction Class ... Unknown" against the whole modal's
            // text, but the diagnostic dump shows a SEPARATE element,
            // class="iv360-originalDefaultsText" with text "Unknown" -
            // almost certainly a permanent "original value" reference
            // label, not live current state. That made the cross-check a
            // false positive, rejecting a genuinely valid "1 - Frame"
            // selection every time and forcing pointless retries. Trust
            // inputValue() directly, exactly like the proven
            // selectUseVerified() above does for the Use field - it never
            // cross-checks the modal text either.
            if (after && !/unknown/i.test(after)) return true;
        }

        // Still stuck - reopen the dropdown and dump every visible leaf
        // element whose text mentions "Frame" or "Unknown" anywhere in the
        // document, instead of guessing a fourth time. This tells us
        // definitively whether the option text exists and is visible at all
        // (timing issue), lives outside the subtree we searched (structure
        // issue), or is rendered some other way entirely (a fundamentally
        // different control).
        await classInput.click().catch(() => { });
        await page.waitForTimeout(700);
        const domDump = await page.evaluate(() => {
            const isVisible = (el) => !!el.offsetParent;
            const active = document.activeElement;
            const matches = [...document.querySelectorAll('*')]
                .filter(el => el.children.length === 0 && isVisible(el) && /frame|unknown/i.test((el.textContent || '').trim()))
                .slice(0, 15)
                .map(el => ({
                    tag: el.tagName, cls: (el.className || '').toString().slice(0, 60),
                    text: (el.textContent || '').trim().slice(0, 40),
                }));
            return {
                activeElement: active ? { tag: active.tagName, id: active.id, cls: (active.className || '').toString().slice(0, 60) } : null,
                visibleMatches: matches,
            };
        }).catch(() => ({ error: true }));
        console.log(`Construction Class DOM diagnostic: ${JSON.stringify(domDump)}`);

        console.warn(`Construction Class: FAILED to set a valid value after ${attempts} attempts - still "Unknown"`);
        return false;
    }

    async function waitForEnabled(locator, timeout = 8000) {
        try {
            await locator.waitFor({ state: 'visible', timeout });
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                const isDisabled = await locator.evaluate(el =>
                    el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true'
                );
                if (!isDisabled) return true;
                await new Promise(r => setTimeout(r, 200));
            }
            return false;
        } catch { return false; }
    }


    // ── Estimator click ───────────────────────────────────────────────────────
    async function clickEstimatorAndWait() {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        // Shrunk from 3000ms - the Structure Building wait below already polls up to 30s.
        await page.waitForTimeout(500);

        await page.locator('text=Structure Building').first()
            .waitFor({ state: 'visible', timeout: 30000 })
            .catch(() => console.log('Structure Building header not found, continuing...'));
        console.log('Structure Building section loaded');
        const estimatorLocator = page.locator('a:has-text("Create Estimator"), a:has-text("Edit Estimator"), [id*="Estimator"] a').first();


        const estimatorVisible = await waitForVisible(estimatorLocator, 30000);
        if (!estimatorVisible) console.log('WARNING: Estimator link not visible after 30s');
        else console.log('Estimator link is visible');

        await estimatorLocator.scrollIntoViewIfNeeded().catch(() => { });
        await page.bringToFront();
        await page.waitForTimeout(1000);

        let estimatorOpened = false;

        for (let attempt = 1; attempt <= 4; attempt++) {
            console.log(`Estimator click attempt ${attempt}/4`);

            const strategies = [
                async () => { await estimatorLocator.click({ timeout: 5000 }); },
                async () => { await estimatorLocator.click({ force: true, timeout: 5000 }); },
                async () => {
                    await page.evaluate(() => {
                        const el = Array.from(document.querySelectorAll('a, span, div'))
                            .find(e => /create estimator|edit estimator/i.test(e.textContent?.trim()));
                        if (el) el.click();
                    });
                },
            ];

            for (const strategy of strategies) {
                try {
                    await page.bringToFront();
                    await strategy();
                    await page.waitForTimeout(3000);

                    const sqFtField = page.locator([
                        '#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL',
                        '[id*="SQUARE_FEET"]',
                        '[id*="PRI-XT"]',
                    ].join(', ')).first();

                    const propertyNotFound = page.locator('text=Property Information Not Found').first();
                    const isOpen = await sqFtField.isVisible({ timeout: 3000 }).catch(() => false);
                    const stillShowsError = await propertyNotFound.isVisible({ timeout: 1000 }).catch(() => false);

                    if (isOpen || !stillShowsError) {
                        console.log(`Estimator opened on attempt ${attempt}`);
                        estimatorOpened = true;
                        break;
                    }
                } catch (e) {
                    console.log(`Estimator strategy failed: ${e.message}`);
                }
            }

            if (estimatorOpened) break;

            await estimatorLocator.scrollIntoViewIfNeeded().catch(() => { });
            await page.bringToFront();
            await page.waitForTimeout(2000);
        }

        return estimatorOpened;
    }

    // ── Verify Import Data actually populated the property data ──────────────
    // Clicking Import Data does not mean it worked - the Structure Building
    // panel keeps showing the red "Property Information Not Found" banner
    // until the import genuinely completes, which can take a while. Reading
    // the Estimated Replacement Cost field before that banner flips to the
    // green "Property Information Found" is why it was coming back empty and
    // silently wiping out the fallback limit. Poll for the real success
    // signal instead of assuming a fixed wait is long enough.
    async function waitForPropertyInformationFound(timeout = 45000) {
        const foundLocator = page.locator('text=Property Information Found').first();
        const notFoundLocator = page.locator('text=Property Information Not Found').first();
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (await foundLocator.isVisible({ timeout: 1000 }).catch(() => false)) return true;
            if (!(await notFoundLocator.isVisible({ timeout: 500 }).catch(() => false))) {
                // Neither banner is showing (e.g. mid-refresh) - keep polling
                // rather than treating this as success.
            }
            await page.waitForTimeout(1000);
        }
        return false;
    }

    try {

        async function clickIfExists(buttonName) {
            try {
                await dismissStatusModal();
                const btn = page.getByRole('button', { name: buttonName });
                // Fast presence probe instead of relying on click()'s full 5s
                // actionability timeout to detect "not present" - this is called
                // in runs of up to 5 mutually-exclusive optional buttons, so a
                // miss here used to cost a guaranteed 5s each (up to 20-25s/run).
                const visible = await btn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
                if (!visible) { console.log(`"${buttonName}" button not present, skipping`); return; }
                await btn.click({ timeout: 3000 });
                console.log(`"${buttonName}" button clicked`);
            } catch {
                console.log(`"${buttonName}" button not present, skipping`);
            }
        }

        await createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone });

        await page.waitForTimeout(3000);
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
        await dismissStatusModal();

        // ── Commercial Package checkbox ────────────────────────────────────────
        async function clickCommercialPackage() {
            const input = page.locator('#chk_commercialpackage').first();
            const label = page.locator('#for_chk_commercialpackage').first();
            try {
                if (await input.count() > 0 && await input.isVisible().catch(() => false)) {
                    await input.scrollIntoViewIfNeeded();
                    await input.click({ timeout: 10000 });
                    console.log('Commercial Package checkbox clicked (input)');
                    return;
                }
                if (await label.count() > 0 && await label.isVisible().catch(() => false)) {
                    await label.scrollIntoViewIfNeeded();
                    await label.click({ timeout: 10000 });
                    console.log('Commercial Package checkbox clicked (label)');
                    return;
                }
                const clicked = await page.evaluate(() => {
                    const el = document.querySelector('#chk_commercialpackage');
                    if (el) { el.click(); return true; }
                    const lbl = document.querySelector('#for_chk_commercialpackage');
                    if (lbl) { lbl.click(); return true; }
                    return false;
                });
                if (clicked) { console.log('Commercial Package checkbox clicked (JS evaluate)'); return; }
                throw new Error('Commercial package checkbox not found');
            } catch (e) {
                console.log('Commercial package click fallback:', e.message);
                try {
                    if (await label.count() > 0) {
                        await label.waitFor({ state: 'attached', timeout: 10000 }).catch(() => { });
                        await label.click({ force: true });
                        console.log('Commercial Package clicked (force)');
                        return;
                    }
                } catch (e2) {
                    // Setting .checked directly and firing synthetic input/change
                    // events does NOT run the checkbox's own
                    // onclick="$GblClient.ProductLines.toggleGrids(this)" handler
                    // (onclick only fires on a real click event) - the checkbox
                    // LOOKED checked but the page never wired up the Commercial
                    // Property line's dependent controls (Inland Marine/Crime),
                    // which then never rendered downstream. Confirmed live: this
                    // exact fallback ran, then #cbInlandMarine timed out at 30s.
                    // Native el.click() both toggles checked AND fires the click
                    // event, so the inline handler actually runs.
                    await page.evaluate(() => {
                        const el = document.querySelector('#chk_commercialpackage');
                        if (el && !el.checked) el.click();
                    });
                    console.log('Commercial Package set via native click() (last resort)');
                }
            }
            await page.waitForTimeout(500);
        }

        await clickCommercialPackage();
        await page.waitForTimeout(1500);
        await dismissStatusModal();

        await page.getByRole('button', { name: 'Next' }).click();
        await page.waitForTimeout(1500);
        await dismissStatusModal();

        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_ApplicantCPPLiabilityLossesInd_Ext_No"]').click();
        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_CPPCertificateQuestion_Ext_Yes"]').click();
        await page.getByRole('button', { name: 'Finish' }).click();
        // Shrunk from 1500ms - priorCarrierSelect.waitFor() below already polls up to 15s.
        await page.waitForTimeout(300);
        await dismissStatusModal();

        const priorCarrierSelect = page.locator('#ddlPriorCarrier');
        await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(200);
        const firstCarrierValue = await priorCarrierSelect.evaluate(el => {
            const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
            return opt ? opt.value : null;
        });
        if (!firstCarrierValue) throw new Error('No prior carrier options available');
        await priorCarrierSelect.selectOption(firstCarrierValue);
        console.log(`Selected prior carrier: ${firstCarrierValue}`);

        await safeNextClick();
        trackMilestone('Policy Details Entered');

        await page.waitForLoadState('domcontentloaded');
        await page.locator('#cbInlandMarine').waitFor({ state: 'visible', timeout: 30000 });
        await dismissStatusModal();

        await page.locator('#cbInlandMarine').scrollIntoViewIfNeeded();
        if (!await page.locator('#cbInlandMarine').isChecked()) {
            await page.locator('#cbInlandMarine').evaluate(el => el.click());
            await page.waitForTimeout(500);
            console.log('Inland Marine toggled to Yes');
        }

        await page.locator('#cbCrime').scrollIntoViewIfNeeded();
        if (!await page.locator('#cbCrime').isChecked()) {
            await page.locator('#cbCrime').evaluate(el => el.click());
            await page.waitForTimeout(500);
            console.log('Crime toggled to Yes');
        }

        await page.waitForTimeout(200);
        await page.locator('#btnConfirmSelections').click();
        await page.waitForTimeout(1500);
        await dismissStatusModal();
        await safeNextClick();
        trackMilestone('Line Selections Tab Navigation Completed');

        await page.getByTitle('Edit Location').click();
        await dismissStatusModal();
        await clickIfExists('Yes');
        await page.locator('#txtLocationStreet2').fill('Apt 101');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        await page.locator('#btnVerifyAddress').click();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await clickIfExists('Ok');
        await clickIfExists('Use Suggested');
        await clickIfExists('Accept As-Is');
        await clickIfExists('Continue');
        await clickIfExists('Save');

        await page.waitForTimeout(200);
        await safeNextClick();
        trackMilestone('Locations tab Navigation Completed');

        await page.waitForTimeout(1500);
        await dismissStatusModal();
        await safeNextClick();


        //await page.waitForLoadState('domcontentloaded');
        //await page.waitForLoadState('networkidle').catch(() => { });
        //await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
        //await dismissStatusModal();

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await dismissStatusModal();
        await safeNextClick();
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();
        await safeNextClick();
        trackMilestone('CP - Commercial Property tab navigation Completed');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await dismissStatusModal();

        // Confirmed live on Training/DE: this "Edit Location" click failed
        // with a 120s timeout because #dgic-modal-clcpplocationaddress was
        // ALREADY open and intercepting pointer events on the button itself -
        // left over from the earlier general-Locations "Edit Location" cycle
        // above, whose only close signal was a best-effort clickIfExists('Save')
        // with no wait for the modal to actually finish hiding. Wait for any
        // stray modal to clear before attempting this second, CP-specific
        // location edit rather than assuming the page is clean.
        const staleLocationModal = page.locator('#dgic-modal-clcpplocationaddress, .modal.show');
        if (await staleLocationModal.first().isVisible().catch(() => false)) {
            console.log('CP Locations: a location modal was still open - waiting for it to close before Edit Location');
            await staleLocationModal.first().waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
                console.log('CP Locations: stale modal did not close in time - forcing it closed');
                await clickIfExists('Save');
                await clickIfExists('Close');
                await clickIfExists('Cancel');
            });
        }

        await page.getByTitle('Edit Location').click();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await safeSaveClick('Save Location');
        await safeNextClick();
        trackMilestone('CP - Locations tab navigation Completed');

        await processAllAddCoverageButtons(page);
        await dismissStatusModal();
        await safeNextClick();

        await page.locator('button').filter({ hasText: 'Add Building' }).click();
        await page.locator('a.dropdown-item').filter({ hasText: 'Location 1:' }).nth(1).click();
        await page.waitForTimeout(500);
        await page.locator('#txtBuildingDescription').fill('test desc');
        await page.locator('#txtClassDescription_displayAll > .input-group-text > .fas').click();
        await clickTextItem('Airports - Hangars with repairing or servicing');
        await page.waitForTimeout(1000);

        await page.locator('#ddlConstructionTypeToUse').selectOption({ label: 'Joisted Masonry' });
        await page.locator('#ddlConstructionTypeToUse').selectOption({ index: 2 });
        await page.waitForTimeout(200);
        await page.locator('button[data-id="ddlBuildingCodeClass"]').click();

        await page.getByRole('listbox')
            .getByRole('option')
            .filter({ hasNotText: 'Nothing selected' })
            .first()
            .click();
        await page.waitForTimeout(200);
        await page.locator('#txtNumberOfStories').fill('15');

        await page.waitForTimeout(200);
        await page.locator('#txtYearOfConstruction').fill('2015');
        await page.waitForTimeout(1500);
        await dismissStatusModal();
        await safeNextClick();

        // ── Estimator ─────────────────────────────────────────────────────────
        const estimatorOpened = await clickEstimatorAndWait();

        const sourceInput = page.locator('#xtxt_EstimatedReplacementCost');
        const limit52Input = page.locator('#txt_CP7Limit52_integerWithCommas');

        let numericValue = '1000000';
        if (estimatorOpened) {
            // The live UI can present EITHER the newer Verisk360 Valuation modal
            // (generic unlabeled inputs inside #dgic-modal-editverisk360valuation)
            // OR the older single-page estimator fields
            // (#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL etc). Detect which one
            // actually opened instead of assuming the old fields - blindly
            // skipping the fill-and-close sequence when the Verisk360 modal is
            // the one open left it sitting on screen with unanswered required
            // fields, silently blocking every click behind it (including the
            // Next/Save button on this page) until the 120s wait finally timed
            // out. Confirmed live via logs/package-PA.log.
            const verisk360Modal = page.locator('#dgic-modal-editverisk360valuation');
            const oldEstimatorFld = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
            // Confirmed live (user watching the real browser, on BOP): the
            // modal can open and then close itself almost immediately before
            // any field gets filled - a single isVisible(timeout) check right
            // after the click can straddle that open/close window and wrongly
            // report "never opened". Poll for a few seconds and confirm it's
            // still there a beat later instead of trusting one snapshot.
            let isVerisk360 = false;
            let isOldEstimator = false;
            const detectDeadline = Date.now() + 8000;
            while (Date.now() < detectDeadline && !isVerisk360 && !isOldEstimator) {
                const v360 = await verisk360Modal.isVisible().catch(() => false);
                const old = await oldEstimatorFld.isVisible().catch(() => false);
                if (v360 || old) { isVerisk360 = v360; isOldEstimator = !v360 && old; break; }
                await page.waitForTimeout(300);
            }
            if (isVerisk360) {
                await page.waitForTimeout(600);
                const stillOpen = await verisk360Modal.isVisible().catch(() => false);
                if (!stillOpen) {
                    console.log('Verisk360 modal closed itself within ~600ms of opening');
                    isVerisk360 = false;
                }
            }

            if (isVerisk360) {
                console.log('Verisk360 Valuation modal detected');

                const totalSqFt = verisk360Modal.locator('input').first();
                await totalSqFt.waitFor({ state: 'visible', timeout: 5000 });
                const okTotal = await setNumericVerified(totalSqFt, '999', 'Verisk360 Total Sq. Ft.');

                const useInput = verisk360Modal.locator('input').nth(1);
                await useInput.waitFor({ state: 'visible', timeout: 5000 });
                const okUse = await selectUseVerified(
                    useInput, 'Apartment', 'Apartment / Condominium', 'Verisk360 Use'
                );

                await page.keyboard.press('Escape').catch(() => { });
                await page.waitForTimeout(600);

                let primarySqFt = verisk360Modal.locator(
                    'input[placeholder*="Primary" i], input[aria-label*="Primary" i], ' +
                    'input[id*="Primary" i], input[name*="Primary" i]'
                ).first();
                if (!(await primarySqFt.isVisible({ timeout: 2000 }).catch(() => false))) {
                    primarySqFt = verisk360Modal.locator('input[type="text"]:visible').last();
                }
                if (await primarySqFt.isVisible({ timeout: 5000 }).catch(() => false)) {
                    await setNumericVerified(primarySqFt, '999', 'Verisk360 Primary Sq. Ft.');
                }

                if (!okTotal || !okUse) {
                    console.log(`Verisk360 screen-1 fields incomplete - Total:${okTotal} Use:${okUse} - will still try to close`);
                }

                const continueVerisk = verisk360Modal.locator('button:has-text("CONTINUE"), button:has-text("Continue")').first();
                if (await continueVerisk.isVisible({ timeout: 10000 }).catch(() => false)) {
                    await continueVerisk.click();
                    await page.waitForTimeout(300);
                }

                // Screen 2 - "Structure Options": Construction Class defaults to
                // "Unknown", which CALCULATE NOW rejects with:
                // "The Estimator returned an Unknown construction type, which
                // is not a valid selection. Please reopen the Estimator and
                // select a valid Construction Class before importing."
                // Confirmed live via screenshot - fix it before proceeding,
                // and skip the rest of the wizard entirely if it can't be
                // fixed, since Calculate Now is guaranteed to reproduce the
                // same error otherwise.
                const constructionClassOk = await selectConstructionClassVerified();

                let importClicked = false;
                if (constructionClassOk) {
                    const calculateBtn = verisk360Modal.locator('button:has-text("CALCULATE NOW"), button:has-text("Calculate Now")').first();
                    if (await calculateBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
                        await calculateBtn.click();
                        await page.waitForTimeout(300);
                        console.log('Verisk360 CALCULATE NOW clicked');
                    } else {
                        console.log('Verisk360 CALCULATE NOW button never appeared - Construction Class selection may not have registered with the app');
                    }

                    // Widened from 15s - confirmed live that Calculate Now's
                    // own processing (screen 2 -> 3) can take longer than
                    // that under load; BOP succeeded with the same 15s twice
                    // in a row, but CP has stalled here at least once.
                    const finishBtn = verisk360Modal.locator('button:has-text("FINISH"), button:has-text("Finish")').first();
                    if (await finishBtn.isVisible({ timeout: 25000 }).catch(() => false)) {
                        await finishBtn.click();
                        await page.waitForTimeout(300);
                        console.log('Verisk360 FINISH clicked');
                    } else {
                        const modalDiag = await verisk360Modal.evaluate(el => ({
                            text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
                            buttons: [...el.querySelectorAll('button')]
                                .filter(b => b.offsetParent !== null)
                                .map(b => (b.textContent || '').trim()).filter(Boolean),
                        })).catch(() => ({ text: '(modal not found)', buttons: [] }));
                        console.log('Verisk360 FINISH button never appeared after CALCULATE NOW - modal state: ' + JSON.stringify(modalDiag));
                    }

                    const importBtn = page.locator('button:has-text("Import Data")').first();
                    if (await importBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
                        await importBtn.click();
                        importClicked = true;
                        console.log('Verisk360 Import Data clicked');
                    } else {
                        console.log('Verisk360 Import Data button never appeared after FINISH');
                    }
                } else {
                    console.log('Skipping CALCULATE NOW/FINISH/Import Data - Construction Class still invalid, would fail validation');
                }

                await verisk360Modal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { });

                if (importClicked) {
                    const importedOk = await waitForPropertyInformationFound(45000);
                    console.log(importedOk
                        ? 'Property Information Found - Import Data succeeded'
                        : 'Property Information still shows Not Found after 45s - Import Data likely failed');
                }

                // Import Data can leave the modal up if any of the buttons above
                // were missed - force it closed rather than letting every click
                // downstream (including Save Building's Next button) inherit the
                // same 120s dead wait.
                await closeAnyBlockingDialog();
                await dismissStatusModal();
                console.log('Verisk360 flow completed');

            } else if (isOldEstimator) {
                console.log('Old estimator detected');
                await oldEstimatorFld.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.keyboard.type('999');
                await page.keyboard.press('Tab');
                await page.waitForTimeout(500);
                await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
                await page.getByText('Apartment / Condominium').click();
                await page.getByRole('button', { name: 'Continue' }).click();
                await page.getByRole('button', { name: 'Calculate Now' }).click();
                await page.getByRole('button', { name: 'Finish' }).click();
                await page.waitForTimeout(500);
                await page.getByRole('button', { name: 'Import Data' }).click();
                await page.waitForTimeout(1000);
                const importedOkOld = await waitForPropertyInformationFound(45000);
                console.log(importedOkOld
                    ? 'Property Information Found - Import Data succeeded'
                    : 'Property Information still shows Not Found after 45s - Import Data likely failed');
                await closeAnyBlockingDialog();
                console.log('Old estimator completed');
            } else {
                console.log('Estimator link opened but neither Verisk360 modal nor old estimator fields were found - closing anything left open');
                await closeAnyBlockingDialog();
            }

            const sourceVisible = await waitForVisible(sourceInput, 5000);
            if (sourceVisible) {
                const rawValue = await sourceInput.inputValue();
                const cleaned = rawValue.replace(/,/g, '').trim();
                // The field being VISIBLE does not mean the estimator actually
                // populated it - when Import Data never really ran (e.g. the
                // modal was force-closed after a stuck validation error), this
                // read back an empty string, which overwrote the safe fallback
                // with a BLANK building limit instead of leaving 1000000 in
                // place. Confirmed live: "Estimated Replacement Cost:  -> " /
                // "Building Limit set: " (both blank) in logs/cp-fix-verify2.log.
                if (cleaned && Number(cleaned) > 0) {
                    numericValue = cleaned;
                    console.log(`Estimated Replacement Cost: ${rawValue} -> ${numericValue}`);
                } else {
                    console.log(`Estimated Replacement Cost field visible but empty ("${rawValue}") - keeping fallback ${numericValue}`);
                }
            } else {
                console.log(`Estimated Replacement Cost field not visible, using fallback ${numericValue}`);
            }
        } else {
            console.log('Estimator did not open - using fallback limit 1000000');
        }

        await closeAnyBlockingDialog();
        await limit52Input.waitFor({ state: 'visible', timeout: 10000 });
        await fillIntegerField(limit52Input, numericValue);
        console.log(`Building Limit set: ${numericValue}`);

        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        //await processAllAddCoverageButtons(page);
        //await dismissStatusModal();

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);

        // ── Close lingering modal ─────────────────────────────────────────────────
        try {
            const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
            if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('Closing lingering schedule dialog modal...');

                const modalBtns = modal.locator('button');
                const btnCount = await modalBtns.count();
                let closed = false;
                for (let i = 0; i < btnCount && !closed; i++) {
                    try {
                        await modalBtns.nth(i).click({ force: true, timeout: 3000 });
                        await page.waitForTimeout(800);
                        if (!await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
                            console.log('Modal closed via button click');
                            closed = true;
                        }
                    } catch (e) { }
                }

                if (!closed) {
                    for (let i = 0; i < 3; i++) {
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(300);
                    }
                    if (!await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
                        console.log('Modal closed via Escape');
                        closed = true;
                    }
                }

                if (!closed) {
                    console.log('Modal still open - force removing from DOM...');
                    await page.evaluate(() => {
                        const m = document.getElementById('dgic-modal-clpropertyaddlcoveragesscheduledialog');
                        if (m) m.remove();
                        document.querySelectorAll('.modal-backdrop, .ui-widget-overlay').forEach(el => el.remove());
                        document.body.classList.remove('modal-open');
                        document.body.style.removeProperty('overflow');
                        document.body.style.removeProperty('padding-right');
                    });
                    await page.waitForTimeout(500);
                    console.log('Modal force-removed from DOM');
                }
            }
        } catch (e) { console.log('Modal close attempt: ' + e.message); }

        await dismissStatusModal();
        await page.waitForTimeout(300);

        // ── Business Income ───────────────────────────────────────────────────
        //await safeSaveClick('Save Building & Add Business');
        const saveBuildingBtn = page.locator('#btnNext_CLPackageBuildingAdditionalCoverages');

        await saveBuildingBtn.waitFor({ state: 'visible' });
        await saveBuildingBtn.click();

        //await page.waitForLoadState('domcontentloaded');
        //await page.waitForTimeout(2500);
        //await page.locator('#txtBusinessIncomeDescription').fill('test desc');
        //await page.waitForTimeout(1200);
        //await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
        //await page.waitForTimeout(1200);
        //await page.locator('#bs-select-2-1').click();
        //await page.waitForTimeout(200);
        //await page.locator('#xrgn_TypeOfRisk_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
        //await page.waitForTimeout(1200);
        //await page.locator('#bs-select-6-0').click();
        //await page.waitForTimeout(1500);
        //await dismissStatusModal();
        //await safeNextClick();

        //const limit53Input = page.locator('#txt_CP7Limit53_integerWithCommas');
        //await limit53Input.waitFor({ state: 'visible', timeout: 10000 });
        //await fillIntegerField(limit53Input, '155666');

        //await processCoverageDropdowns(page);
        //await page.waitForTimeout(1500);

        //await dismissStatusModal();
        //await safeNextClick();
        //await processAllAddCoverageButtons(page);
        //await dismissStatusModal();

        //const saveBusinessIncomeBtn = page.locator('#btnNext_CLPropertyBuildingBusinessIncomeAdditionalCoverages');
        //await saveBusinessIncomeBtn.waitFor({ state: 'visible', timeout: 30000 });
        //await safeClick(saveBusinessIncomeBtn);
        //await dismissStatusModal();

        // ── Occupancy ─────────────────────────────────────────────────────────
        await page.getByTitle('Add Occupancy Building').click();
        await page.waitForLoadState('domcontentloaded');
        // Shrunk from 2500ms - the txtOccupancyDescription wait below already polls up to 15s.
        await page.waitForTimeout(500);
        await dismissStatusModal();
        await page.locator('#txtOccupancyDescription').waitFor({ state: 'visible', timeout: 15000 });
        await page.locator('#txtOccupancyDescription').fill('occupancy desc');
        await page.locator('#txtSquareFootage').fill('15656');
        await page.getByText('Occupancy Details Location').click();
        await page.locator('button[data-id="ddlSprinkler"]').click();
        await page.locator('.dropdown-menu').getByText('Sprinklered Building, but Not Rated as Sprinklered').click();
        await dismissStatusModal();
        await safeNextClick();
        await page.locator('button[data-id="ddlOccupancyCategory"]').click();
        await page.locator('.dropdown-menu.show').getByText('Residential Apartments and Condominiums', { exact: true }).click();
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(500);

        const saveOccBtn = page.locator('#btnNext_CLPropertyBuildingOccupancyCoverages');
        await expect(saveOccBtn).toBeVisible();
        await expect(saveOccBtn).toBeEnabled();
        await safeClick(saveOccBtn);
        await dismissStatusModal();

        // ── Personal Property ─────────────────────────────────────────────────
        await page.waitForTimeout(200);
        await page.getByTitle('Add Personal Property').click();
        await page.waitForTimeout(500);
        await page.locator('#txtPersonalPropertyDescription').fill('Personal property description');
        await dismissStatusModal();
        await safeNextClick();

        const limit54Input = page.locator('#txt_CP7Limit54_integerWithCommas');
        await limit54Input.waitFor({ state: 'visible', timeout: 10000 });
        await fillIntegerField(limit54Input, '156566');

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();
        await safeNextClick();
        await safeClick(page.locator('#btnNext_CLPropertyBuildingPersonalPropertyAdditionalCoverages'));
        await dismissStatusModal();
        await safeNextClick();
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();

        // ── Attention dialog ──────────────────────────────────────────────────
        const attentionHeading = page.getByRole('heading', { name: 'Attention' });
        try {
            // Shrunk from 5000ms - this is an optional dialog that either appears
            // right away or not at all, same fix as clickIfExists elsewhere.
            await attentionHeading.waitFor({ state: 'visible', timeout: 1500 });
            console.log('Attention dialog found');
            await page.getByRole('button', { name: ' Close' }).click();
            await page.getByTitle('Edit Building').click();

            const urlBefore = page.url();
            await page.getByRole('button', { name: 'Next ' }).click({ timeout: 5000 }).catch(() => { });
            await page.waitForTimeout(200);

            if (page.url() !== urlBefore) {
                console.log('Next button successful after Attention dialog');
                await page.waitForLoadState('domcontentloaded');
                await page.waitForLoadState('networkidle').catch(() => { });
            } else {
                console.log('Next failed, running recovery');
                await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue')
                    .getByRole('combobox', { name: 'Nothing selected' })
                    .click();

                await page.getByRole('listbox')
                    .getByRole('option')
                    .filter({ hasNotText: 'Nothing selected' })
                    .first()
                    .click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);
                await safeClick(page.locator('#btnNext_CLPropertyBuildingDetails'));
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);
                await safeNextClick();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(200);
                await safeClick(page.locator('#btnNext_CLPackageBuildingAdditionalCoverages'));
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(200);
                await safeNextClick();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForLoadState('networkidle').catch(() => { });
                console.log('Recovery complete, URL:', page.url());
            }
        } catch {
            console.log('Attention dialog not found, skipping');
        }

        // ── Special Classes ───────────────────────────────────────────────────
        const addSpecialClassOption = page.locator('div.filter-option-inner-inner')
            .filter({ hasText: /Special Class|Add Special/ }).first();
        const dropdownVisible = await waitForVisible(addSpecialClassOption, 10000);

        if (!dropdownVisible) {
            console.log('Add Special Class option not found, skipping');
        } else {
            await addSpecialClassOption.scrollIntoViewIfNeeded();
            await addSpecialClassOption.click();
            await page.locator('#bs-select-1-0').click();
            await page.locator('#txtNewSpecialClassDescription').waitFor({ state: 'visible', timeout: 8000 });
            await page.locator('#txtNewSpecialClassDescription').fill('Special Class Description');
            await page.locator('button[data-id="ddlCovForm"]').click();
            await page.locator('.dropdown-menu.show a[role="option"]')
                .filter({ hasText: 'Building and Personal Property Coverage Form' })
                .waitFor({ state: 'visible', timeout: 5000 });
            await page.locator('.dropdown-menu.show a[role="option"]')
                .filter({ hasText: 'Building and Personal Property Coverage Form' }).click();

            const lookupTrigger = page.locator('#txtSpecialClassesClassificationDescriptions_displayAll');
            await lookupTrigger.waitFor({ state: 'visible', timeout: 5000 });
            await lookupTrigger.click();
            const firstResultRow = page.locator('#txtSpecialClassesClassificationDescriptions_resultsTable tbody tr').first();
            await firstResultRow.waitFor({ state: 'visible', timeout: 8000 });
            await firstResultRow.click();

            const basicSymbolDropdown = page.locator('button[data-id="ddlBasicSymbolNumber"]');
            if (await basicSymbolDropdown.count() > 0) {
                const isEnabled = await waitForEnabled(basicSymbolDropdown, 8000);
                if (!isEnabled) {
                    console.log('Basic Symbol Number stayed disabled, skipping');
                } else {
                    await basicSymbolDropdown.click();
                    const menuId = await basicSymbolDropdown.getAttribute('aria-owns');
                    const optionSel = menuId ? `#${menuId} [role="option"]` : '#bs-select-8 [role="option"]';
                    const firstOpt = page.locator(optionSel).first();
                    await firstOpt.waitFor({ state: 'visible', timeout: 5000 });
                    await firstOpt.click();
                    console.log('Basic Symbol Number selected');
                }
            }
            await page.waitForLoadState('networkidle').catch(() => { });
            // Per live observation: this Details screen stays on-screen
            // noticeably longer than networkidle alone suggests before it is
            // actually ready for Next to be clicked.
            await page.waitForTimeout(1000);
        }

        // ── Special Class Coverages ───────────────────────────────────────────
        // Widened per live observation: both the Special Class Details ->
        // Coverages transition and the Coverages screen's own Limit field
        // consistently need more settle time than a bare 200ms after
        // networkidle - Guidewire's polling/delayed rendering here is not
        // fully captured by the networkidle event.
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForTimeout(1500);
        await dismissStatusModal();

        const limit19Input = page.locator('#txt_CP7Limit19_integerWithCommas');
        await limit19Input.waitFor({ state: 'visible', timeout: 30000 });
        await fillIntegerField(limit19Input, '165666');

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await safeClick(page.locator('#btnNext_CLPackageSpecialClassAdditionalCoverages'));
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeContinueClick();

        console.log('Commercial property package data entered successfully.');
        trackMilestone('Commercial Property Package Completed');

        // ── General Liability ─────────────────────────────────────────────────
        console.log('General Liability data entry started.');
        await safeNextClick();
        await safeNextClick();
        await safeNextClick();
        await clickIfExists('Close');

        await page.getByRole('row')
            .filter({ hasText: 'Employment Practices Liability Insurance Coverage Endorsement' })
            .locator('button[data-action="Edit"]').click();

        const limit51Input = page.locator('#txtzh4h8eu1sdr3q3h40nqv6fdk65a_integerWithCommas');
        await limit51Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit51Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(200);
        await limit51Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        await page.keyboard.type('150');
        await page.waitForTimeout(200);
        await limit51Input.blur();
        await page.waitForTimeout(1500);

        const today = new Date();
        const currentMonthLastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        const twoMonthsLastDay = twoMonthsLater.getDate();
        await page.locator('.input-group-text').first().click();
        await page.getByRole('cell', { name: String(currentMonthLastDay) }).last().click();
        await page.locator('#xrgn_zgni6as6fl4tt7q4qkleqpts9jaValue > .ui-xcontrols > .input-group-append > .input-group-text > .fas').click();
        await page.getByTitle('Next Month').click();
        await page.getByRole('cell', { name: String(twoMonthsLastDay) }).last().click();
        await page.locator('#CLGLAdditionalCoveragesScheduleDialog_dialog_btn_0').click();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();

        if (page.url().includes('CLGLAdditionalCoverages.aspx')) {
            console.log('Additional Coverages page detected');
            await safeNextClick();
            await page.waitForLoadState('domcontentloaded');
        }

        await page.waitForTimeout(500);
        await clickIfExists('Close');
        await dismissStatusModal();

        try {
            const locationDropdown = page.locator('button[data-id="ddlAddLocation"]');
            // Shrunk from 5000ms - this GL Locations section is optional (not
            // present for every state/product combo), same fix as clickIfExists.
            await locationDropdown.waitFor({ state: 'visible', timeout: 1500 });
            await locationDropdown.click();
            const menu = page.locator('ul.dropdown-menu.inner.show');
            await menu.waitFor({ state: 'visible', timeout: 5000 });
            await menu.locator('li').filter({ hasText: /^1:/ }).first().click();
            console.log('GL location added');
            await safeNextClick();
        } catch { console.log('GL Locations section not present, skipping'); }

        await page.locator('#btnAddExposure').click();
        await page.getByRole('combobox', { name: 'Select Location' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.getByRole('combobox', { name: 'Select Class Code' }).click();
        await page.locator('#bs-select-2-1').click();
        await page.locator('#txtExposure_Prem').fill('166');
        await dismissStatusModal();
        await safeNextClick();
        await dismissStatusModal();
        await safeNextClick();
        await safeClick(page.getByRole('button', { name: 'Save Exposure ' }));

        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeContinueClick();
        console.log('General Liability data entered successfully.');
        trackMilestone('General Liability Completed');

        // ── Inland Marine ─────────────────────────────────────────────────────
        console.log('Inland Marine data entry started.');
        await page.getByRole('combobox', { name: 'Add New Form' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.waitForTimeout(200);
        await page.getByRole('combobox', { name: 'Select Location' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.waitForTimeout(200);
        await page.getByRole('combobox', { name: 'None' }).click();
        await page.locator('#bs-select-2-1').click();
        await page.waitForTimeout(5000);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);

        const imLimit1 = page.locator('#txt_z5mh4r37u1gomc1gru4e21al9ha_integerWithCommas');
        await imLimit1.waitFor({ state: 'visible', timeout: 20000 });
        await fillIntegerField(imLimit1, '165666');

        const imLimit2 = page.locator('#txt_z66jk360ek2gv3redungtmut688_integerWithCommas');
        await imLimit2.waitFor({ state: 'visible', timeout: 20000 });
        await fillIntegerField(imLimit2, '5000');

        const imLimit3 = page.locator('#txt_zv2ikdh26eivu9n0pgub3ph6k19_integerWithCommas');
        await imLimit3.waitFor({ state: 'visible', timeout: 20000 });
        await fillIntegerField(imLimit3, '1000');

        const imLimit4 = page.locator('#txt_znrjmb0kmf659ck5liulv1qj6rb_integerWithCommas');
        await imLimit4.waitFor({ state: 'visible', timeout: 20000 });
        await fillIntegerField(imLimit4, '500');

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await safeClick(page.getByRole('button', { name: 'Save Form' }));
        await page.waitForTimeout(200);
        await clickIfExists('Close');
        await page.waitForTimeout(500);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await safeContinueClick();
        await page.waitForTimeout(3000);
        console.log('Inland Marine data entered successfully.');
        trackMilestone('Inland Marine Completed');

        // ── Crime ─────────────────────────────────────────────────────────────
        console.log('Crime data entry started.');
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
        await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
        await dismissStatusModal();
        await safeNextClick();
        await page.locator('#txtTotalNumberRatableEmployees').fill('15');
        await page.locator('#txtTotalNumberERISAPlanOfficials').fill('02');
        await page.locator('#xrgn_PredominantActivityValue')
            .getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.locator('#bs-select-6-1').click();
        await page.waitForTimeout(1500);
        await page.locator('.fas.fa-th').click();
        await page.waitForTimeout(200);

        const carWashCell = page.getByRole('gridcell', { name: /Car washes/ });
        await carWashCell.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
            console.log('Car washes gridcell not found');
        });
        if (await carWashCell.count() > 0) await carWashCell.click();
        else await clickTextItem(/Car washes/);

        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await dismissStatusModal();
        await safeNextClick();
        await dismissStatusModal();
        await safeContinueClick();
        await page.waitForTimeout(200);
        await page.locator('#for_xrdo_Question_Form_CPPUnderwritingQuestion_Ext_0_CPPBestInfoByApplicant_Ext_Yes').click();
        console.log('Crime data entered successfully.');
        trackMilestone('Crime Completed');

        await dismissStatusModal();
        await safeContinueClick();

        // Click Close as soon as it appears - don't wait for page load states first
        // The "Attention: Your quote is in progress" dialog appears async after Continue
        // and networkidle hangs on WB's background polling, causing unnecessary delay
        console.log('Waiting for Close button...');
        const closeButton = page.getByRole('button', { name: 'Close' });

        let closeDone = false;
        try {
            await closeButton.waitFor({ state: 'visible', timeout: 90000 });
            console.log('Close button visible - clicking immediately...');

            for (let attempt = 1; attempt <= 4 && !closeDone; attempt++) {
                try {
                    await dismissStatusModal();
                    await closeButton.click({ timeout: 10000 });
                    closeDone = true;
                    console.log('Close clicked successfully');
                } catch (e) {
                    console.log(`Close click attempt ${attempt} failed: ${e.message.split('\n')[0]}`);
                    await page.waitForTimeout(500);
                }
            }
            if (!closeDone) {
                await closeButton.click({ force: true });
                console.log('Close clicked (force)');
            }
        } catch (e) {
            console.log('WARNING: Close button not found after 90s - proceeding to quote table check');
        }

        // Wait for quote table to appear - this is the real signal that rating started
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await dismissStatusModal();

        const quoteTableVisible = await page.locator('#tblQuotes tbody tr').first()
            .waitFor({ state: 'visible', timeout: 30000 })
            .then(() => true)
            .catch(() => false);

        if (!quoteTableVisible) {
            console.log('Quote table not visible - reloading page...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);
        }

        // ── Quote polling ─────────────────────────────────────────────────────
        const quoteNumber = (await page.locator('#tblQuotes tbody tr').first()
            .locator('td').nth(3).innerText()).trim();
        console.log('Captured Quote Number:', quoteNumber);

        async function dismissNotification() {
            try {
                const btn = page.locator('button.wb-bell-btn-ack');
                if (await btn.isVisible({ timeout: 2000 })) {
                    await btn.click();
                    await btn.waitFor({ state: 'hidden', timeout: 3000 });
                }
            } catch { }
        }

        async function getStatus() {
            try {
                await dismissNotification();
                const row = page.locator(`#tblQuotes tbody tr:has-text("${quoteNumber}")`);
                await row.waitFor({ state: 'visible', timeout: 5000 });
                return (await row.locator('td').nth(11).innerText({ timeout: 5000 })).trim();
            } catch (e) {
                console.warn(`getStatus() transient error: ${e.message}`);
                return 'Quote Requested';
            }
        }

        // Graduated backoff: check quickly at first (rating often finishes
        // fast), then back off to avoid hammering the server on slow
        // ratings. Previously a flat 10s between every attempt, so a quote
        // that was ready 1s after a check still took up to 10s to be noticed.
        function nextPollDelayMs(attemptNum) {
            if (attemptNum <= 3) return 3000;
            if (attemptNum <= 6) return 2000;
            if (attemptNum <= 10) return 1000;
            return 10000;
        }

        let status = await getStatus();
        let attempts = 0;
        console.log('Initial Status:', status);

        // "Draft" is a valid transient pre-rating state, same as "Quote
        // Requested" - the quote row can appear in the table before the
        // backend has finished transitioning it out of Draft. Treating only
        // "Quote Requested" as "keep polling" meant a first read landing on
        // "Draft" (confirmed live: "Quote did not reach 'Quoted' after 0
        // attempts. Final: 'Draft'") skipped the loop entirely and failed
        // immediately instead of waiting like it should have.
        while ((status === 'Quote Requested' || status === 'Draft') && attempts < 50) {
            attempts++;
            const delay = nextPollDelayMs(attempts);
            console.log(`Attempt ${attempts}/50: waiting ${delay / 1000}s...`);
            await page.waitForTimeout(delay);
            await page.reload();
            await page.waitForLoadState('networkidle').catch(() => { });
            await dismissNotification();
            status = await getStatus();
            console.log(`Attempt ${attempts} status: "${status}"`);
        }

        if (status !== 'Quoted')
            throw new Error(`Quote did not reach "Quoted" after ${attempts} attempts. Final: "${status}"`);

        console.log('Quote is now Quoted');
        trackMilestone('Quote Rated Successfully', 'PASSED', `Quote #: ${quoteNumber}`);

        global.testData.quoteNumber = quoteNumber;
        saveTestData();

        console.log('Starting policy submission workflow...');
        const policyNumber = await submitPolicyForApproval(page, quoteNumber, { policyCenterUrl, trackMilestone });

        global.testData.policyNumber = policyNumber;
        global.testData.status = 'PASSED';
        saveTestData();
        console.log('Test completed successfully. Policy:', policyNumber);

    } catch (error) {
        testFailed = true;
        console.error('Test execution failed:', error.message);
        console.error('Stack:', error.stack);

        try {
            const pageText = await page.locator('body').textContent({ timeout: 2000 }).catch(() => '');
            const match = pageText.match(/\b(\d{10})\b/);
            if (match) {
                global.testData.quoteNumber = match[1];
                console.log(`Extracted number from page: ${match[1]}`);
            }
        } catch { }

        global.testData.status = 'FAILED';
        global.testData.error = error.message;
        saveTestData();
        console.log(`Test data written with failure info`);
        throw error;
    }
});
