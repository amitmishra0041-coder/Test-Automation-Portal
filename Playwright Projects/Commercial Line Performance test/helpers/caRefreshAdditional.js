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
  for (const box of await modal.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):visible, textarea:visible').all()) {
    if ((await box.inputValue().catch(() => 'x')).trim()) continue;
    const hint = `${await box.getAttribute('id').catch(() => '')} ${await box.getAttribute('name').catch(() => '')} ${await box.getAttribute('aria-label').catch(() => '')}`;
    const label = await box.evaluate((e) => { const fs = e.closest('.FieldSpacing, tr, .form-group'); return fs ? fs.textContent : ''; }).catch(() => '');
    const text = `${hint} ${label}`;
    const value = /date/i.test(text) ? effectiveDate : /limit|amount|premium|number|cost|value|\$/i.test(text) ? '1000' : 'Test';
    await box.fill(value).catch(() => {});
  }
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

// opts: { expected: [{name, category}], effectiveDate, pool, record(entry), label }
async function addExpectedFromGrid(page, opts) {
  const { expected, effectiveDate, pool, record, label } = opts;
  const rows = await readGrid(page);
  const done = new Set();
  for (const row of rows) {
    const match = expected.filter((e) => !done.has(e.name)).map((e) => ({ e, score: norm(row.name) === norm(e.name) ? 1 : covered(row.name, e.name) }))
      .filter((m) => m.score >= 0.8 && tokens(row.name).length >= 2).sort((a, b) => b.score - a.score)[0];
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
        await fillDialog(modal, effectiveDate);
        await modal.locator('button:has-text("Save")').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        // Dialogs such as the Additional Insured forms need at least one scheduled item before they will save.
        if (await modal.isVisible().catch(() => false)) {
          const addItem = modal.locator('button:has-text("Add Scheduled Item"), button:has-text("Add Item"), button:has-text("Add New")').first();
          if (await addItem.count() > 0) {
            await addItem.click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1200);
            const top = page.locator('.modal.show').last();
            await fillDialog(top, effectiveDate);
            await top.locator('button:has-text("Save"), button:has-text("OK"), button:has-text("Add")').first().click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1200);
            await page.locator('.modal.show').first().locator('button:has-text("Save")').first().click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1500);
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

module.exports = { addExpectedFromGrid, readGrid };
