// CA Refresh: add the precondition's additional coverages / forms / exclusions from a WriteBiz "Additional Coverages"
// grid (Type | Selected | Coverage Name | Actions[+]). For each expected name that has a row: click "+", record the
// dialog's terms and options (compared with the product model later), fill the required terms, Save, then confirm
// the row shows as selected. Results feed the run's Word document.
const { readCards, norm } = require('./caRefreshValidator');

const tokens = (s) => norm(String(s).replace(/\(.*?\)/g, '')).split(' ').filter((t) => t.length > 2);
// share of the GRID name's words that appear in the expected (precondition) name
const covered = (gridName, expectedName) => { const g = tokens(gridName); const e = new Set(tokens(expectedName)); return g.length ? g.filter((t) => e.has(t)).length / g.length : 0; };

async function readGrid(page) {
  return page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr, index) => {
    const td = [...tr.querySelectorAll('td')];
    if (td.length < 4 || !tr.offsetParent) return null;
    const name = td[2].textContent.replace(/\s+/g, ' ').trim();
    const actions = td[td.length - 1];
    return { index, type: td[0].textContent.trim(), name,
      selected: !!td[1].querySelector('i, svg, img') || !!actions.querySelector('.fa-trash, .fa-trash-alt, [class*="trash"]'),
      canAdd: !!actions.querySelector('button[data-action="Add"], button:has(i.fa-plus-circle), i.fa-plus-circle') };
  }).filter((r) => r && r.name)).catch(() => []);
}

// Fill whatever the dialog requires: dropdowns -> first real option, text -> 'Test', numbers/limits -> 1000, dates -> effective date.
async function fillDialog(modal, effectiveDate) {
  for (const sel of await modal.locator('select:visible').all()) {
    const val = await sel.evaluate((e) => ([...e.options].find((o) => o.value && !/nothing selected|^select/i.test(o.textContent)) || {}).value).catch(() => null);
    const cur = await sel.inputValue().catch(() => '');
    if (val && !cur) await sel.selectOption(val).catch(() => {});
  }
  await modal.page().waitForTimeout(900); // choosing a dropdown value re-renders the dialog and clears typed text - fill text after it settles
  // Checkbox groups ("Coverages" on a scheduled item) need at least one ticked.
  const ticks = modal.locator('input[type="checkbox"]:visible');
  if (await ticks.count() > 0) {
    let any = false;
    for (const c of await ticks.all()) if (await c.isChecked().catch(() => false)) any = true;
    if (!any) await ticks.first().check({ force: true }).catch(() => {});
  }
  for (const box of await modal.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):visible, textarea:visible').all()) {
    if ((await box.inputValue().catch(() => 'x')).trim()) continue;
    const hint = `${await box.getAttribute('id').catch(() => '')} ${await box.getAttribute('name').catch(() => '')} ${await box.getAttribute('aria-label').catch(() => '')}`;
    const label = await box.evaluate((e) => { const fs = e.closest('.FieldSpacing, tr, .form-group'); return fs ? fs.textContent : ''; }).catch(() => '');
    const text = `${hint} ${label}`;
    const value = /date/i.test(text) ? effectiveDate : /limit|amount|premium|number|cost|value|\$/i.test(text) ? '1000' : 'Test';
    await box.fill(value).catch(() => {});
  }
}

// "Add Additional Insured Contact" / loss payee contact form: a Name plus "Select existing location" (fills the address).
async function createContact(page) {
  const dlg = page.locator('.modal.show').filter({ hasText: /Add .*Contact/i }).last();
  if (!await dlg.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) { console.log('  Add New: no contact dialog appeared; modals: ' + (await page.locator('.modal.show .modal-title, .modal.show .modal-header').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200)); return false; }
  for (const sel of await dlg.locator('select:visible').all()) {
    const hasExisting = await sel.evaluate((e) => [...e.options].some((o) => /existing location/i.test(o.textContent))).catch(() => false);
    if (hasExisting) { await sel.selectOption({ index: 1 }).catch(() => {}); await page.waitForTimeout(800); }
  }
  // Name goes in after the address (picking an existing location re-renders the form). It is the input next to the "Name" label.
  const nameBox = dlg.locator('xpath=.//*[normalize-space(text())="Name"]/following::input[not(@type="hidden")][1]');
  await nameBox.fill('Test Company').catch(async () => { await dlg.locator('input[type="text"]:visible').first().fill('Test Company').catch(() => {}); });
  await nameBox.press('Tab').catch(() => {});
  await dlg.locator('button:has-text("Save")').first().click({ timeout: 5000 }).catch(() => {});
  const closed = await dlg.waitFor({ state: 'hidden', timeout: 8000 }).then(() => true).catch(() => false);
  console.log(`  contact dialog ${closed ? 'saved' : 'did NOT close: ' + ((await dlg.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 300)}`);
  await page.waitForTimeout(800);
  return true;
}

// Fill a coverage / scheduled-item dialog: create the contact it asks for (Add New), then the remaining terms.
async function completeDialog(page, modal, effectiveDate) {
  const addNew = modal.locator('button:has-text("Add New")').first();
  if (await addNew.count() > 0 && await addNew.isVisible().catch(() => false)) {
    await addNew.click({ timeout: 4000 }).catch(() => {});
    await createContact(page);
  }
  await fillDialog(modal, effectiveDate);
}

// QA (Devyani): "Drive Other Car Coverage - Broadened Coverage For Named Individuals" needs one scheduled item per coverage type -
// the first with "...Named Individuals Collision", the second with "...Named Individuals Other Than Collision".
const ITEM_PICKS = [
  { row: /drive other car.*named individuals/i, picks: [/(named individuals collision|indivscollision)\s*$/i, /(named individuals other than collision|indivsoththancollision)\s*$/i] },
];
async function pickItemCoverage(dlg, re) {
  for (const sel of await dlg.locator('select:visible').all()) {
    const v = await sel.evaluate((e, src) => { const r = new RegExp(src, 'i'); const o = [...e.options].find((x) => x.value && r.test(x.textContent.trim())); return o ? o.value : null; }, re.source).catch(() => null);
    if (v) { await sel.selectOption(v).catch(() => {}); await dlg.page().waitForTimeout(900); return true; }
  }
  const boxes = await dlg.locator('input[type="checkbox"]:visible').all();
  for (const b of boxes) {
    const t = await b.evaluate((e) => { const l = e.id && document.querySelector(`label[for="${e.id}"]`); return ((l && l.textContent) || (e.closest('label') || e.parentElement || {}).textContent || '').replace(/\s+/g, ' ').trim(); }).catch(() => '');
    const bid = await b.getAttribute('id').catch(() => '');
    if (re.test(t) || re.test(bid || '')) { await b.check({ force: true }).catch(() => {}); return true; }
  }
  return false;
}

// Close every open dialog (nested scheduled-item dialog first) so a coverage that cannot be added never blocks the page.
async function closeAllModals(page) {
  for (let i = 0; i < 5; i++) {
    const top = page.locator('.modal.show').last();
    if (!await top.isVisible().catch(() => false)) return;
    await top.locator('button:has-text("Remove Scheduled Item"), button:has-text("Remove Coverage"), button:has-text("Cancel"), button:has-text("Close")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

// Wait until WriteBiz has finished reacting to a change (status overlay gone, network quiet), close an "An error has
// occurred" box if one pops up, then leave a short margin. Changing dropdowns faster than this leaves dependants blank.
async function settle(page, extra = 1200) {
  await page.locator('#dgic-status-message').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const err = page.locator('.modal.show').filter({ hasText: 'An error has occurred' }).first();
  if (await err.isVisible().catch(() => false)) {
    console.log('  "An error has occurred" box after a dropdown change - closing it');
    await err.getByRole('button', { name: /close/i }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(extra);
}

// Put a dropdown back to the option it started on and prove it (several tries, each with a full settle).
async function restoreSelect(page, sel, info) {
  for (let k = 0; k < 4; k++) {
    await sel.selectOption({ label: info.curText }).catch(() => sel.selectOption(info.cur).catch(() => {}));
    await settle(page, 1500);
    const now = await sel.evaluate((e) => (e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '')).catch(() => '');
    if (now === info.curText) return true;
  }
  console.log(`  could not restore "${info.label}" to "${info.curText}"`);
  return false;
}

// Select each option of every (small) dropdown in the dialog, record the terms/options it then shows, put the default back.
async function exerciseDialog(page, modal, pool, rowName) {
  const sels = await modal.locator('select:visible').all();
  for (const sel of sels.slice(0, 6)) {
    const info = await sel.evaluate((e) => {
      const fs = e.closest('.FieldSpacing'); const l = fs && fs.querySelector('.FieldLabel');
      return { label: l ? l.textContent.replace(/\s+/g, ' ').trim() : e.id, cur: e.value, curText: e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '',
        opts: [...e.options].filter((o) => o.value && !/nothing selected|^select/i.test(o.textContent)).map((o) => ({ v: o.value, t: o.textContent.trim() })) };
    }).catch(() => null);
    if (!info || info.opts.length < 2 || info.opts.length > 8) continue;
    for (const o of info.opts) {
      if (o.v === info.cur) continue;
      await sel.selectOption(o.v).catch(() => {});
      await settle(page, 1200);
      const cards = await readCards(page, '.modal.show');
      pool.push({ label: `Add coverage: ${rowName}`, context: `${info.label} = ${o.t}`, text: '', norm: '', shot: '', cards: cards.map((c) => ({ ...c, title: rowName })) });
    }
    await restoreSelect(page, sel, info);
  }
}

// Page-level coverage cards (QA: Devyani 2025-10): EVERY dropdown of each card is exercised - each non-default option is selected,
// the terms/options that then appear are recorded, and the default is restored (e.g. Collision "Collision Coverage Type", Other Than
// Collision "Other Than Collision Coverage Type", PIP "First Party Benefits Coverage Type"). For the controlling (first) dropdown the
// later dropdowns are exercised again under each of its options (e.g. Losses Coverage -> Collision Coverage Type).
const OPT_READ = (e) => ({ label: (() => { const fs = e.closest('.FieldSpacing'); const l = fs && fs.querySelector('.FieldLabel'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : e.id; })(),
  cur: e.value, curText: e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '', disabled: e.disabled,
  opts: [...e.options].filter((o) => o.value && !/nothing selected|^select/i.test(o.textContent)).map((o) => ({ v: o.value, t: o.textContent.trim() })) });
async function exerciseCards(page, pool, label, maxCards = 40, opts = {}) {
  const touched = [];
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id^="xacc_Card_"]')].filter((c) => c.offsetParent !== null && c.querySelector('select')).map((c) => c.id)).catch(() => []);
  let n = 0;
  for (const id of ids) {
    if (n++ >= maxCards) break;
    const card = page.locator(`[id="${id}"]`);
    const title = (await card.locator('.xaccordion-sectionheader').first().innerText().catch(() => id)).replace(/\s+Save$/i, '').trim();
    const count = await card.locator('select').count().catch(() => 0);
    const infoAt = async (k) => card.locator('select').nth(k).evaluate(OPT_READ).catch(() => null);
    const usable = (info) => info && !/deductible/i.test(info.label) /* dependent outputs - changing them corrupts the card server-side */ && !info.disabled && info.cur && !/nothing selected|^select|^please select/i.test(info.curText) && /* a blank start cannot be restored */ info.opts.length >= 2 && info.opts.length <= 12 && !info.opts.every((o) => /^(yes|no)$/i.test(o.t)); // Yes/No switches are set by the flow, never toggled here
    const snap = async (context) => { const cards = await readCards(page, `#${id}`); pool.push({ label, context, text: '', norm: '', shot: '', cards: cards.map((c) => ({ ...c, title })) }); };
    for (let si = 0; si < count && si < 8; si++) {
      const info = await infoAt(si);
      if (!usable(info)) continue;
      const sel = card.locator('select').nth(si);
      for (const o of info.opts) {
        if (o.v === info.cur || /^no coverage$/i.test(o.t)) continue;
        await sel.selectOption(o.v).catch(() => {});
        await settle(page, 1800);
        await snap(`${info.label} = ${o.t}`);
        if (si === 0) { // dependent dropdowns under this option of the controlling one
          const now = await card.locator('select').count().catch(() => 0);
          for (let sj = 1; sj < now && sj < 6; sj++) {
            const inf2 = await infoAt(sj);
            if (!usable(inf2)) continue;
            const sel2 = card.locator('select').nth(sj);
            for (const q of inf2.opts.filter((x) => x.v !== inf2.cur && !/^no coverage$/i.test(x.t)).slice(0, 4)) {
              await sel2.selectOption(q.v).catch(() => {});
              await settle(page, 1500);
              await snap(`${info.label} = ${o.t}; ${inf2.label} = ${q.t}`);
            }
            await restoreSelect(page, sel2, inf2);
          }
        }
      }
      await restoreSelect(page, sel, info);
      touched.push({ id, si, label: info.label, curText: info.curText, title });
    }
  }
  if (touched.length) await verifyAgainstServer(page, touched, opts.rerender);
  return touched;
}

// Root cause of the dealer "Coverage Type left on Blanket Collision / Limit Of Liability with blank dependants" failure:
// the restore is posted to WriteBiz (coverageOnChangeEvent -> AjaxInvoke_UpdateCoverageTermsWithoutReload). When that post
// fails ("An error has occurred, please try again") the SERVER keeps the exercised value while the browser's <select> already
// shows the restored one, so a check of the <select> passes. The next full re-render (e.g. turning Other Than Collision on)
// brings the server value back with its required terms empty. So: re-render the page from the server and compare THAT,
// redoing every dropdown that is not back on its starting option.
async function verifyAgainstServer(page, touched, rerender) {
  const readNow = async (t) => page.locator(`[id="${t.id}"] select`).nth(t.si || 0)
    .evaluate((e) => (e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '')).catch(() => null);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await (rerender ? rerender() : page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}));
    await settle(page, 1500);
    const wrong = [];
    for (const t of touched) {
      const now = await readNow(t);
      if (now !== null && now !== t.curText) wrong.push({ ...t, now });
    }
    if (!wrong.length) { console.log(`  exercise: all ${touched.length} exercised dropdown(s) confirmed back on their defaults after a server re-render`); return true; }
    console.log(`  exercise: server kept ${wrong.length} exercised value(s) (attempt ${attempt}): ${wrong.map((w) => `${w.title}: ${w.label} = ${w.now} (want ${w.curText})`).join('; ')}`);
    for (const w of wrong) {
      const sel = page.locator(`[id="${w.id}"] select`).nth(w.si || 0);
      await sel.selectOption({ label: w.curText }).catch(() => {});
      await settle(page, 2500);
    }
  }
  console.log('  exercise: WARNING - could not get every exercised dropdown back to its default');
  return false;
}

// opts: { expected: [{name, category}], effectiveDate, pool, record(entry), label }
async function addExpectedFromGrid(page, opts) {
  const { expected, effectiveDate, pool, record, label } = opts;
  const rows = await readGrid(page);
  const done = new Set();
  for (const row of rows) {
    const match = expected.filter((e) => !done.has(e.name)).map((e) => ({ e, score: norm(row.name) === norm(e.name) ? 1 : covered(row.name, e.name) }))
      .filter((m) => m.score >= 0.8 && tokens(row.name).length >= 2 && (tokens(row.name).length > 6 || m.score === 1)).sort((a, b) => b.score - a.score)[0];
    if (!match) continue;
    const entry = { coverage: match.e.name, gridRow: row.name, page: label, status: '', detail: '' };
    done.add(match.e.name);
    if (row.selected && !row.canAdd) { entry.status = 'ALREADY_SELECTED'; record(entry); continue; }
    if (!row.canAdd) { entry.status = 'NO_ADD_BUTTON'; record(entry); continue; }
    try {
      const tr = page.locator('table tbody tr').nth(row.index);
      await tr.locator('button[data-action="Add"], button:has(i.fa-plus-circle)').first().click({ timeout: 8000, force: true });
      const modal = page.locator('.modal.show').first();
      const opened = await modal.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
      if (opened) {
        await page.waitForTimeout(500);
        const cards = await readCards(page, '.modal.show');
        pool.push({ label: `Add coverage: ${row.name}`, text: await modal.innerText().catch(() => ''), norm: norm(row.name), shot: '', cards: cards.map((c) => ({ ...c, title: row.name })) });
        await exerciseDialog(page, modal, pool, row.name).catch((e) => console.log(`  exerciseDialog: ${e.message.split(String.fromCharCode(10))[0]}`));
        await completeDialog(page, modal, effectiveDate);
        await modal.locator('button:has-text("Save")').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        // Dialogs such as the Additional Insured forms need at least one scheduled item before they will save.
        if (await modal.isVisible().catch(() => false)) {
          console.log(`  schedule: dialog still open after first Save for "${row.name}"`);
          const addItem = modal.locator('button:has-text("Add Scheduled Item"), button:has-text("Add Item"), button:has-text("Add New")').first();
          if (await addItem.count() > 0) {
            let saved = 0;
            for (let n = 0; n < 2; n++) { // two scheduled items for any scheduled coverage
              await addItem.click({ timeout: 4000 }).catch(() => {});
              await page.waitForTimeout(1200);
              const top = page.locator('.modal.show').last();
              const want = (ITEM_PICKS.find((x) => x.row.test(row.name)) || {}).picks;
              if (want && want[n]) {
                let ok = false;
                for (let k = 0; k < 4 && !ok; k++) { // the nested dialog can still be animating in
                  await top.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
                  ok = await pickItemCoverage(top, want[n]);
                  if (!ok) await page.waitForTimeout(1200);
                }
                console.log(`  scheduled item ${n + 1} of "${row.name}": ${ok ? 'picked' : 'could NOT pick'} ${want[n]}`);
                if (!ok && opts.shotDir) await page.screenshot({ path: require('path').join(opts.shotDir, `schedule-item-${n + 1}-pick-failed.png`) }).catch(() => {});
                if (!ok) console.log('  schedule dialog dump: ' + JSON.stringify(await top.evaluate((m) => ({ selects: [...m.querySelectorAll('select')].map((e) => ({ id: e.id, vis: !!e.offsetParent, opts: [...e.options].map((o) => o.textContent.trim()).slice(0, 8) })), boxes: [...m.querySelectorAll('input[type=checkbox],input[type=radio]')].map((e) => ({ id: e.id, name: e.name, vis: !!e.offsetParent, txt: ((e.closest('label') || e.parentElement || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) })), text: m.innerText.replace(/\s+/g, ' ').slice(0, 400) })).catch((e) => ({ err: String(e.message).slice(0, 150), modals: 0 }))));
                const cards2 = await readCards(page, '.modal.show').catch(() => []);
                pool.push({ label: `Add coverage: ${row.name}`, context: `scheduled item ${n + 1}: Named Individuals ${n === 0 ? 'Collision' : 'Other Than Collision'}`, text: '', norm: '', shot: '', cards: cards2.map((c) => ({ ...c, title: row.name })) });
              }
              for (let attempt = 0; attempt < 3; attempt++) {
                await completeDialog(page, top, effectiveDate);
                await top.locator('button:has-text("Save")').first().click({ timeout: 4000 }).catch(() => {});
                if (await top.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false)) break;
              }
              if (await top.isVisible().catch(() => false)) {
                entry.detail = 'scheduled item ' + (n + 1) + ': ' + (((await top.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 200));
                break;
              }
              saved++;
              await page.waitForTimeout(500);
            }
            if (saved) {
              if (saved < 2 && !entry.detail) entry.detail = 'only ' + saved + ' scheduled item saved';
              await page.locator('.modal.show').first().locator('button:has-text("Save")').first().click({ timeout: 4000 }).catch(() => {});
              await page.waitForTimeout(1500);
              if (saved === 2) entry.detail = '2 scheduled items added';
            }
          }
        }
        if (await modal.isVisible().catch(() => false)) {
          entry.detail = ((await modal.locator('.alert, [class*="error"], .text-danger').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 160);
          if (opts.shotDir) await page.screenshot({ path: require('path').join(opts.shotDir, `cannot-add-${norm(row.name).replace(/ /g, '_').slice(0, 40)}.png`) }).catch(() => {});
          if (!entry.detail) entry.detail = ((await modal.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 200);
          await modal.locator('button:has-text("Remove Coverage"), button:has-text("Cancel"), button:has-text("Close")').first().click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      }
      await closeAllModals(page);
      // Saving can rename the row (terms get appended), so fall back to a close name match among the selected rows.
      const grid2 = await readGrid(page);
      const after = grid2.find((r) => norm(r.name) === norm(row.name))
        || grid2.find((r) => r.selected && covered(row.name, r.name) >= 0.8 && covered(r.name, row.name) >= 0.8);
      entry.status = after && after.selected ? 'ADDED' : 'ADD_FAILED';
      if (entry.status === 'ADD_FAILED' && !entry.detail) {
        const alert = await page.locator('.modal.show, .alert, .text-danger').first().innerText().catch(() => '');
        entry.detail = `${opened ? 'dialog opened' : 'no dialog opened'}; row ${after ? 'present, not selected' : 'not found'}; ${alert.replace(/\s+/g, ' ').slice(0, 140)}`;
        console.log(`CA Refresh add debug "${row.name}": ${entry.detail} | row=${JSON.stringify(row)} after=${JSON.stringify(after)}`);
      }
    } catch (e) { entry.status = 'ADD_FAILED'; entry.detail = e.message.split('\n')[0]; }
    record(entry);
  }
  for (const e of expected.filter((x) => x.source === 'QA' && !done.has(x.name))) { // QA extras with no grid row on this page: show the nearest rows so the name can be matched
    const near = rows.filter((r) => covered(r.name, e.name) >= 0.4 || covered(e.name, r.name) >= 0.5).map((r) => r.name).slice(0, 4);
    console.log(`  QA extra "${e.name}" not in the grid on "${label}"${near.length ? '; nearest rows: ' + JSON.stringify(near) : ''}`);
  }
  return [...done];
}

module.exports = { addExpectedFromGrid, readGrid, exerciseCards };
