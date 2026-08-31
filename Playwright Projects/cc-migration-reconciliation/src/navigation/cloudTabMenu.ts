import { Page } from '@playwright/test';

/**
 * CONFIRMED — cloud only. Ported from claimCenterBase.js: "Every top-nav
 * tab in the cloud UI shares one structure: #TabBar-<tabId> wraps a
 * [role="menuitem"] LABEL … plus a separate .gw-action--expand-button
 * sibling … that actually opens the dropdown/submenu." Discovered via a
 * live DOM dump while debugging FNOL's "New Claim" navigation. Centralized
 * here so every cloud page object can reuse it instead of rediscovering it.
 */
export async function openTabMenu(page: Page, tabId: string): Promise<boolean> {
  const expandBtn = page.locator(`#TabBar-${tabId} .gw-action--expand-button`).first();
  await expandBtn.waitFor({ state: 'attached', timeout: 10000 });
  await expandBtn.click({ force: true });

  const isOpen = () => page.waitForFunction(
    (id) => {
      const sub = document.querySelector(`#TabBar-${id} .gw-subMenu`);
      return sub && sub.getAttribute('aria-hidden') === 'false';
    },
    tabId,
    { timeout: 5000 },
  ).then(() => true).catch(() => false);

  let opened = await isOpen();
  if (!opened) {
    await expandBtn.click({ force: true });
    opened = await isOpen();
  }
  return opened;
}

export async function clickTabMenuItem(page: Page, tabId: string, itemId: string): Promise<void> {
  await openTabMenu(page, tabId);
  const item = page.locator(`#TabBar-${itemId} [role="menuitem"]`).first();
  await item.waitFor({ state: 'attached', timeout: 5000 });
  await item.click({ force: true });
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
}

export async function selectTab(page: Page, tabId: string): Promise<void> {
  const label = page.locator(`#TabBar-${tabId} [role="menuitem"]`).first();
  await label.waitFor({ state: 'attached', timeout: 10000 });
  await label.click({ force: true });
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
}
