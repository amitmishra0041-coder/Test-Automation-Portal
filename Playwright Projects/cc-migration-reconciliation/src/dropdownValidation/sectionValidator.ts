import { Page } from '@playwright/test';
import { navigateSteps } from '../pages/shared/genericPageFactories';
import { readDropdownFields } from './editModeReader';
import { clickUpdateAndCapture } from './updateAction';
import { EditRegionResult, DropdownComparison } from '../models/DropdownValidation';
import { logger } from '../logging/logger';

/** Backs out of an open edit form without saving — used only when a duplicate region is skipped, so it doesn't stay open and interfere with reading the next region. */
async function clickCancelIfOpen(page: Page, environment: 'onprem' | 'cloud'): Promise<void> {
  const cancelBtn = environment === 'cloud'
    ? page.getByRole('button', { name: 'Cancel', exact: true })
    : page.locator('a.x-btn:visible').filter({ hasText: 'Cancel' });
  await cancelBtn.first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Opens every independent "Edit" region on one section (a page can have
 * more than one — confirmed live on Loss Details), and for each: reads its
 * dropdown/enum fields, then clicks Update (always, per explicit
 * instruction — there is no dry-run mode). The Edit-button locator is
 * queried ONCE and indexed with `.nth(i)`, not re-queried per iteration —
 * clicking Update re-renders the page, and re-querying "the first Edit
 * button" after that would just click the SAME already-processed region
 * again rather than advancing to the next one, since independent regions
 * don't reorder relative to each other.
 */
export async function validateSection(
  page: Page,
  environment: 'onprem' | 'cloud',
  claimNumber: string,
  sectionKey: string,
  navPath: string[],
): Promise<EditRegionResult[]> {
  const navigated = await navigateSteps(page, `dropdownValidation.${sectionKey}`, navPath);
  if (!navigated) return [];
  await page.waitForTimeout(500);

  // `:visible` is required on-prem — confirmed live 2026-08-21 that ExtJS
  // renders a second, hidden duplicate "Edit" button (id suffix "__dup_1")
  // alongside the real one (likely a responsive/alternate-layout artifact),
  // and a plain `.count()` on an unfiltered locator matches BOTH, opening
  // and re-saving the exact same fields twice.
  const editButtonLocator = environment === 'cloud'
    ? page.getByRole('button', { name: 'Edit', exact: true })
    : page.locator('a.x-btn:visible').filter({ hasText: 'Edit' });
  const count = Math.min(await editButtonLocator.count().catch(() => 0), 10); // safety cap, not an expected real limit
  const results: EditRegionResult[] = [];
  const seenFieldSets = new Set<string>();

  for (let i = 0; i < count; i++) {
    const opened = await editButtonLocator.nth(i).click({ timeout: 8000 }).then(() => true).catch(() => false);
    if (!opened) continue;
    await page.waitForTimeout(800);

    const fields = await readDropdownFields(page, environment);
    // On-prem confirmed live 2026-08-21 to sometimes render a second,
    // `:visible`-but-genuinely-duplicate "Edit" button for the exact same
    // field set (not a CSS-hidden artifact — `:visible` filtering alone
    // didn't stop it). Comparing the read fields catches it regardless of
    // why it's duplicated: skip clicking Update a second time on content
    // already saved this pass, rather than writing the same unchanged data
    // twice for no reason.
    const fieldsKey = JSON.stringify(fields);
    if (seenFieldSets.has(fieldsKey)) {
      logger.info('dropdown validation: skipping duplicate edit region (identical fields already saved)', {
        environment, claimNumber, section: sectionKey, editButtonIndex: i,
      });
      await clickCancelIfOpen(page, environment);
      continue;
    }
    seenFieldSets.add(fieldsKey);

    const update = await clickUpdateAndCapture(page, environment);
    logger.info('dropdown validation: edit region processed', {
      environment, claimNumber, section: sectionKey, editButtonIndex: i,
      fieldCount: fields.length, updateSucceeded: update.succeeded,
    });

    results.push({ environment, claimNumber, editButtonIndex: i, fields, update });
    await page.waitForTimeout(500);
  }

  return results;
}

/** Compares dropdown option lists between the on-prem/cloud region found at the same index — order-independent set comparison, since rendering order isn't itself meaningful. */
export function compareDropdownRegions(onpremRegions: EditRegionResult[], cloudRegions: EditRegionResult[]): DropdownComparison[] {
  const byLabel = new Map<string, { onprem?: string[]; cloud?: string[] }>();
  for (const region of onpremRegions) {
    for (const f of region.fields) {
      const entry = byLabel.get(f.fieldLabel) ?? {};
      entry.onprem = f.options;
      byLabel.set(f.fieldLabel, entry);
    }
  }
  for (const region of cloudRegions) {
    for (const f of region.fields) {
      const entry = byLabel.get(f.fieldLabel) ?? {};
      entry.cloud = f.options;
      byLabel.set(f.fieldLabel, entry);
    }
  }

  const out: DropdownComparison[] = [];
  for (const [fieldLabel, { onprem, cloud }] of byLabel) {
    const onpremSet = new Set(onprem ?? []);
    const cloudSet = new Set(cloud ?? []);
    const onlyOnPrem = [...onpremSet].filter((o) => !cloudSet.has(o));
    const onlyCloud = [...cloudSet].filter((o) => !onpremSet.has(o));
    out.push({
      fieldLabel,
      onpremOptions: onprem ?? null,
      cloudOptions: cloud ?? null,
      match: onprem !== undefined && cloud !== undefined && onlyOnPrem.length === 0 && onlyCloud.length === 0,
      onlyOnPrem,
      onlyCloud,
    });
  }
  return out.sort((a, b) => a.fieldLabel.localeCompare(b.fieldLabel));
}
