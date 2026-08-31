import { ExtractionContext } from '../ExtractionContext';
import { ValidationState } from '../../models/ClaimData';

/**
 * CONFIRMED, both platforms — ported from readValidation in claimSnapshot.js
 * and the cloud silent-failure findings (project_cc_cloud_behaviors memory):
 * cloud's validation text lives in #gw-south-panel, not inline on the field
 * and not in a dialog. Only PRESENCE is meaningful for reconciliation
 * (Section 11) — wording differs freely between platforms.
 */
export async function extractValidationState(ctx: ExtractionContext): Promise<ValidationState> {
  const text = await ctx.page.evaluate(() => {
    const panel = document.getElementById('gw-south-panel');
    if (panel && (panel as HTMLElement).offsetParent) {
      return (panel.innerText || '')
        .replace(/\s+/g, ' ')
        .replace(/^\s*Validation Results\s*/i, '')
        .replace(/^\s*Clear\s*/i, '')
        .trim()
        .slice(0, 400);
    }
    const banner = Array.from(document.querySelectorAll('[class*="message"], [class*="error"]'))
      .filter((e) => (e as HTMLElement).offsetParent)
      .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      .find(Boolean);
    return banner ? banner.slice(0, 400) : '';
  }).catch(() => '');

  return { present: !!text, text: text || null };
}
