import * as fs from 'fs';
import * as path from 'path';
import { ReconciliationReport, ClaimResult } from '../ReportAggregator';
import { Finding } from '../../comparison/types';
import { getNavPathForSection, REAL_NAV_ORDER } from '../../../config/navigation/navigationCatalog';

function esc(v: unknown): string {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CLASS_COLOR: Record<string, string> = {
  MATCH: '#1c7c4d', EXPECTED_DIFFERENCE: '#2159b0', UNEXPECTED_DIFFERENCE: '#b3372c', MISMATCH: '#b3372c',
  MISSING_IN_CLOUD: '#7a4bb0', MISSING_ON_PREM: '#7a4bb0', NEW_IN_CLOUD: '#a8660a', EXTRA_ON_PREM: '#a8660a',
  EXTRA_TRANSACTION: '#a8660a', UNABLE_TO_COMPARE: '#6b7385', EXTRACTION_ERROR: '#6b7385',
};

const REAL_FINDING_CLASSIFICATIONS = new Set([
  'UNEXPECTED_DIFFERENCE', 'MISMATCH', 'MISSING_IN_CLOUD', 'MISSING_ON_PREM', 'NEW_IN_CLOUD', 'EXTRA_ON_PREM', 'EXTRA_TRANSACTION',
]);

/** Plain (unescaped) claimNumber for a real migrated pair; "onprem / cloud" when the claim was compared asymmetrically. */
function claimLabelPlain(c: ClaimResult): string {
  return c.cloudClaimNumber && c.cloudClaimNumber !== c.claimNumber
    ? `${c.claimNumber} / ${c.cloudClaimNumber}`
    : c.claimNumber;
}

function claimLabel(c: ClaimResult): string {
  return c.cloudClaimNumber && c.cloudClaimNumber !== c.claimNumber
    ? `${esc(c.claimNumber)} <small style="color:#7c8698">(on-prem)</small> / ${esc(c.cloudClaimNumber)} <small style="color:#7c8698">(cloud)</small>`
    : esc(c.claimNumber);
}

interface TaggedFinding { claim: string; finding: Finding }

/**
 * Section 19/20's HTML report body. Findings are grouped into a tree that
 * mirrors ClaimCenter's own left-nav structure (Loss Details > Associations
 * / Medical, Policy > Endorsements, Financials > Checks/Payments, …) rather
 * than one flat per-claim table — matches how a reviewer already navigates
 * the real app, and each section renders collapsed by default (`<details>`,
 * no JS) so a claim with hundreds of compared fields doesn't dump
 * everything on screen at once. See navigationCatalog.ts's `navPath`/
 * `getNavPathForSection` for how a Finding.section string maps onto this
 * tree, and `REAL_NAV_ORDER` for why sections are NOT sorted alphabetically.
 */
interface NavNode {
  label: string;
  items: TaggedFinding[]; // findings whose section maps exactly to this node (not descendants)
  children: Map<string, NavNode>;
}

function buildNavTree(items: TaggedFinding[]): NavNode {
  const root: NavNode = { label: '', items: [], children: new Map() };
  for (const item of items) {
    const navPath = getNavPathForSection(item.finding.section);
    let node = root;
    for (const seg of navPath) {
      let child = node.children.get(seg);
      if (!child) {
        child = { label: seg, items: [], children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.items.push(item);
  }
  return root;
}

function sortedChildren(node: NavNode): NavNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    const ai = REAL_NAV_ORDER.indexOf(a.label);
    const bi = REAL_NAV_ORDER.indexOf(b.label);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function collectAll(node: NavNode): TaggedFinding[] {
  let all = node.items.slice();
  for (const child of node.children.values()) all = all.concat(collectAll(child));
  return all;
}

function statBadge(items: TaggedFinding[]): string {
  if (!items.length) return '<span class="badge badge-na">—</span>';
  const real = items.filter((t) => REAL_FINDING_CLASSIFICATIONS.has(t.finding.classification));
  if (real.length > 0) return `<span class="badge badge-diff">${real.length} diff${real.length === 1 ? '' : 's'}</span>`;
  const unable = items.filter((t) => t.finding.classification === 'UNABLE_TO_COMPARE' || t.finding.classification === 'EXTRACTION_ERROR');
  if (unable.length === items.length) return '<span class="badge badge-na">no data</span>';
  return `<span class="badge badge-ok">${items.length} match${items.length === 1 ? '' : 'es'}</span>`;
}

function taggedRow(t: TaggedFinding, showClaimColumn: boolean): string {
  const f = t.finding;
  const color = CLASS_COLOR[f.classification] ?? '#000';
  return `<tr>${showClaimColumn ? `<td>${esc(t.claim)}</td>` : ''}<td><code>${esc(f.path)}</code></td>`
    + `<td>${esc(f.onprem)}</td><td>${esc(f.cloud)}</td>`
    + `<td style="color:${color};font-weight:600">${esc(f.classification)}</td><td>${esc(f.severity)}</td><td>${esc(f.note)}</td></tr>`;
}

function renderNode(node: NavNode, showClaimColumn: boolean): string {
  const children = sortedChildren(node);
  const allItems = collectAll(node);
  if (!allItems.length) return '';
  const badge = statBadge(allItems);
  const header = `<tr>${showClaimColumn ? '<th>Claim</th>' : ''}<th>Path</th><th>On-Prem</th><th>Cloud</th><th>Classification</th><th>Severity</th><th>Note</th></tr>`;

  let ownContent = '';
  if (node.items.length > 0) {
    const nonMatch = node.items.filter((t) => t.finding.classification !== 'MATCH');
    const nonMatchRows = nonMatch.map((t) => taggedRow(t, showClaimColumn)).join('');
    const allRows = node.items.map((t) => taggedRow(t, showClaimColumn)).join('');
    ownContent = (nonMatchRows
      ? `<table>${header}${nonMatchRows}</table>`
      : '<p class="muted">No differences in this section.</p>')
      + `<details class="all-fields"><summary>All ${node.items.length} compared fields — including matches</summary><table>${header}${allRows}</table></details>`;
  }

  const childrenHtml = children.map((c) => renderNode(c, showClaimColumn)).join('');
  return `<details class="nav-node"><summary><span class="nav-label">${esc(node.label)}</span> ${badge}</summary><div class="nav-node-body">${ownContent}${childrenHtml}</div></details>`;
}

function claimSection(c: ClaimResult): string {
  if (c.technicalFailure) {
    return `<h3>${claimLabel(c)}${c.claimType ? ` <small style="color:#7c8698">[${esc(c.claimType)}]</small>` : ''} <small style="color:#6b7385">TECHNICAL_FAILURE</small></h3><p>${esc(c.technicalFailure)}</p>`;
  }
  const items: TaggedFinding[] = c.findings.map((finding) => ({ claim: claimLabelPlain(c), finding }));
  const tree = buildNavTree(items);
  const topNodes = sortedChildren(tree);
  return `<h3>${claimLabel(c)}${c.claimType ? ` <small style="color:#7c8698">[${esc(c.claimType)}]</small>` : ''} <small>${esc(c.status)}</small></h3>`
    + '<h4>Findings by section — click to expand</h4>'
    + `<div class="nav-tree">${topNodes.map((n) => renderNode(n, false)).join('')}</div>`;
}

/** Every compared field across every claim in this run, in one nav-mirrored tree with a Claim column — lets a reviewer see cross-claim patterns (e.g. the same section failing on every claim) without opening each claim separately. */
function consolidatedSection(report: ReconciliationReport): string {
  const items: TaggedFinding[] = [];
  for (const c of report.claims) {
    if (c.technicalFailure) continue;
    for (const finding of c.findings) items.push({ claim: claimLabelPlain(c), finding });
  }
  if (!items.length) return '';
  const tree = buildNavTree(items);
  const topNodes = sortedChildren(tree);
  return '<h2>Consolidated differences — all claims</h2>'
    + `<p class="muted">Every compared field across all ${report.claims.length} claims in this run, grouped by ClaimCenter section. Collapsed by default.</p>`
    + `<div class="nav-tree">${topNodes.map((n) => renderNode(n, true)).join('')}</div>`;
}

/** Section 19/20's HTML report — executive summary, then claim-level table, then a cross-claim consolidated view, then per-claim detail. This is the PRIMARY deliverable (Section A), not Playwright's own HTML reporter. */
export function generateHtmlReport(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const s = report.executiveSummary;

  const claimTableRows = report.claims.map((c) =>
    `<tr><td>${claimLabel(c)}</td><td>${esc(c.claimType ?? '')}</td><td style="font-weight:600">${esc(c.status)}</td>`
    + `<td class="num">${c.counts.CRITICAL}</td><td class="num">${c.counts.HIGH}</td>`
    + `<td class="num">${c.counts.MEDIUM}</td><td class="num">${c.counts.LOW}</td></tr>`,
  ).join('');

  const html = `<!doctype html><meta charset="utf-8">
<title>ClaimCenter Migration Reconciliation — ${esc(report.tier)}</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:1200px;color:#161a22}
  table{border-collapse:collapse;width:100%;margin:0 0 1rem}
  td,th{border:1px solid #dbe1ea;padding:6px 10px;text-align:left;vertical-align:top;font-size:.85rem}
  th{background:#eef1f6}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  code{background:#eef1f6;padding:1px 4px;border-radius:3px;font-size:.85em}
  .summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:#dbe1ea;border:1px solid #dbe1ea;margin-bottom:2rem}
  .summary div{background:#fff;padding:.75rem 1rem}
  .summary .k{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#7c8698}
  .summary .v{font-size:1.4rem;font-weight:700}
  .muted{color:#7c8698;font-size:.85rem}
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
  details.all-fields summary{color:#6b7385;font-weight:400;font-size:.85rem}
</style>
<h1>ClaimCenter Migration Reconciliation</h1>
<p>Tier: <strong>${esc(report.tier)}</strong> · Generated: ${esc(report.generatedAt)}</p>
<div class="summary">
  <div><span class="k">Total Claims</span><span class="v">${s.totalClaims}</span></div>
  <div><span class="k">Passed</span><span class="v" style="color:#1c7c4d">${s.passed}</span></div>
  <div><span class="k">Passed w/ Expected Diff</span><span class="v" style="color:#2159b0">${s.passedWithExpectedDifferences}</span></div>
  <div><span class="k">Failed</span><span class="v" style="color:#b3372c">${s.failed}</span></div>
  <div><span class="k">Technical Failures</span><span class="v" style="color:#6b7385">${s.technicalFailures}</span></div>
  <div><span class="k">Critical Findings</span><span class="v" style="color:#b3372c">${s.criticalFindings}</span></div>
  <div><span class="k">High Findings</span><span class="v" style="color:#c15a13">${s.highFindings}</span></div>
</div>
<h2>Claim-level summary</h2>
<table><tr><th>Claim</th><th>LOB</th><th>Status</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th></tr>${claimTableRows}</table>
${consolidatedSection(report)}
<h2>Detailed findings by claim</h2>
${report.claims.map(claimSection).join('')}
`;

  const file = path.join(outDir, `reconciliation-${report.tier}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}
