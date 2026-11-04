// Offline test: a dependent dropdown refilled by a LATE second WriteBiz call must still be read by the exercise.
//   node scripts/mock/testDependantWaitOffline.js
// PA/AZ/NC/NM 11/03: Special Types Collision "Coverage Type = ACV" was read while Deductible was still disabled on
// "Not Applicable"; NE (faster) got 1,000-25,000. Here the Deductible is refilled 3 s after the change (after settle()).
const { chromium } = require('playwright');
const { exerciseCards } = require('../../helpers/caRefreshAdditional');

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const delay of [0, 3000]) {
    await page.setContent(`<div id="xacc_Card_CA7VehicleCollisionSPV"><div class="xaccordion-sectionheader">Special Types Collision</div>
      <div class="FieldSpacing"><span class="FieldLabel">Collision Coverage Type</span>
        <select id="ddl_CA7CovType11"><option value="NC" selected>No Coverage</option><option value="ACV">ACV</option></select></div>
      <div class="FieldSpacing"><span class="FieldLabel">Deductible</span><select id="ddl_CA7Ded15" disabled><option value="NA">Not Applicable</option></select></div></div>
      <script>(() => {
        const ded = document.getElementById('ddl_CA7Ded15');
        document.getElementById('ddl_CA7CovType11').addEventListener('change', (e) => setTimeout(() => {
          if (e.target.value === 'ACV') { ded.disabled = false; ded.innerHTML = ['1,000', '2,000', '5,000', '25,000'].map((v) => '<option>' + v + '</option>').join(''); }
          else { ded.disabled = true; ded.innerHTML = '<option value="NA">Not Applicable</option>'; }
        }, ${delay}));
      })();</script>`);
    const pool = [];
    const t0 = Date.now();
    await exerciseCards(page, pool, 'mock special type', 40, { rerender: async () => {} });
    const acv = pool.find((p) => p.context === 'Collision Coverage Type = ACV');
    const opts = acv ? ((acv.cards[0] || {}).terms || []).find((t) => t.label === 'Deductible') : null;
    check(`refill after ${delay} ms: ACV snapshot has the deductible list`, !!opts && opts.options.includes('25,000'), JSON.stringify(opts && opts.options));
    console.log(`   (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
