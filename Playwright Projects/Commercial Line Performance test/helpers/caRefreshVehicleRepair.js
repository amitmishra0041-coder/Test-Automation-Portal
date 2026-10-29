// CA Refresh: Vehicles summary -> Next can be refused with an "Attention / Errors" box such as
//   3: (1FTEW1EP4KFA54321) 2019 FORD F150: Special Types Other Than Collision Coverage - Missing required field "Losses Covered" Edit
// Seen live (trace of PA Auto Dealers, 10/29): the Edit link runs $CLAutoVehicles.editVehicleByFixedId behind a "Loading..."
// bubble and lands (seconds later) on the vehicle's DETAILS sub-tab; the missing field is on the Coverages sub-tab and
// "Save Vehicle" only exists on Additional Coverages. Repair = Edit -> Next (Coverages) -> fill blanks, re-check after a
// re-render -> Next (Additional Coverages) -> Save Vehicle -> back on the summary -> Next again.
// Offline test: node scripts/mock/testVehicleRepairOffline.js

// deps: { safeNextClick, fillBlanks(tag) -> number filled, dismiss(), log(msg) }
async function repairVehicleErrors(page, deps, maxFixes = 4) {
  const { safeNextClick, fillBlanks, dismiss, log } = deps;
  const summaryNext = page.locator('#btnNext_CLAutoVehicles');
  const saveVehicle = page.getByRole('button', { name: 'Save Vehicle ' });
  const onDetails = () => page.getByRole('button', { name: /Return to Summary/i }).first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  for (let fix = 1; fix <= maxFixes; fix++) {
    await summaryNext.waitFor({ state: 'visible', timeout: 30000 });
    await dismiss();
    await summaryNext.click({ timeout: 10000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const errBox = page.locator('.modal.show').filter({ hasText: /Errors/ }).first();
    if (!await errBox.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) return true; // Next accepted
    const text = (await errBox.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const veh = Number((/(?:^|\s)(\d+):\s*\(/.exec(text) || [])[1] || 0);
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

module.exports = { repairVehicleErrors };
