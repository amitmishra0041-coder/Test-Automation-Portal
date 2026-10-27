// Word (.docx) test-result document for one CA Refresh run (same idea as the OneInc case reviews):
// header, milestones, coverage validation table, and the coverage-page screenshots, in one attachable file.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun, ShadingType, BorderStyle, HeadingLevel,
} = require('docx');

const COLORS = { PASS: '17692E', FAIL: '9B1C1C', FOUND: '17692E', MISSING: '9B1C1C', MISMATCH: '9B1C1C', MATCH: '17692E', NOT_OBSERVED: '667085', PARTIAL: '8A5A00', ADDED: '17692E', ALREADY_SELECTED: '17692E', ADD_FAILED: '9B1C1C', SKIPPED_RULE: '667085', NO_ADD_BUTTON: '9B1C1C', NO_MODEL_DATA: '667085', UNEXPECTED: '8A5A00', PC_ONLY: '3B5BA5', NOT_TESTED: '667085', REMOVED_STILL_PRESENT: '8A5A00', NOT_APPLICABLE: '667085' };
const FILLS = { PASS: 'E3F6E8', FAIL: 'FDE8E8', FOUND: 'E3F6E8', MATCH: 'E3F6E8', PARTIAL: 'FFF3D6', ADDED: 'E3F6E8', ALREADY_SELECTED: 'E3F6E8', ADD_FAILED: 'FDE8E8', NO_ADD_BUTTON: 'FDE8E8', MISMATCH: 'FDE8E8', MISSING: 'FDE8E8', UNEXPECTED: 'FFF3D6', REMOVED_STILL_PRESENT: 'FFF3D6' };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'BFC6D0' };
const MAX_W = 620;
const MAX_H = 760;

const para = (text, opts = {}) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: String(text == null ? '' : text), ...opts })] });
const heading = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, children: [new TextRun({ text, bold: true })] });
const cell = (text, { w, fill, bold, color } = {}) => new TableCell({
  width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
  children: [new Paragraph({ children: [new TextRun({ text: String(text == null ? '' : text), bold, color })] })],
});
const table = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function image(file) {
  if (!file || !fs.existsSync(file)) return [];
  const data = fs.readFileSync(file);
  const sz = pngSize(data);
  if (!sz) return [];
  const k = Math.min(1, MAX_W / sz.w, MAX_H / sz.h);
  return [new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(sz.w * k), height: Math.round(sz.h * k) } })] })];
}

// run: { testCaseId, testCaseName, lobLabel, state, env, quoteNumber, policyNumber, status, error, milestones[], validation, shots[{label,file}] }
async function writeCaRefreshDoc(run, outFile) {
  const v = run.validation || { results: [], summary: {} };
  const s = v.summary || {};
  const kids = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `CA Refresh - ${run.lobLabel} - ${run.state}`, bold: true })] }),
    table([
      ['Test case', `${run.testCaseId} - ${run.testCaseName}`],
      ['Environment', run.env], ['State', run.state], ['Line of business', run.lobLabel],
      ['Quote #', run.quoteNumber], ['Policy #', run.policyNumber],
      ['Executed', run.executedAt],
      ['Result', run.status],
      ['Coverage validation', `${s.found || 0} found, ${s.missing || 0} missing, ${s.pcOnly || 0} PolicyCenter-only (not shown to agents in WriteBiz), ${s.notTested || 0} not tested (needs a Special Type / Public Transportation vehicle), ${s.unexpected || 0} unexpected, ${s.removedStillPresent || 0} removed-but-present (info), ${s.notApplicable || 0} not applicable in ${run.state}`],
    ].map(([k, val]) => new TableRow({ children: [cell(k, { w: 22, bold: true, fill: 'F4F6F8' }), k === 'Result' ? cell(val, { w: 78, bold: true, color: COLORS[val], fill: FILLS[val] }) : cell(val, { w: 78 })] }))),
    para('Scope: policy issued through the standard CA workflow; coverages validated from the test-case precondition and product model. Rewrite, cancel, policy change, renewal, website and ImageRight are not covered.', { italics: true, color: '667085' }),
  ];
  if (run.error) kids.push(heading('Error'), para(run.error, { color: COLORS.FAIL }));

  kids.push(heading('Workflow steps'));
  kids.push(table([new TableRow({ tableHeader: true, children: ['Step', 'Status', 'Duration'].map((h, i) => cell(h, { w: [60, 15, 25][i], bold: true, fill: 'E7EBF0' })) })]
    .concat((run.milestones || []).map((m) => new TableRow({ children: [cell(m.name, { w: 60 }), cell(m.status, { w: 15, bold: true, color: COLORS[m.status === 'PASSED' ? 'PASS' : 'FAIL'] }), cell(m.duration || '', { w: 25 })] })))));

  kids.push(heading('Coverage validation'));
  const rows = v.results.filter((r) => r.status !== 'NOT_APPLICABLE').concat(v.results.filter((r) => r.status === 'NOT_APPLICABLE'));
  kids.push(table([new TableRow({ tableHeader: true, children: ['Category', 'Coverage', 'Code / form', 'Avail.', 'Result', 'Seen on'].map((h, i) => cell(h, { w: [16, 34, 18, 6, 12, 14][i], bold: true, fill: 'E7EBF0' })) })]
    .concat(rows.map((r) => new TableRow({ children: [
      cell(r.category, { w: 16 }), cell(r.name, { w: 34 }), cell([r.code, r.form].filter(Boolean).join(' / '), { w: 18 }), cell(r.availability, { w: 6 }),
      cell(r.status, { w: 12, bold: true, color: COLORS[r.status], fill: FILLS[r.status] }), cell(r.page, { w: 14 })] })))));

  const ad = v.additions || [];
  kids.push(heading('Additional coverages added'));
  kids.push(para(`${s.additionsAdded || 0} added / already selected, ${s.additionsFailed || 0} could not be added. Each was added with the "+" button, its dialog terms were recorded and filled where required, and the grid row was checked for the selected mark.`, { italics: true, color: '667085' }));
  if (ad.length) {
    kids.push(table([new TableRow({ tableHeader: true, children: ['Precondition coverage', 'WriteBiz row', 'Page', 'Result', 'Detail'].map((h, i) => cell(h, { w: [28, 24, 20, 10, 18][i], bold: true, fill: 'E7EBF0' })) })]
      .concat(ad.map((x) => new TableRow({ children: [cell(x.coverage, { w: 28 }), cell(x.gridRow, { w: 24 }), cell(x.page, { w: 20 }), cell(x.status, { w: 10, bold: true, color: COLORS[x.status], fill: FILLS[x.status] }), cell(x.detail, { w: 18 })] })))));
  }

  const tc = v.termChecks || [];
  kids.push(heading('Coverage term and option validation'));
  kids.push(para(`${s.termsChecked || 0} term(s) compared with the product model for ${run.state} (options taken from the WriteBiz dropdowns and Add-coverage dialogs); ${s.termMismatches || 0} mismatch(es) (WriteBiz offers an option the model does not list), ${s.termsPartial || 0} partial (model options not shown - usually a dropdown filtered by another selection), ${s.termsNoModelData || 0} with no model options for this state.`, { italics: true, color: '667085' }));
  if (tc.length) {
    kids.push(table([new TableRow({ tableHeader: true, children: ['Coverage', 'Term', 'Product model options', 'WriteBiz options', 'Missing / extra', 'Result'].map((h, i) => cell(h, { w: [18, 16, 20, 20, 16, 10][i], bold: true, fill: 'E7EBF0' })) })]
      .concat(tc.map((t) => new TableRow({ children: [
        cell(t.coverage + (t.context ? ' [' + t.context + ']' : ''), { w: 18 }), cell(t.term, { w: 16 }), cell(t.expected.join(', '), { w: 20 }), cell(t.observed.join(', '), { w: 20 }),
        cell([t.note || '', t.missing.length ? `missing: ${t.missing.join(', ')}` : '', t.extra.length ? `extra: ${t.extra.join(', ')}` : ''].filter(Boolean).join(' | '), { w: 16 }),
        cell(t.status, { w: 10, bold: true, color: COLORS[t.status], fill: FILLS[t.status] })] })))));
  }

  const shots = (run.shots || []).filter((x) => x.file && fs.existsSync(x.file));
  if (shots.length) kids.push(heading('Screenshots'));
  for (const sh of shots) kids.push(para(sh.label, { bold: true }), ...image(sh.file));

  const doc = new Document({ sections: [{ children: kids }] });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  return outFile;
}

module.exports = { writeCaRefreshDoc };
