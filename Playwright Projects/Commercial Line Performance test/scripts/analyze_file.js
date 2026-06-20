const fs = require('fs');
const p = 'c:\\Users\\amitmish\\Playwright Projects\\Commercial Line Performance test\\accountCreationHelper.js';
const s = fs.readFileSync(p,'utf8');
const openBraces=(s.match(/{/g)||[]).length;
const closeBraces=(s.match(/}/g)||[]).length;
const backticks=(s.match(/`/g)||[]).length;
const openPar=(s.match(/\(/g)||[]).length;
const closePar=(s.match(/\)/g)||[]).length;
console.log(JSON.stringify({openBraces, closeBraces, openPar, closePar, backticks}, null, 2));

// Find line where brace depth peaks and final depth
const lines = s.split(/\r?\n/);
let depth = 0;
let maxDepth = 0;
let maxDepthLine = -1;
for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	for (const ch of line) {
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
	}
	if (depth > maxDepth) { maxDepth = depth; maxDepthLine = i + 1; }
}
console.log('finalDepth:', depth, 'maxDepth:', maxDepth, 'maxDepthLine:', maxDepthLine);
// Find the last line where depth was zero
let lastZero = -1;
depth = 0;
for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	for (const ch of line) {
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
	}
	if (depth === 0) lastZero = i + 1;
}
console.log('lastLineWithZeroDepth:', lastZero, 'totalLines:', lines.length);
if (lastZero < lines.length) {
	console.log('Missing closing brace likely after line', lastZero);
}
