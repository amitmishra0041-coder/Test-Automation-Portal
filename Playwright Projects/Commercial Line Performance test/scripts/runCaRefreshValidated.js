// CA Refresh batch that validates each run the moment it finishes, so the next state never starts behind a false failure.
//   node scripts/runCaRefreshValidated.js --share-date 2026-11-06 [--pairs PA:BUSINESS_AUTO,PA:AUTO_DEALERS] [--env test]
// Per pair: run it alone (scripts/runCaRefreshBatch.js, no email, no share copy), then check the run's health from its log and
// saved test data:
//   STALL the run's log did not move for --stall-min minutes (default 5) -> run killed
//   ENV   WriteBiz Test trouble (location Address Validation stuck, territory code, "An error has occurred", account creation,
//         page timeouts with Test slow)
//   TOOL  the tool misbehaved (did not reach rating, coverage not added, scheduled item not picked / not mapped, no document)
//   -> any of these stops the batch at once for investigation - no waiting, no retries (user 11/06)
//   OK    rated and healthy -> the Word document is copied to the share (an older copy of the same state + LOB is replaced)
// Real product findings (MISSING / PARTIAL / MISMATCH) are results, not run problems - they never stop the batch.
// Quiet: one line per attempt in runtime-data/ca-refresh/validated/<stamp>/progress.txt, nothing else.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { DATA } = require('../helpers/caRefreshValidator');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..');
const RT = path.join(ROOT, 'runtime-data');
const env = arg('env', 'test');
const shareDir = path.join(arg('share', String.raw`V:\Amit Int\CARefresh\Results`), arg('share-date', new Date().toISOString().slice(0, 10)));
const pairs = (arg('pairs', '') || DATA.states.flatMap((s) => [`${s}:BUSINESS_AUTO`, `${s}:AUTO_DEALERS`]).join(',')).split(',').filter(Boolean);
const outDir = path.join(RT, 'ca-refresh', 'validated', new Date().toISOString().replace(/[:.]/g, '-'));
const progress = path.join(outDir, 'progress.txt');
const say = (s) => fs.appendFileSync(progress, `${new Date().toISOString().slice(11, 19)} ${s}\n`);

// Watchdog (user 11/06): a run whose log has not moved for --stall-min minutes (default 5) is stuck - kill it and stop the
// batch for investigation instead of waiting it out.
const stallMs = Number(arg('stall-min', '5')) * 60000;
// --lanes 2 (user 11/06): two runs at once, each on its OWN WriteBiz login (one login cannot hold two sessions). Lane 1 uses the
// .env logins as before; lane k >= 2 uses WB_USER_<k> / WB_PASS_<k> from .env, handed to its runs as every state's login
// (process env wins over dotenv). Each lane keeps its own Playwright output folder.
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const lanes = Number(arg('lanes', '1'));
function laneEnv(lane) {
  if (lane === 1) return { ...process.env };
  const u = process.env[`WB_USER_${lane}`]; const p = process.env[`WB_PASS_${lane}`];
  if (!u || !p) throw new Error(`--lanes ${lanes}: WB_USER_${lane} / WB_PASS_${lane} missing from .env`);
  const e = { ...process.env, WB_USER: u, WB_PASS: p };
  for (const st of DATA.states) { e[`WB_USER_${st}`] = u; e[`WB_PASS_${st}`] = p; }
  return e;
}
// the batch folder of THIS pair (another lane creates folders too): new since the start and holding this pair's log
const findDir = (batchRoot, before, st, lob) => (fs.existsSync(batchRoot) ? fs.readdirSync(batchRoot) : []).filter((d) => !before.has(d) && fs.existsSync(path.join(batchRoot, d, `${st}-${lob}.log`))).sort().pop();
// Two runs starting in the same second break one of them (11/07: Playwright's start-up clean-up -> "ENOENT scandir test-results-qa"
// in the other lane after 5 s). Space run starts at least 45 s apart.
let lastStart = 0;
async function startGate() {
  for (;;) { const wait = lastStart + 45000 - Date.now(); if (wait <= 0) break; await new Promise((r) => setTimeout(r, wait)); }
  lastStart = Date.now();
}
async function runPair(pair, lane = 1) {
  await startGate();
  const batchRoot = path.join(RT, 'ca-refresh', 'batch');
  const before = new Set(fs.existsSync(batchRoot) ? fs.readdirSync(batchRoot) : []);
  const [st, lob] = pair.split(':');
  const p = spawn(process.execPath, [path.join(__dirname, 'runCaRefreshBatch.js'), '--pairs', pair, '--env', env, '--until', 'RATING', '--email', '0', '--share', '0', '--output', lane === 1 ? 'test-results-qa' : `test-results-qa-lane${lane}`], { cwd: ROOT, stdio: 'ignore', env: laneEnv(lane) });
  let stalled = '';
  let lastSize = -1; let lastMove = Date.now();
  const timer = setInterval(() => {
    const dir = findDir(batchRoot, before, st, lob);
    const log = dir && path.join(batchRoot, dir, `${st}-${lob}.log`);
    const size = log && fs.existsSync(log) ? fs.statSync(log).size : 0;
    if (size !== lastSize) { lastSize = size; lastMove = Date.now(); return; }
    if (Date.now() - lastMove > stallMs && !stalled) {
      const text = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      stalled = `no progress for ${Math.round((Date.now() - lastMove) / 60000)} min after: ${(text.trim().split('\n').pop() || '').trim().slice(0, 140)}`;
      spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']);
    }
  }, 15000);
  await new Promise((r) => p.on('close', r));
  clearInterval(timer);
  const dir = findDir(batchRoot, before, st, lob);
  if (!dir) return { log: '', summary: '', stalled };
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return { dir: path.join(batchRoot, dir), log: read(path.join(batchRoot, dir, `${st}-${lob}.log`)), summary: read(path.join(batchRoot, dir, 'summary.txt')), stalled };
}

// Classify one finished run. Returns { kind: 'OK'|'ENV'|'TOOL', why: [...], doc }
function validate(pair, r) {
  const [st, lob] = pair.split(':');
  const log = r.log;
  const why = [];
  if (r.stalled) return { kind: 'STALL', why: [r.stalled], doc: '' };
  const rated = /OK Quote Rated Successfully/.test(log);
  const doc = (/doc=(\S+\.docx)/.exec(r.summary) || [])[1];
  if (!rated) {
    const envSigns = [
      [/open dialog\(s\): \[[^\]]*Address Validation/, 'location Address Validation dialog stuck'],
      [/territory code set/i, 'territory code not set on the location'],
      [/Closed "An error|An Error has Occ?ured/i, 'WriteBiz "An error has occurred"'],
      [/WriteBiz error box: .*unexpected error/i, 'WriteBiz "An unexpected error occurred"'],
      // SC Auto Dealers 11/07: "There was an error while loading your screen. Please refresh ..." alert over the page
      [/id="dgic-modal-alert_\d+"[^\n]*intercepts pointer events|dialog text: .*error while loading your screen/, 'WriteBiz alert "There was an error while loading your screen"'],
      // any WriteBiz error box open when the run failed (logged by the test since 11/07)
      [/Open WriteBiz box\(es\) at failure: .*(Error\(s\) occurred|Failed to create|unexpected error|error has occ?ur|error while loading|Technical Support|Agency Automation)/i, 'WriteBiz error box open when the run failed'],
      [/Account Information form still open|account creation failed/i, 'account creation'],
    ].filter(([re]) => re.test(log)).map(([, w]) => w);
    // WriteBiz's "Saving information and refreshing view..." spinner never clearing (AZ Auto Dealers 11/06, Special Type save)
    // counted in the run's last 150 lines only: a long dealer run collects 8+ timed-out waits over its whole log (11/07)
    if ((log.split('\n').slice(-150).join('\n').match(/Status modal visible \(attempt 5\)/g) || []).length >= 8) envSigns.push('WriteBiz "Saving information and refreshing view" spinner stuck');
    if (/dialog did not save - WRITEBIZ DEFECT/.test(log)) envSigns.push('WriteBiz defect: required fields disabled in a coverage dialog, which then would not save');
    // a timeout counts as WriteBiz trouble only when Test is visibly slow (Locations normally 12-30 s; 85 s when it breaks)
    const loc = Number((/OK Locations page Loaded \(([\d.]+)s\)/.exec(log) || [])[1] || 0);
    if (/Timeout \d+ms exceeded/.test(log) && loc >= 60) envSigns.push(`page timeout with WriteBiz slow (Locations ${loc}s)`);
    const last = (log.match(/^OK .*/gm) || []).pop() || 'none';
    return { kind: envSigns.length ? 'ENV' : 'TOOL', why: [...(envSigns.length ? envSigns : ['did not reach rating']), `last step: ${last.slice(0, 80)}`], doc };
  }
  let data = {};
  try { data = JSON.parse(fs.readFileSync(path.join(RT, `test-data-${st}-CARefresh-${lob}.json`), 'utf8')).caRefresh || {}; } catch (e) { why.push('no saved test data'); }
  const s = data.summary || {};
  // Known WriteBiz defect, CO only: the Special Type vehicle cannot be saved (UMPD disabled, blank and required), so the flow reads
  // and validates its coverages, removes it and rates - a finding in the document, not a run problem (CO 11/06).
  // UT 11/07: same defect - recognised from the log (the Special Types UMPD box txt_CA7Wanted30 blank + disabled) instead of a state list
  const umpdBox = /Next disabled: blank required fields \[[^\n]*txt_CA7Wanted30[^\n]*VehicleUninsuredMotoristPropertyDamageSPV/.test(log);
  const knownCo = (a) => (st === 'CO' || umpdBox) && a.coverage === 'Special Type vehicle' && /vehicle removed with/i.test(a.detail || '');
  const known = (data.additions || []).filter((a) => /FAILED|NO_ADD/.test(a.status) && knownCo(a)).length;
  if (s.additionsFailed) s.additionsFailed -= known;
  if (s.additionsFailed) why.push(`${s.additionsFailed} coverage(s) not added: ${(data.additions || []).filter((a) => /FAILED|NO_ADD/.test(a.status) && !knownCo(a)).map((a) => a.coverage).join('; ').slice(0, 200)}`);
  if (/could NOT pick/.test(log)) why.push('scheduled item coverage could not be picked');
  if (/item dialog did not open/.test(log)) why.push('scheduled item dialog did not open');
  const unmapped = [...log.matchAll(/scheduled item \d of "([^"]+)": terms read as (\[[^\]]*\])/g)].filter((m) => { try { const t = JSON.parse(m[2]); return !t.length || t.includes(m[1]); } catch (e) { return true; } });
  if (unmapped.length) why.push(`scheduled item terms not mapped to a model sub-coverage: ${unmapped.map((m) => m[1]).join('; ')}`);
  // ("exercise: WARNING - could not get every exercised dropdown back" is routine and repaired later by the flow - not a stop)
  if (/^CA Refresh document failed:/m.test(log) || !doc) // line start: the expected FAIL assert prints this source line too
    why.push('result document not written');
  if (!(data.termChecks || []).length) why.push('no term checks recorded');
  return { kind: why.length ? 'TOOL' : 'OK', why, doc };
}

function publish(pair, doc) {
  const [st, lob] = pair.split(':');
  const src = path.join(RT, 'ca-refresh', doc);
  fs.mkdirSync(shareDir, { recursive: true });
  for (const f of fs.readdirSync(shareDir)) if (f.startsWith(`CARefresh_${lob}_${st}_`) && f !== doc) fs.unlinkSync(path.join(shareDir, f)); // one current doc per state + LOB
  fs.copyFileSync(src, path.join(shareDir, doc));
}

module.exports = { validate };
if (require.main !== module) return;
fs.mkdirSync(outDir, { recursive: true });
say(`start: ${pairs.length} pair(s), env ${env}, ${lanes} lane(s), share ${shareDir}`);
const result = [];
let stop = '';
const queue = [...pairs];
// --lane1-after-pid P: lane 1 starts only once process P (a run still using lane 1's login) has exited - switching a running
// single-lane batch to two lanes without losing the run in progress (11/07).
const afterPid = Number(arg('lane1-after-pid', '0'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
async function lane(n) {
  if (n === 1 && afterPid) { while (alive(afterPid) && !stop) await new Promise((r) => setTimeout(r, 30000)); say(`lane 1: process ${afterPid} done - starting`); }
  for (;;) {
    if (stop || !queue.length) return;
    const pair = queue.shift();
    const r = await runPair(pair, n);
    const v = validate(pair, r);
    say(`${lanes > 1 ? `[lane ${n}] ` : ''}${pair}: ${v.kind}${v.why.length ? ' - ' + v.why.join(' | ') : ''}${r.dir ? ` (${path.basename(r.dir)})` : ''}`);
    // a failure stops the batch: the other lane finishes the run it is on (a valid run), then takes no new pair
    if (v.kind !== 'OK' && !stop) stop = `STOPPED (${v.kind}) at ${pair} - needs investigation`;
    if (v.kind === 'OK') { try { publish(pair, v.doc); result.push(`${pair} OK ${v.doc}`); } catch (e) { result.push(`${pair} OK (copy failed: ${e.message})`); } }
    else result.push(`${pair} ${v.kind}: ${v.why.join(' | ')}`);
  }
}
(async () => {
for (let n = 2; n <= lanes; n++) laneEnv(n); // fail fast when a lane has no login
await Promise.all(Array.from({ length: lanes }, (_, k) => lane(k + 1)));
say(stop || 'ALL PAIRS DONE');
fs.writeFileSync(path.join(outDir, 'result.txt'), result.join('\n') + `\n${stop || 'ALL PAIRS DONE'}\n`);
console.log(`${stop || 'ALL PAIRS DONE'} - ${result.filter((x) => / OK /.test(x)).length}/${pairs.length} validated; ${path.join(outDir, 'result.txt')}`);
})();
