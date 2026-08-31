import * as fs from 'fs';
import * as path from 'path';
import { UpdateValidationReport, ClaimUpdateResult, SectionUpdateResult } from '../../models/DropdownValidation';

function esc(v: unknown): string {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function claimLabel(c: ClaimUpdateResult): string {
  return c.cloudClaimNumber && c.cloudClaimNumber !== c.claimNumber
    ? `${esc(c.claimNumber)} <small style="color:#7c8698">(on-prem)</small> / ${esc(c.cloudClaimNumber)} <small style="color:#7c8698">(cloud)</small>`
    : esc(c.claimNumber);
}

function dropdownTable(section: SectionUpdateResult): string {
  const rows = section.dropdownComparisons;
  if (!rows.length) return '<p class="muted">No dropdown/enum fields found in this section\'s edit mode.</p>';
  const body = rows.map((r) => {
    const color = r.match ? '#1c7c4d' : '#b3372c';
    return `<tr><td>${esc(r.fieldLabel)}</td>`
      + `<td>${r.onpremOptions ? esc(r.onpremOptions.join(', ')) : '<span class="muted">not found</span>'}</td>`
      + `<td>${r.cloudOptions ? esc(r.cloudOptions.join(', ')) : '<span class="muted">not found</span>'}</td>`
      + `<td style="color:${color};font-weight:600">${r.match ? 'MATCH' : 'MISMATCH'}</td>`
      + `<td>${r.onlyOnPrem.length ? 'only on-prem: ' + esc(r.onlyOnPrem.join(', ')) : ''}${r.onlyOnPrem.length && r.onlyCloud.length ? '<br>' : ''}${r.onlyCloud.length ? 'only cloud: ' + esc(r.onlyCloud.join(', ')) : ''}</td></tr>`;
  }).join('');
  return `<table><tr><th>Field</th><th>On-Prem Options</th><th>Cloud Options</th><th>Result</th><th>Difference</th></tr>${body}</table>`;
}

function updateResultsTable(section: SectionUpdateResult): string {
  const regions = [...section.onpremRegions, ...section.cloudRegions];
  if (!regions.length) return '<p class="muted">No "Edit" button found on this section on either platform.</p>';
  const rows = regions.map((r) => {
    const color = !r.update.attempted ? '#6b7385' : r.update.succeeded ? '#1c7c4d' : '#b3372c';
    const status = !r.update.attempted ? 'NOT ATTEMPTED' : r.update.succeeded ? 'SAVED OK' : 'SAVE FAILED';
    return `<tr><td>${esc(r.environment)}</td><td>${esc(r.claimNumber)}</td><td>${r.editButtonIndex}</td>`
      + `<td style="color:${color};font-weight:600">${status}</td><td>${esc(r.update.errorMessage ?? '')}</td></tr>`;
  }).join('');
  return `<table><tr><th>Platform</th><th>Claim</th><th>Edit Region #</th><th>Update Result</th><th>Error (if any)</th></tr>${rows}</table>`;
}

function sectionBlock(section: SectionUpdateResult): string {
  const mismatches = section.dropdownComparisons.filter((r) => !r.match).length;
  const saveFailures = [...section.onpremRegions, ...section.cloudRegions].filter((r) => r.update.attempted && !r.update.succeeded).length;
  const badge = saveFailures > 0
    ? `<span class="badge badge-diff">${saveFailures} save failure${saveFailures === 1 ? '' : 's'}</span>`
    : mismatches > 0
      ? `<span class="badge badge-diff">${mismatches} dropdown mismatch${mismatches === 1 ? '' : 'es'}</span>`
      : (section.onpremRegions.length + section.cloudRegions.length) > 0
        ? '<span class="badge badge-ok">OK</span>'
        : '<span class="badge badge-na">no edit region</span>';

  return `<details class="nav-node"><summary><span class="nav-label">${esc(section.sectionLabel)}</span> ${badge}</summary>`
    + `<div class="nav-node-body"><h4>Dropdown option comparison</h4>${dropdownTable(section)}`
    + `<h4>Update (save) results</h4>${updateResultsTable(section)}</div></details>`;
}

function claimSection(c: ClaimUpdateResult): string {
  if (c.technicalFailure) {
    return `<h3>${claimLabel(c)} <small style="color:#6b7385">TECHNICAL_FAILURE</small></h3><p>${esc(c.technicalFailure)}</p>`;
  }
  const totalMismatches = c.sections.reduce((sum, s) => sum + s.dropdownComparisons.filter((r) => !r.match).length, 0);
  const totalSaveFailures = c.sections.reduce((sum, s) => sum + [...s.onpremRegions, ...s.cloudRegions].filter((r) => r.update.attempted && !r.update.succeeded).length, 0);
  return `<h3>${claimLabel(c)}${c.claimType ? ` <small style="color:#7c8698">[${esc(c.claimType)}]</small>` : ''}`
    + ` <small>${totalSaveFailures} save failures, ${totalMismatches} dropdown mismatches</small></h3>`
    + `<div class="nav-tree">${c.sections.map(sectionBlock).join('')}</div>`;
}

export function generateUpdateValidationHtmlReport(report: UpdateValidationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });

  const allSections = report.claims.flatMap((c) => c.sections);
  const totalMismatches = allSections.reduce((sum, s) => sum + s.dropdownComparisons.filter((r) => !r.match).length, 0);
  const totalSaveFailures = allSections.reduce((sum, s) => sum + [...s.onpremRegions, ...s.cloudRegions].filter((r) => r.update.attempted && !r.update.succeeded).length, 0);
  const totalSaveAttempts = allSections.reduce((sum, s) => sum + [...s.onpremRegions, ...s.cloudRegions].filter((r) => r.update.attempted).length, 0);

  const html = `<!doctype html><meta charset="utf-8">
<title>ClaimCenter Data Update &amp; Dropdown Validation — ${esc(report.tier)}</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:1200px;color:#161a22}
  table{border-collapse:collapse;width:100%;margin:0 0 1rem}
  td,th{border:1px solid #dbe1ea;padding:6px 10px;text-align:left;vertical-align:top;font-size:.85rem}
  th{background:#eef1f6}
  .muted{color:#7c8698;font-size:.85rem}
  .summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:#dbe1ea;border:1px solid #dbe1ea;margin-bottom:2rem}
  .summary div{background:#fff;padding:.75rem 1rem}
  .summary .k{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#7c8698}
  .summary .v{font-size:1.4rem;font-weight:700}
  details{margin:0 0 .5rem}
  details summary{cursor:pointer;font-weight:600;padding:.4rem 0;color:#2159b0;list-style:revert}
  details[open]>summary{margin-bottom:.4rem}
  .nav-tree{border:1px solid #dbe1ea;border-radius:6px;padding:.75rem 1rem;margin-bottom:2rem;background:#fbfcfe}
  .nav-node{margin:0 0 .25rem}
  .nav-node .nav-node-body{margin-left:1.25rem;padding-left:.75rem;border-left:2px solid #e4e9f0}
  .nav-label{color:#161a22;font-weight:600}
  .badge{display:inline-block;font-size:.72rem;font-weight:600;padding:1px 8px;border-radius:10px;margin-left:.4rem}
  .badge-diff{background:#fbeae8;color:#b3372c}
  .badge-ok{background:#e8f4ee;color:#1c7c4d}
  .badge-na{background:#eef0f3;color:#6b7385}
</style>
<h1>ClaimCenter Data Update &amp; Dropdown Validation</h1>
<p>Tier: <strong>${esc(report.tier)}</strong> · Generated: ${esc(report.generatedAt)}</p>
<p class="muted">For each section: opens Edit, compares dropdown/enum option lists between platforms, then clicks Update to confirm the underlying claim data still saves cleanly — a save failure here is a real migration defect, not a tool error.</p>
<div class="summary">
  <div><span class="k">Claims</span><span class="v">${report.claims.length}</span></div>
  <div><span class="k">Save Attempts</span><span class="v">${totalSaveAttempts}</span></div>
  <div><span class="k">Save Failures</span><span class="v" style="color:#b3372c">${totalSaveFailures}</span></div>
  <div><span class="k">Dropdown Mismatches</span><span class="v" style="color:#b3372c">${totalMismatches}</span></div>
</div>
<h2>Results by claim</h2>
${report.claims.map(claimSection).join('')}
`;

  const file = path.join(outDir, `update-validation-${report.tier}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}
