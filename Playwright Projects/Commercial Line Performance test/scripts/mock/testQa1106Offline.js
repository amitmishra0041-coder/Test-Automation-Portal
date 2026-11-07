// Offline checks for the QA review of 11/06 (PA results, common to all states) - no WriteBiz needed.
//   node scripts/mock/testQa1106Offline.js
// 1. dealer Other Than Collision: Losses Covered starts blank under Coverage Type = Inventory Value Or Limit Of Insurance and
//    Deductible Type depends on it (late refill) - every Losses Covered choice must be read with its Deductible Types
// 2. Special Type vehicle: Towing Labor stays disabled until Other Than Collision is on - its options must still be read
// 3. Truck Towing Labor ("N / Y" cells, old N struck) has PA options in the product-model data
// 4. scheduled items (Drive Other Car Named Individuals): the item's terms are read under the model sub-coverage
// 5. Losses Covered missing only "No Coverage" -> PARTIAL
const path = require('path');
const { chromium } = require('playwright');
const { exerciseCards, addExpectedFromGrid } = require('../../helpers/caRefreshAdditional');
const { DATA, evaluate } = require('../../helpers/caRefreshValidator');

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const optsOf = (pool, ctx, title, label) => { const p = pool.find((x) => x.context === ctx); const c = p && p.cards.find((k) => k.title === title); const t = c && c.terms.find((x) => x.label === label); return t ? t.options : null; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. dealer Other Than Collision
  await page.setContent(`<div id="xacc_Card_CA7OTCGRD"><div class="xaccordion-sectionheader">Auto Dealers Other Than Collision</div>
    <div class="FieldSpacing"><span class="FieldLabel">Other Than Collision Coverage Type</span>
      <select id="ct"><option value="NC" selected>No Coverage</option><option value="IV">Inventory Value Or Limit Of Insurance</option></select></div>
    <div class="FieldSpacing"><span class="FieldLabel">Losses Covered</span><select id="lc" disabled><option value="">Not Applicable</option></select></div>
    <div class="FieldSpacing"><span class="FieldLabel">Deductible Type</span><select id="dt" disabled><option value="NA">Not Applicable</option></select></div></div>
    <script>(() => {
      const $ = (i) => document.getElementById(i);
      $('ct').addEventListener('change', (e) => setTimeout(() => {
        const on = e.target.value === 'IV';
        $('lc').disabled = !on; $('lc').innerHTML = on ? '<option value="" selected></option><option value="F">Fire Only</option><option value="C">Comprehensive</option><option value="S">Specified Causes Of Loss</option>' : '<option value="">Not Applicable</option>';
        $('dt').disabled = true; $('dt').innerHTML = '<option value="NA">Not Applicable</option>';
      }, 300));
      // Deductible Type refilled 2.5 s after Losses Covered changes (after settle) - only Comprehensive / SCOL offer Per Auto
      $('lc').addEventListener('change', (e) => setTimeout(() => {
        const per = /^(C|S)$/.test(e.target.value);
        $('dt').disabled = !per; $('dt').innerHTML = '<option value="NA">Not Applicable</option>' + (per ? '<option value="PA">Per Auto And Per Occurrence Deductible - Applicable To All Perils</option>' : '');
      }, 2500));
    })();</script>`);
  let pool = [];
  await exerciseCards(page, pool, 'mock dealer', 40, { rerender: async () => {} });
  for (const lc of ['Fire Only', 'Comprehensive', 'Specified Causes Of Loss']) {
    const o = optsOf(pool, `Other Than Collision Coverage Type = Inventory Value Or Limit Of Insurance; Losses Covered = ${lc}`, 'Auto Dealers Other Than Collision', 'Deductible Type');
    const want = lc === 'Fire Only' ? ['Not Applicable'] : ['Not Applicable', 'Per Auto And Per Occurrence Deductible - Applicable To All Perils'];
    check(`dealer OTC: Losses Covered = ${lc} read with its Deductible Types`, JSON.stringify(o) === JSON.stringify(want), JSON.stringify(o));
  }

  // 2. Special Type: Towing enabled only once Other Than Collision is on
  await page.setContent(`<div id="xacc_Card_OTC"><div class="xaccordion-sectionheader">Special Types Other Than Collision</div>
    <div class="FieldSpacing"><span class="FieldLabel">Other Than Collision Coverage Type</span>
      <select id="ct"><option value="NC" selected>No Coverage</option><option value="ACV">ACV</option></select></div></div>
    <div id="xacc_Card_TOW"><div class="xaccordion-sectionheader">Special Types Towing Labor</div>
    <div class="FieldSpacing"><span class="FieldLabel">Towing and Labor Limit</span><select id="tw" disabled><option value="NC" selected>No Coverage</option></select></div></div>
    <script>document.getElementById('ct').addEventListener('change', (e) => setTimeout(() => {
      const tw = document.getElementById('tw'); const on = e.target.value === 'ACV'; tw.disabled = !on;
      tw.innerHTML = '<option value="NC" selected>No Coverage</option>' + (on ? ['50', '100', '200', '300', '700', '1,000'].map((v) => '<option>' + v + '</option>').join('') : '');
    }, 300));</script>`);
  pool = [];
  await exerciseCards(page, pool, 'mock special type', 40, { rerender: async () => {} });
  const tow = optsOf(pool, 'Special Types Other Than Collision: Other Than Collision Coverage Type = ACV', 'Special Types Towing Labor', 'Towing and Labor Limit');
  check('Special Type: Towing Labor options read once Other Than Collision = ACV', JSON.stringify(tow) === JSON.stringify(['No Coverage', '50', '100', '200', '300', '700', '1,000']), JSON.stringify(tow));

  // 2b. NC Auto Dealers 11/07: WriteBiz raises "An error has occurred" on the 2nd limit - the card's exercise stops there
  await page.setContent(`<div id="xacc_Card_UM"><div class="xaccordion-sectionheader">Uninsured Motorists Coverage</div>
    <div class="FieldSpacing"><span class="FieldLabel">Uninsured Motorists Coverage Combined Single Limit</span>
      <select id="lim"><option value="1000" selected>1,000,000</option><option value="150">150,000</option><option value="750">750,000</option><option value="300">300,000</option><option value="500">500,000</option></select></div></div>
    <script>document.getElementById('lim').addEventListener('change', (e) => { if (e.target.value === '750' && !document.getElementById('errBox')) document.body.insertAdjacentHTML('beforeend', '<div class="modal show" id="errBox">An error has occurred, please try again <button onclick="this.parentElement.remove()">Close</button></div>'); });</script>`);
  pool = [];
  await exerciseCards(page, pool, 'mock state page', 40, { rerender: async () => {} });
  const tried = pool.filter((p) => !/^[^=]*: /.test(p.context || '')).map((p) => p.context.replace(/^.*= /, ''));
  check('WriteBiz error stops the card: nothing tried after 750,000', JSON.stringify(tried) === JSON.stringify(['150,000', '750,000']), JSON.stringify(tried));

  // 3. Truck Towing Labor PA options in the data
  const tt = (DATA.modelTerms || []).find((m) => m.name === 'Truck Towing Labor');
  const paOpts = tt ? tt.terms['Towing and Labor Limit'].filter((o) => o.states.includes('PA') && o.wb === 'Y').map((o) => o.option) : [];
  check('Truck Towing Labor: PA options from "N / Y" cells', JSON.stringify(paOpts) === JSON.stringify(['No Coverage', '50', '100', '200', '300', '700', '1000']), JSON.stringify(paOpts));
  const ev3 = evaluate('BUSINESS_AUTO', 'PA', [{ label: 'Vehicle coverages - Truck', text: '', norm: '', cards: [{ title: 'Truck Towing Labor', terms: [{ label: 'Towing and Labor Limit', kind: 'select', options: ['No Coverage', '50', '100', '200', '300', '700', '1,000'], disabled: false }] }] }]);
  const t3 = ev3.termChecks.find((t) => t.coverage === 'Truck Towing Labor' && t.expected.length) || {};
  check('Truck Towing Labor PA -> MATCH (was NO_MODEL_DATA)', t3.status === 'MATCH', t3.status);

  // 4. scheduled items: terms read under the model sub-coverage, and still 2 items saved
  const BASE = 'file:///' + path.join(__dirname, 'caRefreshScheduleMock.html').replace(/\\/g, '/');
  await page.goto(`${BASE}?hideMs=1500&terms=1`);
  pool = [];
  const recs = [];
  await addExpectedFromGrid(page, { expected: [{ name: 'Drive Other Car Coverage - Broadened Coverage For Named Individuals', category: 'Coverage' }], effectiveDate: '08/01/2027', pool, record: (e) => recs.push(e), label: 'mock' });
  check('schedule with terms: still ADDED with 2 items', (recs[0] || {}).status === 'ADDED' && /^2 scheduled items added/.test(recs[0].detail), JSON.stringify(recs[0]));
  const titles = [...new Set(pool.flatMap((p) => p.cards.map((c) => c.title)))];
  check('schedule item 1 read as "... Named Individuals Collision"', titles.includes('Drive Other Car Cov Broadened Cov For Named Individuals Collision'), JSON.stringify(titles));
  check('schedule item 2 read as "... Named Individuals Other Than Collision"', titles.includes('Drive Other Car Cov Broadened Cov For Named Individuals Other Than Collision'), JSON.stringify(titles));
  const ev4 = evaluate('BUSINESS_AUTO', 'PA', pool);
  const dt = ev4.termChecks.find((t) => /named individuals other than collision/i.test(t.coverage) && t.term === 'Deductible Type' && t.expected.length) || {};
  check('schedule item OTC Deductible Type compared with the model (both Losses Covered choices read)', ['Comprehensive All Perils Deductible', 'Specified Causes Of Loss All Perils Deductible'].every((o) => (dt.observed || []).includes(o)), `${dt.status} obs=${JSON.stringify(dt.observed)} miss=${JSON.stringify(dt.missing)}`);

  // 4b. the real PA item dialog (11/06): one row per sub-coverage, its terms after it - Liability / UIM / UM split apart
  await page.setContent(`<html><body>${require('fs').readFileSync(path.join(__dirname, 'caRefreshDocItemPA.html'), 'utf8')}</body></html>`);
  await page.evaluate(() => { const m = document.querySelector('.modal') || document.body.firstElementChild; m.id = 'crroot'; m.classList.add('show'); m.style.display = 'block'; });
  const { readCards } = require('../../helpers/caRefreshValidator');
  const { scheduleTitles } = require('../../helpers/caRefreshAdditional');
  const real = await scheduleTitles(page.locator('#crroot'), 'Drive Other Car Coverage - Broadened Coverage For Named Individuals', await readCards(page, '#crroot'));
  const shape = real.map((c) => `${c.title.replace(/^Drive Other Car Cov Broadened Cov For Named Individuals /, '')}: ${c.terms.map((t) => t.label).join(', ')}`);
  check('real item dialog split per sub-coverage', JSON.stringify(shape) === JSON.stringify(['Liability: Coverage Type, Liability Limit', 'Underinsured Motorists: Underinsured Motorists Coverage Type, Combined Single Limit', 'Uninsured Motorists: Uninsured Motorists Coverage Type, Combined Single Limit']), JSON.stringify(shape));

  // 5. Losses Covered without "No Coverage" -> PARTIAL
  const ev5 = evaluate('BUSINESS_AUTO', 'PA', [{ label: 'Vehicle coverages - Private passenger', text: '', norm: '', cards: [{ title: 'Private Passenger Other Than Collision', terms: [{ label: 'Losses Covered', kind: 'select', options: ['Comprehensive', 'Fire Only', 'Fire and Theft Only', 'Fire, Theft and Windstorm Only', 'Limited Specified Causes Of Loss', 'Specified Causes Of Loss'], disabled: false }] }] }]);
  const t5 = ev5.termChecks.find((t) => t.term === 'Losses Covered' && t.expected.length) || {};
  check('Private Passenger Losses Covered without "No Coverage" -> PARTIAL', t5.status === 'PARTIAL', `${t5.status} ${JSON.stringify(t5.missing)}`);

  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
