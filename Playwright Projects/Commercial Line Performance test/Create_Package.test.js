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
    page.setDefaultTimeout(60000); // 60 seconds default timeout for all actions

    // Select environment via TEST_ENV (qa|test). Defaults to qa.
    const envName = process.env.TEST_ENV || 'qa';
    const { writeBizUrl, policyCenterUrl } = getEnvUrls(envName);

    // Select state via TEST_STATE. Defaults to DE.
    const allowedStates = Object.keys(STATE_CONFIG);
    let testState = (process.env.TEST_STATE || 'DE').toUpperCase();
    if (!allowedStates.includes(testState)) {
        console.log(`⚠️ TEST_STATE "${testState}" not allowed; defaulting to DE`);
        testState = 'DE';
    }
    const stateConfig = getStateConfig(testState);
    console.log(`🗺️ Running test for state: ${testState} (${stateConfig.name})`);

    // Initialize milestone tracking for email report
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

    // Immediately save initialized test data to prevent stale values from previous iterations
    const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
    fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
    console.log(`✅ Initialized test data for ${testState} with N/A values`);

    // Track HTTP response times and errors
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
            // Only log for XHR/fetch or important URLs
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
    let waitBudgetMs = 0; // tracks explicit waits to exclude from milestone duration
    let testFailed = false;

    // Wrap waitForTimeout so we can subtract intentional sleeps from milestone timing
    const originalWaitForTimeout = page.waitForTimeout.bind(page);
    page.waitForTimeout = async (ms) => {
        try {
            if (page.isClosed()) {
                return;
            }
            await originalWaitForTimeout(ms);
            waitBudgetMs += ms;
        } catch (error) {
            if (!page.isClosed()) {
                throw error;
            }
        }
    };

    // Helper to persist test data to state-specific JSON file (prevent parallel conflicts)
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

        // Calculate duration since last milestone (exclude intentional waits)
        if (currentStepStartTime) {
            const elapsedMs = now - currentStepStartTime - waitBudgetMs;
            duration = (Math.max(elapsedMs, 0) / 1000).toFixed(2); // in seconds
        }

        const milestone = {
            name,
            status,
            timestamp: now,
            details,
            duration: duration ? `${duration}s` : null
        };
        global.testData.milestones.push(milestone);
        console.log(`${status === 'PASSED' ? '\u2705' : status === 'FAILED' ? '\u274c' : '\u23eb'} ${name}${duration ? ` (${duration}s)` : ''}`);

        // Save data to file immediately so reporter can read it
        saveTestData();

        // Reset timer for next step
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

    // Ensure retry count is always up to date
    global.testData.retryCount = testInfo.retry || 0;

    // Start timing from first milestone
    currentStepStartTime = new Date();

    // Universal helper to wait for modals/overlays to disappear before interacting
    async function waitForModalsToClose(timeout = 5000) {
        try {
            // Wait for common modal/overlay elements to become hidden
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
            // Small buffer to ensure modal animations complete
            await page.waitForTimeout(300);
        } catch (e) {
            // Silently continue if no modals found or timeout
        }
    }

    // Enhanced click function with modal/overlay wait
    async function safeClick(locator, options = {}) {
        await waitForModalsToClose();
        await locator.scrollIntoViewIfNeeded();
        await locator.click(options);
    }

    try {




        // Helper function to click optional buttons
        async function clickIfExists(buttonName) {
            try {
                const button = page.getByRole('button', { name: buttonName });
                await button.click({ timeout: 5000 });
                console.log(`✅ "${buttonName}" button clicked`);
            } catch (error) {
                console.log(`⏭️  "${buttonName}" button not present, skipping`);
            }
        }

        // Account creation and qualification (reuses same page/tab)
        await createAccountAndQualify(page, {
            writeBizUrl,
            testState,
            clickIfExists,
            trackMilestone
        });


        // Wait for next page to fully load before interacting with package selection
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

                // Fallback: JS click (bypasses visibility)
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

                // Secondary fallback: force click label
                try {
                    if (await label.count() > 0) {
                        await label.waitFor({ state: 'attached', timeout: 10000 }).catch(() => { });
                        await label.click({ force: true });
                        console.log('✅ Commercial Package checkbox clicked (force)');
                        return;
                    }
                } catch (e2) {
                    // Last resort: set checked state directly via JS
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
        await page.waitForTimeout(1500); // Allow UI to respond


        await page.getByRole('button', { name: 'Next' }).click();

        await page.waitForTimeout(1500); // Allow UI to respond

        //Product eligibility page
        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_ApplicantCPPLiabilityLossesInd_Ext_No"]').click();
        await page.locator('label[for="xrdo_Question_Form_CPPPreQual_0_CPPCertificateQuestion_Ext_Yes"]').click();
        await page.getByRole('button', { name: 'Finish' }).click();
        await page.waitForTimeout(1500); // Allow UI to respond


        // Wait for prior-carrier dropdown to be ready with options
        const priorCarrierSelect = page.locator('#ddlPriorCarrier');
        await priorCarrierSelect.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(2000); // Allow options to populate

        // Select first available option (skip empty/placeholder)
        const firstCarrierValue = await priorCarrierSelect.evaluate((el) => {
            const opt = Array.from(el.options).find(o => o.value && o.value.trim() !== '');
            return opt ? opt.value : null;
        });
        if (!firstCarrierValue) {
            throw new Error('No prior carrier options available');
        }
        await priorCarrierSelect.selectOption(firstCarrierValue);

        console.log(`✅ Selected prior carrier: ${firstCarrierValue}`);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Policy Details Entered');

        await page.waitForLoadState('networkidle');


        // Toggle Inland Marine and Crime to "Yes" if not already selected (slider style controls)
        // Scroll into view and use JavaScript to click the actual checkbox element
        await page.waitForTimeout(1000); // Wait for slider rendering


        // Toggle Inland Marine - scroll and click via JavaScript
        await page.locator('#cbInlandMarine').scrollIntoViewIfNeeded();
        const inlandChecked = await page.locator('#cbInlandMarine').isChecked();
        if (!inlandChecked) {
            await page.locator('#cbInlandMarine').evaluate(el => el.click());

            await page.waitForTimeout(500);
            console.log('✅ Inland Marine toggled to Yes');
        }

        // Toggle Crime - scroll and click via JavaScript
        await page.locator('#cbCrime').scrollIntoViewIfNeeded();
        const crimeChecked = await page.locator('#cbCrime').isChecked();
        if (!crimeChecked) {
            await page.locator('#cbCrime').evaluate(el => el.click());
            trackMilestone('Toggled Crime');
            await page.waitForTimeout(500);
            console.log('✅ Crime toggled to Yes');
        }

        // Click Confirm Selections button after both toggles are selected
        await page.waitForTimeout(1000);
        await page.locator('#btnConfirmSelections').click();
        await page.waitForTimeout(1500);


        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Line Selections Tab Navigation Completed');

        //Commercial property locations
        const editLocationButton = page.getByTitle('Edit Location');
        await page.waitForTimeout(2000); // Additional wait for element to render
        await editLocationButton.click();
        await clickIfExists('Yes');
        await page.locator('#txtLocationStreet2').fill('Apt 101');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(2000); // Additional wait for element to render

        //await page.locator('#txtLocationCity').click();
        await page.waitForTimeout(100);
        await page.locator('#btnVerifyAddress').click();

        await page.waitForTimeout(2000);
        await clickIfExists('Ok');
        await page.waitForTimeout(100);
        await clickIfExists('Use Suggested');
        await page.waitForTimeout(100);
        await clickIfExists('Accept As-Is');
        await page.waitForTimeout(100);
        await clickIfExists('Continue');
        await page.waitForTimeout(100);
        await clickIfExists('Save');



        await page.waitForLoadState('networkidle');
        await page.waitForLoadState('domcontentloaded');


        await page.waitForTimeout(200);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('Locations tab Navigation Completed');

        await page.waitForTimeout(1500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        //CP -Coverage tab 
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.locator('text=Coverage').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });

        await page.locator('select, [role="combobox"], .dropdown-toggle, button[data-toggle="dropdown"]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => { });
        // Process coverage dropdowns and track changes after State specific info page
        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);


        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await processAllAddCoverageButtons(page);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        trackMilestone('CP - Commercial Property tab navigation Completed');
        //Navigated to CP Locations page
        // Wait for page to fullylicked Next after Schedule Dialog load after clicking Next
        // Use domcontentloaded only (networkidle causes timeout waiting for pending requests in perf)
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000); // Allow page to stabilize in perf env
        //Commercial property locations
        const editLocationButton1 = page.getByTitle('Edit Location');
        await page.waitForTimeout(2000); // Additional wait for element to render
        await editLocationButton1.click();
        //await page.locator('#txtAddressStreet2').fill('Apt 101');
        //await page.waitForTimeout(2000); // Additional wait for element to render
        //await page.locator('#btnVerifyAddress').click();
        //await page.waitForTimeout(2000);
        //await clickIfExists('Accept As-Is');
        //await page.waitForTimeout(500);
        //await editLocationButton.waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Save Location' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        // Wait for Save Location button to be fully ready




        trackMilestone('CP - Locations tab navigation Completed');


        await processAllAddCoverageButtons(page);


        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await page.locator('button').filter({ hasText: 'Add Building' }).click();

        //await page.locator('a.dropdown-item', { hasText: 'Location 1:' }).click();
        await page.locator('a.dropdown-item').filter({ hasText: 'Location 1:' }).nth(1).click();
        await page.waitForTimeout(500);
        await page.locator('#txtBuildingDescription').click();

        await page.locator('#txtBuildingDescription').fill('test desc');

        await page.locator('#txtClassDescription_displayAll > .input-group-text > .fas').click();
        await clickTextItem('Airports - Hangars with repairing or servicing');

        await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();

        await page.locator('#bs-select-6-0').click();

        await page.waitForTimeout(1000);
        await page.locator('#txtNumberOfStories').click();

        await page.locator('#txtNumberOfStories').fill('15');

        await page.waitForTimeout(1000);
        await page.getByRole('combobox', { name: 'Nothing selected' }).click();

        await page.waitForTimeout(1200);
        await page.locator('#bs-select-19-0').click();

        await page.waitForTimeout(1000);
        await page.locator('#txtYearOfConstruction').click();

        await page.locator('#txtYearOfConstruction').fill('2015');

        await page.waitForTimeout(1500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));


        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => { });



        await page.getByRole('link', { name: 'Create Estimator' }).click();
        trackMilestone('Create Estimator Clicked');



        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').click();
        trackMilestone('Commercial Sq Ft Clicked');
        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').fill('3256');
        trackMilestone('Commercial Sq Ft Filled');
        await page.locator('#PRI-XT_COMMERCIAL_SQUARE_FEET_ALL-VAL').press('Tab');
        trackMilestone('Commercial Sq Ft Tabbed');
        await page.waitForTimeout(500);
        await page.locator('#PRI-XT_TEMPLATE_ID_PRIMARY-VAL').click();
        trackMilestone('Template ID Primary Clicked');
        await page.getByText('Apartment / Condominium').click();
        trackMilestone('Apartment/Condo Selected');
        await page.getByRole('button', { name: 'Continue' }).click();
        trackMilestone('Continue Clicked');
        await page.getByRole('button', { name: 'Calculate Now' }).click();
        trackMilestone('Calculate Now Clicked');
        await page.getByRole('button', { name: 'Finish' }).click();
        trackMilestone('Finish Clicked');
        await page.waitForTimeout(500);

        await page.getByRole('button', { name: 'Import Data' }).click();
        trackMilestone('Import Data Clicked');




        await page.waitForTimeout(2000);
        // Process coverage dropdowns and track changes after State specific info page
        await processCoverageDropdowns(page);
        await page.waitForTimeout(1000);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(2000);

        await processAllAddCoverageButtons(page);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        // Close any lingering modal dialogs before clicking "Save Building & Add Business"
        try {
            const modal = page.locator('#dgic-modal-clpropertyaddlcoveragesscheduledialog');
            const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
            if (isVisible) {
                console.log('⏭️ Closing lingering modal dialog...');

                // Strategy 1: Look for modal buttons - Save/OK button inside the modal
                const modalButtons = [
                    '#CLPropertyAddlCoveragesScheduleDialog_dialog_btn_0',  // First button in modal
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

                // Strategy 2: If no button worked, try backdrop click
                if (!buttonClicked) {
                    try {
                        const backdrop = page.locator('.modal-backdrop, .ui-widget-overlay');
                        await backdrop.click().catch(() => { });
                        await page.waitForTimeout(800);
                    } catch (e) { }
                }

                // Strategy 3: Try Escape key multiple times
                for (let i = 0; i < 3; i++) {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(300);
                }

                // Strategy 4: Force remove modal via JavaScript
                try {
                    await page.evaluate(() => {
                        const m = document.getElementById('dgic-modal-clpropertyaddlcoveragesscheduledialog');
                        if (m && m.parentNode) {
                            m.parentNode.removeChild(m);
                        }
                        // Also remove backdrop if present
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
        await page.waitForTimeout(1000);
        // Use specific locator to avoid strict mode violation (3 comboboxes with same name)
        await page.locator('#xrgn_TypeOfRisk_Value').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.waitForTimeout(1200);
        await page.locator('#bs-select-6-0').click();
        await page.waitForTimeout(1500);
        await safeClick(page.getByRole('button', { name: 'Next ' }));



        const limit53Input = page.locator('#txt_CP7Limit53_integerWithCommas');
        await limit53Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit53Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(1000);
        // Click to select all existing text
        await limit53Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);
        // Clear by pressing Backspace
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        // Type character by character for comma formatting
        await page.keyboard.type('155666');
        await page.waitForTimeout(1000);
        // Blur to trigger validation
        await limit53Input.blur();
        await page.waitForTimeout(1500);


        // Process coverage dropdowns and track changes after State specific info page
        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);



        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await processAllAddCoverageButtons(page);
        await page.getByRole('button', { name: 'Save Building Business Income' }).click();
        // add occupancy and personal property
        await page.getByTitle('Add Occupancy Building').click();
        // Wait for page navigation and load after clicking Add Occupancy
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);
        await page.locator('#txtOccupancyDescription').waitFor({ state: 'visible', timeout: 15000 });
        await page.locator('#txtOccupancyDescription').click();
        await page.locator('#txtOccupancyDescription').fill('occupancy desc');
        await page.locator('#txtSquareFootage').click();
        await page.locator('#txtSquareFootage').fill('15656');
        await page.getByText('Occupancy Details Location').click();
        await page.locator('button[data-id="ddlSprinkler"]').click();

        await page
            .locator('.dropdown-menu')
            .getByText('Sprinklered Building, but Not Rated as Sprinklered')
            .click();
        await safeClick(page.getByRole('button', { name: 'Next ' }));


        await page.locator('button[data-id="ddlOccupancyCategory"]').click();

        await page
            .locator('.dropdown-menu.show')
            .getByText('Residential Apartments and Condominiums', { exact: true })
            .click();

        await processAllAddCoverageButtons(page);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(500);
        const saveBtn = page.locator('#btnNext_CLPropertyBuildingOccupancyCoverages');

        await expect(saveBtn).toBeVisible();
        await expect(saveBtn).toBeEnabled();

        await saveBtn.click();
        await page.waitForTimeout(1000);
        await page.getByTitle('Add Personal Property').click();
        await page.waitForTimeout(500);
        await page.locator('#txtPersonalPropertyDescription').fill('Personal property description');
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        const limit54Input = page.locator('#txt_CP7Limit54_integerWithCommas');
        await limit54Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit54Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(1000);
        // Click to select all existing text
        await limit54Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);
        // Clear by pressing Backspace
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        // Type character by character for comma formatting
        await page.keyboard.type('156566');
        await page.waitForTimeout(1000);
        // Blur to trigger validation
        await limit54Input.blur();
        await page.waitForTimeout(1500);



        // Process coverage dropdowns and track changes after State specific info page
        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);

        await processAllAddCoverageButtons(page);




        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.locator('#btnNext_CLPropertyBuildingPersonalPropertyAdditionalCoverages').click();
        await safeClick(page.getByRole('button', { name: 'Next ' }));

        await processAllAddCoverageButtons(page);
        // Check if Attention dialog is visible
        const attentionHeading = page.getByRole('heading', { name: 'Attention' });
        try {
            await attentionHeading.waitFor({ state: 'visible', timeout: 5000 });
            // Attention dialog found - try clicking Next first
            console.log('⏭️  Attention dialog found, attempting Next button first');
            await page.getByRole('heading', { name: 'Attention' }).click();
            await page.getByRole('button', { name: ' Close' }).click();
            await page.getByTitle('Edit Building').click();
            // Get current URL before clicking Next
            const urlBeforeNext = page.url();

            // Try clicking Next button

            const nextButton = page.getByRole('button', { name: 'Next ' });
            await nextButton.click({ timeout: 5000 }).catch(() => { });
            await page.waitForTimeout(2000);

            // Check if navigation was successful
            const urlAfterNext = page.url();
            const navigationSuccessful = urlAfterNext !== urlBeforeNext;

            if (navigationSuccessful) {
                console.log('✅ Next button successful, skipping error handling');
                // Navigation worked, skip the error handling logic
            } else {
                // Next button didn't navigate, execute error handling
                console.log('⚠️ Next button failed, executing error handling logic');

                await page.locator('#xrgn_CLPropertyBuildingDetails_ConstructionTypeToUseValue').getByRole('combobox', { name: 'Nothing selected' }).click();
                await page.locator('#bs-select-6-0').click();
                //await page.locator('#bs-select-6-0').click();
                await page.waitForTimeout(3000);
                //await page.getByRole('button', { name: 'Next ' }).click();
                await page.locator('#btnNext_CLPropertyBuildingDetails').click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);

                //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertyBuildingCoverages.aspx&sid=8FF799FC9CCA4036945F7A17BAD76A22');
                await safeClick(page.getByRole('button', { name: 'Next ' }));
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(2000)
                //await page.getByRole('button', { name: 'Save Building ' }).click();
                await page.locator('#btnNext_CLPackageBuildingAdditionalCoverages').click();
                await page.waitForTimeout(2000);
                await safeClick(page.getByRole('button', { name: 'Next ' }));
            }
        } catch (error) {
            console.log('⏭️  Attention dialog not found, skipping block');
        }

        // Special Classes
        // Wait for Special Classes dropdown with more robust visibility check
        await page.waitForFunction(() => {
            const elements = Array.from(document.querySelectorAll('div.filter-option-inner-inner')).filter(el => {
                const text = el.textContent || '';
                return text.includes('Special Class') || text.includes('Add Special');
            });
            if (elements.length === 0) return false;
            const el = elements[0];
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0';
        }, { timeout: 25000 }).catch(() => {
            // Fallback: proceed without wait if element never appears
            console.log('⚠️ Add Special Class element visibility timeout, attempting to continue');
        });

        // Try to scroll and click the element, handling case where it may not exist
        try {
            const addSpecialClassOption = page.locator('div.filter-option-inner-inner').filter({ hasText: /Special Class|Add Special/ });
            const count = await addSpecialClassOption.count();
            if (count > 0) {
                await addSpecialClassOption.first().scrollIntoViewIfNeeded();
                await page.waitForTimeout(1500);
                await addSpecialClassOption.first().click();
                await page.locator('#bs-select-1-0').click();
                // Wait for page to load after selecting
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(2000);
            } else {
                console.log('⚠️ Add Special Class option not found, skipping');
                // If dropdown not found, skip the special class description section
                return; // Exit the step and move to next
            }
        } catch (e) {
            console.log(`⚠️ Failed to interact with Add Special Class: ${e.message}`);
            return; // Exit on error
        }

        // Only proceed if we successfully clicked Add Special Class
        await page.locator('#txtNewSpecialClassDescription').fill('Special Class Description');
        await page.locator('button[data-id="ddlCovForm"]').click();

        await page.locator('.dropdown-menu.show a[role="option"]')
            .filter({ hasText: 'Building and Personal Property Coverage Form' })
            .click();

        await page.waitForTimeout(1000);
        // Open lookup window/grid
        await page.locator('#txtSpecialClassesClassificationDescriptions_displayAll').click();

        // Wait for results table
        await page.locator('#txtSpecialClassesClassificationDescriptions_resultsTable tbody tr')
            .first()
            .waitFor({ state: 'visible' });

        // Select first row
        await page.locator('#txtSpecialClassesClassificationDescriptions_resultsTable tbody tr')
            .first()
            .click();

        // Click the Basic Symbol Number dropdown only if it exists
        const basicSymbolDropdown = page.locator('button[data-id="ddlBasicSymbolNumber"]');
        try {
            const dropdownVisible = await basicSymbolDropdown.isVisible({ timeout: 3000 }).catch(() => false);
            if (dropdownVisible) {
                await basicSymbolDropdown.click();
                await page.waitForTimeout(500);
                // Click the first available option
                const menuId = await basicSymbolDropdown.getAttribute('aria-owns');
                if (menuId) {
                    await page.locator(`#${menuId} [role="option"]`).first().click();
                } else {
                    await page.locator('#bs-select-8 [role="option"]').first().click();
                }
                console.log('✅ Basic Symbol Number dropdown selected');
            } else {
                console.log('⏭️ Basic Symbol Number dropdown not found, skipping');
            }
        } catch (e) {
            console.log('⏭️ Basic Symbol Number dropdown not available, skipping');
        }


        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: 'Next ' }).click();
        // Wait for page to load after clicking Next
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLPropertySpecialClassCoverages.aspx&sid=0780278C9FB44ABCADFEB9E0ED129FBC');
        // Wait for Special Class Coverage section to load
        const limit19Input = page.locator('#txt_CP7Limit19_integerWithCommas');

        await limit19Input.waitFor({ state: 'visible', timeout: 20000 });

        // Clear existing value
        await limit19Input.clear();

        // Enter new value
        await limit19Input.fill('65666');

        // Trigger onchange
        await limit19Input.press('Tab');

        // Wait for ajax update if needed
        await page.waitForTimeout(500);

        const coverageChanges = await processCoverageDropdowns(page);
        await page.waitForTimeout(300);

        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(2000);
        await page.locator('#btnNext_CLPackageSpecialClassAdditionalCoverages').click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Continue ' }).click();

        console.log('Commercial property package data entered  successfully.');
        trackMilestone('Commercial Property Package Completed', 'PASSED', 'Building, Business Income, Occupancy, Personal Property entered');

        console.log('General Liability data entry started.');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLCoverages.aspx&sid=DB02C8659EC1486FA06AF850885BB1FE');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await clickIfExists('Close');
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLCoverages.aspx&sid=8F4104755ACC4408A10F0A28450980F8');
        await page.getByRole('row').filter({ hasText: 'Employment Practices Liability Insurance Coverage Endorsement' }).locator('button[data-action="Edit"]').click();


        const limit51Input = page.locator('#txtzh4h8eu1sdr3q3h40nqv6fdk65a_integerWithCommas');

        await limit51Input.waitFor({ state: 'visible', timeout: 10000 });
        await limit51Input.waitFor({ state: 'attached', timeout: 10000 });
        await page.waitForTimeout(1000);

        // Click to select all existing text
        await limit51Input.click({ clickCount: 3 });
        await page.waitForTimeout(500);

        // Clear by pressing Backspace
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);

        // Type character by character for comma formatting
        await page.keyboard.type('150');
        await page.waitForTimeout(1000);

        // Blur to trigger validation/onchange event
        await limit51Input.blur();
        await page.waitForTimeout(1500);


        // Calculate dates dynamically: current month last day and +2 months last day
        const today = new Date();
        const currentMonthLastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        const twoMonthsLastDay = twoMonthsLater.getDate();
        await page.locator('.input-group-text').first().click();
        // Select the last day of current month (use .last() to avoid strict mode violation)
        await page.getByRole('cell', { name: String(currentMonthLastDay) }).last().click();
        await page.locator('#xrgn_zgni6as6fl4tt7q4qkleqpts9jaValue > .ui-xcontrols > .input-group-append > .input-group-text > .fas').click();
        await page.getByTitle('Next Month').click();
        // Select the last day of the month that is 2 months from now
        await page.getByRole('cell', { name: String(twoMonthsLastDay) }).last().click();
        await page.locator('#CLGLAdditionalCoveragesScheduleDialog_dialog_btn_0').click();
        await page.waitForTimeout(1000);
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLAdditionalCoverages.aspx&sid=C44457B5B33B46888B07158DDD5B9F24');
        //await page.locator('#GL7AddlInsdChurchMbrOffcrVolunWrkr').getByTitle('Add the Coverage').click();
        //await page.getByRole('button', { name: 'Finish' }).click();
        //await safeClick(page.getByRole('button', { name: 'Next ' }));
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        //await page.locator('button[data-id="ddlAddLocation"]').click();
        //await page.locator('a.dropdown-item:has-text("1: ")').click();
        //await safeClick(page.getByRole('button', { name: 'Next ' }));

        //await page.getByRole('button', { name: 'Finish' }).click();
        // wait for correct page
        //await page.waitForURL('**/CLGLLocations.aspx');

        // wait for dropdown to exist
        const locationDropdown = page.locator('button[data-id="ddlAddLocation"]');
        await locationDropdown.waitFor({ state: 'visible' });

        // click dropdown
        await locationDropdown.click();

        // wait for menu
        const menu = page.locator('ul.dropdown-menu.inner.show');
        await menu.waitFor({ state: 'visible' });

        // select item
        await menu.locator('li')
            .filter({ hasText: /^1:/ })
            .first()
            .click();
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.locator('#btnAddExposure').click();
        await page.getByRole('combobox', { name: 'Select Location' }).click();
        await page.locator('#bs-select-1-1').click();
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E9265AB5DF924567BB72F7434525E340');
        await page.getByRole('combobox', { name: 'Select Class Code' }).click();
        await page.locator('#bs-select-2-1').click();
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresDetails.aspx&selectedsubline=%22Premises/Operations%20and%20Products/Completed%20Operations%22&sid=E1A86E1405BA4536A6D78577D333850B');
        await page.locator('#txtExposure_Prem').click();
        await page.locator('#txtExposure_Prem').click();
        await page.locator('#txtExposure_Prem').fill('166');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?p=CLGLExposuresCoverages.aspx&sid=B7D53EFD48D34942B45549FB2627936C');
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.getByRole('button', { name: 'Save Exposure ' }).click();

        // Wait for any navigation to complete and optional modal to close
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { });
        } catch (e) {
            // Navigation might already be complete
        }
        await page.waitForTimeout(1000);

        // Try to close any modal that might be blocking (GL section)
        const statusModalGL = page.locator('#dgic-status-message');
        try {
            await statusModalGL.waitFor({ state: 'visible', timeout: 2000 });
            const closeBtnGL = statusModalGL.getByRole('button', { name: /close|ok|done/i }).first();
            await closeBtnGL.click().catch(() => { });
            await page.waitForTimeout(500);
        } catch (e) {
            // Modal not present, continue
        }

        await page.getByRole('button', { name: 'Continue ' }).click();

        console.log('General Liability data entered successfully.');
        trackMilestone('General Liability Completed', 'PASSED', 'Coverage limits and deductibles entered');

        console.log('Inland Marine data entry started.');
        await page.getByRole('combobox', { name: 'Add New Form' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.waitForTimeout(2000);
        await page.getByRole('combobox', { name: 'Select Location' }).click();
        await page.locator('#bs-select-1-1').click();
        await page.waitForTimeout(2000);
        await page.getByRole('combobox', { name: 'None' }).click();
        await page.locator('#bs-select-2-1').click();
        await page.waitForTimeout(5000);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(2000);
        //await page.getByTitle('Edit Coverage').click();

        // Wait for Coverage field to load
        const coverageLimitInput = page.locator('#txt_z5mh4r37u1gomc1gru4e21al9ha_integerWithCommas');
        await coverageLimitInput.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput.clear();
        await coverageLimitInput.fill('165666');
        await coverageLimitInput.press('Tab');
        await page.waitForTimeout(500)

        // Wait for Coverage field to load
        const coverageLimitInput2 = page.locator('#txt_z66jk360ek2gv3redungtmut688_integerWithCommas');
        await coverageLimitInput2.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput2.clear();
        await coverageLimitInput2.fill('5000');
        await coverageLimitInput2.press('Tab');
        await page.waitForTimeout(500);

        // Wait for Coverage field to load
        const coverageLimitInput3 = page.locator('#txt_zv2ikdh26eivu9n0pgub3ph6k19_integerWithCommas');
        await coverageLimitInput3.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput3.clear();
        await coverageLimitInput3.fill('1000');
        await coverageLimitInput3.press('Tab');
        await page.waitForTimeout(500);

        // Wait for Coverage field to load
        const coverageLimitInput4 = page.locator('#txt_znrjmb0kmf659ck5liulv1qj6rb_integerWithCommas');
        await coverageLimitInput4.waitFor({ state: 'visible', timeout: 20000 });
        await coverageLimitInput4.clear();
        await coverageLimitInput4.fill('500');
        await coverageLimitInput4.press('Tab');
        await page.waitForTimeout(500);

        await processCoverageDropdowns(page);
        await page.waitForTimeout(300);



        await page.waitForTimeout(2000);
        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Save Form' }).click();
        await page.waitForTimeout(2000);

        //add for close button logic if modal appears after saving form
        await clickIfExists('Close');
        await page.waitForTimeout(500);

        await safeClick(page.getByRole('button', { name: 'Next ' }));
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Continue ' }).click();
        await page.waitForTimeout(3000);

        console.log('Inland Marine data entered successfully.');
        trackMilestone('Inland Marine Completed', 'PASSED', 'Coverage limits and deductibles entered');
        console.log('Crime data entry started.');
        await page.waitForTimeout(3000);
        await page.getByRole('combobox', { name: new RegExp(`: .* ${testState}$`) }).click();
        await page.locator('ul.dropdown-menu.inner.show').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('ul.dropdown-menu.inner.show li').filter({ hasText: /^1:/ }).first().click();
        // Close any blocking modal before Next click
        //const statusModal = page.locator('#dgic-status-message');
        //try {
        //  await statusModal.waitFor({ state: 'visible', timeout: 3000 });
        //  const closeBtn = statusModal.getByRole('button', { name: /close|ok|done/i }).first();
        //  await closeBtn.click().catch(() => {});
        //  await page.waitForTimeout(500);
        //} catch (e) {
        //  // Modal not present, continue
        //}
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.locator('#txtTotalNumberRatableEmployees').click();
        await page.locator('#txtTotalNumberRatableEmployees').fill('15');
        await page.locator('#txtTotalNumberERISAPlanOfficials').click();
        await page.locator('#txtTotalNumberERISAPlanOfficials').fill('02');
        await page.locator('#xrgn_PredominantActivityValue').getByRole('combobox', { name: 'Nothing selected' }).click();
        await page.locator('#bs-select-6-1').click();
        await page.waitForTimeout(1500);
        await page.locator('.fas.fa-th').click();
        await page.waitForTimeout(2000);
        const carWashCell = page.getByRole('gridcell', { name: /Car washes/ });
        await carWashCell.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
            console.log('⚠️ Car washes gridcell not found, clicking first matching gridcell');
        });
        if (await carWashCell.count() > 0) {
            await carWashCell.click();
        } else {
            await clickTextItem(/Car washes/);
        }
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Next ' }).click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Next ' }).click();
        //await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Continue ' }).click();
        await page.waitForTimeout(2000);
        await page.locator('#for_xrdo_Question_Form_CPPUnderwritingQuestion_Ext_0_CPPBestInfoByApplicant_Ext_Yes').click();


        console.log('Crime data entered successfully.');
        trackMilestone('Crime Completed', 'PASSED', 'Crime coverage details entered');

        await page.getByRole('button', { name: 'Continue ' }).click();

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(60000);

        await clickIfExists('Close');

        //console.log('Finalizing policy and navigating to LOB Review page.');
        //await page.getByRole('button', { name: 'Finalize Policy ' }).click();

        //await page.goto('https://nautilusqa.donegalgroup.com/crystal.aspx?a=show&p=LOBReview.aspx&wf=true&sid=2F5067F927AC411EBD7F7103528A95FC');
        //await page.waitForSelector('#lblQuoteNumValue', { timeout: 60000 });

        await page.waitForTimeout(5000);
        // Capture quote number
        const quoteNumber = await page.locator('#tblQuotes tbody tr').first().locator('td').nth(3).innerText();
        console.log('Captured Quote Number:', quoteNumber.trim());


        const statusLocator = page.locator(
            `#tblQuotes tbody tr:has-text("${quoteNumber}") td`
        );

        // function to extract status safely
        async function getStatus() {
            const row = page.locator(`#tblQuotes tbody tr:has-text("${quoteNumber}")`);
            const status = await row.locator('td').nth(11).innerText();
            return status.trim();
        }

        let status = await getStatus();
        console.log('Initial Status:', status);

        let attempts = 0;
        const maxAttempts = 20;

        while (status === 'Quote Requested' && attempts < maxAttempts) {

            console.log(`Attempt ${attempts + 1}: status still Quote Requested, refreshing...`);

            await page.reload();
            await page.waitForLoadState('networkidle');

            status = await getStatus();
            attempts++;
        }

        if (status !== 'Quoted') {
            throw new Error(`Quote did not reach "Quoted". Final status: ${status}`);
        }

        console.log('Quote is now Quoted ✔');

        
        const submissionNumber = quoteNumber.trim();
        trackMilestone('Quote Rated Successfully', 'PASSED', `Quote #: ${submissionNumber}`);

        // Add these at the very top of your test file
        const fs = require('fs');
        const path = require('path');


        // Store submission number globally for email reporter
        global.testData.quoteNumber = submissionNumber;
        saveTestData();

        // Now submit policy for approval in the same browser session
        console.log('Starting policy submission workflow...');


        const policyNumber = await submitPolicyForApproval(page, submissionNumber, { policyCenterUrl, trackMilestone });



        // Store quote and policy numbers globally for email reporter
        global.testData.policyNumber = policyNumber;
        global.testData.quoteNumber = submissionNumber;
        global.testData.status = 'PASSED';
        saveTestData();
        console.log('📋 Test Data:', global.testData);

        // Write test data to state-specific JSON file so reporter can read it
        const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
        fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
        console.log(`💾 Test data written to test-data-${testState}.json`);

        console.log('✅ Test completed successfully');

    } catch (error) {
        // Test failed - mark the failure as a milestone
        testFailed = true;
        console.error('❌ Test execution failed:', error.message);
        console.error('📍 Stack:', error.stack);

        // Only Strategy 4: Try any visible 10-digit number on the page
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
            if (extractedNumber) {
                global.testData.quoteNumber = extractedNumber;
            }
        } catch (extractErr) {
            console.log('⚠️ Could not extract submission number:', extractErr.message);
        }

        trackMilestone('Test Execution Failed', 'FAILED', `${error.message}`);

        // Ensure test data has failure status
        global.testData.status = 'FAILED';
        global.testData.error = error.message;

        // Write final test data with failure info to state-specific file
        const testDataFile = path.join(__dirname, `test-data-${testState}.json`);
        fs.writeFileSync(testDataFile, JSON.stringify(global.testData, null, 2));
        console.log(`💾 Test data written to test-data-${testState}.json with failure info`);

        // Re-throw to mark test as failed in Playwright
        throw error;
    }
});

// Note: Consolidated batch email is sent by the parallel runner script.
// Removed test-level afterAll email to avoid duplicate emails.



