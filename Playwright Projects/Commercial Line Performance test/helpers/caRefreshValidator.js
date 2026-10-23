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

function expectedFor(lob, state) {
  const d = DATA.lobs[lob];
  if (!d) throw new Error(`No CA Refresh data for LOB "${lob}"`);
  const list = [];
  for (const sec of d.sections) {
    for (const c of sec.coverages) {
      list.push({ category: sec.category, ...c, expected: isExpectedIn(c, state) });
    }
  }
  for (const f of d.mappingForms) list.push({ category: 'Forms from mapping', name: f, expected: true, form: true });
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
    pool.push({ label, text, norm: norm(text), shot, cards });
  } catch (e) { console.log(`CA Refresh snapshot "${label}" failed: ${e.message.split('\n')[0]}`); }
}

// Forms in the mapping list start with a form number ("CA 20 16 ...") - match on the number or the full title.
function matchers(cov) {
  const full = norm(cov.name);
  const list = [full];
  const m = /^\s*(CAD?\s?\d{2}\s?\d{2})\b/i.exec(cov.name);
  if (m) list.push(norm(m[1]));
  if (cov.form) list.push(norm(cov.form));
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
const wbVisible = (cov) => cov.form || !cov.writeBiz || /^y/i.test(cov.writeBiz);

// The workflow only creates a Private Passenger and a Truck vehicle, so coverages that live on other vehicle
// types can't be seen - say so instead of calling them missing.
const NO_PRIVATE_PASSENGER_STATES = ['NC']; // WriteBiz: "Private Passengers may not be written in the state of NC"
const needsOtherVehicle = (cov, state) => /^(Special Type|Public Transportation|Zone Rated)/i.test(cov.category) || (NO_PRIVATE_PASSENGER_STATES.includes(state) && /^Private Passenger/i.test(cov.category));

// Compare each coverage term's options as seen in WriteBiz with the product model's options for the state.
const normOpt = (o) => norm(String(o).replace(/,/g, ''));
const jaccard = (a, b) => { const ta = new Set(tokens(a)); const tb = new Set(tokens(b)); const u = new Set([...ta, ...tb]); return u.size ? [...ta].filter((t) => tb.has(t)).length / u.size : 0; };
const overlap = (a, b) => { const ta = tokens(a); const tb = tokens(b); return ta.length ? ta.filter((t) => tb.includes(t)).length / ta.length : 0; };

const modelByName = new Map();
for (const m of DATA.modelTerms || []) { const k = norm(m.name); (modelByName.get(k) || modelByName.set(k, []).get(k)).push(m); }

// Every coverage card / Add-coverage dialog captured from WriteBiz that maps to a product-model coverage with term
// options gets its dropdown options compared with the model's options offered in this state.
function checkAllCards(state, pool) {
  const out = [];
  const done = new Set();
  for (const p of pool) {
    for (const card of p.cards || []) {
      let cands = modelByName.get(norm(card.title));
      if (!cands) cands = (DATA.modelTerms || []).filter((m) => overlap(m.name, card.title) >= 0.9 && overlap(card.title, m.name) >= 0.9);
      if (!cands.length) continue;
      const selects = card.terms.filter((x) => x.kind === 'select');
      const score = (m) => Object.keys(m.terms).filter((tn) => selects.some((x) => overlap(tn, x.label) >= 0.6)).length;
      const m = cands.slice().sort((a, b) => score(b) - score(a))[0];
      for (const [term, opts] of Object.entries(m.terms)) {
        const t = selects.slice().sort((x, y) => jaccard(term, y.label) - jaccard(term, x.label))[0];
        const expected = opts.filter((o) => o.states.includes(state) && o.wb !== 'N').map((o) => o.option);
        const base = { coverage: card.title, term, expected, page: p.label };
        if (!t || jaccard(term, t.label) < 0.6) { continue; } // term not shown for this card/state - nothing to compare
        const key = `${norm(card.title)}|${norm(term)}|${t.options.join('~')}`;
        if (done.has(key)) continue;
        done.add(key);
        const seen = new Set(t.options.map(normOpt));
        const want = new Set(expected.map(normOpt));
        const missing = expected.filter((o) => !seen.has(normOpt(o)));
        const extra = t.options.filter((o) => !want.has(normOpt(o)));
        // Options WriteBiz offers that the model does not list = MISMATCH. Model options not on screen = PARTIAL (many
        // dropdowns are filtered by another selection, so only a subset is visible). No options for this state = no data.
        const status = !expected.length ? 'NO_MODEL_DATA' : extra.length ? 'MISMATCH' : missing.length ? 'PARTIAL' : 'MATCH';
        out.push({ ...base, observed: t.options, missing, extra, status });
      }
    }
  }
  return out;
}

function evaluate(lob, state, pool) {
  const results = expectedFor(lob, state).map((cov) => {
    let hit = pool.find((p) => matchers(cov).some((m) => p.norm.includes(m)));
    let page = hit ? hit.label : '';
    if (!hit && cov.expected) {
      const sim = similarLine(cov, pool);
      if (sim) { hit = sim; page = `${sim.page} (as "${sim.line}")`; }
    }
    let status;
    if (!cov.expected) status = hit ? 'UNEXPECTED' : 'NOT_APPLICABLE';
    else if (hit) status = 'FOUND';
    else if (needsOtherVehicle(cov, state)) status = 'NOT_TESTED';
    else status = wbVisible(cov) ? 'MISSING' : 'PC_ONLY';
    return { category: cov.category, name: cov.name, code: cov.code || '', form: cov.form || '', availability: (cov.availability || {})[state] || '', status, page, cov };
  });
  const termChecks = checkAllCards(state, pool);
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
