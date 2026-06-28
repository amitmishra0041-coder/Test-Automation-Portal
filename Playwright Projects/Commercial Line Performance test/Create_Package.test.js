// Set suite type for email reporter
process.env.TEST_TYPE = 'PACKAGE';

import { test, expect } from '@playwright/test';

const { randEmail, randCompany, randPhone, randFirstName, randLastName, randAddress, randCity, randZipCode, randSSN } = require('./helpers/randomData');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow');
const { getEnvUrls } = require('./helpers/envConfig');
const { STATE_CONFIG, getStateConfig, randCityForState, randZipForState } = require('./stateConfig');
const { createAccountAndQualify } = require('./accountCreationHelper');
const { processCoverageDropdowns, processAllAddCoverageButtons } = require('./helpers/coverageHelpers');
const fs = require('fs');
const path = require('path');

test('Package Submission', async ({ page }, testInfo) => {
    test.setTimeout(1200000); // 20 minutes total test timeout
    page.setDefaultTimeout(120000); // 120 seconds default timeout for all actions

    const envName = process.env.TEST_ENV || 'qa';
    const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

    const allowedStates = Object.keys(STATE_CONFIG);
    let testState = (process.env.TEST_STATE || 'DE').toUpperCase();
    if (!allowedStates.includes(testState)) {
        console.log(`⚠️ TEST_STATE "${testState}" not allowed; defaulting to DE`);
        testState = 'DE';
    }
    const stateConfig = getStateConfig(testState);
    console.log(`🗺️ Running test for state: ${testState} (${stateConfig.name})`);

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
    console.log(`✅ Initialized test data for ${testState} with N/A values`);

    page.on('response', async (response) => {
        try {
            const url = response.url();
            const status = response.status();
            const timing = response.timing();
            const startTime = timing && timing.startTime ? timing.startTime : null;
            const endTime = timing && timing.responseEnd ? timing.responseEnd : null;
            let duration = null;
            if (startTime && endTime) duration = (endTime - startTime) / 1000;
            else if (response.request().timing()) {
                const reqTiming = response.request().timing();
                if (reqTiming.startTime && reqTiming.responseEnd)
                    duration = (reqTiming.responseEnd - reqTiming.startTime) / 1000;
            }
            if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch' || /api|service|rest|json/i.test(url)) {
                global.testData.httpTimings.push({ url, status, duration, timestamp: new Date().toISOString() });
            }
            if (status >= 400) {
                global.testData.networkErrors.push({ url, status, timestamp: new Date().toISOString() });
            }
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
            const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
            fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
        } catch (e) {
            console.log('⚠️ Could not save test-data.json:', e.message);
        }
    }

    function trackMilestone(name, status = 'PASSED', details = '') {
        const now = new Date();
        let duration = null;
        if (currentStepStartTime) {
            const elapsedMs = now - currentStepStartTime - waitBudgetMs;
            duration = (Math.max(elapsedMs, 0) / 1000).toFixed(2);
        }
        const milestone = { name, status, timestamp: now, details, duration: duration ? `${duration}s` : null };
        global.testData.milestones.push(milestone);
        console.log(`${status === 'PASSED' ? '\u2705' : status === 'FAILED' ? '\u274c' : '\u23eb'} ${name}${duration ? ` (${duration}s)` : ''}`);
        saveTestData();
        currentStepStartTime = new Date();
        waitBudgetMs = 0;
    }

    async function clickTextItem(text) {
        const gridItem = page.getByRole('gridcell', { name: text }).first();
        if (await gridItem.count() > 0) {
            await gridItem.click();
            return;
        }
        const fallback = typeof text === 'string'
            ? page.locator(`text="${text}"`).first()
            : page.locator(`text=${text}`).first();
        await fallback.waitFor({ state: 'visible', timeout: 10000 });
        await fallback.click({ force: true });
    }

    global.testData.retryCount = testInfo.retry || 0;
    currentStepStartTime = new Date();

    async function waitForModalsToClose(timeout = 5000) {
        try {
            const modalSelectors = [
                '.modal.show',
                '#dgic-status-message',
                '.ui-widget-overlay',
                '#gw-click-overlay.gw-disable-click',
                '.gw-click-overlay',
                '#dgic-modal-clpropertyaddlcoveragesscheduledialog'
            ];
            for (const selector of modalSelectors) {
                const modal = page.locator(selector).first();
                if (await modal.count() > 0) {
                    await modal.waitFor({ state: 'hidden', timeout }).catch(() => { });
                }
            }
            await page.waitForLoadState('domcontentloaded').catch(() => { });
        } catch (e) { }
    }

    async function safeClick(locator, options = {}) {
        await waitForModalsToClose();
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        await locator.click(options);
    }

    // ─── Shared helpers (defined once, used throughout) ──────────────────────────

    // Returns true if locator becomes visible within timeout, false otherwise
    async function waitForVisible(locator, timeout = 5000) {
        return locator.waitFor({ state: 'visible', timeout })
            .then(() => true)
            .catch(() => false);
    }

    // Instant DOM presence check — no waiting
    async function exists(locator) {
        return (await locator.count()) > 0;
    }

    // Waits for a bootstrap-select button to shed its 'disabled' class/aria-disabled
    async function waitForEnabled(locator, timeout = 8000) {
        try {
            await locator.waitFor({ state: 'visible', timeout });
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                const isDisabled = await locator.evaluate(el =>
                    el.classList.contains('disabled') ||
                    el.getAttribute('aria-disabled') === 'true'
                );
                if (!isDisabled) return true;
                await new Promise(r => setTimeout(r, 200));
            }
            return false;
        } catch {
            return false;
        }
    }

    try {

        async function clickIfExists(buttonName) {
            try {
                const button = page.getByRole('button', { name: buttonName });
                await button.click({ timeout: 5000 });
                console.log(`✅ "${buttonName}" button clicked`);
            } catch (error) {
                console.log(`⏭️  "${buttonName}" button not present, skipping`);
            }
        }

        await createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone });

        await page.waitForTimeout(3000);
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });

        async function clickCommercialPackage() {
            const input = page.locator('#chk_commercialpackage').first();
            const label = page.locator('#for_chk_commercialpackage').first();
            try {
                if (await input.count() > 0 && await input.isVisible().catch(() => false)) {
                    await input.scrollIntoViewIfNeeded();
                    await input.click({ timeout: 10000 });
                    console.log('✅ Commercial Package checkbox clicked (input)');
                    return;
                }
                if (await label.count() > 0 && await label.isVisible().catch(() => false)) {
                    await label.scrollIntoViewIfNeeded();
                    await label.click({ timeout: 10000 });
                    console.log('✅ Commercial Package checkbox clicked (label)');
                    return;
                }
                const clicked = await page.evaluate(() => {
                    const el = document.querySelector('#chk_commercialpackage');
                    if (el) { el.click(); return true; }
                    const lbl = document.querySelector('#for_chk_commercialpackage');
                    if (lbl) { lbl.click(); return true; }
                    return false;
                });
                if (clicked) {
                    console.log('✅ Commercial Package checkbox clicked (JS evaluate)');
                    return;
                }
                throw new Error('Commercial package checkbox not found');
            } catch (e) {
                console.log('⚠️ Commercial package click fallback:', e.message);
                try {
                    if (await label.count() > 0) {
                        await label.waitFor({ state: 'attached', timeout: 10000 }).catch(() => { });
                        await label.click({ force: true });
                        console.log('✅ Commercial Package checkbox clicked (force)');
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
                    console.log('✅ Commercial Package checkbox set via JS events (last resort)');
                }
            }
            await page.waitForTimeout(500);
        }

        await clickCommercialPackage();
        await page.waitForTimeout(1500);

        await page.getByRole('button', { name: 'Next' }).click();
        await page.waitForTimeout(1500);

        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_ApplicantCPPLiabilityLossesInd_Ext_No"]').click();
        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_CPPCertificateQuestion_Ext_Yes"]').click();
        await page.getByRole('button', { name: 'Finish' }).click();
        await page.waitForTimeout(1500);

        const priorCarrierSelect = page.locator('#ddlPriorCarrier');
        await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(200);

        const firstCarrierValue = await priorCarrierSelect.evaluate((el) => {
            const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
            return opt ? opt.value : null;
        });
        if (!firstCarrierValue) throw new Error('No prior carrier options available');
        await priorCarrierSelect.selectOption(firstCarrierValue);
        console.log(`✅ Selected prior carrier: ${firstCarrierValue}`);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Policy Details Entered');

        // networkidle never resolves in this app (background polling keeps connections open)
        // domcontentloaded + the first interactive element on the next page is the correct signal
        await page.waitForLoadState('domcontentloaded');
        await page.locator('#cbInlandMarine').waitFor({ state: 'visible', timeout: 30000 });

        await page.locator('#cbInlandMarine').scrollIntoViewIfNeeded();
        const inlandChecked = await page.locator('#cbInlandMarine').isChecked();
        if (!inlandChecked) {
            await page.locator('#cbInlandMarine').evaluate(el => el.click());
            await page.waitForTimeout(500);
            console.log('✅ Inland Marine toggled to Yes');
        }

        await page.locator('#cbCrime').scrollIntoViewIfNeeded();
        const crimeChecked = await page.locator('#cbCrime').isChecked();
        if (!crimeChecked) {
            await page.locator('#cbCrime').evaluate(el => el.click());
            await page.waitForTimeout(500);
            console.log('✅ Crime toggled to Yes');
        }

        await page.waitForTimeout(200);
        await page.locator('#btnConfirmSelections').click();
        await page.waitForTimeout(1500);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Line Selections Tab Navigation Completed');

        const editLocationButton = page.getByTitle('Edit Location');
        await page.waitForTimeout(200);
        await editLocationButton.click();
        await clickIfExists('Yes');
        await page.locator('#txtLocationStreet2').fill('Apt 101');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        await page.waitForTimeout(100);
        await page.locator('#btnVerifyAddress').click();
        await page.waitForTimeout(200);
        await clickIfExists('Ok');
        await page.waitForTimeout(100);
        await clickIfExists('Use Suggested');
        await page.waitForTimeout(100);
        await clickIfExists('Accept As-Is');
        await page.waitForTimeout(100);
        await clickIfExists('Continue');
        await page.waitForTimeout(100);
        await clickIfExists('Save');

        await page.waitForTimeout(200);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Locations tab Navigation Completed');

        await page.waitForTimeout(1500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
        await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await processAllAddCoverageButtons(page);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('CP - Commercial Property tab navigation Completed');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        const editLocationButton1 = page.getByTitle('Edit Location');
        await page.waitForTimeout(200);
        await editLocationButton1.click();
        await page.waitForTimeout(200);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Save Location' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('CP - Locations tab navigation Completed');

        await processAllAddCoverageButtons(page);
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await page.locator('button').filter({ hasText: 'Add Building' }).click();
        await page.locator('a.dropdown-item').filter({ hasText: 'Location 1:' }).nth(1).click();
        await page.waitForTimeout(500);
        await page.locator('#txtBuildingDescription').click();
        await page.locator('#txtBuildingDescription').fill('test desc');
        await page.locator('#txtClassDescription_displayAll > .input-group-text > .fas').click();
        await clickTextItem('Airports - Hangars with repairing or servicing');
        await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.locator('#bs-select-6-0').click();
        await page.waitForTimeout(200);
        await page.locator('#txtNumberOfStories').click();
        await page.locator('#txtNumberOfStories').fill('15');
        await page.waitForTimeout(200);
        await page.getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.waitForTimeout(1200);
        await page.locator('#bs-select-19-0').click();
        await page.waitForTimeout(200);
        await page.locator('#txtYearOfConstruction').click();
        await page.locator('#txtYearOfConstruction').fill('2015');
        await page.waitForTimeout(1500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });

        const createEstimator = page.getByRole('link', { name: 'Create Estimator' });
        const editEstimator = page.getByRole('link', { name: 'Edit Estimator' });
        if (await createEstimator.isVisible().catch(() => false)) {
            await createEstimator.click();
            console.log('Clicked Create Estimator');
        } else if (await editEstimator.isVisible().catch(() => false)) {
            await editEstimator.click();
            console.log('Clicked Edit Estimator');
        } else {
            console.log('Neither Create Estimator nor Edit Estimator found');
        }

        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
        await page.waitForTimeout(500);
        await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
        await page.getByText('Apartment / Condominium').click();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('button', { name: 'Calculate Now' }).click();
        await page.getByRole('button', { name: 'Finish' }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Import Data' }).click();

        await page.waitForTimeout(200);
        await processCoverageDropdowns(page);
        await page.waitForTimeout(200);

        // Source field only exists if the estimator was run and populated a value
const sourceInput = page.locator('#xtxt_EstimatedReplacementCost');
const sourceVisible = await waitForVisible(sourceInput, 5000);

const limit52Input = page.locator('#txt_CP7Limit52_integerWithCommas');
await limit52Input.waitFor({ state: 'visible', timeout: 10000 });
await limit52Input.waitFor({ state: 'attached', timeout: 10000 });

if (sourceVisible) {
    // Read raw value from estimator output and strip commas before typing
    const rawValue = await sourceInput.inputValue();
    const numericValue = rawValue.replace(/,/g, '').trim(); // "642,351" → "642351"
    console.log(`📋 Copying Estimated Replacement Cost: ${rawValue} → ${numericValue}`);

    await page.waitForTimeout(200);
    await limit52Input.click({ clickCount: 3 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    await page.keyboard.type(numericValue);
    await page.waitForTimeout(200);
    await limit52Input.blur();
    await page.waitForTimeout(1500);

    console.log(`✅ Building Limit set from estimator: ${rawValue}`);
} else {
    // Estimator field not present — type a fallback value directly
    console.log('⚠️ Estimated Replacement Cost field not visible, using fallback value');

    await page.waitForTimeout(200);
    await limit52Input.click({ clickCount: 3 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    await page.keyboard.type('1000000');
    await page.waitForTimeout(200);
    await limit52Input.blur();
    await page.waitForTimeout(1500);

    console.log('✅ Building Limit set to fallback: 1000000');
}

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(200);
        await processAllAddCoverageButtons(page);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);

        // Close any lingering modal dialogs before clicking "Save Building & Add Business"
        try {
            const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
            const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
            if (isVisible) {
                console.log('⏭️ Closing lingering modal dialog...');
                const modalButtons = [
                    '#CLPropertyAddlCoveragesScheduleDialog_dialog_btn_0',
                    'button[id*="ScheduleDialog"]',
                    'button:has-text("Save")',
                    'button:has-text("OK")',
                    'button:has-text("Close")'
                ];
                let buttonClicked = false;
                for (const btnSelector of modalButtons) {
                    try {
                        const btn = page.locator(btnSelector).first();
                        const count = await btn.count({ timeout: 500 }).catch(() => 0);
                        if (count > 0) {
                            console.log(`Attempting to click button: ${btnSelector}`);
                            await btn.click({ timeout: 3000, force: true });
                            await page.waitForTimeout(800);
                            buttonClicked = true;
                            console.log('✅ Modal button clicked');
                            break;
                        }
                    } catch (e) { }
                }
                if (!buttonClicked) {
                    try {
                        const backdrop = page.locator('.modal-backdrop, .ui-widget-overlay');
                        await backdrop.click().catch(() => { });
                        await page.waitForTimeout(800);
                    } catch (e) { }
                }
                for (let i = 0; i < 3; i++) {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(300);
                }
                try {
                    await page.evaluate(() => {
                        const m = document.getElementById('dgic-modal-clpropertyaddlcoveragesscheduledialog');
                        if (m && m.parentNode) m.parentNode.removeChild(m);
                        const backdrops = document.querySelectorAll('.modal-backdrop, .ui-widget-overlay');
                        backdrops.forEach(bd => bd.remove());
                    });
                    await page.waitForTimeout(500);
                } catch (e) { }
            }
        } catch (modalErr) {
            console.log('ℹ️ Modal close attempt: ' + modalErr.message);
        }

        await page.getByRole('button', { name: 'Save Building & Add Business' }).click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);

        await page.locator('#txtBusinessIncomeDescription').click();
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
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        const limit53Input = page.locator('#txt_CP7Limit53_integerWithCommas');
        await limit53Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit53Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(200);
        await limit53Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        await page.keyboard.type('155666');
        await page.waitForTimeout(200);
        await limit53Input.blur();
        await page.waitForTimeout(1500);

        
        await processCoverageDropdowns(page);
        await page.waitForTimeout(1000);
        

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await processAllAddCoverageButtons(page);

        const saveBusinessIncomeBtn = page.locator('#btnNext_CLPropertyBuildingBusinessIncomeAdditionalCoverages');
        await saveBusinessIncomeBtn.waitFor({ state: 'visible', timeout: 30000 });
        await saveBusinessIncomeBtn.click();

        await page.getByTitle('Add Occupancy Building').click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);
        await page.locator('#txtOccupancyDescription').waitFor({ state: 'visible', timeout: 15000 });
        await page.locator('#txtOccupancyDescription').click();
        await page.locator('#txtOccupancyDescription').fill('occupancy desc');
        await page.locator('#txtSquareFootage').click();
        await page.locator('#txtSquareFootage').fill('15656');
        await page.getByText('Occupancy Details Location').click();
        await page.locator('button[data-id="ddlSprinkler"]').click();
        await page.locator('.dropdown-menu').getByText('Sprinklered Building, but Not Rated as Sprinklered').click();
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await page.locator('button[data-id="ddlOccupancyCategory"]').click();
        await page.locator('.dropdown-menu.show').getByText('Residential Apartments and Condominiums', { exact: true }).click();

        await processAllAddCoverageButtons(page);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(500);

        const saveBtn = page.locator('#btnNext_CLPropertyBuildingOccupancyCoverages');
        await expect(saveBtn).toBeVisible();
        await expect(saveBtn).toBeEnabled();
        await saveBtn.click();

        await page.waitForTimeout(200);
        await page.getByTitle('Add Personal Property').click();
        await page.waitForTimeout(500);
        await page.locator('#txtPersonalPropertyDescription').fill('Personal property description');
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        const limit54Input = page.locator('#txt_CP7Limit54_integerWithCommas');
        await limit54Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit54Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(200);
        await limit54Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        await page.keyboard.type('156566');
        await page.waitForTimeout(200);
        await limit54Input.blur();
        await page.waitForTimeout(1500);

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);
        await processAllAddCoverageButtons(page);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.locator('#btnNext_CLPropertyBuildingPersonalPropertyAdditionalCoverages').click();
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await processAllAddCoverageButtons(page);

        // ─── Attention dialog handling ────────────────────────────────────────────
        // FIX: After ALL recovery paths, wait for the Special Classes page to be ready
        // before falling through to the Special Classes section below.

        const attentionHeading = page.getByRole('heading', { name: 'Attention' });
        try {
            await attentionHeading.waitFor({ state: 'visible', timeout: 5000 });
            console.log('⏭️  Attention dialog found, attempting Next button first');
            await page.getByRole('heading', { name: 'Attention' }).click();
            await page.getByRole('button', { name: ' Close' }).click();
            await page.getByTitle('Edit Building').click();

            const urlBeforeNext = page.url();
            const nextButton = page.getByRole('button', { name: 'Next ' });
            await nextButton.click({ timeout: 5000 }).catch(() => { });
            await page.waitForTimeout(200);

            const urlAfterNext = page.url();
            const navigationSuccessful = urlAfterNext !== urlBeforeNext;

            if (navigationSuccessful) {
                console.log('✅ Next button successful after Attention dialog');
                // Page navigated — wait for Special Classes page to fully load
                await page.waitForLoadState('domcontentloaded');
                await page.waitForLoadState('networkidle').catch(() => { });
            } else {
                // Next didn't navigate — run recovery path
                console.log('⚠️ Next button failed, executing error handling logic');

                await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue')
                    .getByRole('combobox', { name: 'Nothing selected' }).click();
                await page.locator('#bs-select-6-0').click();

                // FIX: wait for page to settle after construction type change
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);

                await page.locator('#btnNext_CLPropertyBuildingDetails').click();

                // FIX: wait after each nav step, not just at the end
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);

                await safeClick(page.getByRole('button', { name: 'Next ' }));
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(200);

                await page.locator('#btnNext_CLPackageBuildingAdditionalCoverages').click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(200);

                await safeClick(page.getByRole('button', { name: 'Next ' }));

                // FIX: After recovery, wait for Special Classes page to be fully ready
                // before the section below tries to find the dropdown
                await page.waitForLoadState('domcontentloaded');
                await page.waitForLoadState('networkidle').catch(() => { });
                console.log('✅ Recovery navigation complete, current URL:', page.url());
            }
        } catch (error) {
            console.log('⏭️  Attention dialog not found, skipping block');
        }

        // ─── Special Classes ──────────────────────────────────────────────────────
        // By this point ALL navigation paths above have waited for domcontentloaded
        // and networkidle, so the page is settled before we probe for the dropdown.

        const addSpecialClassOption = page
            .locator('div.filter-option-inner-inner')
            .filter({ hasText: /Special Class|Add Special/ })
            .first();

        // Give the dropdown up to 10 s — longer than before because the recovery
        // path can leave the app mid-render when networkidle resolves early.
        const dropdownVisible = await waitForVisible(addSpecialClassOption, 10000);

        if (!dropdownVisible) {
            console.log('⚠️ Add Special Class option not found, skipping section');
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
                .filter({ hasText: 'Building and Personal Property Coverage Form' })
                .click();

            const lookupTrigger = page.locator('#txtSpecialClassesClassificationDescriptions_displayAll');
            await lookupTrigger.waitFor({ state: 'visible', timeout: 5000 });
            await lookupTrigger.click();

            const firstResultRow = page
                .locator('#txtSpecialClassesClassificationDescriptions_resultsTable tbody tr')
                .first();
            await firstResultRow.waitFor({ state: 'visible', timeout: 8000 });
            await firstResultRow.click();

            // --- Basic Symbol Number dropdown (optional) ---
            const basicSymbolDropdown = page.locator('button[data-id="ddlBasicSymbolNumber"]');

            if ((await basicSymbolDropdown.count()) > 0) {
                // Wait for it to shed its disabled state (bootstrap-select loads disabled
                // until the classification lookup response resolves)
                const isEnabled = await waitForEnabled(basicSymbolDropdown, 8000);

                if (!isEnabled) {
                    console.log('⚠️ Basic Symbol Number dropdown present but stayed disabled, skipping');
                } else {
                    await basicSymbolDropdown.click();

                    const menuId = await basicSymbolDropdown.getAttribute('aria-owns');
                    const optionSelector = menuId
                        ? `#${menuId} [role="option"]`
                        : '#bs-select-8 [role="option"]';

                    const firstOption = page.locator(optionSelector).first();
                    await firstOption.waitFor({ state: 'visible', timeout: 5000 });
                    await firstOption.click();

                    console.log('✅ Basic Symbol Number dropdown selected');
                }
            } else {
                console.log('⏭️ Basic Symbol Number dropdown not present, skipping');
            }

            // networkidle covers domcontentloaded — no need for both
            await page.waitForLoadState('networkidle').catch(() => { });
        }

        // ─── Special Class Coverages ──────────────────────────────────────────────
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForTimeout(200);

        const limit19Input = page.locator('#txt_CP7Limit19_integerWithCommas');
        await limit19Input.waitFor({ state: 'visible', timeout: 20000 });
        await limit19Input.clear();
        await limit19Input.fill('165666');
        await limit19Input.press('Tab');
        await page.waitForTimeout(500);

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);

        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.locator('#btnNext_CLPackageSpecialClassAdditionalCoverages').click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Continue ' }).click();

        console.log('Commercial property package data entered successfully.');
        trackMilestone('Commercial Property Package Completed', 'PASSED', 'Building, Business Income, Occupancy, Personal Property entered');

        // ─── General Liability ────────────────────────────────────────────────────
        console.log('General Liability data entry started.');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await clickIfExists('Close');

        await page.getByRole('row').filter({ hasText: 'Employment Practices Liability Insurance Coverage Endorsement' }).locator('button[data-action="Edit"]').click();

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
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        console.log('Current URL:', page.url());
        if (page.url().includes('CLGLAdditionalCoverages.aspx')) {
            console.log('📋 Additional Coverages page detected');
            await safeClick(page.getByRole('button', { name: 'Next ' }));
            await page.waitForLoadState('domcontentloaded');
        }

        await page.waitForTimeout(500);
        await clickIfExists('Close');

        try {
            const locationDropdown = page.locator('button[data-id="ddlAddLocation"]');
            await locationDropdown.waitFor({ state: 'visible', timeout: 5000 });
            await locationDropdown.click();
            const menu = page.locator('ul.dropdown-menu.inner.show');
            await menu.waitFor({ state: 'visible', timeout: 5000 });
            await menu.locator('li').filter({ hasText: /^1:/ }).first().click();
            console.log('✅ GL location added');
            await safeClick(page.getByRole('button', { name: 'Next ' }));
        } catch {
            console.log('⏭️ GL Locations section not present on this page, skipping');
        }

        await page.locator('#btnAddExposure').click();
        await page.getByRole('combobox', { name: 'Select Location' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.getByRole('combobox', { name: 'Select Class Code' }).click();
        await page.locator('#bs-select-2-1').click();
        await page.locator('#txtExposure_Prem').click();
        await page.locator('#txtExposure_Prem').click();
        await page.locator('#txtExposure_Prem').fill('166');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.getByRole('button', { name: 'Save Exposure ' }).click();

        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { });
        } catch (e) { }
        await page.waitForTimeout(200);

        const statusModalGL = page.locator('#dgic-status-message');
        try {
            await statusModalGL.waitFor({ state: 'visible', timeout: 2000 });
            const closeBtnGL = statusModalGL.getByRole('button', { name: /close|ok|done/i }).first();
            await closeBtnGL.click().catch(() => { });
            await page.waitForTimeout(500);
        } catch (e) { }

        await page.getByRole('button', { name: 'Continue ' }).click();

        console.log('General Liability data entered successfully.');
        trackMilestone('General Liability Completed', 'PASSED', 'Coverage limits and deductibles entered');

        // ─── Inland Marine ────────────────────────────────────────────────────────
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
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(200);

        const coverageLimitInput = page.locator('#txt_z5mh4r37u1gomc1gru4e21al9ha_integerWithCommas');
        await coverageLimitInput.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput.clear();
        await coverageLimitInput.fill('165666');
        await coverageLimitInput.press('Tab');
        await page.waitForTimeout(500);

        const coverageLimitInput2 = page.locator('#txt_z66jk360ek2gv3redungtmut688_integerWithCommas');
        await coverageLimitInput2.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput2.clear();
        await coverageLimitInput2.fill('5000');
        await coverageLimitInput2.press('Tab');
        await page.waitForTimeout(500);

        const coverageLimitInput3 = page.locator('#txt_zv2ikdh26eivu9n0pgub3ph6k19_integerWithCommas');
        await coverageLimitInput3.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput3.clear();
        await coverageLimitInput3.fill('1000');
        await coverageLimitInput3.press('Tab');
        await page.waitForTimeout(500);

        const coverageLimitInput4 = page.locator('#txt_znrjmb0kmf659ck5liulv1qj6rb_integerWithCommas');
        await coverageLimitInput4.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput4.clear();
        await coverageLimitInput4.fill('500');
        await coverageLimitInput4.press('Tab');
        await page.waitForTimeout(500);

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);

        await page.waitForTimeout(200);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Save Form' }).click();
        await page.waitForTimeout(200);
        await clickIfExists('Close');
        await page.waitForTimeout(500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Continue ' }).click();
        await page.waitForTimeout(3000);

        console.log('Inland Marine data entered successfully.');
        trackMilestone('Inland Marine Completed', 'PASSED', 'Coverage limits and deductibles entered');

        // ─── Crime ────────────────────────────────────────────────────────────────
        console.log('Crime data entry started.');
        await page.waitForTimeout(200);
        await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
        await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.locator('#txtTotalNumberRatableEmployees').click();
        await page.locator('#txtTotalNumberRatableEmployees').fill('15');
        await page.locator('#txtTotalNumberERISAPlanOfficials').click();
        await page.locator('#txtTotalNumberERISAPlanOfficials').fill('02');
        await page.locator('#xrgn_PredominantActivityValue').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.locator('#bs-select-6-1').click();
        await page.waitForTimeout(1500);
        await page.locator('.fas.fa-th').click();
        await page.waitForTimeout(200);

        const carWashCell = page.getByRole('gridcell', { name: /Car washes/ });
        await carWashCell.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
            console.log('⚠️ Car washes gridcell not found, clicking first matching gridcell');
        });
        if (await carWashCell.count() > 0) {
            await carWashCell.click();
        } else {
            await clickTextItem(/Car washes/);
        }

        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.getByRole('button', { name: 'Continue ' }).click();
        await page.waitForTimeout(200);
        await page.locator('#for_xrdo_Question_Form_CPPUnderwritingQuestion_Ext_0_CPPBestInfoByApplicant_Ext_Yes').click();

        console.log('Crime data entered successfully.');
        trackMilestone('Crime Completed', 'PASSED', 'Crime coverage details entered');

        await page.getByRole('button', { name: 'Continue ' }).click();
        await page.waitForTimeout(4000);

        console.log('Close buttons found:', await page.getByRole('button', { name: 'Close' }).count());
        const closeButton = page.getByRole('button', { name: 'Close' });
        await closeButton.waitFor({ state: 'visible', timeout: 60000 });
        console.log('Close button count:', await closeButton.count());
        await closeButton.click({ force: true });

        await page.waitForTimeout(5000);

        // ─── Quote polling ────────────────────────────────────────────────────────
        const quoteNumber = await page.locator('#tblQuotes tbody tr').first().locator('td').nth(3).innerText();
        console.log('Captured Quote Number:', quoteNumber.trim());

        async function dismissNotification(page) {
            try {
                const dismissBtn = page.locator('button.wb-bell-btn-ack');
                const isVisible = await dismissBtn.isVisible({ timeout: 2000 });
                if (isVisible) {
                    await dismissBtn.click();
                    console.log('🔔 Notification dismissed');
                    await dismissBtn.waitFor({ state: 'hidden', timeout: 3000 });
                }
            } catch { }
        }

        async function getStatus(page, quoteNumber) {
            try {
                await dismissNotification(page);
                const row = page.locator(`#tblQuotes tbody tr:has-text("${quoteNumber}")`);
                await row.waitFor({ state: 'visible', timeout: 5000 });
                const status = await row.locator('td').nth(11).innerText({ timeout: 5000 });
                return status.trim();
            } catch (e) {
                console.warn(`getStatus() failed (transient DOM issue): ${e.message}`);
                return 'Quote Requested';
            }
        }

        let status = await getStatus(page, quoteNumber);
        console.log('Initial Status:', status);

        let attempts = 0;
        const maxAttempts = 50;

        while (status === 'Quote Requested' && attempts < maxAttempts) {
            attempts++;
            console.log(`Attempt ${attempts}/${maxAttempts}: status still "Quote Requested", waiting 10s then refreshing...`);
            await page.waitForTimeout(10000);
            await page.reload();
            await page.waitForLoadState('networkidle').catch(() => { });
            await dismissNotification(page);
            await page.waitForTimeout(200);
            await dismissNotification(page);
            status = await getStatus(page, quoteNumber);
            console.log(`Attempt ${attempts} status: "${status}"`);
        }

        if (status !== 'Quoted') {
            throw new Error(`Quote did not reach "Quoted" after ${attempts} attempt(s). Final status: "${status}"`);
        }

        console.log('✔ Quote is now Quoted');
        trackMilestone('Quote Rated Successfully', 'PASSED', `Quote #: ${quoteNumber}`);
        const submissionNumber = quoteNumber.trim();

        global.testData.quoteNumber = submissionNumber;
        saveTestData();

        console.log('Starting policy submission workflow...');
        const policyNumber = await submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone });

        global.testData.policyNumber = policyNumber;
        global.testData.quoteNumber = submissionNumber;
        global.testData.status = 'PASSED';
        saveTestData();
        console.log('📋 Test Data:', global.testData);

        const testDataFile2 = path.join(__dirname, `test-data-${testState}.json`);
        fs.writeFileSync(testDataFile2, JSON.stringify(global.testData, null, 2));
        console.log(`💾 Test data written to test-data-${testState}.json`);
        console.log('✅ Test completed successfully');

    } catch (error) {
        testFailed = true;
        console.error('❌ Test execution failed:', error.message);
        console.error('📍 Stack:', error.stack);

        try {
            let extractedNumber = null;
            try {
                const pageText = await page.locator('body').textContent({ timeout: 2000 });
                const textMatch = pageText.match(/\b(\d{10})\b/);
                if (textMatch && textMatch[1]) {
                    extractedNumber = textMatch[1];
                    console.log(`🔍 Extracted number from page text: ${extractedNumber}`);
                }
            } catch (e) { }
            if (extractedNumber) global.testData.quoteNumber = extractedNumber;
        } catch (extractErr) {
            console.log('⚠️ Could not extract submission number:', extractErr.message);
        }

        global.testData.status = 'FAILED';
        global.testData.error = error.message;

        const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
        fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
        console.log(`💾 Test data written to test-data-${testState}.json with failure info`);

        throw error;
    }
});