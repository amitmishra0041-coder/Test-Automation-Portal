const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const nodemailer = require('nodemailer');

class PDFComparer {
  constructor() {
    this.differences = [];
    this.matches = [];
    this.tableResults = [];
    const envKeywords = (process.env.EXPECTED_TABLE_KEYWORDS || '').split(',').map(k => k.trim()).filter(Boolean);
    this.expectedTableKeywords = envKeywords.length ? envKeywords : [
      'State Coverage Summary',
      'Classification of Operations',
      'WC 00 03 13',
      'Waiver of Our Right to Recover from Others Endorsement'
    ];
    this.expectedTableChecks = [];
    this.headings = new Set();
    this.stats = {
      totalPages1: 0,
      totalPages2: 0,
      textMatches: 0,
      textMismatches: 0,
      tablesFound1: 0,
      tablesFound2: 0,
      tableMatches: 0,
      tableMismatches: 0
    };
  }

  async comparePDFs(pdf1Path, pdf2Path) {
    console.log(`\n📄 Comparing PDFs:`);
    console.log(`   PDF 1: ${path.basename(pdf1Path)}`);
    console.log(`   PDF 2: ${path.basename(pdf2Path)}`);

    // Read and parse both PDFs
    const pdf1Buffer = fs.readFileSync(pdf1Path);
    const pdf2Buffer = fs.readFileSync(pdf2Path);

  const pdf1Data = await pdfParse(pdf1Buffer);
  const pdf2Data = await pdfParse(pdf2Buffer);

    this.stats.totalPages1 = pdf1Data.numpages;
    this.stats.totalPages2 = pdf2Data.numpages;

    console.log(`   Pages: ${this.stats.totalPages1} vs ${this.stats.totalPages2}`);

    // Extract text and tables
    const pdf1Text = pdf1Data.text;
    const pdf2Text = pdf2Data.text;

    // Split by pages (using form feed or page breaks)
    const pdf1Pages = this._splitIntoPages(pdf1Text);
    const pdf2Pages = this._splitIntoPages(pdf2Text);

    // Compare page by page
    const maxPages = Math.max(pdf1Pages.length, pdf2Pages.length);
    for (let i = 0; i < maxPages; i++) {
      await this._comparePage(i + 1, pdf1Pages[i] || '', pdf2Pages[i] || '');
    }

    // Extract and compare tables
    await this._compareTables(pdf1Text, pdf2Text);

    return this._generateReport();
  }

  _splitIntoPages(text) {
    // Try common page delimiters
    let pages = text.split('\f'); // Form feed
    if (pages.length === 1) {
      // Fallback: split by large gaps or headers
      pages = text.split(/\n{3,}/);
    }
    return pages.filter(p => p.trim().length > 0);
  }

  async _comparePage(pageNum, page1Text, page2Text) {
    if (!page1Text && !page2Text) return;

    if (!page1Text) {
      this.differences.push({
        type: 'PAGE_MISSING',
        page: pageNum,
        location: 'PDF 1',
        description: `Page ${pageNum} exists only in PDF 2`,
        severity: 'HIGH'
      });
      this.stats.textMismatches++;
      return;
    }

    if (!page2Text) {
      this.differences.push({
        type: 'PAGE_MISSING',
        page: pageNum,
        location: 'PDF 2',
        description: `Page ${pageNum} exists only in PDF 1`,
        severity: 'HIGH'
      });
      this.stats.textMismatches++;
      return;
    }

    // Normalize whitespace for comparison
    const normalized1 = page1Text.replace(/\s+/g, ' ').trim();
    const normalized2 = page2Text.replace(/\s+/g, ' ').trim();

    if (normalized1 === normalized2) {
      this.matches.push({
        type: 'PAGE_MATCH',
        page: pageNum,
        description: `Page ${pageNum} matches exactly`
      });
      this.stats.textMatches++;
    } else {
      // Find specific differences
      const diff = this._findTextDifferences(page1Text, page2Text, pageNum);
      this.differences.push(...diff);
      this.stats.textMismatches++;
    }
  }

  _findTextDifferences(text1, text2, pageNum) {
    const diffs = [];
    const lines1 = text1.split('\n').filter(l => l.trim());
    const lines2 = text2.split('\n').filter(l => l.trim());

    // Compare line by line
    const maxLines = Math.max(lines1.length, lines2.length);
    let diffCount = 0;

    for (let i = 0; i < maxLines && diffCount < 10; i++) { // Limit to first 10 diffs per page
      const line1 = (lines1[i] || '').trim();
      const line2 = (lines2[i] || '').trim();

      if (line1 !== line2) {
        diffs.push({
          type: 'TEXT_MISMATCH',
          page: pageNum,
          line: i + 1,
          location: `Page ${pageNum}, Line ${i + 1}`,
          pdf1Value: line1.substring(0, 100) + (line1.length > 100 ? '...' : ''),
          pdf2Value: line2.substring(0, 100) + (line2.length > 100 ? '...' : ''),
          severity: 'MEDIUM'
        });
        diffCount++;
      }
    }

    if (diffCount === 10 && maxLines > 10) {
      diffs.push({
        type: 'TEXT_MISMATCH',
        page: pageNum,
        location: `Page ${pageNum}`,
        description: `... and ${maxLines - 10} more line differences on this page`,
        severity: 'INFO'
      });
    }

    return diffs;
  }

  async _compareTables(text1, text2) {
    // Detect tables by looking for patterns with consistent spacing
    const tables1 = this._extractTables(text1);
    const tables2 = this._extractTables(text2);

    this.stats.tablesFound1 = tables1.length;
    this.stats.tablesFound2 = tables2.length;

    console.log(`\n📊 Tables found: ${tables1.length} vs ${tables2.length}`);

    // Try to match tables by content similarity
    const matched = new Set();

    for (let i = 0; i < tables1.length; i++) {
      let bestMatch = null;
      let bestScore = 0;

      for (let j = 0; j < tables2.length; j++) {
        if (matched.has(j)) continue;

        const score = this._calculateSimilarity(tables1[i].content, tables2[j].content);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = j;
        }
      }

      const name1 = tables1[i].title || `Table ${i + 1}`;
      const name2 = bestMatch !== null ? (tables2[bestMatch].title || `Table ${bestMatch + 1}`) : null;

      if (bestScore > 0.8) { // 80% similarity threshold
        matched.add(bestMatch);
        this.matches.push({
          type: 'TABLE_MATCH',
          table: name1,
          description: `${name1} matches ${name2} (${(bestScore * 100).toFixed(1)}% similarity)`,
          similarity: bestScore
        });
        this.stats.tableMatches++;
        this.tableResults.push({ name: name1, status: 'MATCH', similarity: bestScore, matchedWith: name2 });
      } else if (bestScore > 0.5) {
        this.differences.push({
          type: 'TABLE_PARTIAL_MATCH',
          table: name1,
          description: `${name1} partially matches ${name2} (${(bestScore * 100).toFixed(1)}% similarity)` ,
          severity: 'MEDIUM',
          pdf1Content: tables1[i].preview,
          pdf2Content: tables2[bestMatch]?.preview
        });
        this.stats.tableMismatches++;
        this.tableResults.push({ name: name1, status: 'PARTIAL', similarity: bestScore, matchedWith: name2 });
      } else {
        this.differences.push({
          type: 'TABLE_MISMATCH',
          table: name1,
          description: `${name1} from PDF 1 has no match in PDF 2`,
          severity: 'HIGH',
          pdf1Content: tables1[i].preview
        });
        this.stats.tableMismatches++;
        this.tableResults.push({ name: name1, status: 'MISSING_IN_PDF2' });
      }
    }

    // Report unmatched tables from PDF 2
    for (let j = 0; j < tables2.length; j++) {
      if (!matched.has(j)) {
        const name2 = tables2[j].title || `Table ${j + 1}`;
        this.differences.push({
          type: 'TABLE_MISSING',
          table: name2,
          description: `${name2} from PDF 2 has no match in PDF 1`,
          severity: 'HIGH',
          pdf2Content: tables2[j].preview
        });
        this.stats.tableMismatches++;
        this.tableResults.push({ name: name2, status: 'MISSING_IN_PDF1' });
      }
    }

    // Expected table headers verification (use combined titles from both PDFs)
    const combinedTitles = [
      ...tables1.map(t => t.title).filter(Boolean),
      ...tables2.map(t => t.title).filter(Boolean),
      ...Array.from(this.headings)
    ];
    this.expectedTableChecks = this._checkExpectedTables(this.expectedTableKeywords, combinedTitles);
  }

  _extractTables(text) {
    const tables = [];
    const lines = text.split('\n');
    let currentTable = [];
    let inTable = false;
    let lookback = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect table rows (lines with multiple spaces or tabs, suggesting columns)
      const hasMultipleSpaces = /\s{2,}/.test(line) || /\t/.test(line);
      const hasNumbers = /\d/.test(line);
      const hasSignificantContent = trimmed.length > 10;

      // Capture heading candidates (short-ish, mixed case, not all caps noise)
      const words = trimmed.split(/\s+/);
      const looksLikeHeading = trimmed.length >= 4 && trimmed.length <= 80 && words.length <= 12 && /[A-Za-z]/.test(trimmed);
      if (looksLikeHeading && !hasMultipleSpaces) {
        this.headings.add(trimmed);
      }

      if (hasMultipleSpaces && hasSignificantContent) {
        inTable = true;
        currentTable.push(line);
      } else if (inTable && currentTable.length > 2) {
        // End of table detected
        const title = this._inferTableTitle(lookback);
        tables.push({
          content: currentTable.join('\n'),
          preview: currentTable.slice(0, 3).join('\n') + (currentTable.length > 3 ? '\n...' : ''),
          rows: currentTable.length,
          title
        });
        currentTable = [];
        inTable = false;
      } else if (!hasSignificantContent) {
        currentTable = [];
        inTable = false;
      }

      // Maintain lookback of last few non-empty lines to guess titles above tables
      if (trimmed) {
        lookback.push(trimmed);
        if (lookback.length > 4) {
          lookback.shift();
        }
      }
    }

    // Add last table if exists
    if (currentTable.length > 2) {
      const title = this._inferTableTitle(lookback);
      tables.push({
        content: currentTable.join('\n'),
        preview: currentTable.slice(0, 3).join('\n') + (currentTable.length > 3 ? '\n...' : ''),
        rows: currentTable.length,
        title
      });
    }

    return tables;
  }

  _inferTableTitle(lookbackLines) {
    // Choose the most recent short line that looks like a heading
    const candidates = [...lookbackLines].reverse();
    for (const line of candidates) {
      const clean = line.replace(/[:\-–]+$/, '').trim();
      const words = clean.split(/\s+/);
      const hasLetters = /[A-Za-z]/.test(clean);
      const notTooLong = clean.length <= 80;
      const notTooShort = clean.length >= 4;
      if (hasLetters && notTooLong && notTooShort && words.length <= 12) {
        return clean;
      }
    }
    return null;
  }

  _calculateSimilarity(str1, str2) {
    // Simple similarity score based on common words
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  _generateReport() {
    const report = {
      summary: {
        timestamp: new Date().toISOString(),
        totalDifferences: this.differences.length,
        totalMatches: this.matches.length,
        stats: this.stats
      },
      differences: this.differences,
      matches: this.matches,
      tables: this.tableResults,
      expectedTables: this.expectedTableChecks,
      headings: Array.from(this.headings),
      verdict: this.differences.length === 0 ? 'IDENTICAL' : 
               this.differences.length < 5 ? 'MOSTLY_SIMILAR' : 'SIGNIFICANT_DIFFERENCES'
    };

    return report;
  }

  async sendEmailReport({ htmlPath, jsonPath, subject, report }) {
    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('⚠️ SMTP not configured; PDF comparison email skipped.');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false }
    });

    const attachments = [];
    if (htmlPath && fs.existsSync(htmlPath)) attachments.push({ filename: path.basename(htmlPath), path: htmlPath });
    if (jsonPath && fs.existsSync(jsonPath)) attachments.push({ filename: path.basename(jsonPath), path: jsonPath });

    // Build inline email body with summary + table outcomes
    const summaryStats = report?.summary?.stats || {};
    const tableRows = (report?.tables || []).map(t => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${this._escapeHtml(t.name || '-')}</td>
        <td style="padding:8px;border:1px solid #ddd;">${this._escapeHtml(t.status || '-').replace(/_/g, ' ')}</td>
        <td style="padding:8px;border:1px solid #ddd;">${t.matchedWith ? this._escapeHtml(t.matchedWith) : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;">${t.similarity ? (t.similarity * 100).toFixed(1) + '% ' : '-'}</td>
      </tr>
    `).join('');

    const expectedRows = (report?.expectedTables || []).map(t => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${this._escapeHtml(t.name || '-')}</td>
        <td style="padding:8px;border:1px solid #ddd;">${(t.status || '-').replace(/_/g, ' ')}</td>
        <td style="padding:8px;border:1px solid #ddd;">${t.matchedWith ? this._escapeHtml(t.matchedWith) : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;">${t.similarity ? (t.similarity * 100).toFixed(1) + '% ' : '-'}</td>
      </tr>
    `).join('');

      const headingsRows = (report?.headings || []).map(h => `
        <tr><td style="padding:6px;border:1px solid #ddd;">${this._escapeHtml(h)}</td></tr>
      `).join('');

    const tableSection = (report?.tables?.length)
      ? `
        <h3 style="margin:10px 0 6px 0;">Table Outcomes (${report.tables.length})</h3>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">
          <thead>
            <tr style="background:#2196F3;color:white;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Table Name</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Matched With</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Similarity</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      `
      : '<p>No tables detected.</p>';

    const expectedSection = (report?.expectedTables?.length)
      ? `
        <h3 style="margin:10px 0 6px 0;">Expected Headers (${report.expectedTables.length})</h3>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">
          <thead>
            <tr style="background:#673ab7;color:white;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Expected Name</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Matched With</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Similarity</th>
            </tr>
          </thead>
          <tbody>${expectedRows}</tbody>
        </table>
      `
      : '';

      const headingsSection = (report?.headings?.length)
        ? `
          <h3 style="margin:10px 0 6px 0;">All Detected Headings (${report.headings.length})</h3>
          <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">\
            <thead><tr style="background:#0097a7;color:white;"><th style="padding:8px;border:1px solid #ddd;text-align:left;">Heading Text</th></tr></thead>\
            <tbody>${headingsRows}</tbody>\
          </table>
        `
        : '';

    const emailBody = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="color:#1976d2;margin:0 0 10px 0;">PDF Comparison Report</h2>
        <p style="margin:4px 0;"><b>Verdict:</b> ${report?.verdict || '-'} | <b>Total Differences:</b> ${report?.summary?.totalDifferences ?? '-'} | <b>Total Matches:</b> ${report?.summary?.totalMatches ?? '-'}</p>
        <p style="margin:4px 0;"><b>Pages:</b> ${summaryStats.totalPages1 ?? '-'} vs ${summaryStats.totalPages2 ?? '-'} | <b>Tables Found:</b> ${summaryStats.tablesFound1 ?? '-'} vs ${summaryStats.tablesFound2 ?? '-'} | <b>Table Matches:</b> ${summaryStats.tableMatches ?? '-'} | <b>Table Mismatches:</b> ${summaryStats.tableMismatches ?? '-'}</p>
        ${tableSection}
        ${expectedSection}
          ${headingsSection}
        <p style="margin:8px 0 0 0;">Full HTML and JSON reports are attached.</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.TO_EMAIL,
      subject: subject || 'PDF Comparison Report',
      html: emailBody,
      attachments
    });

    console.log('✔ PDF comparison email sent.');
  }

  generateHTMLReport(report, outputPath) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>PDF Comparison Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #1976d2; border-bottom: 3px solid #1976d2; padding-bottom: 10px; }
    h2 { color: #333; margin-top: 30px; }
    .summary { background: #e3f2fd; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .stat-box { background: white; padding: 15px; border-radius: 5px; border-left: 4px solid #2196F3; }
    .stat-box h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; }
    .stat-box .value { font-size: 28px; font-weight: bold; color: #1976d2; }
    .verdict { padding: 15px; border-radius: 5px; font-weight: bold; text-align: center; margin: 20px 0; font-size: 18px; }
    .verdict.IDENTICAL { background: #4CAF50; color: white; }
    .verdict.MOSTLY_SIMILAR { background: #FFC107; color: #333; }
    .verdict.SIGNIFICANT_DIFFERENCES { background: #f44336; color: white; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #2196F3; color: white; padding: 12px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #ddd; }
    tr:hover { background: #f5f5f5; }
    .severity-HIGH { color: #f44336; font-weight: bold; }
    .severity-MEDIUM { color: #FF9800; }
    .severity-INFO { color: #2196F3; }
    .match { color: #4CAF50; }
    .code { background: #f5f5f5; padding: 10px; border-radius: 3px; font-family: monospace; white-space: pre-wrap; margin: 5px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📄 PDF Comparison Report</h1>
    <div class="summary">
      <p><strong>Generated:</strong> ${new Date(report.summary.timestamp).toLocaleString()}</p>
      <p><strong>Total Differences:</strong> ${report.summary.totalDifferences}</p>
      <p><strong>Total Matches:</strong> ${report.summary.totalMatches}</p>
    </div>

    <div class="verdict ${report.verdict}">
      ${report.verdict.replace(/_/g, ' ')}
    </div>

    <div class="stats">
      <div class="stat-box">
        <h3>Pages (PDF 1)</h3>
        <div class="value">${report.summary.stats.totalPages1}</div>
      </div>
      <div class="stat-box">
        <h3>Pages (PDF 2)</h3>
        <div class="value">${report.summary.stats.totalPages2}</div>
      </div>
      <div class="stat-box">
        <h3>Tables Found (PDF 1)</h3>
        <div class="value">${report.summary.stats.tablesFound1}</div>
      </div>
      <div class="stat-box">
        <h3>Tables Found (PDF 2)</h3>
        <div class="value">${report.summary.stats.tablesFound2}</div>
      </div>
      <div class="stat-box">
        <h3>Table Matches</h3>
        <div class="value">${report.summary.stats.tableMatches}</div>
      </div>
      <div class="stat-box">
        <h3>Table Mismatches</h3>
        <div class="value">${report.summary.stats.tableMismatches}</div>
      </div>
    </div>

    ${report.tables.length > 0 ? `
    <h2>📋 Table Outcomes (${report.tables.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Table Name</th>
          <th>Status</th>
          <th>Matched With</th>
          <th>Similarity</th>
        </tr>
      </thead>
      <tbody>
        ${report.tables.map(t => `
          <tr>
            <td>${this._escapeHtml(t.name)}</td>
            <td>${t.status.replace(/_/g, ' ')}</td>
            <td>${t.matchedWith ? this._escapeHtml(t.matchedWith) : '-'}</td>
            <td>${t.similarity ? (t.similarity * 100).toFixed(1) + '% ' : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    ${report.differences.length > 0 ? `
    <h2>❌ Differences Found (${report.differences.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Location</th>
          <th>Description</th>
          <th>Severity</th>
        </tr>
      </thead>
      <tbody>
        ${report.differences.map(diff => `
          <tr>
            <td>${diff.type.replace(/_/g, ' ')}</td>
            <td>${diff.location || diff.table || diff.page || '-'}</td>
            <td>
              ${diff.description || ''}
              ${diff.pdf1Value ? `<div class="code"><strong>PDF 1:</strong> ${this._escapeHtml(diff.pdf1Value)}</div>` : ''}
              ${diff.pdf2Value ? `<div class="code"><strong>PDF 2:</strong> ${this._escapeHtml(diff.pdf2Value)}</div>` : ''}
              ${diff.pdf1Content ? `<div class="code"><strong>PDF 1 Content:</strong>\n${this._escapeHtml(diff.pdf1Content)}</div>` : ''}
              ${diff.pdf2Content ? `<div class="code"><strong>PDF 2 Content:</strong>\n${this._escapeHtml(diff.pdf2Content)}</div>` : ''}
            </td>
            <td class="severity-${diff.severity || 'MEDIUM'}">${diff.severity || 'MEDIUM'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    ${report.matches.length > 0 ? `
    <h2>✅ Matches Found (${report.matches.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Location</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${report.matches.map(match => `
          <tr class="match">
            <td>${match.type.replace(/_/g, ' ')}</td>
            <td>${match.table || match.page || '-'}</td>
            <td>${match.description}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}
  </div>
</body>
</html>
    `;

    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`\n✅ HTML report saved to: ${outputPath}`);
    return outputPath;
  }

  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  _checkExpectedTables(expected, titles) {
    return expected.map(name => {
      let best = null;
      let bestScore = 0;
      titles.forEach(t => {
        const score = this._calculateSimilarity(name, t || '');
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      });
      const status = bestScore > 0.8 ? 'FOUND' : bestScore > 0.5 ? 'POSSIBLE_MATCH' : 'MISSING';
      return { name, status, matchedWith: best, similarity: bestScore };
    });
  }
}

module.exports = PDFComparer;
