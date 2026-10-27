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

// Page-level coverage cards: for the first (controlling) dropdown of each card, select every option except "No Coverage",
// record the terms/options that appear, then restore the default. e.g. Collision / Other Than Collision "Coverage Type".
async function exerciseCards(page, pool, label, maxCards = 14) {
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id^="xacc_Card_"]')].filter((c) => c.offsetParent !== null && c.querySelector('select')).map((c) => c.id)).catch(() => []);
  let n = 0;
  for (const id of ids) {
    if (n++ >= maxCards) break;
    const card = page.locator(`[id="${id}"]`);
    const sel = card.locator('select').first();
    const info = await sel.evaluate((e) => {
      const fs = e.closest('.FieldSpacing'); const l = fs && fs.querySelector('.FieldLabel');
      return { label: l ? l.textContent.replace(/\s+/g, ' ').trim() : e.id, cur: e.value, curText: e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '', disabled: e.disabled,
        opts: [...e.options].filter((o) => o.value && !/nothing selected|^select/i.test(o.textContent)).map((o) => ({ v: o.value, t: o.textContent.trim() })) };
    }).catch(() => null);
    if (!info || info.disabled || info.opts.length < 2 || info.opts.length > 8) continue;
    if (info.opts.every((o) => /^(yes|no)$/i.test(o.t))) continue; // Yes/No switches (e.g. Hired Auto Coverage) are set by the flow, never toggled here
    const title = await card.locator('.xaccordion-sectionheader').first().innerText().catch(() => id);
    for (const o of info.opts) {
      if (o.v === info.cur || /^no coverage$/i.test(o.t)) continue;
      await sel.selectOption(o.v).catch(() => {});
      await settle(page, 1800);
      const cards = await readCards(page, `#${id}`);
      pool.push({ label, context: `${info.label} = ${o.t}`, text: '', norm: '', shot: '', cards: cards.map((c) => ({ ...c, title: title.replace(/\s+Save$/i, '').trim() })) });
    }
    await restoreSelect(page, sel, info);
  }
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
          const addItem = modal.locator('button:has-text("Add Scheduled Item"), button:has-text("Add Item"), button:has-text("Add New")').first();
          if (await addItem.count() > 0) {
            let saved = 0;
            for (let n = 0; n < 2; n++) { // two scheduled items for any scheduled coverage
              await addItem.click({ timeout: 4000 }).catch(() => {});
              await page.waitForTimeout(1200);
              const top = page.locator('.modal.show').last();
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
  return [...done];
}

module.exports = { addExpectedFromGrid, readGrid, exerciseCards };
