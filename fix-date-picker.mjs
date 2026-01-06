import fs from 'fs';

const filePath = './Create_Package.test.js';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the hardcoded date selection with dynamic calculation
const oldPattern = `    await glCoverageField.blur();
    await page.locator('.input-group-text').first().click();
    // Select the last instance of day 31 to avoid strict mode violation (current month vs previous month)
    await page.getByRole('cell', { name: '31' }).last().click();
    await page.locator('#xrgn_zgni6as6fl4tt7q4qkleqpts9jaValue > .ui-xcontrols > .input-group-append > .input-group-text > .fas').click();
    await page.getByTitle('Next Month').click();
    await page.getByRole('cell', { name: '30' }).nth(1).click();
    await page.getByRole('button', { name: ' Save' }).click();`;

const newPattern = `    await glCoverageField.blur();
    
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
    await page.getByRole('button', { name: ' Save' }).click();`;

if (content.includes(oldPattern)) {
  content = content.replace(oldPattern, newPattern);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Successfully updated date picker logic to use dynamic dates');
} else {
  console.log('⚠️  Pattern not found, trying line-by-line replacement...');
  
  // Try replacing the specific problematic lines
  const lines = content.split('\n');
  let modified = false;
  
  for (let i = 0; i < lines.length; i++) {
    // Find the line with day 30 selection
    if (lines[i].includes("getByRole('cell', { name: '30' }).nth(1).click()")) {
      console.log(`Found line ${i + 1}: ${lines[i].trim()}`);
      
      // Insert date calculation before the blur line (a few lines back)
      let blurIndex = i;
      while (blurIndex > 0 && !lines[blurIndex].includes('glCoverageField.blur()')) {
        blurIndex--;
      }
      
      if (blurIndex > 0) {
        // Insert the date calculation code after the blur line
        const dateCalcCode = [
          '    ',
          '    // Calculate dates dynamically: current month last day and +2 months last day',
          '    const today = new Date();',
          '    const currentMonthLastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();',
          '    const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, 0);',
          '    const twoMonthsLastDay = twoMonthsLater.getDate();'
        ];
        
        lines.splice(blurIndex + 1, 0, ...dateCalcCode);
        
        // Update the index after insertion
        i += dateCalcCode.length;
        
        // Replace the day 31 line
        for (let j = blurIndex; j < i + 10 && j < lines.length; j++) {
          if (lines[j].includes("getByRole('cell', { name: '31' }).last().click()")) {
            lines[j] = lines[j].replace(
              "getByRole('cell', { name: '31' }).last().click()",
              "getByRole('cell', { name: String(currentMonthLastDay) }).last().click()"
            );
            // Update comment
            if (j > 0 && lines[j-1].includes('Select the last instance')) {
              lines[j-1] = '    // Select the last day of current month (use .last() to avoid strict mode violation)';
            }
          }
        }
        
        // Replace the day 30 line
        lines[i] = lines[i].replace(
          "getByRole('cell', { name: '30' }).nth(1).click()",
          "getByRole('cell', { name: String(twoMonthsLastDay) }).last().click()"
        );
        
        // Add comment before the replaced line
        if (!lines[i-1].includes('Select the last day')) {
          lines.splice(i, 0, '    // Select the last day of the month that is 2 months from now');
          i++;
        }
        
        modified = true;
        console.log(`✅ Replaced line ${i + 1} with dynamic date calculation`);
        break;
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log('✅ Successfully updated date picker logic to use dynamic dates');
  } else {
    console.log('❌ Could not find the pattern to replace');
  }
}
