// Offline test of the CA Refresh term statuses (QA feedback, Devyani 11/04) - no WriteBiz needed.
//   node scripts/mock/testTermStatusOffline.js
// 1. Only terms the product model makes available to WriteBiz agents in the state are checked for presence.
// 2. A vehicle-level PIP term that stays read-only (set from the state PIP coverage) is SET_BY_STATE_PIP, not PARTIAL.
// 3. A "Not Applicable" placeholder that is never offered as a choice does not make a term PARTIAL.
const { evaluate, DATA, norm } = require('../../helpers/caRefreshValidator');

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const sel = (label, options, disabled = false) => ({ label, options, selected: options[0], kind: 'select', disabled });
const run = (state, cards) => evaluate('BUSINESS_AUTO', state, [{ label: 'mock', text: '', norm: '', cards }]).termChecks;

// 1. term-name list: every entry carries its states; nothing marked WriteBiz = N survives the build
const all = Object.values(DATA.termNames).flat();
check('term names carry states', all.length > 0 && all.every((t) => Array.isArray(t.states) && t.states.length), `${all.length} entries`);
const pip = (DATA.termNames[norm('Special Types Personal Injury Protection')] || []).filter((t) => t.states.includes('PA')).map((t) => t.name);
check('PA Special Types PIP terms are the PA ones only', pip.includes('Accidental Death Benefits Coverage') && !pip.includes('Covered by Workers Compensation'), JSON.stringify(pip));

// 2. vehicle PIP: read-only on every snapshot -> SET_BY_STATE_PIP; once enabled somewhere -> back to PARTIAL
const pipCard = (disabled) => ({ title: 'Special Types Personal Injury Protection', terms: [sel('Accidental Death Benefits Coverage', ['Not Provided'], disabled)] });
const st = (cards) => (run('PA', cards).find((t) => t.term === 'Accidental Death Benefits Coverage' && t.expected.length) || {}).status;
check('read-only vehicle PIP term -> SET_BY_STATE_PIP', st([pipCard(true)]) === 'SET_BY_STATE_PIP', st([pipCard(true)]));
check('enabled vehicle PIP term missing options -> PARTIAL', st([pipCard(false)]) === 'PARTIAL', st([pipCard(false)]));

// 3. "Not Applicable" placeholder only
const col = (opts) => run('PA', [{ title: 'Private Passenger Collision', terms: [sel('Deductible', opts)] }]).find((t) => t.term === 'Deductible' && t.expected.length) || {};
const full = col(['1,000', '2,000', '3,000', '5,000', '10,000', '15,000', '25,000']);
check('only "Not Applicable" missing -> MATCH with a note', full.status === 'MATCH' && /placeholder/.test(full.note || ''), `${full.status} / ${full.note}`);
const short = col(['1,000', '2,000']);
check('real options missing -> still PARTIAL', short.status === 'PARTIAL' && short.missing.includes('25000'), `${short.status} / ${JSON.stringify(short.missing)}`);

// 4. QA 11/05 rules
const one = (lob, title, label, opts) => evaluate(lob, 'PA', [{ label: 'mock', text: '', norm: '', cards: [{ title, terms: [sel(label, opts)] }] }]).termChecks;
const liab = (lob) => one(lob, 'Liability', 'Liability Limit', ['1,000,000']).filter((t) => /aggregate limit/i.test(t.term)).map((t) => t.term);
check('Liability aggregate limits not expected on Business Auto', liab('BUSINESS_AUTO').length === 0, JSON.stringify(liab('BUSINESS_AUTO')));
check('Liability aggregate limits still expected on Auto Dealers', liab('AUTO_DEALERS').length === 2, JSON.stringify(liab('AUTO_DEALERS')));
const hl = one('BUSINESS_AUTO', 'Hired Auto Liability', 'Liability Coverage Type', ['Combined Single Limit']).find((t) => t.term === 'Liability Coverage Type' && t.expected.length) || {};
check('Hired Auto Liability Coverage Type without "No Coverage" -> NOT_APPLICABLE', hl.status === 'NOT_APPLICABLE', `${hl.status} / ${hl.note}`);
const lc = one('BUSINESS_AUTO', 'Truck Other Than Collision', 'Losses Covered', ['Comprehensive', 'Fire Only', 'Fire and Theft Only', 'Fire, Theft and Windstorm Only', 'Limited Specified Causes Of Loss', 'Specified Causes Of Loss']).find((t) => t.term === 'Losses Covered' && t.expected.length) || {};
// QA 11/06 reversed the 11/05 rule: Losses Covered without "No Coverage" is PARTIAL
check('Truck Losses Covered without "No Coverage" -> PARTIAL (QA 11/06)', lc.status === 'PARTIAL' && JSON.stringify(lc.missing) === '["No Coverage"]', `${lc.status} / ${JSON.stringify(lc.missing)} / ${lc.note}`);
const sc = one('BUSINESS_AUTO', 'Special Types Collision', 'Collision Coverage Type', ['No Coverage', 'ACV', 'Collision']).find((t) => t.term === 'Collision Coverage Type' && t.expected.length) || {};
check('Special Types Blanket Collision (needs PolicyCenter) ignored -> MATCH with a note', sc.status === 'MATCH' && /6680/.test(sc.note || '') && !sc.expected.includes('Blanket Collision'), `${sc.status} / ${sc.note}`);
const sc2 = one('BUSINESS_AUTO', 'Special Types Collision', 'Collision Coverage Type', ['No Coverage', 'ACV']).find((t) => t.term === 'Collision Coverage Type' && t.expected.length) || {};
check('Special Types Collision also missing "Collision" -> still PARTIAL', sc2.status === 'PARTIAL' && JSON.stringify(sc2.missing) === '["Collision"]', `${sc2.status} / ${JSON.stringify(sc2.missing)}`);

// 5. QA 11/05: PolicyCenter-only forms (all model rows WriteBiz = N) and terms shown only after a PC change are skipped
const res = evaluate('BUSINESS_AUTO', 'PA', [{ label: 'mock', text: '', norm: '', cards: [] }]).results;
for (const f of ['CA 20 19', 'CA 20 33', 'CA 23 24']) {
  const r = res.find((x) => x.name.startsWith(f)) || {};
  check(`${f} not on WriteBiz -> PC_ONLY with a comment`, r.status === 'PC_ONLY' && /PolicyCenter only/.test(r.page), `${r.status} / ${r.page}`);
}
const ca9905 = res.find((x) => x.name.startsWith('CA 99 05')) || {};
check('CA 99 05 (WriteBiz = Y) not seen -> still MISSING', ca9905.status === 'MISSING', ca9905.status);
const pdc = run('PA', [{ title: 'Special Types Other Than Collision', terms: [sel('Losses Covered', ['Comprehensive'])] }]).find((t) => t.term === 'Physical Damage Classification') || {};
check('Physical Damage Classification not shown -> NOT_APPLICABLE with a comment', pdc.status === 'NOT_APPLICABLE' && /6680/.test(pdc.note || ''), `${pdc.status} / ${pdc.note}`);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
