// CA Refresh: Vehicles summary -> Next can be refused with an "Attention / Errors" box such as
//   3: (1FTEW1EP4KFA54321) 2019 FORD F150: Special Types Other Than Collision Coverage - Missing required field "Losses Covered" Edit
// Seen live (trace of PA Auto Dealers, 10/29): the Edit link runs $CLAutoVehicles.editVehicleByFixedId behind a "Loading..."
// bubble and lands (seconds later) on the vehicle's DETAILS sub-tab; the missing field is on the Coverages sub-tab and
// "Save Vehicle" only exists on Additional Coverages. Repair = Edit -> Next (Coverages) -> fill blanks, re-check after a
// re-render -> Next (Additional Coverages) -> Save Vehicle -> back on the summary -> Next again.
// Offline test: node scripts/mock/testVehicleRepairOffline.js

// Re-post every visible select whose label / required message is `field`: pick another real option, then the original
// (or the first real option when it was blank), each followed by the status bubble settling.
async function repostField(page, field, dismiss) {
  const ids = await page.evaluate((f) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return [...document.querySelectorAll('select')].filter((s) => {
      const box = s.closest('.bootstrap-select') || s;
      if (s.disabled || !(box.offsetParent || box.getClientRects().length)) return false;
      const msg = norm(s.getAttribute('data-requiredmessage')).replace(/ is required$/, '');
      const fs = s.closest('.FieldSpacing, .form-group, tr');
      const lab = fs ? norm((fs.querySelector('.FieldLabel, label, span') || {}).textContent) : '';
      return msg === norm(f) || lab === norm(f);
    }).map((s) => s.id).filter(Boolean);
  }, field).catch(() => []);
  const done = [];
  if (!ids.length) {
    // The field exists but is DISABLED and blank (OH / CO 10/30: "Uninsured Motorists Property Damage Limit", recalculated
    // from the Uninsured Motorists card above it). Re-send the controlling dropdown of the card just before it so WriteBiz
    // recalculates and enables it; the caller's blank-fill then sets it.
    const ctl = await page.evaluate((f) => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const dis = [...document.querySelectorAll('select')].find((s) => s.disabled && norm(s.getAttribute('data-requiredmessage')).replace(/ is required$/, '') === norm(f));
      const card = dis && dis.closest('[id^="xacc_Card_"]');
      let prev = card && card.previousElementSibling;
      while (prev && !(prev.id || '').startsWith('xacc_Card_')) prev = prev.previousElementSibling;
      const sel = prev && [...prev.querySelectorAll('select')].find((s) => !s.disabled && s.id);
      return sel ? sel.id : null;
    }, field).catch(() => null);
    if (ctl) {
      const sel = page.locator(`[id="${ctl}"]`);
      const info = await sel.evaluate((e) => ({ cur: e.value, opts: [...e.options].filter((o) => o.value).map((o) => o.value) })).catch(() => null);
      if (info && info.cur) {
        const other = info.opts.find((v) => v !== info.cur);
        if (other) { await sel.selectOption(other).catch(() => {}); await page.waitForTimeout(800); await dismiss(); }
        await sel.selectOption(info.cur).catch(() => {});
        await page.waitForTimeout(1200);
        await dismiss();
        done.push(`${ctl} (controls the disabled field)`);
      }
    }
  }
  for (const id of ids) {
    const sel = page.locator(`[id="${id}"]`);
    const info = await sel.evaluate((e) => ({ cur: e.value, opts: [...e.options].filter((o) => o.value).map((o) => o.value) })).catch(() => null);
    if (!info || !info.opts.length) continue;
    const keep = info.cur && info.opts.includes(info.cur) ? info.cur : info.opts[0];
    const other = info.opts.find((v) => v !== keep);
    if (other) { await sel.selectOption(other).catch(() => {}); await page.waitForTimeout(800); await dismiss(); }
    await sel.selectOption(keep).catch(() => {});
    await sel.evaluate((e) => { try { if (window.jQuery) window.jQuery(e).selectpicker && window.jQuery(e).selectpicker('refresh'); } catch (x) { /* plain select */ } }).catch(() => {});
    await page.waitForTimeout(800);
    await dismiss();
    done.push(id);
  }
  return done;
}

// deps: { safeNextClick, fillBlanks(tag) -> number filled, dismiss(), log(msg) }
// A field name can itself contain quotes (DE 10/30: 'Missing required field "Personal Injury Protection For "Bodily Injury""'):
// take everything up to the closing quote that is followed by the next error / Edit / Close / end of the box.
async function repairVehicleErrors(page, deps, maxFixes = 4) {
  const { safeNextClick, fillBlanks, dismiss, log } = deps;
  const summaryNext = page.locator('#btnNext_CLAutoVehicles');
  const saveVehicle = page.getByRole('button', { name: 'Save Vehicle ' });
  const onDetails = () => page.getByRole('button', { name: /Return to Summary/i }).first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  for (let fix = 1; fix <= maxFixes; fix++) {
    // A vehicle that could not be saved (MI Auto Dealers 10/29: "An error has occurred" on every Next of the Special Type
    // coverages) leaves the vehicle form open: close dialogs and go back to the summary first.
    if (!await summaryNext.isVisible().catch(() => false)) {
      for (let i = 0; i < 4; i++) {
        const top = page.locator('.modal.show').last();
        if (!await top.isVisible().catch(() => false)) break;
        await top.locator('button:has-text("Close"), button:has-text("Cancel"), button:has-text("OK")').first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
      }
      const back = page.getByRole('button', { name: /Return to Summary/i }).first();
      if (await back.isVisible().catch(() => false)) { log('Vehicles repair: back to the summary with Return to Summary'); await back.click({ timeout: 5000 }).catch(() => {}); }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await dismiss();
      if (!await summaryNext.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
        log('Vehicles repair: summary not shown - opening the Vehicles tab');
        await page.locator('a:visible, li:visible').filter({ hasText: /^\s*Vehicles\s*$/ }).first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await dismiss();
      }
    }
    await summaryNext.waitFor({ state: 'visible', timeout: 30000 });
    await dismiss();
    await summaryNext.click({ timeout: 10000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const errBox = page.locator('.modal.show').filter({ hasText: /Errors/ }).first();
    if (!await errBox.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) return true; // Next accepted
    const text = (await errBox.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const veh = Number((/(?:^|\s)(\d+):\s*\(/.exec(text) || [])[1] || 0);
    const field = (/Missing required field "(.*?)"(?=\s*(?:Edit\b|Close\b|Location \d|\d+:|[A-Z][A-Za-z ]*:|$))/.exec(text) || [])[1] || '';
    log(`Vehicles Next refused (fix ${fix}): ${text.slice(0, 260)}`);
    if (fix === maxFixes) break;

    // 1. open the vehicle: the error's Edit link (slow), else the summary row's Edit button
    await errBox.getByText('Edit', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    let opened = await onDetails();
    if (!opened) {
      await errBox.getByRole('button', { name: /Close/ }).first().click({ timeout: 3000 }).catch(() => {});
      const row = page.locator('#tblVehicles tbody tr, table tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${veh || 1}\\s*$`) }) }).first();
      await row.locator('button[data-action="Edit"]').first().click({ timeout: 5000 }).catch(() => {});
      opened = await onDetails();
    }
    log(`Vehicles repair: vehicle ${veh} opened = ${opened}`);
    if (!opened) continue;
    await dismiss();

    // 2. Details -> Coverages (Next), fill blanks until a re-render shows none
    await safeNextClick();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
    // The named field can LOOK filled while WriteBiz has it blank (seen live: PA Business Auto, Private Passenger
    // "Deductible Type"): re-send its value - another option, then back - so the server receives it.
    if (field) log(`Vehicles repair: re-sent "${field}" -> ${JSON.stringify(await repostField(page, field, dismiss))}`);
    for (let round = 1; round <= 3; round++) {
      await page.waitForTimeout(1500);
      const n = await fillBlanks(`vehicle ${veh} repair (round ${round})`);
      if (!n) break;
      // re-render the Coverages sub-tab from the server to prove the values stuck
      await page.getByRole('link', { name: 'Coverages', exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await dismiss();
    }

    // 3. Coverages -> Additional Coverages (Next) -> Save Vehicle
    for (let k = 0; k < 3 && !await saveVehicle.isVisible().catch(() => false); k++) {
      await safeNextClick();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await dismiss();
      await fillBlanks(`vehicle ${veh} repair (before save)`);
    }
    await saveVehicle.click({ timeout: 10000 }).catch((e) => log(`Vehicles repair: Save Vehicle failed: ${e.message.split('\n')[0]}`));
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
  }
  return false;
}

// Same "Errors" box on a page with Details / Coverages / Additional Coverages sub-tabs (State Specific Info, Auto Dealers),
// e.g. CO 10/29: 'Colorado: Uninsured Motorists Property Damage Coverage - Missing required field "Uninsured Motorists
// Property Damage Limit"' after Additional Coverages -> Next. The field is a card on the Coverages sub-tab (no grid row, no
// Edit link). Repair = close the box -> Coverages sub-tab -> fill blanks + re-send the named fields -> Next -> Next.
// Returns true once Next is accepted (no Errors box).
async function repairCoverageErrors(page, deps, maxFixes = 3) {
  const { safeNextClick, fillBlanks, dismiss, log } = deps;
  const errBox = () => page.locator('.modal.show').filter({ hasText: /Missing required field/ }).first();
  for (let fix = 1; fix <= maxFixes + 1; fix++) {
    const box = errBox();
    if (!await box.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) return true;
    const text = (await box.innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`Next refused (coverage fix ${fix}): ${text.slice(0, 300)}`);
    if (fix > maxFixes) break;
    const fields = [...new Set([...text.matchAll(/Missing required field "(.*?)"(?=\s*(?:Edit\b|Close\b|Location \d|\d+:|[A-Z][A-Za-z ]*:|$))/g)].map((m) => m[1]))];
    await box.locator('#ActivityImpediments_dialog_btn_0, button:has-text("Close")').first().click({ timeout: 5000 }).catch(() => {});
    await box.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.getByRole('link', { name: 'Coverages', exact: true }).first().click({ timeout: 8000 }).catch((e) => log(`coverage fix: Coverages sub-tab not clickable: ${e.message.split(String.fromCharCode(10))[0]}`));
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
    await page.waitForTimeout(1500);
    await fillBlanks(`coverage fix ${fix}`);
    for (const f of fields) log(`coverage fix: re-sent "${f}" -> ${JSON.stringify(await repostField(page, f, dismiss))}`);
    await fillBlanks(`coverage fix ${fix} (after re-send)`);
    await safeNextClick(); // Coverages -> Additional Coverages (may itself raise the box: the loop handles it)
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
    if (await errBox().isVisible().catch(() => false)) continue;
    await safeNextClick(); // Additional Coverages -> next tab
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
  }
  return false;
}

// DE Auto Dealers 10/30: 'Location 1: MAIN ST, NEWARK, DE 19702: Auto Dealers Personal Injury Protection Endorsement PIP Coverage -
// Missing required field "Personal Injury Protection For "Bodily Injury""' after "Save Auto Dealers". That coverage is a ROW of
// the Additional Coverages grid (selected by default) - its required fields are inside the row's edit dialog, not on a
// Coverages card. Repair = close the box -> Additional Coverages sub-tab -> edit that row -> fill the dialog's blank
// dropdowns -> Save the dialog -> save the tab again (deps.saveTab). Returns true once no Errors box comes back.
async function repairGridCoverageErrors(page, deps, maxFixes = 3) {
  const { saveTab, dismiss, log } = deps;
  const errBox = () => page.locator('.modal.show').filter({ hasText: /Missing required field/ }).first();
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (let fix = 1; fix <= maxFixes + 1; fix++) {
    const box = errBox();
    if (!await box.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) return true;
    const text = (await box.innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`Save refused (grid coverage fix ${fix}): ${text.slice(0, 300)}`);
    if (fix > maxFixes) break;
    const covs = [...new Set([...text.matchAll(/:\s*([^:]+?)\s+-\s+Missing required field "/g)].map((m) => m[1].replace(/\s+Coverage$/i, '').trim()))];
    await box.locator('#ActivityImpediments_dialog_btn_0, button:has-text("Close")').first().click({ timeout: 5000 }).catch(() => {});
    await box.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    // the sub-tab link is <a class="nav-link" value="Static|...AdditionalCoverages.aspx">Additional Coverages</a>
    const subTab = page.locator('a.nav-link[value*="AdditionalCoverages"]:visible').or(page.locator('a.nav-link:visible').filter({ hasText: /^\s*Additional Coverages\s*$/ })).first();
    // After "Save Auto Dealers" WriteBiz shows the list of dealer LOCATIONS (DE 10/30: one row "Franchised Private Passenger
    // Auto Dealer") and the Details / Coverages / Additional Coverages sub-tabs only exist once a location is opened: open it.
    if (!await subTab.isVisible().catch(() => false)) {
      const locRow = page.locator('table tbody tr:visible').first();
      const edit = locRow.locator('button[data-action="Edit"], [title*="Edit" i], i.fa-edit, i.fa-pen-to-square').first();
      if (await edit.isVisible().catch(() => false)) {
        log(`grid coverage fix: opening dealer location "${((await locRow.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 80)}"`);
        await edit.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await dismiss();
        await subTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      } else log(`grid coverage fix: no edit control on the dealer location row: ${((await locRow.innerHTML().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    await subTab.click({ timeout: 8000 }).catch((e) => log(`grid coverage fix: Additional Coverages sub-tab not clickable: ${e.message.split(String.fromCharCode(10))[0]}`));
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
    await page.waitForTimeout(2000);
    const findRow = (want) => page.evaluate((w) => {
      const n = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return [...document.querySelectorAll('table tbody tr')].findIndex((tr) => { const td = tr.querySelectorAll('td'); return td.length > 3 && tr.offsetParent && n(td[2].textContent).replace(/ coverage$/, '') === n(w); });
    }, want).catch(() => -1);
    for (const cov of covs) {
      let idx = await findRow(cov);
      // the grid pages 10 rows at a time (DataTables): look through the next pages too
      for (let pg = 0; idx < 0 && pg < 6; pg++) {
        const next = page.locator('.paginate_button.next:not(.disabled):visible, a.page-link:visible:has-text("Next")').first();
        if (!await next.isVisible().catch(() => false)) break;
        await next.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(700);
        idx = await findRow(cov);
      }
      if (idx < 0) {
        const seen = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter((tr) => tr.offsetParent).map((tr) => (tr.querySelectorAll('td')[2] || {}).textContent || '').map((t) => t.trim()).filter(Boolean).slice(0, 12)).catch(() => []);
        log(`grid coverage fix: no grid row for "${cov}" on ${page.url()}; rows seen: ${JSON.stringify(seen)}`);
        continue;
      }
      const row = page.locator('table tbody tr').nth(idx);
      await row.locator('button[data-action="Edit"], [title*="Edit" i], i.fa-edit, i.fa-pen-to-square').first().click({ timeout: 5000 }).catch(() => {});
      const dlg = page.locator('.modal.show').last();
      if (!await dlg.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { log(`grid coverage fix: "${cov}" dialog did not open`); continue; }
      await page.waitForTimeout(800);
      const filled = [];
      for (let round = 0; round < 3; round++) { // each pick can reload the next dropdown
        const ids = await dlg.evaluate((m) => [...m.querySelectorAll('select')].filter((s) => !s.disabled && !(s.options[s.selectedIndex] && s.options[s.selectedIndex].value) && [...s.options].some((o) => o.value)).map((s) => s.id).filter(Boolean)).catch(() => []);
        if (!ids.length) break;
        for (const id of ids) {
          const sel = page.locator(`[id="${id}"]`);
          const v = await sel.evaluate((e) => ([...e.options].find((o) => o.value && !/no coverage|not applicable/i.test(o.textContent)) || [...e.options].find((o) => o.value) || {}).value).catch(() => null);
          if (!v) continue;
          await sel.selectOption(v).catch(() => {});
          await sel.evaluate((e) => { try { if (window.jQuery && window.jQuery(e).selectpicker) window.jQuery(e).selectpicker('refresh'); } catch (x) { /* plain */ } }).catch(() => {});
          filled.push(`${await sel.getAttribute('data-requiredmessage').catch(() => id) || id}=${await sel.evaluate((e) => e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '').catch(() => '?')}`);
          await page.waitForTimeout(900);
          await dismiss();
        }
      }
      log(`grid coverage fix: "${cov}" filled ${JSON.stringify(filled)}`);
      await dlg.locator('button:has-text("Save")').first().click({ timeout: 5000 }).catch(() => {});
      await dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await dismiss();
    }
    await saveTab();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
  }
  return false;
}

module.exports = { repairVehicleErrors, repostField, repairCoverageErrors, repairGridCoverageErrors };
