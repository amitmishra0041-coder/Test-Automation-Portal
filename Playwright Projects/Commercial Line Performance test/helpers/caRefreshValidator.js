// CA Refresh coverage validation (project "CA Refresh", Jira ABP-593).
// Expected coverages come from helpers/caRefreshData.json (built by scripts/buildCaRefreshData.py from the
// test-case Pre-condition column + product model). While the normal CA policy workflow runs, snapshot()
// records the text WriteBiz shows on each coverage page; evaluate() then checks every expected coverage
// against what was seen, so a missing coverage is reported instead of stopping the run.
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'caRefreshData.json'), 'utf8'));

const LOB_LABELS = { BUSINESS_AUTO: 'Business Auto', AUTO_DEALERS: 'Auto Dealers' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Product-model availability codes per state: R required, S suggested, E electable, U unavailable.
// Blank / N / #NA = not offered in that state, so the coverage isn't expected there.
function isExpectedIn(cov, state) {
  const a = cov.availability && cov.availability[state];
  if (cov.availability === undefined) return true; // not in the product model sheet - the precondition still lists it
  return Boolean(a) && !/^(U|N|#NA)$/i.test(a.trim());
}

// Policy type each clause is offered on (Clause Availability Rules 2025: CA7LinePolicyType = ...). A Business Auto policy
// is not expected to carry Auto Dealers clauses and vice versa, so those are left out instead of reported missing.
const POLICY_TYPE = { BUSINESS_AUTO: 'Business Auto Coverage Form', AUTO_DEALERS: 'Auto Dealers Coverage Form' };
// 'this' = classified for this policy type, 'other' = classified for the other one, 'unknown' = no rule found.
function classify(cov, lob) {
  const r = cov.code && (DATA.clauseRules || {})[cov.code];
  const t = POLICY_TYPE[lob];
  if (r) {
    if (r.deny.includes(t)) return 'other';
    if (r.allow.length) return r.allow.includes(t) ? 'this' : 'other';
  }
  if (/^(Auto Dealer|Garage)/i.test(cov.category || '')) return lob === 'AUTO_DEALERS' ? 'this' : 'other';
  return 'unknown';
}
const lobApplicable = (cov, lob) => classify(cov, lob) !== 'other';

// QA review of the results (Devyani, 10/30/2026):
//  - only in PolicyCenter, not on WriteBiz: CA 99 28 Stated Amount Insurance, CAD 21 06 / CAD 21 91 Pennsylvania UM / UIM - Stacked,
//    CA 20 16 Mobile Homes Contents Coverage
//  - "Non Owned Auto Standard Coverages" belong to Business Auto only
//  - a precondition coverage named after a state ("Virginia Medical Expense And Income Loss Benefits Endorsement") is
//    expected in that state only
const QA_PC_ONLY = [/^ca 99 28\b/, /^cad 21 06\b/, /^cad 21 91\b/, /^ca 20 16\b/];
const qaPcOnly = (cov) => QA_PC_ONLY.some((r) => r.test(norm(cov.name)));
const QA_BA_ONLY_SECTIONS = [/^non owned auto standard coverages$/];
const STATE_NAMES = { AZ: 'arizona', CO: 'colorado', DE: 'delaware', IA: 'iowa', MD: 'maryland', MI: 'michigan', NC: 'north carolina', NE: 'nebraska',
  NM: 'new mexico', OH: 'ohio', PA: 'pennsylvania', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VA: 'virginia', WI: 'wisconsin' };
// the state a coverage name is tied to ("Virginia ...", "CAD 21 92 Pennsylvania ..."), or null
const namedState = (name) => { const n = norm(name).replace(/^cad? ?\d{2} ?\d{2} /, ''); const hit = Object.entries(STATE_NAMES).find(([, s]) => n.startsWith(s + ' ')); return hit ? hit[0] : null; };

function expectedFor(lob, state) {
  const d = DATA.lobs[lob];
  if (!d) throw new Error(`No CA Refresh data for LOB "${lob}"`);
  const list = [];
  for (const sec of d.sections) {
    for (const c of sec.coverages) {
      if (!lobApplicable({ ...c, category: sec.category }, lob)) continue;
      if (lob !== 'BUSINESS_AUTO' && QA_BA_ONLY_SECTIONS.some((r) => r.test(norm(sec.category)))) continue;
      const tied = namedState(c.name);
      list.push({ category: sec.category, ...c, source: 'precondition', expected: isExpectedIn(c, state) && (!tied || tied === state) });
    }
  }
  for (const f of d.mappingForms) { const tied = namedState(f); list.push({ category: 'Forms from mapping', name: f, source: 'precondition', expected: !tied || tied === state, mappingForm: true }); }
  // Everything else the product model flags "SBT Update = yes" (coverages, conditions, exclusions) that applies to this
  // policy type and state - the precondition only lists some of the CA Refresh set.
  const seen = new Set(list.map((c) => norm(c.name)));
  for (const e of DATA.sbt || []) {
    // only coverages marked Y for WriteBiz (struck-through values already removed), offered in the state, and not classified for the other policy type
    if (seen.has(norm(e.name)) || !/^y$/i.test(String(e.writeBiz || '').replace(/\s+/g, '')) || !isExpectedIn(e, state)) continue;
    const kind = classify(e, lob);
    if (kind === 'other') continue;
    seen.add(norm(e.name));
    // no clause rule found: still validated if it shows up on screen, but not reported missing when it does not
    list.push({ ...e, source: 'SBT Update', expected: true, optional: kind === 'unknown' });
  }
  return list;
}

// Every coverage card on the page (title + each term's label and its dropdown options). The options come straight
// from the page's <select> elements, i.e. exactly what the agent gets when opening the dropdown.
async function readCards(page, rootSelector) {
  return page.evaluate((rootSel) => {
    const root = rootSel ? document.querySelector(rootSel) : document;
    if (!root) return [];
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const termsOf = (el) => [...el.querySelectorAll('.FieldSpacing')].map((fs) => {
      const label = clean((fs.querySelector('.FieldLabel') || {}).textContent);
      const sel = fs.querySelector('select');
      const input = fs.querySelector('input:not([type=hidden]):not([type=checkbox])');
      return { label, options: sel ? [...sel.options].map((o) => clean(o.textContent)).filter((o) => o && !/^nothing selected$/i.test(o)) : [],
        selected: sel && sel.selectedOptions[0] ? clean(sel.selectedOptions[0].textContent) : (input ? clean(input.value) : ''), kind: sel ? 'select' : (input ? 'input' : 'text') };
    }).filter((t) => t.label);
    const cards = [...root.querySelectorAll('[id^="xacc_Card_"]')].map((c) => ({ title: clean((c.querySelector('.xaccordion-sectionheader') || {}).textContent).replace(/\s+Save$/i, ''), terms: termsOf(c) }));
    if (!cards.length) {
      const title = clean((root.querySelector('.modal-title, .modal-header, h1, h2') || {}).textContent);
      const terms = termsOf(root);
      if (terms.length) cards.push({ title, terms });
    }
    return cards;
  }, rootSelector || null).catch(() => []);
}

// Text a coverage page shows: visible text plus every <select> option / label, since WriteBiz renders many
// coverages as dropdown rows or "Add Coverage" menu entries rather than plain text.
async function snapshot(page, label, pool, shotDir) {
  try {
    // A page navigation mid-read destroys the execution context - let the page settle and retry.
    let text;
    for (let attempt = 0; attempt < 4 && text === undefined; attempt++) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      text = await page.evaluate(() => {
        const bits = [document.body ? document.body.innerText : ''];
        document.querySelectorAll('option, label, [role="option"], .dropdown-item').forEach((e) => bits.push(e.textContent || ''));
        return bits.join('\n');
      }).catch(async () => { await page.waitForTimeout(2000); return undefined; });
    }
    if (text === undefined) throw new Error('page kept navigating');
    let shot = '';
    if (shotDir) {
      shot = path.join(shotDir, `${pool.length + 1}-${label.replace(/[^A-Za-z0-9]+/g, '_')}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => { shot = ''; });
    }
    if (shotDir) {
      const html = await page.evaluate(() => document.body.innerHTML).catch(() => '');
      fs.writeFileSync(path.join(shotDir, `${pool.length + 1}-${label.replace(/[^A-Za-z0-9]+/g, '_')}.html`), html);
    }
    if (shotDir) fs.writeFileSync(shot ? shot.replace(/\.png$/, '.txt') : path.join(shotDir, `${pool.length + 1}.txt`), text);
    const cards = await readCards(page);
    const gridNames = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr) => { const td = tr.querySelectorAll('td'); return td.length > 3 ? td[2].textContent.replace(/\s+/g, ' ').trim() : ''; }).filter(Boolean)).catch(() => []);
    pool.push({ label, text, norm: norm(text), shot, cards, gridNames });
  } catch (e) { console.log(`CA Refresh snapshot "${label}" failed: ${e.message.split('\n')[0]}`); }
}

// Forms in the mapping list start with a form number ("CA 20 16 ...") - match on the number or the full title.
function matchers(cov) {
  const full = norm(cov.name);
  const list = [full];
  const m = /^\s*(CAD?\s?\d{2}\s?\d{2})\b/i.exec(cov.name);
  if (m) list.push(norm(m[1]));
  return list.filter(Boolean);
}

// WriteBiz words many coverages differently from the product model (e.g. "Pennsylvania - Named Individuals -
// Broadened First-Party Benefits" for "Named Individuals - Broadened Personal Injury Protection"), so when no exact
// phrase is on a page, accept the closest page line sharing most of the coverage's words and say what it matched.
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 2);
const removedNorms = new Set(DATA.removed.map((r) => norm(r.name)));
function similarLine(cov, pool) {
  const want = tokens(cov.name.replace(/\(.*?\)/g, ''));
  if (want.length < 3) return null;
  let best = null;
  for (const p of pool) {
    for (const line of String(p.text || '').split(/[\n\t]/)) {
      if (removedNorms.has(norm(line))) continue; // a pre-refresh name WriteBiz may still show must not satisfy its replacement
      const lt = tokens(line);
      if (lt.length < 2 || lt.length > want.length * 2) continue;
      const shared = want.filter((t) => lt.includes(t)).length / want.length;
      if (shared >= 0.75 && (!best || shared > best.score)) best = { score: shared, line: line.trim(), page: p.label };
    }
  }
  return best;
}

// Coverages the product model marks as not available to agents in WriteBiz can't appear on WriteBiz pages;
// they belong to PolicyCenter, so they're reported as PC_ONLY instead of MISSING.
// column K "Donegal WriteBiz Availability For Agents": any Y = applies to WriteBiz; otherwise PolicyCenter-only (counts as pass)
const wbVisible = (cov) => cov.mappingForm || !cov.writeBiz || /^y$/i.test(String(cov.writeBiz).replace(/\s+/g, ''));

// The workflow only creates a Private Passenger and a Truck vehicle, so coverages that live on other vehicle
// types can't be seen - say so instead of calling them missing.
const NO_PRIVATE_PASSENGER_STATES = ['NC']; // WriteBiz: "Private Passengers may not be written in the state of NC"
const needsOtherVehicle = (cov, state) => /^(Special Type|Public Transportation|Zone Rated)/i.test(cov.category) || (NO_PRIVATE_PASSENGER_STATES.includes(state) && /^Private Passenger/i.test(cov.category));

// Compare each coverage term's options as seen in WriteBiz with the product model's options for the state.
const normOpt = (o) => norm(String(o).replace(/,/g, ''));
const jaccard = (a, b) => { const ta = new Set(tokens(a)); const tb = new Set(tokens(b)); const u = new Set([...ta, ...tb]); return u.size ? [...ta].filter((t) => tb.has(t)).length / u.size : 0; };
const overlap = (a, b) => { const ta = tokens(a); const tb = tokens(b); return ta.length ? ta.filter((t) => tb.includes(t)).length / ta.length : 0; };

// precondition notes after the name ("CA 20 16 Mobile Homes Contents Coverage – new form with added fields", "... – Date added")
// are not part of the name either
const canon = (n) => norm(n).replace(/^auto dealers? /, 'garage ').replace(/^cad? ?\d{2} ?\d{2} /, '').replace(/ (new form with added fields|date added)$/, '');
const modelByName = new Map();
for (const m of DATA.modelTerms || []) { const k = canon(m.name); (modelByName.get(k) || modelByName.set(k, []).get(k)).push(m); }

// Every coverage card / Add-coverage dialog captured from WriteBiz that maps to a product-model coverage gets its terms and
// dropdown options compared with the model's options offered in this state. QA (Devyani, 10/30): a term's options depend on
// other selections (Coverage Type = No Coverage shows no deductibles; some values only under higher limits), so the options
// seen across EVERY snapshot of the same coverage + term (default page and every exercised selection) are combined before
// comparing; likewise a term counts as shown when any snapshot of the card shows it.
function checkAllCards(state, pool) {
  const agg = new Map(); // coverage|term -> { coverage, term, expected, observed:Set, pages:Set, contexts:Set }
  const shownTerms = new Map(); // coverage -> { names, shown:Set, pages:Set }
  for (const p of pool) {
    for (const card of p.cards || []) {
      let cands = modelByName.get(canon(card.title));
      if (!cands) cands = (DATA.modelTerms || []).filter((m) => overlap(m.name, card.title) >= 0.9 && overlap(card.title, m.name) >= 0.9);
      if (!cands.length) continue;
      const selects = card.terms.filter((x) => x.kind === 'select');
      const score = (m) => Object.keys(m.terms).filter((tn) => selects.some((x) => overlap(tn, x.label) >= 0.6)).length;
      const m = cands.slice().sort((a, b) => score(b) - score(a))[0];
      const ckey = canon(card.title);
      const names = DATA.termNames && DATA.termNames[norm(m.name)];
      if (names && card.terms.length) {
        const st = shownTerms.get(ckey) || shownTerms.set(ckey, { coverage: card.title, names, shown: new Set(), pages: new Set() }).get(ckey);
        card.terms.forEach((x) => st.shown.add(x.label));
        st.pages.add(p.label);
      }
      for (const [term, opts] of Object.entries(m.terms)) {
        const t = selects.slice().sort((x, y) => jaccard(term, y.label) - jaccard(term, x.label))[0];
        if (!t || jaccard(term, t.label) < 0.6) continue; // term not shown in this snapshot
        const key = `${ckey}|${norm(term)}`;
        const a = agg.get(key) || agg.set(key, { coverage: card.title, term, expected: opts.filter((o) => o.states.includes(state) && o.wb === 'Y').map((o) => o.option), observed: new Set(), pages: new Set(), contexts: new Set() }).get(key);
        t.options.forEach((o) => a.observed.add(o));
        a.pages.add(p.label);
        if (p.context) a.contexts.add(p.context);
      }
    }
  }
  const out = [];
  for (const st of shownTerms.values()) {
    const shown = [...st.shown];
    for (const nm of st.names) {
      const ok = shown.some((l) => jaccard(nm, l) >= 0.6);
      out.push({ coverage: st.coverage, term: nm, expected: [], observed: [], missing: [], extra: [], page: [...st.pages].join(', '), context: '', status: ok ? 'MATCH' : 'PARTIAL', note: ok ? 'term shown' : 'term not shown on any snapshot of this coverage' });
    }
  }
  for (const a of agg.values()) {
    const observed = [...a.observed];
    const seen = new Set(observed.map(normOpt));
    const want = new Set(a.expected.map(normOpt));
    const missing = a.expected.filter((o) => !seen.has(normOpt(o)));
    const extra = observed.filter((o) => !want.has(normOpt(o)));
    // Options WriteBiz offers that the model does not list = MISMATCH. Model options never seen on any snapshot = PARTIAL.
    const status = !a.expected.length ? 'NO_MODEL_DATA' : extra.length ? 'MISMATCH' : missing.length ? 'PARTIAL' : 'MATCH';
    out.push({ coverage: a.coverage, term: a.term, expected: a.expected, page: [...a.pages].join(', '), context: [...a.contexts].slice(0, 6).join(' | ') + (a.contexts.size > 6 ? ` (+${a.contexts.size - 6} more)` : ''), observed, missing, extra, status });
  }
  return out;
}

// "Auto Dealers X" in the precondition is "Garage X" on the screens; a leading form number is not part of the name.
const isFormNumberName = (cov) => cov.mappingForm || /^\s*CAD?\s?\d{2}\s?\d{2}\b/i.test(cov.name);

// A coverage is PRESENT only when WriteBiz shows it as a coverage card title or an Additional Coverages grid row with the
// same name (not merely the same words somewhere on the page). Form-number entries are matched by their number in the page text.
function findPresent(cov, pool) {
  const c = canon(cov.name);
  for (const p of pool) {
    if ((p.cards || []).some((k) => canon(k.title) === c)) return p;
    if ((p.gridNames || []).some((g) => canon(g) === c)) return p;
  }
  // "<State> Uninsured / Underinsured Motorists Coverage - Nonstacked": on WriteBiz this is a Coverage Type option
  // ("Combined Single Limit Nonstacked") of the Uninsured / Underinsured Motorists Coverage card, not a coverage of its own.
  const stack = /(uninsured|underinsured) motorists coverage (non ?stacked|stacked)$/.exec(c.replace(/^[a-z ]*?(?=(uninsured|underinsured) )/, ''));
  if (stack) {
    const want = stack[2].replace(' ', '');
    for (const p of pool) {
      if ((p.cards || []).some((k) => canon(k.title) === `${stack[1]} motorists coverage` && (k.terms || []).some((t) => (t.options || []).some((o) => norm(o).split(' ').includes(want))))) return p;
    }
  }
  if (isFormNumberName(cov)) return pool.find((p) => matchers(cov).some((m) => p.norm.includes(m)));
  return null;
}

function evaluate(lob, state, pool) {
  const results = expectedFor(lob, state).map((cov) => {
    const hit = findPresent(cov, pool);
    let page = hit ? hit.label : '';
    if (!hit && cov.expected) {
      const sim = similarLine(cov, pool);
      if (sim) page = `not present; similar wording on ${sim.page}: "${sim.line}"`; // reported, but never counted as found
    }
    let status;
    if (!cov.expected) status = hit ? 'UNEXPECTED' : 'NOT_APPLICABLE';
    else if (hit) status = 'FOUND';
    else if (needsOtherVehicle(cov, state)) status = 'NOT_TESTED';
    else status = wbVisible(cov) && !qaPcOnly(cov) ? 'MISSING' : 'PC_ONLY';
    if (cov.optional && !hit) return null; // unclassified and not on screen: nothing to report
    return { category: cov.category, name: cov.name, source: cov.source || '', code: cov.code || '', form: cov.form || '', availability: (cov.availability || {})[state] || '', status, page, cov };
  });
  const termChecks = checkAllCards(state, pool);
  for (let k = results.length - 1; k >= 0; k--) if (results[k] === null) results.splice(k, 1);
  results.forEach((r) => { delete r.cov; });
  // Informational only: the sheet's "Removed" column is ambiguous (removed from the product vs. from test scope).
  const stillThere = DATA.removed.filter((r) => norm(r.name).length > 12 && pool.some((p) => p.norm.includes(norm(r.name))))
    .map((r) => ({ category: r.category, name: r.name, code: '', form: '', availability: '', status: 'REMOVED_STILL_PRESENT', page: '' }));
  const all = results.concat(stillThere);
  const count = (st) => all.filter((r) => r.status === st).length;
  return {
    results: all,
    termChecks,
    summary: { termMismatches: termChecks.filter((t) => t.status === 'MISMATCH').length, termsChecked: termChecks.length, termsPartial: termChecks.filter((t) => t.status === 'PARTIAL').length, termsNoModelData: termChecks.filter((t) => t.status === 'NO_MODEL_DATA').length, found: count('FOUND'), missing: count('MISSING'), pcOnly: count('PC_ONLY'), notTested: count('NOT_TESTED'), unexpected: count('UNEXPECTED'), removedStillPresent: count('REMOVED_STILL_PRESENT'), notApplicable: count('NOT_APPLICABLE') },
  };
}

module.exports = { DATA, LOB_LABELS, snapshot, evaluate, expectedFor, readCards, norm };
