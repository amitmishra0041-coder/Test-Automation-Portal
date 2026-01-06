import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, 'Create_Package.test.js');

let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

let newLines = [];
let i = 0;
let replaced = false;

while (i < lines.length) {
  // Look for the pattern: .click() on limit52
  if (!replaced && 
      lines[i].includes('#txtCP7Limit52_integerWithCommas') && 
      lines[i].includes('.click()') &&
      i + 1 < lines.length &&
      lines[i + 1].includes('#txtCP7Limit52_integerWithCommas') && 
      lines[i + 1].includes('.fill')) {
    
    // Replace these 4 lines with the new pattern
    newLines.push('      const limit52Input = page.locator(\'#txtCP7Limit52_integerWithCommas\');');
    newLines.push('      await limit52Input.waitFor({ state: \'visible\', timeout: 10000 });');
    newLines.push('      await limit52Input.waitFor({ state: \'attached\', timeout: 10000 });');
    newLines.push('      await page.waitForTimeout(1000);');
    newLines.push('      // Click to select all existing text');
    newLines.push('      await limit52Input.click({ clickCount: 3 });');
    newLines.push('      await page.waitForTimeout(500);');
    newLines.push('      // Clear by pressing Backspace');
    newLines.push('      await page.keyboard.press(\'Backspace\');');
    newLines.push('      await page.waitForTimeout(500);');
    newLines.push('      // Type character by character for comma formatting');
    newLines.push('      await page.keyboard.type(\'165656\');');
    newLines.push('      await page.waitForTimeout(1000);');
    newLines.push('      // Blur to trigger validation');
    newLines.push('      await limit52Input.blur();');
    newLines.push('      await page.waitForTimeout(1500);');
    newLines.push(lines[i + 2]); // First Save button
    newLines.push(lines[i + 3]); // Second Save button
    
    i += 4;
    replaced = true;
  } else {
    newLines.push(lines[i]);
    i++;
  }
}

if (replaced) {
  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('✅ Successfully updated limit52 input logic');
} else {
  console.log('❌ Pattern not found');
  process.exit(1);
}
