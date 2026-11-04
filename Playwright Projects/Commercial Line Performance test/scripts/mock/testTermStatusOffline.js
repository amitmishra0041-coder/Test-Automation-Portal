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

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
