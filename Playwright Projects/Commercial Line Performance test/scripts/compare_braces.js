const fs = require('fs');
const p1 = 'c:\\Users\\amitmish\\Playwright Projects\\Commercial Line Performance test\\accountCreationHelper.js';
const p2 = 'c:\\Users\\amitmish\\Playwright Projects\\Coverage Part change\\accountCreationHelper.js';
function analyze(p){
  const s = fs.readFileSync(p,'utf8');
  return { path: p, openBraces:(s.match(/{/g)||[]).length, closeBraces:(s.match(/}/g)||[]).length };
}
console.log(JSON.stringify([analyze(p1), analyze(p2)], null, 2));
