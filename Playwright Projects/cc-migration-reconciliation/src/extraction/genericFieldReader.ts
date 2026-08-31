import { Page } from '@playwright/test';
import { ExtractionContext } from './ExtractionContext';
import { FieldObservation, ok, notPresent } from './FieldObservation';

/**
 * Reads EVERY label/value pair on the current detail-view page dynamically —
 * no hardcoded per-LOB label list. This exists because the earlier approach
 * (readLabeledFieldsFromLines against a fixed LABELS array, see
 * labeledFieldReader.ts) requires someone to have already seen every field a
 * given LOB can show; any field on an untested LOB (Commercial Auto, BOP,
 * GL, Umbrella, …) was silently skipped rather than compared. This reads the
 * DOM structure itself instead of matching known label text, so it works on
 * any LOB/claim without prior knowledge of what fields it has.
 *
 * Confirmed live 2026-08-20 against Loss Details on both platforms:
 *   on-prem:  <div class="x-field x-form-item">
 *               <label class="x-form-item-label" for="X-inputEl">
 *                 <span class="x-form-item-label-inner">Label Text</span>
 *               </label>
 *               <div class="x-form-item-body">
 *                 <div id="X-inputEl" class="x-form-display-field">Value</div>
 *               </div>
 *             </div>
 *   cloud:    <div class="gw-InputWidget">
 *               <div class="gw-label">Label Text</div>
 *               <div class="gw-value">Value</div>  (may nest a .gw-RangeValue > .gw-label for selects/booleans)
 *             </div>
 * Section headers (cloud: role="heading" on the label div; on-prem: a bare
 * label with no `for` attribute — see LossDetailsDV:0 in the live capture)
 * are excluded, since they aren't a field.
 *
 * A label appearing more than once on one page (e.g. "Name" for both the
 * Insured and the Agent on the Policy page) is disambiguated the same way
 * the codebase already disambiguates repeated labels elsewhere (nth() in
 * labeledFieldReader.ts): by DOM order, suffixed " #2", " #3", etc.
 */
async function readRawOnPrem(page: Page): Promise<Array<{ label: string; value: string }>> {
  return page.evaluate(() => {
    const out: Array<{ label: string; value: string }> = [];
    for (const labelEl of Array.from(document.querySelectorAll('.x-form-item-label'))) {
      if (!(labelEl as HTMLElement).offsetParent) continue;
      const inner = labelEl.querySelector('.x-form-item-label-inner') ?? labelEl;
      const label = (inner.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) continue;
      const forId = labelEl.getAttribute('for');
      if (!forId) continue; // no associated value control — a section heading, not a field
      const valueEl = document.getElementById(forId);
      if (!valueEl) continue;
      // `.value` first (a real <input>/<textarea> control) — falling back to
      // `.textContent` here (as this did before) loses the space at a
      // wrapped-line boundary inside a plain display `<div>`, e.g. Loss
      // Details' "Location" reading "HEMPT ROADMECHANICSBURG, PA" instead of
      // "HEMPT ROAD MECHANICSBURG, PA" — confirmed live 2026-08-27, same
      // textContent-vs-innerText gap already fixed for grid cells elsewhere.
      const value = ((valueEl as HTMLInputElement).value ?? (valueEl as HTMLElement).innerText ?? '').toString().replace(/\s+/g, ' ').trim();
      out.push({ label, value });
    }
    return out;
  }).catch(() => []);
}

async function readRawCloud(page: Page): Promise<Array<{ label: string; value: string }>> {
  return page.evaluate(() => {
    const out: Array<{ label: string; value: string }> = [];
    for (const widget of Array.from(document.querySelectorAll('.gw-InputWidget, .gw-LabelWidget'))) {
      let labelEl: Element | null = null;
      let valueEl: Element | null = null;
      for (const child of Array.from(widget.children)) {
        if (!labelEl && child.classList.contains('gw-label')) labelEl = child;
        if (!valueEl && child.classList.contains('gw-value')) valueEl = child;
      }
      if (!labelEl || labelEl.getAttribute('role') === 'heading') continue; // section heading, not a field
      if (!(widget as HTMLElement).offsetParent) continue;
      const label = (labelEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) continue;
      const value = ((valueEl as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim();
      out.push({ label, value });
    }
    return out;
  }).catch(() => []);
}

/**
 * The small set of label-text differences we've actually confirmed live
 * between platforms for the SAME field — NOT an attempt to enumerate every
 * field (that's exactly the upfront-list problem this module replaces).
 * Grows only when a real cross-platform mismatch is observed; an unmapped
 * label just compares under its own text, matching automatically when both
 * platforms happen to use identical wording (the common case) and otherwise
 * surfacing as an honest EXTRA_ON_PREM/NEW_IN_CLOUD pair rather than being
 * silently dropped or silently mismatched.
 */
const CANONICAL_ALIASES: Record<string, string> = {
  'Policy Mod': 'Policy Mod / Policy Term',
  'Policy Term': 'Policy Mod / Policy Term',
  'Reported Date': 'Reported Date / Date Reported',
  'Date Reported': 'Reported Date / Date Reported',
  'Salvage Status': 'Salvage Status / Salvage Potential',
  'Salvage Potential': 'Salvage Status / Salvage Potential',
  'LossType': 'Loss Type',
};

function canonicalLabel(label: string): string {
  return CANONICAL_ALIASES[label] ?? label;
}

/** Disambiguates repeated labels by DOM order: "Name", "Name #2", "Name #3", … */
function dedupeKeys(pairs: Array<{ label: string; value: string }>): Array<{ key: string; label: string; value: string }> {
  const seen = new Map<string, number>();
  return pairs.map(({ label, value }) => {
    const canonical = canonicalLabel(label);
    const count = (seen.get(canonical) ?? 0) + 1;
    seen.set(canonical, count);
    const key = count === 1 ? canonical : `${canonical} #${count}`;
    return { key, label, value };
  });
}

/**
 * Reads every field on the CURRENT page into a flat FieldObservation map,
 * keyed by (deduplicated, alias-normalized) label text. `section` is the
 * human section name for reporting (e.g. "Loss Details"); `pathPrefix` is
 * the ClaimData-ish dotted path prefix findings should report under (e.g.
 * "claim.lossDetails.fields").
 */
export async function readDynamicFields(
  ctx: ExtractionContext,
  section: string,
  pathPrefix: string,
): Promise<Record<string, FieldObservation>> {
  const raw = ctx.environment === 'onprem' ? await readRawOnPrem(ctx.page) : await readRawCloud(ctx.page);
  const deduped = dedupeKeys(raw);

  const fields: Record<string, FieldObservation> = {};
  for (const { key, label, value } of deduped) {
    const path = `${pathPrefix}.${key}`;
    fields[key] = value
      ? ok({ path, field: label, value, rawText: value, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section })
      : notPresent({ path, field: label, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section }, `"${label}" renders blank on this claim`);
  }
  return fields;
}
