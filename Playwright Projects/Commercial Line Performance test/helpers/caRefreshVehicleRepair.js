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
    }
    await summaryNext.waitFor({ state: 'visible', timeout: 30000 });
    await dismiss();
    await summaryNext.click({ timeout: 10000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const errBox = page.locator('.modal.show').filter({ hasText: /Errors/ }).first();
    if (!await errBox.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) return true; // Next accepted
    const text = (await errBox.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const veh = Number((/(?:^|\s)(\d+):\s*\(/.exec(text) || [])[1] || 0);
    const field = (/Missing required field "([^"]+)"/.exec(text) || [])[1] || '';
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
    const fields = [...new Set([...text.matchAll(/Missing required field "([^"]+)"/g)].map((m) => m[1]))];
    await box.locator('#ActivityImpediments_dialog_btn_0, button:has-text("Close")').first().click({ timeout: 5000 }).catch(() => {});
    await box.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.getByRole('link', { name: 'Coverages', exact: true }).first().click({ timeout: 8000 }).catch((e) => log(`coverage fix: Coverages sub-tab not clickable: ${e.message.split('\n')[0]}`));
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

module.exports = { repairVehicleErrors, repostField, repairCoverageErrors };
