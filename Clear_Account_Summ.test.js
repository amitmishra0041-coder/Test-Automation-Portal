import { test, expect } from '@playwright/test';
const { getEnvUrls } = require('./helpers/envConfig');

test('test', async ({ page }) => {
  test.setTimeout(1800000); // 30 minutes for clicking many hyperlinks
  const env = process.env.TEST_ENV || 'qa';
  const { writeBizUrl } = getEnvUrls(env);
  await page.goto(writeBizUrl);
  await page.getByRole('textbox', { name: 'User ID:' }).click();
  await page.getByRole('textbox', { name: 'User ID:' }).fill('amitmish');
  await page.getByRole('textbox', { name: 'User ID:' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password:' }).press('CapsLock');
  await page.getByRole('textbox', { name: 'Password:' }).fill('Bombay12$');
  
  await page.getByRole('button', { name: 'Log In' }).click();
  
  // Click all hyperlinks with onclick="$ClientHelper.Default.processMessage('pc:...','...');" pattern
  let clickedCount = 0;
  while (true) {
    try {
      // Find all matching hyperlinks
      const links = await page.locator('a[onclick*="pc:"]').all();
      
      if (links.length === 0) {
        console.log(`✅ Finished clicking ${clickedCount} hyperlink(s)`);
        break;
      }
      
      // Click the first link
      await links[0].click();
      clickedCount++;
      console.log(`✅ Clicked hyperlink ${clickedCount}`);
      
      // Wait for page to process and reload
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      
      // Navigate back or close the opened client summary if needed
      await page.getByRole('button', { name: 'Close This Client' }).click({ timeout: 3000 }).catch(() => {
        console.log('⏭️  "Close This Client" button not found, continuing');
      });
      await page.waitForTimeout(500);
      
    } catch (error) {
      console.log(`⏹️  No more hyperlinks found or error occurred: ${error.message}`);
      break;
    }
  }
});