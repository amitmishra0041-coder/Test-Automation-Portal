// Opening the Auto Dealers tab and finding the premises location(s) it offers to add as a dealer location.
// The tab is an ajax tab (li#CLAutoDealers -> $XControls.Navigation.navigate): the click returns before its content is there, and the
// "Add New Location" list fills a moment later. The flow read that list straight after the click, so 9 Auto Dealers runs
// (AZ 11/04, NC 11/04 + 11/07 x2, CO 11/06, OH, UT, VA, WI 11/07) saw an empty list, skipped every dealer step and still logged
// "Location Added" - the dealer coverages were then reported MISSING and the WriteBiz Auto Dealers page read "No Locations found".

// The real location choices of the "Add New Location" list ("Add New Location" itself is the placeholder).
const dealerChoices = (page) => page.locator('#ddlAddNewDealer option')
  .evaluateAll((os) => os.filter((o) => o.value && !/add new/i.test(o.textContent)).map((o) => ({ value: o.value, text: o.textContent.trim() })))
  .catch(() => []);

// Opens the Auto Dealers tab (when not already on it) and waits until the list offers a location. Returns the choices ([] = none
// after `tries` tries, or the grid already lists a location - check dealerGridState). Clicks the tab by its own id; the last tries force the click past an overlay.
async function openAutoDealersTab(page, { dismiss = async () => {}, log = () => {}, tries = 4, waitMs = 30000 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    await dismiss();
    let choices = await dealerChoices(page);
    if (!(choices.length && /CLAutoDealers/i.test(page.url()))) {
      log(`Auto Dealers: opening the tab (try ${attempt}/${tries}, on ${page.url()})`);
      const tab = page.locator('li#CLAutoDealers a.nav-link').or(page.locator('a.nav-link:visible').filter({ hasText: /Auto Dealers/ })).first();
      await tab.click({ timeout: 10000, force: attempt >= 3 }).catch((e) => log(`Auto Dealers tab click: ${e.message.split('\n')[0]}`));
    }
    const deadline = Date.now() + waitMs;
    for (;;) {
      await dismiss();
      choices = await dealerChoices(page);
      if (choices.length || Date.now() > deadline) break;
      // the grid already lists a location (a resumed submission): the list is empty because that premises is used - nothing to wait for
      if (/CLAutoDealers/i.test(page.url()) && (await dealerGridState(page)).rows > 0) return choices;
      await page.waitForTimeout(1000);
    }
    if (choices.length) return choices;
    log(`Auto Dealers: no location offered after ${Math.round(waitMs / 1000)}s (try ${attempt}/${tries}, on ${page.url()})`);
  }
  return [];
}

// What the Auto Dealers location grid shows: rows (dealer locations) and whether it says "No Locations found".
const dealerGridState = (page) => page.evaluate(() => {
  const vis = (e) => !!(e.offsetParent || e.getClientRects().length);
  const trs = [...document.querySelectorAll('table tbody tr')].filter(vis);
  const empty = trs.some((tr) => /No Locations found/i.test(tr.textContent));
  return { empty, rows: trs.filter((tr) => !/No Locations found/i.test(tr.textContent) && tr.querySelectorAll('td').length > 2).length };
}).catch(() => ({ empty: false, rows: 0 }));

module.exports = { dealerChoices, openAutoDealersTab, dealerGridState };
