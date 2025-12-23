const { test } = require('@playwright/test');
const PDFComparer = require('./helpers/pdfComparer');
const path = require('path');
const fs = require('fs');

test.describe('PDF Document Comparison', () => {
  test('Compare two PDF documents and generate discrepancy report', async () => {
    // Configure PDF paths (can be overridden via environment variables)
    const pdf1Path = process.env.PDF1_PATH || 'C:\\Users\\amitmish\\Desktop\\ISSUED+01_20_2020+13_48_01.pdf';
    const pdf2Path = process.env.PDF2_PATH || 'C:\\Users\\amitmish\\Desktop\\ISSUED+01_20_2020+13_48_01.pdf'; // Replace with second PDF

    console.log('\n' + '='.repeat(80));
    console.log('🔍 PDF COMPARISON TEST');
    console.log('='.repeat(80));

    // Verify files exist
    if (!fs.existsSync(pdf1Path)) {
      throw new Error(`PDF 1 not found: ${pdf1Path}`);
    }
    if (!fs.existsSync(pdf2Path)) {
      throw new Error(`PDF 2 not found: ${pdf2Path}`);
    }

    // Initialize comparer
    const comparer = new PDFComparer();

    // Perform comparison
    console.log('\n⚙️  Starting PDF comparison...');
    const startTime = Date.now();

    const report = await comparer.comparePDFs(pdf1Path, pdf2Path);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Comparison completed in ${duration}s`);

    // Display summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPARISON SUMMARY');
    console.log('='.repeat(80));
    console.log(`Verdict: ${report.verdict.replace(/_/g, ' ')}`);
    console.log(`Total Differences: ${report.summary.totalDifferences}`);
    console.log(`Total Matches: ${report.summary.totalMatches}`);
    console.log('\nStatistics:');
    console.log(`  PDF 1 Pages: ${report.summary.stats.totalPages1}`);
    console.log(`  PDF 2 Pages: ${report.summary.stats.totalPages2}`);
    console.log(`  Tables in PDF 1: ${report.summary.stats.tablesFound1}`);
    console.log(`  Tables in PDF 2: ${report.summary.stats.tablesFound2}`);
    console.log(`  Table Matches: ${report.summary.stats.tableMatches}`);
    console.log(`  Table Mismatches: ${report.summary.stats.tableMismatches}`);

    // Show sample differences
    if (report.differences.length > 0) {
      console.log('\n❌ DIFFERENCES (showing first 5):');
      report.differences.slice(0, 5).forEach((diff, idx) => {
        console.log(`\n${idx + 1}. ${diff.type.replace(/_/g, ' ')}`);
        console.log(`   Location: ${diff.location || diff.table || diff.page || 'N/A'}`);
        console.log(`   Severity: ${diff.severity || 'MEDIUM'}`);
        console.log(`   ${diff.description || ''}`);
        if (diff.pdf1Value) console.log(`   PDF 1: ${diff.pdf1Value.substring(0, 80)}...`);
        if (diff.pdf2Value) console.log(`   PDF 2: ${diff.pdf2Value.substring(0, 80)}...`);
      });
      if (report.differences.length > 5) {
        console.log(`\n   ... and ${report.differences.length - 5} more differences`);
      }
    }

    // Show sample matches
    if (report.matches.length > 0) {
      console.log('\n✅ MATCHES (showing first 5):');
      report.matches.slice(0, 5).forEach((match, idx) => {
        console.log(`\n${idx + 1}. ${match.type.replace(/_/g, ' ')}`);
        console.log(`   ${match.description}`);
      });
      if (report.matches.length > 5) {
        console.log(`\n   ... and ${report.matches.length - 5} more matches`);
      }
    }

    // Generate HTML report
    const reportDir = path.join(__dirname, 'test-results', 'pdf-comparison');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const htmlReportPath = path.join(reportDir, `PDF_Comparison_Report_${timestamp}.html`);
    
    comparer.generateHTMLReport(report, htmlReportPath);

    // Also save JSON report
    const jsonReportPath = path.join(reportDir, `PDF_Comparison_Report_${timestamp}.json`);
    fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`✅ JSON report saved to: ${jsonReportPath}`);

    // Send email with reports attached (if SMTP is configured)
    const emailSubject = `PDF Comparison: ${path.basename(pdf1Path)} vs ${path.basename(pdf2Path)} (${report.verdict})`;
    await comparer.sendEmailReport({ htmlPath: htmlReportPath, jsonPath: jsonReportPath, subject: emailSubject, report });

    console.log('\n' + '='.repeat(80));
    console.log(`📁 Reports saved to: ${reportDir}`);
    console.log('='.repeat(80) + '\n');

    // Optionally fail test if significant differences found
    if (process.env.FAIL_ON_DIFF === 'true' && report.verdict === 'SIGNIFICANT_DIFFERENCES') {
      throw new Error(`PDFs have significant differences (${report.summary.totalDifferences} found)`);
    }
  });

  test('Compare PDFs with custom paths from command line', async () => {
    // Example: npx playwright test Compare_PDFs.test.js --grep "custom paths" -g "PDF1_PATH=path1 PDF2_PATH=path2"
    
    if (!process.env.PDF1_PATH || !process.env.PDF2_PATH) {
      console.log('\n⚠️  Skipping test: PDF1_PATH and PDF2_PATH environment variables not set');
      console.log('   Usage: PDF1_PATH="path/to/pdf1.pdf" PDF2_PATH="path/to/pdf2.pdf" npx playwright test Compare_PDFs.test.js');
      test.skip();
      return;
    }

    const comparer = new PDFComparer();
    const report = await comparer.comparePDFs(process.env.PDF1_PATH, process.env.PDF2_PATH);

    console.log(`\n✅ Comparison complete: ${report.verdict}`);
    console.log(`   Differences: ${report.summary.totalDifferences}`);
    console.log(`   Matches: ${report.summary.totalMatches}`);

    // Generate report
    const reportPath = path.join(__dirname, 'test-results', 'pdf-comparison', 
      `Custom_PDF_Comparison_${Date.now()}.html`);
    comparer.generateHTMLReport(report, reportPath);

    // Optional email for custom path run
    const customJson = reportPath.replace(/\.html$/, '.json');
    fs.writeFileSync(customJson, JSON.stringify(report, null, 2), 'utf8');
    const customSubject = `PDF Comparison: ${path.basename(process.env.PDF1_PATH)} vs ${path.basename(process.env.PDF2_PATH)} (${report.verdict})`;
    await comparer.sendEmailReport({ htmlPath: reportPath, jsonPath: customJson, subject: customSubject, report });
  });
});
