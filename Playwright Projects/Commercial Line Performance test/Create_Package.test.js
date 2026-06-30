// Set suite type for email reporter
process.env.TEST_TYPE = 'PACKAGE';

const { test, expect } = require('@playwright/test');

const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./helpers/coverageHelpers');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }, testInfo) => {
    test.setTimeout(1200000);
    page.setDefaultTimeout(120000);

    const envName = process.env.TEST_ENV || 'qa';
    const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

    const allowedStates = Object.keys(STATE_CONFIG);
    let testState = (process.env.TEST_STATE || 'DE').toUpperCase();
    if (!allowedStates.includes(testState)) {
        console.log(`WARNING: TEST_STATE "${testState}" not allowed; defaulting to DE`);
        testState = 'DE';
    }
    const stateConfig = getStateConfig(testState);
    console.log(`Running test for state: ${testState} (${stateConfig.name})`);

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

    const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
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
            if (['xhr', 'fetch'].includes(response.request().resourceType()) || /api|service|rest|json/i.test(url))
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
                path.join(__dirname, `test-data-${testState}.json`),
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
        const fallback = page.locator(`text="${text}"`).first();
        await fallback.waitFor({ state: 'visible', timeout: 10000 });
        await fallback.click({ force: true });
    }

    global.testData.retryCount = testInfo.retry || 0;
    currentStepStartTime = new Date();
// ── Modal / status dismissal (fast path when nothing visible) ──────────────
    async function dismissStatusModal() {
        const statusModal = page.locator('#dgic-status-message');
        // Quick check with near-zero timeout - don't wait 1500ms if it's simply not there
        const isVisible = await statusModal.isVisible().catch(() => false);
        if (!isVisible) return;

        console.log('Status modal visible - dismissing...');
        const btn = statusModal.locator('button').first();
        if (await btn.count() > 0) await btn.click({ force: true }).catch(() => {});
        await statusModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    async function waitForModalsToClose() {
        await dismissStatusModal();
        // Only check other modals if they're actually present in DOM (count > 0 is instant)
        const otherModals = [
            '.ui-widget-overlay',
            '#gw-click-overlay.gw-disable-click',
            '.gw-click-overlay',
            '#dgic-modal-clpropertyaddlcoveragesscheduledialog'
        ];
        for (const selector of otherModals) {
            const modal = page.locator(selector).first();
            const count = await modal.count().catch(() => 0);
            if (count === 0) continue; // skip instantly, no visibility check needed
            const isVisible = await modal.isVisible().catch(() => false);
            if (isVisible) await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
    }

    // ── Safe click helpers (single pass, fast when clear) ──────────────────────
    async function safeClick(locator, options = {}) {
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        await waitForModalsToClose();
        await locator.click(options);
    }

    async function safeNextClick() {
        const btn = page.getByRole('button', { name: 'Next ' });
        await btn.waitFor({ state: 'visible', timeout: 30000 });

        // Single modal check, not three
        await waitForModalsToClose();

        // Only poll for enabled if it's currently disabled - skip the wait entirely otherwise
        const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false);
        if (isDisabled) {
            await page.waitForFunction(() => {
                const candidates = Array.from(document.querySelectorAll('button'));
                const nextBtn = candidates.find(b =>
                    b.textContent.trim().startsWith('Next') && b.classList.contains('btn-primary')
                );
                return nextBtn ? !nextBtn.disabled && !nextBtn.classList.contains('disabled') : true;
            }, { timeout: 15000 }).catch(() => {});
            await waitForModalsToClose();
        }

        await btn.click();
    }

    async function safeContinueClick() {
        const btn = page.getByRole('button', { name: 'Continue ' });
        await btn.waitFor({ state: 'visible', timeout: 30000 });
        await waitForModalsToClose();
        await btn.click();
    }

    async function safeSaveClick(buttonName = 'Save') {
        const btn = page.getByRole('button', { name: buttonName });
        await btn.waitFor({ state: 'visible', timeout: 30000 });
        await waitForModalsToClose();
        await btn.click();
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
            await page.keyboard.type(numericValue, { delay: 100 });
            await page.waitForTimeout(300);
            await locator.blur();
            await page.waitForTimeout(1500);
    console.log(`Field filled via slow type(): ${numericValue}`);
        }
    }

    async function waitForVisible(locator, timeout = 5000) {
        return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
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
        await page.waitForTimeout(3000);

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

    try {

        async function clickIfExists(buttonName) {
            try {
                await dismissStatusModal();
                await page.getByRole('button', { name: buttonName }).click({ timeout: 5000 });
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
                    await page.evaluate(() => {
                        const el = document.querySelector('#chk_commercialpackage');
                        if (el) {
                            el.checked = true;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                    console.log('Commercial Package set via JS events (last resort)');
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
        await page.waitForTimeout(1500);
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
        await safeNextClick();
        await dismissStatusModal();

        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
        await dismissStatusModal();

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
        //await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);

        // 1. Select the Parent dropdown first
        // Change by exact text
        await page.locator('#ddlConstructionTypeToUse').selectOption({ label: 'Joisted Masonry' });

        // OR change by index (e.g., select the 3rd option in the list)
        await page.locator('#ddlConstructionTypeToUse').selectOption({ index: 2 });
        // Looks specifically inside the Building Code Class section
        // 1. Click the combobox to open the menu
        //await page.waitForLoadState('networkidle');
        await page.waitForTimeout(200);
        // 1. Target this exact button using its unique data-id and click it
        await page.locator('button[data-id="ddlBuildingCodeClass"]').click();

        // 2. Select the first real option from the open list, skipping the placeholder
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
        await limit52Input.waitFor({ state: 'visible', timeout: 10000 });

        let numericValue = '1000000';
        if (estimatorOpened) {
            const sqFt = page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL');
            if (await waitForVisible(sqFt, 5000)) {
                await sqFt.click({ clickCount: 3 });
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
            }

            const sourceVisible = await waitForVisible(sourceInput, 5000);
            if (sourceVisible) {
                const rawValue = await sourceInput.inputValue();
                numericValue = rawValue.replace(/,/g, '').trim();
                console.log(`Estimated Replacement Cost: ${rawValue} -> ${numericValue}`);
            } else {
                console.log('Estimated Replacement Cost field not visible, using fallback 1000000');
            }
        } else {
            console.log('Estimator did not open - using fallback limit 1000000');
        }

        await fillIntegerField(limit52Input, numericValue);
        console.log(`Building Limit set: ${numericValue}`);

        await dismissStatusModal();
        await safeNextClick();
        await page.waitForTimeout(200);
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);

        // ── Close lingering modal ─────────────────────────────────────────────
        // ── Close lingering modal ─────────────────────────────────────────────────
        try {
            const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
            if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('Closing lingering schedule dialog modal...');

                // Strategy 1: click first button inside the modal
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

                // Strategy 2: Escape key
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

                // Strategy 3: Force remove from DOM (nuclear option)
                if (!closed) {
                    console.log('Modal still open - force removing from DOM...');
                    await page.evaluate(() => {
                        // Remove the modal
                        const m = document.getElementById('dgic-modal-clpropertyaddlcoveragesscheduledialog');
                        if (m) m.remove();
                        // Remove any backdrops
                        document.querySelectorAll('.modal-backdrop, .ui-widget-overlay').forEach(el => el.remove());
                        // Remove modal-open class from body so scrolling works
                        document.body.classList.remove('modal-open');
                        document.body.style.removeProperty('overflow');
                        document.body.style.removeProperty('padding-right');
                    });
                    await page.waitForTimeout(500);
                    console.log('Modal force-removed from DOM');
                }
            }
        } catch (e) { console.log('Modal close attempt: ' + e.message); }

        // Double-check modal is gone before clicking Save Building
        await dismissStatusModal();
        await page.waitForTimeout(300);

        // ── Business Income ───────────────────────────────────────────────────
        await page.getByRole('button', { name: 'Save Building & Add Business' }).click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);
        await page.locator('#txtBusinessIncomeDescription').fill('test desc');
        await page.waitForTimeout(1200);
        await page.locator('#xrgn_Coverage_Form_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.waitForTimeout(1200);
        await page.locator('#bs-select-2-1').click();
        await page.waitForTimeout(200);
        await page.locator('#xrgn_TypeOfRisk_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.waitForTimeout(1200);
        await page.locator('#bs-select-6-0').click();
        await page.waitForTimeout(1500);
        await dismissStatusModal();
        await safeNextClick();

        const limit53Input = page.locator('#txt_CP7Limit53_integerWithCommas');
        await limit53Input.waitFor({ state: 'visible', timeout: 10000 });
        await fillIntegerField(limit53Input, '155666');

        await processCoverageDropdowns(page);
        // 1. Click the button to expand the dropdown menu
        await page.locator('button[data-id="ddl_CP7Coinsurance7"]').click();

        // 2. Click the first available option in the expanded listbox.
        // Bootstrap-select links the listbox via the aria-owns attribute ("bs-select-7")
        // We use nth(0) if the first option is the target, or nth(1) if the first is the "Nothing selected" placeholder.
        await page.locator('#bs-select-7 [role="option"]').nth(1).click();
        await page.waitForTimeout(1500);
        await dismissStatusModal();
        await safeNextClick();
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();

        const saveBusinessIncomeBtn = page.locator('#btnNext_CLPropertyBuildingBusinessIncomeAdditionalCoverages');
        await saveBusinessIncomeBtn.waitFor({ state: 'visible', timeout: 30000 });
        await saveBusinessIncomeBtn.click();
        await dismissStatusModal();

        // ── Occupancy ─────────────────────────────────────────────────────────
        await page.getByTitle('Add Occupancy Building').click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);
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
        await saveOccBtn.click();
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
        await page.locator('#btnNext_CLPropertyBuildingPersonalPropertyAdditionalCoverages').click();
        await dismissStatusModal();
        await safeNextClick();
        await processAllAddCoverageButtons(page);
        await dismissStatusModal();

        // ── Attention dialog ──────────────────────────────────────────────────
        const attentionHeading = page.getByRole('heading', { name: 'Attention' });
        try {
            await attentionHeading.waitFor({ state: 'visible', timeout: 5000 });
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
                // 1. Click specifically inside the Construction Type wrapper
                await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue')
                    .getByRole('combobox', { name: 'Nothing selected' })
                    .click();

                // 2. Click the first actual option in the dropdown list
                await page.getByRole('listbox')
                    .getByRole('option')
                    .filter({ hasNotText: 'Nothing selected' })
                    .first()
                    .click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);
                await page.locator('#btnNext_CLPropertyBuildingDetails').click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);
                await safeNextClick();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(200);
                await page.locator('#btnNext_CLPackageBuildingAdditionalCoverages').click();
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
        }

        // ── Special Class Coverages ───────────────────────────────────────────
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForTimeout(200);
        await dismissStatusModal();

        const limit19Input = page.locator('#txt_CP7Limit19_integerWithCommas');
        await limit19Input.waitFor({ state: 'visible', timeout: 20000 });
        await fillIntegerField(limit19Input, '165666');

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await dismissStatusModal();
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.locator('#btnNext_CLPackageSpecialClassAdditionalCoverages').click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
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
            await locationDropdown.waitFor({ state: 'visible', timeout: 5000 });
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
        await safeNextClick();
        await page.getByRole('button', { name: 'Save Exposure ' }).click();

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
        await page.getByRole('button', { name: 'Save Form' }).click();
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
        await page.getByRole('button', { name: 'Next ' }).click();
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
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await dismissStatusModal();
        await safeContinueClick();
        await page.waitForTimeout(200);
        await page.locator('#for_xrdo_Question_Form_CPPUnderwritingQuestion_Ext_0_CPPBestInfoByApplicant_Ext_Yes').click();
        console.log('Crime data entered successfully.');
        trackMilestone('Crime Completed');

        await dismissStatusModal();
        await safeContinueClick();
        await page.waitForTimeout(4000);

        const closeButton = page.getByRole('button', { name: 'Close' });
        await closeButton.waitFor({ state: 'visible', timeout: 60000 });
        await closeButton.click({ force: true });
        await page.waitForTimeout(5000);

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

        let status = await getStatus();
        let attempts = 0;
        console.log('Initial Status:', status);

        while (status === 'Quote Requested' && attempts < 50) {
            attempts++;
            console.log(`Attempt ${attempts}/50: waiting 10s...`);
            await page.waitForTimeout(10000);
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
