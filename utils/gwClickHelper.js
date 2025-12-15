async function clickGuidewireText(page, text) {
  const locator = page.locator(`text="${text}"`);
  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    await locator.click();
    return true;
  } catch (e) {
    console.error(`Failed to click: ${text}`, e);
    return false;
  }
}

module.exports = { clickGuidewireText };
