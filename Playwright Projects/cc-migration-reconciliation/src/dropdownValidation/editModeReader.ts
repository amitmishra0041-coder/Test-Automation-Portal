import { Page, Locator } from '@playwright/test';
import { DropdownFieldOptions } from '../models/DropdownValidation';

/**
 * Finds every independent "Edit" button on the current page. CONFIRMED live
 * 2026-08-21: cloud exposes it via role="button" name="Edit" (standard
 * accessible button); on-prem's ExtJS toolbar button carries the literal
 * text "Edit" but no accessible role at all (same platform gap clickNavItem
 * already works around). A single page can have MORE than one independent
 * Edit region — confirmed live on Loss Details (two separate "Edit"
 * buttons, each opening a different subset of fields) — so this returns
 * every match, not just the first.
 */
export async function findEditButtons(page: Page, environment: 'onprem' | 'cloud'): Promise<Locator[]> {
  // `:visible` is required on-prem — confirmed live 2026-08-21 that ExtJS
  // renders a second, hidden duplicate "Edit" button (id suffix "__dup_1")
  // alongside the real one; an unfiltered locator matches both.
  const locator = environment === 'cloud'
    ? page.getByRole('button', { name: 'Edit', exact: true })
    : page.locator('a.x-btn:visible').filter({ hasText: 'Edit' });
  const count = await locator.count();
  const out: Locator[] = [];
  for (let i = 0; i < count; i++) out.push(locator.nth(i));
  return out;
}

/**
 * Reads every dropdown/enum-choice field currently visible in edit mode.
 * CONFIRMED live 2026-08-21:
 *   cloud: real typelist fields render as a native <select> (readable
 *          directly via .options — no click needed, so no risk of
 *          triggering an unwanted selection) or, for booleans, a
 *          role="radiogroup" of role="radio" children (aria-label each).
 *          Free-text/autocomplete fields (e.g. City) are ALSO
 *          role="combobox" but are NOT real dropdowns (Jutro overloads the
 *          role) — recognized and excluded by their widget's
 *          data-gw-getset="text" attribute rather than treated as a
 *          fixed-option field.
 *   on-prem: ExtJS renders no native <select> at all — every field is a
 *          role="combobox" input that must be CLICKED to reveal its
 *          options in a `.x-boundlist` popup (ported from the sister
 *          ClaimCenter-Automation repo's proven selectComboboxOnPrem
 *          helper), then closed with Escape WITHOUT picking anything, so
 *          the field's current value is never changed by reading it. The
 *          page-wide "QuickJump" search box also carries role="combobox"
 *          and must be excluded — it isn't a claim field.
 */
export async function readDropdownFieldsCloud(page: Page): Promise<DropdownFieldOptions[]> {
  return page.evaluate(() => {
    const out: { fieldLabel: string; options: string[] }[] = [];
    const labelFor = (el: Element): string | null => {
      const widget = el.closest('.gw-InputWidget, .gw-LabelWidget');
      if (!widget) return null;
      for (const child of Array.from(widget.children)) {
        if (child.classList.contains('gw-label')) return (child.textContent || '').replace(/\s+/g, ' ').trim();
      }
      return null;
    };

    for (const sel of Array.from(document.querySelectorAll('select'))) {
      if (!(sel as HTMLElement).offsetParent) continue;
      const label = labelFor(sel);
      if (!label) continue;
      const options = Array.from((sel as HTMLSelectElement).options).map((o) => (o.textContent || '').trim()).filter(Boolean);
      if (options.length) out.push({ fieldLabel: label, options });
    }

    for (const group of Array.from(document.querySelectorAll('[role="radiogroup"]'))) {
      if (!(group as HTMLElement).offsetParent) continue;
      const label = labelFor(group);
      if (!label) continue;
      const options = Array.from(group.querySelectorAll('[role="radio"]'))
        .map((r) => r.getAttribute('aria-label') || (r.textContent || '').trim())
        .filter(Boolean) as string[];
      if (options.length) out.push({ fieldLabel: label, options });
    }

    return out;
  }).catch(() => []);
}

/**
 * Boolean/small-enum fields (e.g. "Coverage in Question?") CONFIRMED live
 * 2026-08-21 to NOT use role="combobox" at all on-prem — they render as a
 * custom `.x-form-checkboxgroup`/`.g-radio-group` widget with no native
 * `<input type="radio">` and no ARIA role, just plain `<label>` elements
 * per option (distinct from the field's own `.x-form-item-label`). Read
 * directly, no click needed — unlike true comboboxes, these render all
 * their option labels in the DOM whether "open" or not.
 */
function readRadioGroupFieldsOnPrem(page: Page): Promise<DropdownFieldOptions[]> {
  return page.evaluate(() => {
    const out: { fieldLabel: string; options: string[] }[] = [];
    for (const group of Array.from(document.querySelectorAll('.x-form-checkboxgroup, .g-radio-group'))) {
      if (!(group as HTMLElement).offsetParent) continue;
      const fieldLabelEl = group.querySelector('.x-form-item-label .x-form-item-label-inner');
      const fieldLabel = fieldLabelEl ? (fieldLabelEl.textContent || '').replace(/\s+/g, ' ').trim() : null;
      if (!fieldLabel) continue;
      const options = Array.from(group.querySelectorAll('label'))
        .filter((l) => !l.classList.contains('x-form-item-label'))
        .map((l) => (l.textContent || '').trim())
        .filter(Boolean);
      if (options.length) out.push({ fieldLabel, options });
    }
    return out;
  }).catch(() => []);
}

export async function readDropdownFieldsOnPrem(page: Page): Promise<DropdownFieldOptions[]> {
  const radioGroupFields = await readRadioGroupFieldsOnPrem(page);
  const comboIds: string[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="combobox"]'))
      .filter((e) => (e as HTMLElement).offsetParent && e.id && !e.id.startsWith('QuickJump'))
      .map((e) => e.id);
  }).catch(() => []);

  const results: DropdownFieldOptions[] = [];
  for (const id of comboIds) {
    const label = await page.evaluate((inputId) => {
      const inputEl = document.querySelector(`[id="${inputId}"]`);
      if (!inputEl) return null;
      const field = inputEl.closest('.x-field') || inputEl.closest('.x-form-item');
      const labelInner = field?.querySelector('.x-form-item-label-inner');
      return labelInner ? (labelInner.textContent || '').replace(/\s+/g, ' ').trim() : null;
    }, id).catch(() => null);
    if (!label) continue;

    const locator = page.locator(`[id="${id}"]`);
    const opened = await locator.click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!opened) continue;
    await page.waitForTimeout(300);

    const options = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.x-boundlist')).filter((c) => (c as HTMLElement).offsetParent);
      const container = containers[containers.length - 1];
      if (!container) return [];
      return Array.from(container.querySelectorAll('.x-boundlist-item')).map((li) => (li.textContent || '').trim()).filter(Boolean);
    }).catch(() => []);

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);

    if (options.length) results.push({ fieldLabel: label, options });
  }
  return [...radioGroupFields, ...results];
}

export async function readDropdownFields(page: Page, environment: 'onprem' | 'cloud'): Promise<DropdownFieldOptions[]> {
  return environment === 'cloud' ? readDropdownFieldsCloud(page) : readDropdownFieldsOnPrem(page);
}
