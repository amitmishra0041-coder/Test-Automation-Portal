const { randEmail, randCompany, randAddress, randSSN } = require('./helpers/randomData');
const { randCityForState, randZipForState } = require('./stateConfig');

// Create account and reach the package selection stage, reusing the same page/tab.
async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone }) {
  // Local helper to generate a random 717 phone number
  function randPhone717() {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000); // 7 random digits
    return `717${randomDigits}`;
  }

  // Navigate and login
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill('amitmish');
  await page.getByRole('textbox', { name: 'Password:' }).fill('Bombay12$');
  await page.getByRole('button', { name: 'Log In' }).click();
  console.log('WB Login successful');

  // Create new client
  await page.getByRole('button', { name: 'Create a New Client' }).click();
  // Wait for page to fully load after clicking Create a New Client
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // Allow UI to render fully in perf env
  
  // Robust wait for search field with flexible text matching for webkit/perf issues
  await page.waitForFunction(() => {
    const elements = Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return text.includes('Enter Search Text') || text.includes('Search Text here');
    });
    if (elements.length === 0) return false;
    const el = elements[0];
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    // Element must have dimensions and be visible
    return rect.width > 0 && rect.height > 0 && 
           style.display !== 'none' && 
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }, { timeout: 25000 });
  
  const searchTextField = page.getByText('Enter Search Text here or');
  await searchTextField.click();
  await page.locator('#txtAgency_input').fill('0008707');
  await page.getByRole('gridcell', { name: '0008707' }).click();
  await page.locator('#ui-id-9').getByText('BRENT W. PARENTEAU').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Create new client - retry until "Accept As-Is" is presented (not "Use Suggested")
  let acceptAsIsPresented = false;
  let retryCount = 0;
  const maxRetries = 5;

  while (!acceptAsIsPresented && retryCount < maxRetries) {
    if (retryCount > 0) {
      console.log(`🔄 Retry attempt ${retryCount} - re-entering client information`);
    }

    // Fill client info
    await page.getByRole('textbox', { name: 'Company/ Individual Name' }).fill(randCompany());
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Street Line 1' }).fill(randAddress());
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'City' }).fill(randCityForState(testState));
    await page.waitForTimeout(800);

    // State dropdown click - retry if blocked by dialog overlay
    let stateClickSuccess = false;
    for (let attempt = 1; attempt <= 3 && !stateClickSuccess; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`🔄 Retry ${attempt}/3: Clicking state dropdown...`);
          // Check for blocking dialog overlay
          const overlay = page.locator('.ui-widget-overlay');
          if (await overlay.isVisible().catch(() => false)) {
            console.log('⚠️ Dialog overlay detected, waiting for it to clear...');
            await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
          }
        }
        await page.locator('.ui-xcontrols > .ui-combobox > .ui-widget.ui-widget-content').first().click({ timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.locator('.ui-menu.ui-widget').getByText(testState, { exact: true }).click({ timeout: 5000 });
        stateClickSuccess = true;
        if (attempt > 1) console.log('✅ State dropdown clicked successfully');
      } catch (e) {
        if (attempt === 3) {
          console.log(`❌ Failed to click state dropdown after ${attempt} attempts: ${e.message}`);
          throw e;
        }
        await page.waitForTimeout(2000);
      }
    }

    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Zip Code Phone Number' }).fill(randZipForState(testState));
    await page.waitForTimeout(800);
    // Retry phone fill until it sticks - use keyboard typing to trigger mask, validate 10 digits
    const phoneNumber = randPhone717();
    let phoneFilledCorrectly = false;
    const phoneField = page.locator('#txtPhone');
    for (let i = 0; i < 3; i++) {
      await phoneField.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type(phoneNumber);
      await phoneField.blur();
      await page.waitForTimeout(500);
      const phoneValue = await phoneField.inputValue();
      const digits = (phoneValue || '').replace(/\D/g, '');
      if (digits.length === 10) {
        phoneFilledCorrectly = true;
        console.log(`✅ Phone number filled successfully: ${phoneValue}`);
        break;
      }
      console.log(`⚠️ Phone fill failed (got: '${phoneValue}', digits: '${digits}') - retrying (attempt ${i + 1})`);
    }
    if (!phoneFilledCorrectly) {
      const lastVal = await phoneField.inputValue();
      console.log(`❌ Phone number failed to fill after 3 attempts. Last value: ${lastVal}`);
    }
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Email Address' }).fill(randEmail());
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    //accept as is logic
    const acceptAsIsButton = page.locator('button:has-text("Accept As-Is")');

    try {
      // Wait for Address Validation dialog to stabilize
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

      // Wait up to 25s for button (PERF-safe)
      await acceptAsIsButton.first().waitFor({
        state: 'visible',
        timeout: 25000
      });

      // Re-resolve + stabilize
      await acceptAsIsButton.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // allow re-render to settle

      await acceptAsIsButton.first().click({ force: true });

      console.log('✅ "Accept As-Is" clicked successfully');
      acceptAsIsPresented = true;
      
      // Click optional buttons immediately after Accept As-Is
      await clickIfExists('Client not listed');
      await clickIfExists('Continue');
      break; // Exit retry loop on success

    } catch (e) {
      console.log('⚠️ "Accept As-Is" not available, handling fallback');

      const cancelButton = page
        .getByLabel('Address Validation')
        .getByRole('button', { name: 'Cancel' });

      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
        await page.waitForTimeout(1000);
      }

      retryCount++;
      continue; // Go to next retry iteration
    }
  } // End of while loop

  // Everything after this point runs ONCE after successfully exiting the retry loop
    // CRITICAL: Wait for any address validation dialogs to fully close before proceeding
    // In parallel runs, dialogs can linger and block subsequent interactions
    await page.waitForTimeout(2000);

    // Check if any modal/dialog is still present and wait for it to close
    const modalOverlay = page.locator('.ui-widget-overlay');
    const dialogPresent = await modalOverlay.isVisible().catch(() => false);
    if (dialogPresent) {
      console.log('⏳ Waiting for dialog overlay to disappear...');
      await modalOverlay.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {
        console.log('⚠️ Dialog overlay still present, attempting to continue');
      });
      await page.waitForTimeout(1000); // Extra buffer after overlay clears
    }

    // Also check for any open dialogs and try to close them
    const openDialog = page.locator('.ui-dialog:visible');
    if (await openDialog.isVisible().catch(() => false)) {
      console.log('⚠️ Open dialog detected, attempting to close...');
      const closeBtn = openDialog.locator('button.ui-dialog-titlebar-close').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => { });
        await page.waitForTimeout(1000);
      }
    }


    // Wait for the page to be ready - more reliable than networkidle
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Give page time to fully render

    // Business Description - wait for it to be visible and enabled
    const businessDescField = page.getByRole('textbox', { name: 'Business Description' });
    await businessDescField.waitFor({ state: 'visible', timeout: 30000 });
    await businessDescField.fill('test desc');

    // Click the Business Entity input to open dropdown
    const businessEntityInput = page.locator('#xrgn_det_BusinessEntity > div > div > div:nth-child(2) > div > div > span > input');
    const menuOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item').first();

    // If the menu is already open, skip clicking the input; otherwise click to open
    const menuVisible = await menuOption.isVisible().catch(() => false);
    if (!menuVisible) {
      await businessEntityInput.click();
    }

    // Wait for dropdown and click first option
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await page.waitForTimeout(1500);
    await menuOption.waitFor({ state: 'visible', timeout: 15000 });
    await menuOption.click();
    await page.locator('#txtYearBusinessStarted').fill('2014');
    await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());
    await page.locator('#txtNAICSCode_input').fill('812210');
    await page.getByRole('gridcell', { name: 'Director services, funeral' }).click();

    // Contact info
    await page.getByRole('textbox', { name: 'Contact First Name' }).fill('test');
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Contact Last Name' }).fill('desc');
    await page.waitForTimeout(800);
    // Retry contact phone fill until it sticks - keyboard typing, validate 10 digits
    const expectedContactPhone = '7175551212';
    let contactPhoneFilledCorrectly = false;
    const contactPhoneField = page.getByRole('textbox', { name: 'Contact Phone' });
    for (let i = 0; i < 3; i++) {
      await contactPhoneField.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type(expectedContactPhone);
      await contactPhoneField.blur();
      await page.waitForTimeout(500);
      const contactPhoneValue = await contactPhoneField.inputValue();
      const digits = (contactPhoneValue || '').replace(/\D/g, '');
      if (digits.length === 10) {
        contactPhoneFilledCorrectly = true;
        console.log(`✅ Contact phone number filled successfully: ${contactPhoneValue}`);
        break;
      }
      console.log(`⚠️ Contact phone fill failed (got: '${contactPhoneValue}', digits: '${digits}') - retrying (attempt ${i + 1})`);
    }
    if (!contactPhoneFilledCorrectly) {
      const lastVal = await contactPhoneField.inputValue();
      console.log(`❌ Contact phone number failed to fill after 3 attempts. Last value: ${lastVal}`);
    }
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Contact Email' }).fill(randEmail());
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    console.log('Account creation completed');

    // Wait for the qualification page to load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Coverage selections - wait for dropdown to be available
    const coverageDropdown = page.locator('#xddl_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');
    await coverageDropdown.waitFor({ state: 'visible', timeout: 30000 });
    await coverageDropdown.selectOption('BOP');
    await page.waitForTimeout(1200);
    await page.locator('#xrgn_WillBuildingCoverageBeRequested_124_WillBuildingCoverageBeRequested_124_Question_Control').getByText('No', { exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('radio').first().click();
    await page.waitForTimeout(1000);
    await page.locator('#xddl_WhatIsTheTotalNumberOfPowerUnits_121_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').selectOption('01');
    await page.waitForTimeout(1000);
    await page.getByRole('radio').nth(2).click();
    await page.waitForTimeout(1000);
    await page.locator('#xddl_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').selectOption('13');
    await page.waitForTimeout(1200);
    await page.locator('#txt_AnnualGrossSales_All_008_AnnualGrossSales_All_008_Integer_Question').fill('45555');
    await page.waitForTimeout(1200);
    await page.locator('#xrgn_CertifyQuestion_101_Ext_CertifyQuestion_101_Ext_Question_Control > div > .ui-xcontrols-row > div > div > .ui-xcontrols > div:nth-child(2) > span').first().click();
    await page.waitForTimeout(1500);
    await page.waitForTimeout(2000);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Next' }).click();
    // Robust wait for package selection page (commercial package icon)
    const packageIcon = page.locator('#chk_CommercialPackage + .ui-checkbox-icon');
    await packageIcon.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1000); // Small buffer for UI stability
    if (trackMilestone) {
      trackMilestone('Account Created');
    }

    console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };
