// scripts/ebt/deckUpdate.js — refresh the weekly "EBT Status Summary" deck from the EBT feedback tracker and the
// teams' test case workbook (scripts/ebt/testCases.js; EBT_CASES_PATH).
// Takes the NEWEST "EBT Status Summary*.pptx" in the deck folder (the user edits it between meetings), writes a
// dated copy next to it (never overwrites: "... - 11-11 v2.pptx" if today's name is taken) and fills it via
// PowerPoint (updateEbtDeck.ps1). Slide 1 is the layout in ebtSlide.js: put in once, then only its numbers and
// its right column (progress by team, JIRA by status) are refreshed. Usage: node scripts/ebt/deckUpdate.js [deckFolderOrFile]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const tracker = require('./tracker');
const { writeSlide, slideData } = require('./ebtSlide');
const { readProgress } = require('./testCases');

const DEFAULT_DIR = process.env.EBT_DECK_DIR || path.join(os.homedir(), 'Desktop', 'EBT PPT');
const STATUS_ORDER = ['New', 'Open', 'To Do', 'In Business Review', 'Fixed', 'Ready for Retest', 'Re-Open', 'Impeded', 'Deferred', 'Rejected', 'Closed'];

function latestDeck(dirOrFile) {
  if (/\.pptx$/i.test(dirOrFile)) return dirOrFile;
  const decks = fs.readdirSync(dirOrFile).filter((f) => /^EBT Status Summary.*\.pptx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => ({ f: path.join(dirOrFile, f), t: fs.statSync(path.join(dirOrFile, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!decks.length) throw new Error(`No "EBT Status Summary*.pptx" in ${dirOrFile}`);
  return decks[0].f;
}

function outputName(src) {
  const d = new Date();
  const base = path.join(path.dirname(src), `EBT Status Summary - ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  let out = `${base}.pptx`, v = 2;
  while (fs.existsSync(out)) out = `${base} v${v++}.pptx`;
  return out;
}

// statuses (optional): current JIRA statuses by key, applied over the tracker's Status column (used when the
// tracker itself couldn't be refreshed, e.g. it's open in Excel).
async function updateDeck(dirOrFile = DEFAULT_DIR, { statuses } = {}) {
  const src = latestDeck(dirOrFile);
  const out = outputName(src);
  const entries = (await tracker.listEntries()).map((e) => (statuses && statuses[e.jiraId] ? { ...e, status: statuses[e.jiraId] } : e));
  // Scenario progress by team; the deck is still refreshed (with the feedback areas instead) when it can't be read.
  let cases = null, casesError = '';
  try { cases = readProgress(); if (!cases) casesError = 'test case workbook not found'; } catch (e) { casesError = e.message; }
  const tmp = path.join(os.tmpdir(), `ebt-deck-${Date.now()}.json`);
  // The slide-1 layout as a one-slide deck (used only when the source deck isn't in that layout yet).
  const slideFile = await writeSlide(path.join(os.tmpdir(), `ebt-slide-${Date.now()}.pptx`));
  fs.writeFileSync(tmp, JSON.stringify({
    entries, statusOrder: STATUS_ORDER, slide: slideData(entries, STATUS_ORDER, cases),
    jiraSite: String(process.env.JIRA_SITE || 'donegalgroup.atlassian.net').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    refreshed: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  }), 'utf8');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'updateEbtDeck.ps1'),
      '-Source', src, '-Out', out, '-DataJson', tmp, '-SlideFile', slideFile], { stdio: 'pipe', timeout: 180000 });
  } catch (e) {
    throw new Error(`PowerPoint update failed: ${String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' ')}`);
  } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(slideFile, { force: true }); }
  const jira = entries.filter((e) => /^[A-Z][A-Z0-9]+-\d+$/.test(e.jiraId)).length;
  return { source: src, output: out, observations: entries.length, jira, scenarios: cases ? cases.total : null, casesError };
}

module.exports = { updateDeck, latestDeck };

if (require.main === module) {
  updateDeck(process.argv[2]).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
