const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'Create_Package.test.js');
const content = fs.readFileSync(filePath, 'utf8');

const oldCode = `      // Run alternate replacement cost entry logic
      await page.getByRole('button', { name: ' Enter replacement cost' }).click();
      await page.locator('#txtCP7Limit52_integerWithCommas').click();
      await page.locator('#txtCP7Limit52_integerWithCommas').fill('16,5656');
      await page.getByRole('button', { name: ' Save' }).click();
      await page.getByRole('button', { name: ' Save' }).click();`;

const newCode = `      // Run alternate replacement cost entry logic
      await page.getByRole('button', { name: ' Enter replacement cost' }).click();
      const limit52Input = page.locator('#txtCP7Limit52_integerWithCommas');
      await limit52Input.waitFor({ state: 'visible', timeout: 10000 });
      await limit52Input.waitFor({ state: 'attached', timeout: 10000 });
      await page.waitForTimeout(1000);
      // Click to select all existing text
      await limit52Input.click({ clickCount: 3 });
      await page.waitForTimeout(500);
      // Clear by pressing Backspace
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);
      // Type character by character for comma formatting
      await page.keyboard.type('165656');
      await page.waitForTimeout(1000);
      // Blur to trigger validation
      await limit52Input.blur();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: ' Save' }).click();
      await page.getByRole('button', { name: ' Save' }).click();`;

if (content.includes(oldCode)) {
  const updated = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, updated);
  console.log('✅ Update successful');
} else {
  console.log('⚠️ Pattern not found');
}
