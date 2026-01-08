const XLSX = require('xlsx');
const wb = XLSX.readFile('WB_Test_Report.xlsx');
console.log('\n📊 Excel Workbook Structure:');
console.log('Sheet names:', wb.SheetNames);
console.log('\n📈 Milestones Analytics Preview:');
const analyticsSheet = wb.Sheets['Milestones_Analytics'];
if (analyticsSheet) {
  const data = XLSX.utils.sheet_to_json(analyticsSheet);
  console.log('Total milestones tracked:', data.length);
  console.log('\nTop 5 slowest milestones:');
  data.slice(0, 5).forEach((row, i) => {
    console.log(`  ${i+1}. ${row['Milestone']}: avg ${row['Average Duration (s)']}s (min ${row['Min Duration (s)']}s, max ${row['Max Duration (s)']}s, runs: ${row['Total Runs']})`);
  });
} else {
  console.log('❌ Milestones_Analytics sheet not found!');
}
