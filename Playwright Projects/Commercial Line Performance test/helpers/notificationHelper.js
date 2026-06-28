/**
 * helpers/notificationHelper.js
 * Extracted from Create_Package.test.js and Create_CA_FinalCopy.test.js.
 * Centralizes notification dismissal and quote polling.
 */

async function dismissNotification(page) {
  try {
    const btn = page.locator('button.wb-bell-btn-ack');
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      await btn.waitFor({ state: 'hidden', timeout: 3000 });
      console.log('Notification dismissed');
    }
  } catch (_) {}
}

async function getQuoteStatus(page, quoteNumber) {
  try {
    await dismissNotification(page);
    const row = page.locator(`#tblQuotes tbody tr:has-text("${quoteNumber}")`);
    await row.waitFor({ state: 'visible', timeout: 5000 });
    return (await row.locator('td').nth(11).innerText({ timeout: 5000 })).trim();
  } catch (e) {
    console.warn(`getQuoteStatus() error: ${e.message}`);
    return 'Quote Requested';
  }
}

async function waitForQuoteReady(page, quoteNumber, maxAttempts = 50, intervalMs = 10000) {
  let status = await getQuoteStatus(page, quoteNumber);
  console.log(`Initial quote status: "${status}"`);
  for (let i = 1; i <= maxAttempts && status === 'Quote Requested'; i++) {
    console.log(`Attempt ${i}/${maxAttempts}: waiting ${intervalMs / 1000}s...`);
    await page.waitForTimeout(intervalMs);
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissNotification(page);
    status = await getQuoteStatus(page, quoteNumber);
    console.log(`Attempt ${i} status: "${status}"`);
  }
  if (status !== 'Quoted')
    throw new Error(`Quote never reached Quoted after ${maxAttempts} attempts. Final: "${status}"`);
  console.log('Quote is now Quoted');
  return status;
}

module.exports = { dismissNotification, getQuoteStatus, waitForQuoteReady };
