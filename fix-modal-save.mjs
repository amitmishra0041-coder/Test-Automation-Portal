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
  // Look for the pattern: Blur to trigger validation for limit52
  if (!replaced && 
      lines[i].includes('// Blur to trigger validation') &&
      i + 2 < lines.length &&
      lines[i + 1].includes('limit52Input.blur()') &&
      lines[i + 2].includes('await page.waitForTimeout(1500)')) {
    
    // Add the lines up to blur
    newLines.push(lines[i]);     // // Blur to trigger validation
    newLines.push(lines[i + 1]); // await limit52Input.blur();
    newLines.push(lines[i + 2]); // await page.waitForTimeout(1500);
    
    // Add modal closing logic
    newLines.push('      // Close any blocking modals before Save');
    newLines.push('      try {');
    newLines.push('        const statusModal = page.locator(\'#dgic-status-message\');');
    newLines.push('        const isVisible = await statusModal.isVisible({ timeout: 2000 }).catch(() => false);');
    newLines.push('        if (isVisible) {');
    newLines.push('          console.log(\'⏳ Closing blocking status modal before Save...\');');
    newLines.push('          const closeBtn = statusModal.getByRole(\'button\', { name: /close|ok|done/i }).first();');
    newLines.push('          await closeBtn.click().catch(() => {});');
    newLines.push('          await page.waitForTimeout(1000);');
    newLines.push('        }');
    newLines.push('      } catch (e) {}');
    
    // Now add the safeClick calls instead of direct click
    newLines.push('      await safeClick(page.getByRole(\'button\', { name: \' Save\' }));');
    newLines.push('      await page.waitForTimeout(1500);');
    newLines.push('      await safeClick(page.getByRole(\'button\', { name: \' Save\' }));');
    
    // Skip the old lines
    i += 3;
    // Skip the old Save clicks (next 2 lines)
    if (i + 1 < lines.length &&
        lines[i].includes('await page.getByRole') &&
        lines[i].includes('Save')) {
      i += 2;
    }
    replaced = true;
  } else {
    newLines.push(lines[i]);
    i++;
  }
}

if (replaced) {
  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('✅ Successfully added modal closing logic before Save buttons');
} else {
  console.log('❌ Pattern not found');
  process.exit(1);
}
