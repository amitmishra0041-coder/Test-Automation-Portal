const { randEmail, randCompany, randAddress, randSSN } = require('./helpers/randomData');
const { randCityForState, randZipForState } = require('./stateConfig');

//const { getRandomAddressByState } = require('./address-helper/dist');
//const { getRandomAddressByState } = require('./address-helper/dist/zipData');


//const { randCityForState } = require('./stateConfig');
//const { getRandomAddress } = require('./address-helper/dist/index');


const { stateToZips, zipToCityState } = require('./address-helper/dist/zipData');

function getRandomAddressByState(state) {
  const zips = stateToZips[state];
  if (!zips || zips.length === 0) throw new Error(`No zips for state: ${state}`);
  const zip = zips[Math.floor(Math.random() * zips.length)];
  const location = zipToCityState[zip];
  if (!location) throw new Error(`No city/state for zip: ${zip}`);
  return {
    street: `${Math.floor(Math.random() * 900 + 100)} Main St`,
    city: location.city,
    state: location.state,
    zip
  };
}
// Create account and reach the package selection stage, reusing the same page/tab.
async function createAccountAndQualify(page, { writeBizUrl, testState, clickIfExists, trackMilestone, fallbackZip }) {
  // Local helper to generate a random 717 phone number
  const state = testState;
  console.log("🟢 createAccountAndQualify received testState:", state);
  function randPhone717() {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000); // 7 random digits
    return `717${randomDigits}`;
  }

  // Navigate and login
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).fill('amitmish');
  await page.getByRole('textbox', { name: 'Password:' }).fill('Bombay12$');
  await page.locator('#btnLogin').click({ timeout: 5000 });
  console.log('WB Login successful');

  // =========================
  // ✅ ADDRESS HANDLING (ONLY ONCE)
  // =========================
  let helperAddress = null;
try {
  helperAddress = getRandomAddressByState(state);
  console.log(`✅ Helper address: ${JSON.stringify(helperAddress)}`);
} catch (err) {
  console.log(`⚠️ Helper failed: ${err.message}`);
}

const mailingStreet = helperAddress?.street || randAddress();
const mailingCity   = helperAddress?.city   || randCityForState(testState);
const mailingZip    = helperAddress?.zip    || randZipForState(testState);

  // DEBUG (optional but helpful)
  console.log("📍 Final Address:", {
    mailingStreet,
    mailingCity,
    mailingZip
  });

  // Create new client
  //await page.getByRole('button', { name: 'Create a New Client' }).click();
  await page.locator('#btn_CreateClient').click();
  // Wait for page to fully load after clicking Create a New Client
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // Allow UI to render fully in perf env

  // Robust wait for the agency search field in old and new Kraken UI
  await page.waitForFunction(() => {
    const selectors = [
      '#acg_agency_input',
      '#txtAgency_input',
      'input.dgic-autocomplete-grid',
      'input[data-toggle="dropdown"]',
      'input[placeholder*="Enter Search Text"]',
      'input[placeholder*="Search Text here"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0') {
        return true;
      }
    }
    return false;
  }, { timeout: 25000 });

  const searchTextField = page.locator('#acg_agency_input, #txtAgency_input, input.dgic-autocomplete-grid, input[data-toggle="dropdown"], input[placeholder*="Enter Search Text"], input[placeholder*="Search Text here"]');
  if (await searchTextField.count() > 0) {
    await searchTextField.first().click();
  } else {
    await page.getByText('Enter Search Text here or', { exact: false }).click();
  }

  // Select agency and producer based on state
  let agencyCode, producerName;

  if (['CO', 'IL', 'IN'].includes(testState)) {
    agencyCode = '4501307';
    producerName = 'JEFFERY S. REYNOLDS';
  } else if (testState === 'AZ') {
    agencyCode = '9000325';
    producerName = 'CHRISTINA M. BOWER';
  } else {
    agencyCode = '0000988';
    producerName = 'CHRISTINA M. BOWER';
  }

  // Agency selection - support both old and Kraken UI locators
  const agencyInputSelectors = [
    '#acg_agency_input',
    '#txtAgency_input',
    'input.dgic-autocomplete-grid',
    'input[data-toggle="dropdown"]',
    'input[placeholder*="Enter Search Text"]',
    'input[placeholder*="Search Text here"]'
  ];

  let agencyInput = null;
  for (const selector of agencyInputSelectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count() === 0) continue;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    agencyInput = candidate;
    break;
  }
  if (!agencyInput) {
    throw new Error('Agency search input was not found on the page');
  }

  await agencyInput.click({ clickCount: 3, timeout: 10000 });
  await agencyInput.fill(agencyCode).catch(() => { });
  await page.waitForTimeout(500);

  let currentValue = await agencyInput.inputValue().catch(() => '');
  if (currentValue !== agencyCode) {
    await agencyInput.click({ clickCount: 1 });
    await agencyInput.press('Control+A');
    await page.keyboard.type(agencyCode, { delay: 60 });
    await page.waitForTimeout(500);
    currentValue = await agencyInput.inputValue().catch(() => '');
    console.log(`Agency input value after typing: '${currentValue}'`);
  }

  if (currentValue !== agencyCode) {
    console.log(`⚠️ Agency field did not retain value after typing, trying a second attempt`);
    await agencyInput.click({ clickCount: 1 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type(agencyCode, { delay: 60 });
    await page.waitForTimeout(500);
    currentValue = await agencyInput.inputValue().catch(() => '');
    console.log(`Agency input value after second attempt: '${currentValue}'`);
  }

  // Click the search trigger icon to force display of search results in Kraken UI
  const searchTrigger = page.locator('div.input-group-text:has(i.fas.fa-th)').first();
  if (await searchTrigger.count() > 0 && await searchTrigger.isVisible().catch(() => false)) {
    await searchTrigger.click({ force: true });
    await page.waitForTimeout(800);
  }

  // Press arrow down to open dropdown/autocomplete if needed
  await agencyInput.press('ArrowDown').catch(() => { });
  await page.waitForTimeout(600);

  // Prefer the old search-result gridcell pattern, falling back to visible dropdown items
  const gridcellOption = page.getByRole('gridcell', { name: agencyCode }).first();
  if (await gridcellOption.count() > 0) {
    await gridcellOption.waitFor({ state: 'visible', timeout: 15000 });
    await gridcellOption.click({ force: true });
  } else {
    const agencyOption = page.locator('.ui-menu.ui-widget:visible, .dropdown-menu.show, .bs-select .dropdown-menu.show, [role="option"]:visible')
      .filter({ hasText: agencyCode })
      .first();
    await agencyOption.waitFor({ state: 'visible', timeout: 15000 });
    await agencyOption.click({ force: true });
  }

  async function clickItemByText(text) {
    const roleItem = page.getByRole('gridcell', { name: text }).first();
    if (await roleItem.count() > 0) {
      await roleItem.click();
      return;
    }

    // Try to find a native <select> with an option that matches the text and use selectOption
    const selectCount = await page.locator('select').count();
    for (let i = 0; i < selectCount; i++) {
      const sel = page.locator('select').nth(i);
      const optionTexts = await sel.locator('option').allTextContents();
      if (optionTexts.some(o => (o || '').trim() === text)) {
        try {
          await sel.selectOption({ label: text });
          console.log(`✅ Selected option '${text}' via native <select>`);
          return;
        } catch (e) {
          console.log(`⚠️ selectOption failed for '${text}': ${e.message}`);
        }
      }
    }

    // Try bootstrap-style .bs-select dropdown items
    const bsItem = page.locator('.bs-select .dropdown-menu .dropdown-item').filter({ hasText: text }).first();
    if (await bsItem.count() > 0) {
      // Attempt to open its parent bs-select toggle first
      const parent = bsItem.locator('xpath=ancestor::div[contains(@class,"bs-select")]').first();
      const toggle = parent.locator('button').first();
      if (await toggle.count() > 0) {
        await toggle.click({ force: true }).catch(() => { });
        await page.waitForTimeout(300);
      }
      await bsItem.click({ force: true }).catch(async () => {
        // If direct click fails, try clicking the toggle then the visible item id pattern
        const id = await bsItem.getAttribute('id').catch(() => null);
        if (id) {
          await page.locator(`#${id}`).click({ force: true }).catch(() => { });
        }
      });
      console.log(`✅ Selected bootstrap dropdown item '${text}'`);
      return;
    }

    // Try generic visible dropdown options first (may be hidden by BS styles)
    const dropdownOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item, [role="option"]:visible').filter({ hasText: text }).first();
    if (await dropdownOption.count() > 0) {
      await dropdownOption.click({ force: true }).catch(() => { });
      return;
    }

    // As a last resort click by visible text
    const fallback = page.locator(`text="${text}"`).first();
    await fallback.waitFor({ state: 'visible', timeout: 10000 });
    await fallback.click();
  }

  async function fillLabeledTextbox(labelTextOrList, value, sectionText) {
    const labelList = Array.isArray(labelTextOrList) ? labelTextOrList : [labelTextOrList];
    const sectionLocator = sectionText
      ? page.locator(`xpath=//*[contains(normalize-space(.), ${JSON.stringify(sectionText)})]`)
      : page;
    const sectionClause = sectionText
      ? `and ancestor::*[.//*[normalize-space(.)=${JSON.stringify(sectionText)}]]`
      : '';
    for (const labelText of labelList) {
      const directSelectors = {
        City: ['#txtLocationCity', 'input[name="txtLocationCity"]', 'input[id*="LocationCity"]'],
        'Zip Code': ['#txtLocationZip', 'input[name="txtLocationZip"]', 'input[id*="LocationZip"]', 'input[name*="Zip"]'],
        'Phone Number': ['#txtLocationPhone', 'input[name="txtLocationPhone"]', 'input[id*="LocationPhone"]', '#txtPhone', 'input[aria-label*="Phone"]', 'input[placeholder*="Phone"]'],
        'Email Address': ['#txtLocationEmail', 'input[name="txtLocationEmail"]', 'input[id*="LocationEmail"]', '#txtClientInformationEmail', 'input[name="txtClientInformationEmail"]', 'input[id="txtClientInformationEmail"]', 'input[type="email"]', 'input[aria-label*="Email"]', 'input[placeholder*="Email"]'],
        'Business Name': ['#txtBusinessName', 'input[name="txtBusinessName"]', 'input[id*="BusinessName"]']
      }[labelText] || [];
      for (const selector of directSelectors) {
        const direct = sectionLocator.locator(selector).first();
        if (await direct.count() > 0 && await direct.isVisible().catch(() => false)) {
          await direct.clear();
          await direct.fill(value);
          return;
        }
      }
      const explicit = sectionLocator.getByRole('textbox', { name: labelText }).first();
      if (await explicit.count() > 0) {
        await explicit.fill(value);
        return;
      }
      const fallback = sectionLocator.locator(
        `xpath=//*[normalize-space(.)=${JSON.stringify(labelText)} ${sectionClause}]/following::input[1]`
      ).first();
      if (await fallback.count() > 0) {
        await fallback.fill(value);
        return;
      }
      const genericFallback = sectionLocator.locator(
        `xpath=//label[contains(normalize-space(.), ${JSON.stringify(labelText)}) ${sectionClause}]/following::input[1] | //*[contains(normalize-space(.), ${JSON.stringify(labelText)}) ${sectionClause}]/following::input[1] | //input[contains(@id, ${JSON.stringify(labelText)})] | //input[contains(@name, ${JSON.stringify(labelText)})] | //input[contains(@placeholder, ${JSON.stringify(labelText)})]`
      ).first();
      if (await genericFallback.count() > 0) {
        await genericFallback.fill(value);
        return;
      }
    }
    throw new Error(`Unable to locate textbox for labels '${labelTextOrList}'`);
  }

  // Wait for producer dropdown to auto-open after agency selection
  await page.waitForTimeout(2000);

  // Try old UI first; otherwise use the new Kraken producer bootstrap-select.
  let producerItems = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .ui-menu.ui-widget:visible a');
  if (await producerItems.count() === 0) {
    const producerToggle = page.locator('button[data-id="ddlProducer"]').first();
    await producerToggle.waitFor({ state: 'visible', timeout: 10000 });
    await producerToggle.click({ force: true });
    await page.waitForTimeout(500);
    const producerContainer = page.locator('div.dropdown.bootstrap-select:has(button[data-id="ddlProducer"])');
    producerItems = producerContainer.locator('.dropdown-menu.show .dropdown-item');
  }

  const allProducers = await producerItems.allTextContents();
  console.log(`📋 Available producers in menu: ${JSON.stringify(allProducers)}`);
  console.log(`🎯 Looking for producer: "${producerName}"`);

  // Find the exact producer match index
  const producerIndex = allProducers.findIndex(p => p === producerName);

  if (producerIndex === -1) {
    throw new Error(`Producer "${producerName}" not found in dropdown`);
  }

  console.log(`🔍 Found exact producer at index ${producerIndex}: "${allProducers[producerIndex]}"`);

  const producerItem = producerItems.filter({ hasText: producerName }).first();
  await producerItem.waitFor({ state: 'visible', timeout: 15000 });
  const itemText = await producerItem.textContent();
  console.log(`✅ About to select producer: "${itemText}"`);
  try {
    await clickItemByText(itemText.trim());
  } catch (e) {
    await producerItem.click({ force: true });
  }

  const producerSelect = page.locator('#ddlProducer');
  if (await producerSelect.count() > 0) {
    await producerSelect.selectOption({ label: producerName }).catch(() => { });
  }

  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded').catch(() => { });
  await page.waitForTimeout(1000);
  const clientFormReady = page.locator('text=Business Name, text=Company/ Individual Name, text=Street Line 1, text=Account Mailing Address').first();
  await clientFormReady.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {
    console.log('⚠️ Client info form did not appear within 30s, current URL:', page.url());
  });




  // Fill client info
  await fillLabeledTextbox(['Business Name', 'Company/ Individual Name', 'Company Name'], randCompany(), 'Account Information');
  await page.waitForTimeout(800);

  //Address helper#1




  function randPhone717() {
    return `717${Math.floor(1000000 + Math.random() * 9000000)}`;
  }

  // ... ALL YOUR EXISTING LOGIN / NAVIGATION CODE ABOVE ...



  // =========================
  // ✅ USE VALUES (NO DUPLICATES)
  // =========================
  await fillLabeledTextbox(
    'Street Line 1',
    mailingStreet,
    'Account Mailing Address'
  );

  await fillLabeledTextbox(
    'City',
    mailingCity,
    'Account Mailing Address'
  );

  await fillLabeledTextbox(
    'Zip Code',
    mailingZip,
    'Account Mailing Address'
  );

  // =========================
  // CONTINUE REST OF FLOW
  // =========================

  await page.waitForTimeout(800);

  // REMOVE ALL OTHER:
  // ❌ mailingStreet usage outside this block
  // ❌ duplicate createAccountAndQualify definition
  // ❌ helperAddress?.street logic






  //removed for address helper 
  //await fillLabeledTextbox('Street Line 1', randAddress(), 'Account Mailing Address');


  // Select state first so dependent city dropdown/autocomplete can resolve properly
  let stateSet = false;
  const stateSelect = page.locator('#ddlLocationState, select[name="ddlLocationState"], select[id*="LocationState"], select[name*="LocationState"]');
  if (await stateSelect.count() > 0 && await stateSelect.first().isVisible().catch(() => false)) {
    try {
      await stateSelect.first().selectOption({ value: testState });
      console.log(`✅ State selected via native select: ${testState}`);
      stateSet = true;
    } catch (selectError) {
      console.log(`⚠️ Native state select failed: ${selectError.message}`);
    }
  }

  if (!stateSet) {
    const stateCombo = page.getByRole('combobox', { name: 'State' }).first();
    if (await stateCombo.count() > 0 && await stateCombo.isVisible().catch(() => false)) {
      try {
        await stateCombo.click({ force: true });
        await page.waitForTimeout(600);
        const menuOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item').filter({ hasText: testState }).first();
        if (await menuOption.count() > 0) {
          await menuOption.click({ force: true });
          console.log(`✅ State selected via combobox role: ${testState}`);
          stateSet = true;
        }
      } catch (comboError) {
        console.log(`⚠️ Combobox state selection failed: ${comboError.message}`);
      }
    }
  }

  if (!stateSet) {
    const stateFieldLabel = page.locator('label:has-text("State")').first();
    if (await stateFieldLabel.count() > 0) {
      const stateField = stateFieldLabel.locator('..').locator('select, input, div[role="combobox"], .ui-combobox, button').first();
      if (await stateField.count() > 0 && await stateField.isVisible().catch(() => false)) {
        try {
          await stateField.click({ force: true });
          await page.waitForTimeout(600);
          const menuOption = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item').filter({ hasText: testState }).first();
          if (await menuOption.count() > 0) {
            await menuOption.click({ force: true });
            console.log(`✅ State selected via labeled fallback: ${testState}`);
            stateSet = true;
          }
        } catch (fieldError) {
          console.log(`⚠️ Labeled state selection failed: ${fieldError.message}`);
        }
      }
    }
  }

  if (!stateSet) {
    throw new Error(`Unable to select state '${testState}'. State dropdown may be a custom control or the locator is incorrect.`);
  }


  await page.waitForTimeout(800);
  // await fillLabeledTextbox('Phone Number', randPhone717(), 'Account Mailing Address');


  const mailingPhone = page.locator('input[name="txtClientInformationPhone"]:visible').first();
  if (await mailingPhone.count() > 0 && await mailingPhone.isVisible().catch(() => false)) {
    await mailingPhone.click({ clickCount: 3 });
    await mailingPhone.press('Control+A');
    await mailingPhone.press('Delete');
    const mailingPhoneValue = randPhone717();
    await mailingPhone.fill(mailingPhoneValue);
    await mailingPhone.blur();

    const expectedDigits = mailingPhoneValue.replace(/\D/g, '');
    let normalized = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const currentPhone = await page.locator('input[name="txtClientInformationPhone"]:visible').first();
      if (await currentPhone.count() > 0 && await currentPhone.isVisible().catch(() => false)) {
        const value = await currentPhone.inputValue().catch(() => '');
        if (value.replace(/\D/g, '') === expectedDigits) {
          normalized = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }
    if (!normalized) {
      console.log('⚠️ Mailing phone did not normalize to expected digits within timeout, continuing anyway');
    } else {
      console.log(`✅ Mailing phone entered and normalized: ${mailingPhoneValue}`);
    }
  } else {
    await fillLabeledTextbox('Phone Number', randPhone717(), 'Account Mailing Address');
  }






  await page.waitForTimeout(1000);
  const emailCandidates = [
    page.locator('input[name="txtClientInformationEmail"]:visible').first(),
    page.locator('#txtClientInformationEmail:visible').first(),
    page.getByRole('textbox', { name: 'Email Address' }).first(),
    page.locator('input[type="email"]:visible').first(),
    page.locator('input[name*="mail"]:visible').first(),
    page.locator('input[placeholder*="mail"]:visible').first(),
    page.locator('input[aria-label*="mail"]:visible').first()
  ];
  let emailField = null;
  for (const candidate of emailCandidates) {
    if (await candidate.count() > 0 && await candidate.isVisible().catch(() => false)) {
      emailField = candidate;
      const name = await candidate.getAttribute('name').catch(() => null);
      const placeholder = await candidate.getAttribute('placeholder').catch(() => null);
      console.log(`ℹ️ Email candidate found: name=${name} placeholder=${placeholder}`);
      break;
    }
  }
  if (!emailField) {
    throw new Error('Unable to locate the contact/email field after entering mailing phone');
  }
  const emailValue = randEmail();
  await emailField.fill(emailValue);
  await emailField.blur();
  const filledEmail = await emailField.inputValue();
  if (filledEmail.trim() !== emailValue) {
    throw new Error(`Contact email was not filled correctly; got '${filledEmail}'`);
  }
  console.log(`✅ Contact email entered: ${emailValue}`);
  await page.waitForTimeout(1000);

  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  //accept as is logic
  //const acceptAsIsButton = page.locator('button:has-text("Accept As-Is")');


  await clickIfExists('Accept As-Is');
  await page.waitForTimeout(2000);

  await clickIfExists('Use Suggested');
  await page.waitForTimeout(500);
  // Click optional buttons immediately after Accept As-Is
  await clickIfExists('Account not listed');
  await page.waitForTimeout(500);
  await clickIfExists('Continue');






  // Everything after this point runs ONCE after successfully exiting the retry loop
  // CRITICAL: Wait for any address validation dialogs to fully close before proceeding
  // In parallel runs, dialogs can linger and block subsequent interactions
  await page.waitForTimeout(2000);



  // Business Description - wait for it to be visible and enabled
  const businessDescField = page.getByRole('textbox', { name: 'Business Description' });
  await businessDescField.waitFor({ state: 'visible', timeout: 30000 });
  await businessDescField.fill('test desc');

  // Select the Business Entity using the updated dropdown control
  const businessEntitySelect = page.locator('#ddlBusinessEntity').first();
  if (await businessEntitySelect.count() === 0 || !(await businessEntitySelect.isVisible().catch(() => false))) {
    throw new Error('Unable to locate Business Entity dropdown #ddlBusinessEntity');
  }
  await businessEntitySelect.waitFor({ state: 'visible', timeout: 20000 });
  const firstOption = await businessEntitySelect.locator('option:not([value=""])').first();
  const firstValue = await firstOption.getAttribute('value');
  if (!firstValue) {
    throw new Error('No selectable Business Entity option found in ddlBusinessEntity');
  }
  await businessEntitySelect.selectOption(firstValue);
  console.log(`✅ Selected Business Entity dropdown value: ${firstValue}`);
  await page.locator('#txtYearBusinessStarted').fill('2014');
  await page.getByRole('textbox', { name: 'Federal ID Number' }).fill(randSSN());
  // Enter NAICS code by typing one character at a time (mimic user typing),
  // then wait for suggestions to appear and click the matching result.
  const naicsInput = page.locator('#txtNAICSCode_input').first();
  if (await naicsInput.count() > 0 && await naicsInput.isVisible().catch(() => false)) {
    await naicsInput.click({ force: true });
    const naicsCode = '812210';
    for (const ch of naicsCode) {
      await naicsInput.type(ch, { delay: 120 });
    }
    // Wait for suggestion list to appear
    await page.waitForTimeout(2000);

    // Try to click a visible suggestion that contains the description
    const suggestion = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item, [role="option"]:visible')
      .filter({ hasText: 'Director services, funeral' }).first();
    if (await suggestion.count() > 0) {
      await suggestion.click({ force: true }).catch(() => { });
      console.log('✅ NAICS suggestion clicked');
    } else {
      // Fallback: click by visible text
      await page.locator('text="Director services, funeral"').first().click().catch(() => {
        console.log('⚠️ NAICS suggestion not found by selector or text');
      });
    }
  } else {
    console.log('⚠️ NAICS input not found or not visible');
  }

  // Contact info
  await page.locator('#txtContactFirstName').fill('test');
  await page.waitForTimeout(800);
  await page.locator('#txtContactLastName').fill('test');
  await page.waitForTimeout(800);
  // Retry contact phone fill until it sticks - keyboard typing, validate 10 digits
  const expectedContactPhone = '7175551212';
  let contactPhoneFilledCorrectly = false;
  const contactPhoneField = page.locator('#txtContactPhoneNumber');
  for (let i = 0; i < 3; i++) {
    await contactPhoneField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await contactPhoneField.press('Control+A');
    await contactPhoneField.press('Delete');
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
  await page.getByRole('textbox', { name: 'Email' }).fill(randEmail());
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('Account creation completed');

  // Wait for the qualification page to load
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  // Coverage selections - wait for dropdown to be available
  const coverageDropdown = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_IfCpLiabAndOrBusinessInterruptionCovWillBeRequested_123_Multiple_Choice_Question');
  await coverageDropdown.waitFor({ state: 'visible', timeout: 30000 });
  await coverageDropdown.selectOption('BOP');
  await page.waitForTimeout(1200);
  await coverageDropdown.selectOption('BOP');
  await page.waitForTimeout(1200);
  // 1) Select total number of power units (choose first non-empty option)
  const powerUnitsSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfPowerUnits_121_Multiple_Choice_Question').first();
  if (await powerUnitsSelect.count() > 0 && await powerUnitsSelect.isVisible().catch(() => false)) {
    try {
      await powerUnitsSelect.waitFor({ state: 'visible', timeout: 10000 });
      const firstOpt = powerUnitsSelect.locator('option:not([value=""])').first();
      if (await firstOpt.count() > 0) {
        const val = await firstOpt.getAttribute('value');
        if (val) {
          await powerUnitsSelect.selectOption(val).catch(() => { });
          console.log(`✅ Power units selected (value=${val})`);
        }
      }
    } catch (e) {
      console.log('⚠️ Power units select failed:', e.message);
    }
  } else {
    console.log('⚠️ Power units select not found or not visible');
  }
  await page.waitForTimeout(600);

  // 2) Select Vehicle type = Yes (toggle)
  const vehicleYesLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1_Yes').first();
  if (await vehicleYesLabel.count() > 0) {
    await vehicleYesLabel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    await vehicleYesLabel.click({ force: true }).catch(() => { });
    console.log('✅ Vehicle type set to Yes');
  } else {
    // Try the input directly as a fallback
    const vehicleYesInput = page.locator('input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_IsTheVehiclePrivatePassengerOrLightTruck_121_1"][value$="_Yes"]').first();
    if (await vehicleYesInput.count() > 0) {
      await vehicleYesInput.check().catch(() => { });
      console.log('✅ Vehicle type input checked (fallback)');
    } else {
      console.log('⚠️ Vehicle type Yes control not found');
    }
  }
  await page.waitForTimeout(600);
  // Robustly set the "Will Building Coverage Be Requested" radio to Yes.
  const buildingYesSelector = 'input[name="rdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124"][value$="_Yes"]';
  const buildingYes = page.locator(buildingYesSelector).first();
  await buildingYes.waitFor({ state: 'attached', timeout: 10000 }).catch(() => { });
  let setOk = false;
  try {
    await buildingYes.check({ timeout: 5000 });
    setOk = true;
    console.log('✅ Building coverage Yes checked via locator.check()');
  } catch (e) {
    console.log('⚠️ locator.check() failed for building coverage Yes:', e.message);
  }

  if (!setOk) {
    // Try clicking the label associated with the radio
    const labelFor = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_WillBuildingCoverageBeRequested_124_Yes').first();
    if (await labelFor.count() > 0) {
      try {
        await labelFor.click({ force: true });
        console.log('✅ Clicked label with force for building coverage Yes');
      } catch (e) {
        console.log('⚠️ Label click failed, will set checked via JS:', e.message);
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, buildingYesSelector);
      }
    } else {
      // As a last resort, set checked via JS
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, buildingYesSelector);
    }
  }

  // Verify the radio is checked, otherwise throw a helpful error
  await page.waitForTimeout(500);
  const isChecked = await buildingYes.isChecked().catch(() => false);
  if (!isChecked) {
    throw new Error('Unable to select "Will Building Coverage Be Requested = Yes"');
  }
  await page.waitForTimeout(1000);
  // 3) Select the total number of employees: prefer native <select> and pick first non-empty option
  const employeesSelect = page.locator('#xddl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Multiple_Choice_Question').first();
  if (await employeesSelect.count() > 0 && await employeesSelect.isVisible().catch(() => false)) {
    try {
      await employeesSelect.waitFor({ state: 'visible', timeout: 10000 });
      const firstEmpOpt = employeesSelect.locator('option:not([value=""])').first();
      if (await firstEmpOpt.count() > 0) {
        const empVal = await firstEmpOpt.getAttribute('value');
        if (empVal) {
          await employeesSelect.selectOption(empVal).catch(() => { });
          console.log(`✅ Employees selected (value=${empVal})`);
        }
      }
    } catch (e) {
      console.log('⚠️ Employees native select failed:', e.message);
    }
  } else {
    // Fallback: click first visible dropdown option (existing behavior)
    const label = page.locator('#xlbl_Question_Form_CLAcctProdEligibility_Ext_0_WhatIsTheTotalNumberOfEmployeesAcrossAllApplicableLocations_122_Question_Label').first();
    try { await label.scrollIntoViewIfNeeded(); } catch (e) { }
    const possibleToggle = label.locator('..').locator('button, .dropdown-toggle, .ui-combobox, select, .bs-select').first();
    if (await possibleToggle.count() > 0) {
      await possibleToggle.click({ force: true }).catch(() => { });
      await page.waitForTimeout(300);
    }
    const firstOpt = page.locator('.ui-menu.ui-widget:visible .ui-menu-item, .dropdown-menu.show .dropdown-item, [role="option"]:visible').first();
    if (await firstOpt.count() > 0) {
      await firstOpt.click({ force: true }).catch(() => { });
      console.log('✅ Selected first visible employees option via dropdown click (fallback)');
    } else {
      console.log('⚠️ Could not locate employees dropdown option; continuing');
    }
  }
  await page.waitForTimeout(1200);
  // Enter Annual Gross Sales formatted with comma separators so UI accepts it
  const grossSalesSelector = '#txt_Question_Form_CLAcctProdEligibility_Ext_0_AnnualGrossSales_All_008_Integer_Question_integerWithCommas';
  const grossSalesField = page.locator(grossSalesSelector).first();
  const grossSalesNumber = 45555;
  const grossSalesFormatted = grossSalesNumber.toLocaleString('en-US');
  if (await grossSalesField.count() > 0 && await grossSalesField.isVisible().catch(() => false)) {
    try {
      await grossSalesField.click({ clickCount: 3 }).catch(() => { });
      // Clear existing content via keyboard then type digits slowly so UI formatter runs
      await grossSalesField.press('Control+A').catch(() => { });
      await grossSalesField.press('Delete').catch(() => { });
      const rawDigits = '45555';
      await page.keyboard.type(rawDigits, { delay: 120 });
      await grossSalesField.blur().catch(() => { });
      // Wait for the UI to normalize/format the value (up to ~2s)
      for (let i = 0; i < 10; i++) {
        const cur = await grossSalesField.inputValue().catch(() => '');
        if ((cur || '').replace(/\D/g, '') === rawDigits) break;
        await page.waitForTimeout(200);
      }
      const finalVal = await grossSalesField.inputValue().catch(() => '');
      console.log(`✅ Typed gross sales, final field value: ${finalVal}`);
    } catch (e) {
      console.log('⚠️ Typing gross sales failed, falling back to fill:', e.message);
      await grossSalesField.fill(grossSalesFormatted).catch(() => { });
    }
  } else {
    console.log('⚠️ Gross sales field not found or not visible, attempting direct fill');
    await page.locator(grossSalesSelector).fill(grossSalesFormatted).catch(() => { });
  }
  await page.waitForTimeout(1200);

  await page.waitForTimeout(1200);
  // Select OccupySquareFeet = No: wait for the label then click (simple, like the working select)
  const occupyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_OccupySquareFeetOneLocation_All_010_No').first();
  await occupyLabel.waitFor({ state: 'visible', timeout: 15000 });
  await occupyLabel.click({ force: true });
  console.log('✅ Clicked OccupySquareFeet No label');
  await page.waitForTimeout(800);

  // Select CertifyQuestion Yes: wait for the label then click
  const certifyLabel = page.locator('#for_xrdo_Question_Form_CLAcctProdEligibility_Ext_0_CertifyQuestion_101_Ext_Yes').first();
  await certifyLabel.waitFor({ state: 'visible', timeout: 15000 });
  await certifyLabel.click({ force: true });
  console.log('✅ Clicked CertifyQuestion Yes label');
  await page.waitForTimeout(800);
  await page.waitForTimeout(2000);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Next' }).click();
  // Robust wait for package selection page (commercial package icon)
  //const packageIcon = page.locator('#chk_CommercialPackage + .ui-checkbox-icon');
  //await packageIcon.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1000); // Small buffer for UI stability
  if (trackMilestone) {
    trackMilestone('Account Created');
  }

  console.log('Account qualification completed');
}

module.exports = { createAccountAndQualify };