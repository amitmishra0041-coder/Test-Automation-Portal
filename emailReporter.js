require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

class EmailReporter {
  constructor(options) {
    this.options = options || {};
    this.results = [];
    this.startTime = new Date();
    this.suiteLabel = this._detectSuite();
    this.iterationsFile = path.join(__dirname, `iterations-data-${this.suiteLabel.toLowerCase()}.json`);
    this.lockFile = path.join(__dirname, `parallel-run-lock-${this.suiteLabel.toLowerCase()}.json`);
    this.runId = null;
  }

  _detectSuite() {
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    if (this.options?.suiteName && /BOP/i.test(this.options.suiteName)) return 'BOP';
    return 'Package';
  }

  // Derive suite from the current test file/title; falls back to env.
  _suiteFromTest(test) {
    const file = test?.location?.file || '';
    const title = (test?.title || '').toUpperCase();
    if (/BOP/i.test(file) || title.includes('BOP')) return 'BOP';
    if (/PACKAGE/i.test(file) || title.includes('PACKAGE')) return 'Package';
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    return this.suiteLabel || 'Package';
  }

  onBegin() {
    try {
      const lockFiles = [
        path.join(__dirname, 'parallel-run-lock-bop.json'),
        path.join(__dirname, 'parallel-run-lock-package.json'),
      ];

      const anyLock = lockFiles.some(f => fs.existsSync(f));
      if (!anyLock) {
        ['iterations-data-bop.json', 'iterations-data-package.json'].forEach(file => {
          const fp = path.join(__dirname, file);
          if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
            console.log(`🗑️ Cleared previous iterations data (${file})`);
          }
        });
        const testDataFile = path.join(__dirname, 'test-data.json');
        if (fs.existsSync(testDataFile)) {
          fs.unlinkSync(testDataFile);
          console.log('🗑️ Cleared previous test-data.json (single run)');
        }
        this.runId = new Date().toISOString();
      } else {
        console.log('🔒 Lock file present; skipping cleanup (parallel run)');
        try {
          let lockData = {};
          // Prefer whichever lock file has runId set
          const lockPath = lockFiles.find(f => fs.existsSync(f));
          if (lockPath) {
            lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) || {};
          }
          if (!lockData.runId) {
            lockData.runId = new Date().toISOString();
            fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf8');
            console.log(`🆔 Created runId in lock file: ${lockData.runId}`);
          }
          this.runId = lockData.runId;
        } catch (e) {
          console.log('⚠️ Failed to set runId in lock file:', e.message);
          this.runId = new Date().toISOString();
        }
      }
    } catch (e) {
      console.log('⚠️ Could not clear data files:', e.message);
    }
  }

  onTestEnd(test, result) {
    const timestamp = new Date();
    this.results.push({
      name: test.title,
      status: result.status.toUpperCase(),
      error: result.error?.message || '',
      timestamp,
    });

    // After each test, append its data to iterations file
    try {
      const testDataFile = path.join(__dirname, 'test-data.json');
      if (fs.existsSync(testDataFile)) {
        const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
        const suite = this._suiteFromTest(test);
        const iterationsFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);
        
        // Load existing iterations
        let iterations = [];
        if (fs.existsSync(iterationsFile)) {
          iterations = JSON.parse(fs.readFileSync(iterationsFile, 'utf-8'));
        }
        
        // Add this iteration's data
        iterations.push({
          iterationNumber: iterations.length + 1,
          status: result.status.toUpperCase(),
          state: testData.state || 'N/A',
          stateName: testData.stateName || 'N/A',
          quoteNumber: testData.quoteNumber || 'N/A',
          policyNumber: testData.policyNumber || 'N/A',
          milestones: testData.milestones || [],
          timestamp: timestamp.toISOString(),
          duration: testData.milestones?.reduce((sum, m) => sum + parseFloat(m.duration || 0), 0).toFixed(2) || '0',
          runId: this.runId,
          suite
        });
        
        // Save updated iterations
        fs.writeFileSync(iterationsFile, JSON.stringify(iterations, null, 2), 'utf8');
        console.log(`💾 Iteration ${iterations.length} data saved for suite=${suite}`);
      }
    } catch (e) {
      console.log('⚠️ Could not save iteration data:', e.message);
    }
  }

  async onEnd() {
    console.log('🎬 EmailReporter.onEnd() called');
    console.log('📊 Suite:', this.suiteLabel);
    console.log('🆔 RunId:', this.runId);
    const endTime = new Date();
    const totalDuration = ((endTime - this.startTime) / 1000).toFixed(2);

    // Load iterations for current run across all suites
    let iterations = [];
    try {
      const iterationFiles = ['iterations-data-bop.json', 'iterations-data-package.json'];
      let lockData = {};
      try {
        // Try to pick up any existing lock file for runId reuse
        const lockPaths = ['parallel-run-lock-bop.json', 'parallel-run-lock-package.json']
          .map(f => path.join(__dirname, f));
        const lockPath = lockPaths.find(f => fs.existsSync(f));
        if (lockPath) {
          lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) || {};
        }
      } catch {}
      const activeRunId = lockData.runId || this.runId;

      iterationFiles.forEach(file => {
        const fp = path.join(__dirname, file);
        if (fs.existsSync(fp)) {
          const allIterations = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          if (Array.isArray(allIterations)) {
            const filtered = allIterations.filter(it => it.runId === activeRunId);
            iterations = iterations.concat(filtered);
          }
        }
      });
      console.log(`📂 Loaded ${iterations.length} iteration(s) for runId=${activeRunId} across suites`);
    } catch (e) {
      console.log('⚠️ Failed to read iterations file:', e.message);
    }

    // Fallback: if no iterations recorded, attempt to read current test-data.json
    if (iterations.length === 0) {
      try {
        const testDataFile = path.join(__dirname, 'test-data.json');
        if (fs.existsSync(testDataFile)) {
          const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
          const totalDuration = Array.isArray(testData.milestones)
            ? testData.milestones.reduce((sum, m) => sum + parseFloat((m.duration || '0').toString()), 0).toFixed(2)
            : '0';
          iterations = [{
            iterationNumber: 1,
            status: (testData.status || 'UNKNOWN').toUpperCase(),
            state: testData.state || 'N/A',
            stateName: testData.stateName || 'N/A',
            quoteNumber: testData.quoteNumber || 'N/A',
            policyNumber: testData.policyNumber || 'N/A',
            milestones: testData.milestones || [],
            timestamp: new Date().toISOString(),
            duration: totalDuration
          }];
          console.log('🧭 Using fallback test-data.json for milestone rendering');
        }
      } catch (e) {
        console.log('⚠️ Fallback read of test-data.json failed:', e.message);
      }
    }

    if (iterations.length === 0) {
      console.log('⚠️ No iterations data found. Skipping email report.');
      return;
    }

    // Calculate stats
    const totalIterations = iterations.length;
    const passedIterations = iterations.filter(it => it.status === 'PASSED').length;
    const failedIterations = totalIterations - passedIterations;
    const overallPassed = failedIterations === 0;

    // Build summary table HTML
    const summaryTableHtml = `
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="background:#2196F3;color:white;">
            <th style="padding:12px;text-align:left;border:1px solid #ddd;">Line of Business</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;">Quote Number</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;">Policy Number</th>
            <th style="padding:12px;text-align:center;border:1px solid #ddd;">Overall Status</th>
          </tr>
        </thead>
        <tbody>
          ${iterations.map((it, idx) => {
            const bg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
            const statusIcon = it.status === 'PASSED' ? '✅ PASSED' : '❌ FAILED';
            const statusColor = it.status === 'PASSED' ? '#4CAF50' : '#f44336';
            return `
              <tr style="background:${bg};">
                <td style="padding:12px;border:1px solid #ddd;">${it.suite || this.suiteLabel}</td>
                <td style="padding:12px;border:1px solid #ddd;">${it.quoteNumber}</td>
                <td style="padding:12px;border:1px solid #ddd;">${it.policyNumber}</td>
                <td style="padding:12px;border:1px solid #ddd;text-align:center;color:${statusColor};font-weight:bold;">${statusIcon}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Build email HTML
    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h1 style="color:#1976d2;">🎭 WB Smoke Test Report</h1>
        <div style="background:#f5f5f5;padding:15px;margin:15px 0;border-radius:5px;border-left:4px solid #1976d2;">
          <h3 style="margin-top:0;">📊 Test Summary</h3>
          <p><b>Overall Status:</b> ${overallPassed ? '✅ PASSED' : '❌ FAILED'}</p>
          <p><b>Total Iterations:</b> ${totalIterations}</p>
          <p><b>Passed:</b> <span style="color:green;font-weight:bold;">${passedIterations}</span> &nbsp; <b>Failed:</b> <span style="color:red;font-weight:bold;">${failedIterations}</span></p>
          <p><b>Test Duration:</b> ${totalDuration}s</p>
        </div>

        <h2 style="color:#333;margin-top:20px;">Test Execution Details</h2>
        ${summaryTableHtml}

        <div style="margin-top:30px;padding:15px;background:#e8f5e9;border-radius:5px;border-left:4px solid #4CAF50;">
          <p style="font-size:0.9em;color:#666;">
            <b>Note:</b> Detailed milestone breakdown for each iteration has been attached in the Excel file (WB_Test_Report_${new Date().toISOString().split('T')[0]}.xlsx)
          </p>
        </div>

        <div style="margin-top:20px;padding:10px;background:#f5f5f5;border-radius:5px;text-align:center;color:#666;">
          <p style="margin:5px 0;font-size:0.9em;">Generated by Playwright Test Automation Framework</p>
          <p style="margin:5px 0;font-size:0.9em;">Report Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
        </div>
      </div>
    `;

    // Create Excel workbook with milestone details
    const excelFile = await this._createExcelReport(iterations);

    // Prepare email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false }
    });

    const todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subjectLine = `WB Smoke Testing Report: ${todayDate} - ${passedIterations} Passed, ${failedIterations} Failed`;

    console.log('📧 SMTP Config:', { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL });
    console.log(`📨 Subject: ${subjectLine}`);
    console.log('📊 Final Test Summary:');
    console.log(`   Overall: ${overallPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Iterations: ${totalIterations}`);
    console.log(`   Passed: ${passedIterations} | Failed: ${failedIterations}`);

    // Check if SMTP credentials are available
    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('⚠️ SMTP credentials not configured. Email report will not be sent.');
      console.log('ℹ️  To enable email reports, set SMTP_HOST, SMTP_PORT, FROM_EMAIL, and TO_EMAIL in .env file');
      console.log('ℹ️  Test data has been saved to:', path.join(__dirname, 'test-data.json'));
      if (iterations.length > 0) {
        console.log('ℹ️  Iterations data saved to:', this.iterationsFile);
      }
      if (excelFile) {
        console.log('ℹ️  Excel report generated at:', excelFile);
      }
      return;
    }

    try {
      const mailOptions = {
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: subjectLine,
        html,
        attachments: excelFile ? [{
          filename: path.basename(excelFile),
          path: excelFile
        }] : []
      };

      await transporter.sendMail(mailOptions);
      console.log('✔ Email report sent successfully with Excel attachment.');
    } catch (e) {
      console.error('❌ Failed to send email:', e.message);
      console.error('Stack:', e.stack);
    }
  }

  async _createExcelReport(iterations) {
    try {
      const wb = XLSX.utils.book_new();

      // Create a summary sheet
      const summaryData = iterations.map((it, idx) => ({
        'Iteration #': it.iterationNumber,
        'Line of Business': it.suite || this.suiteLabel,
        'Quote Number': it.quoteNumber,
        'Policy Number': it.policyNumber,
        'Overall Status': it.status,
        'Duration (s)': it.duration,
        'State': it.state
      }));

      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

      // Create detailed sheet for each iteration
      iterations.forEach((it, idx) => {
        const milestoneData = it.milestones.map(m => ({
          'Milestone': m.name,
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Timestamp': m.timestamp || '-'
        }));

        const ws = XLSX.utils.json_to_sheet(milestoneData);
        const sheetName = `Iteration_${it.iterationNumber}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      // Save Excel file
      const excelPath = path.join(__dirname, `WB_Test_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      XLSX.writeFile(wb, excelPath);
      console.log(`📊 Excel report generated: ${excelPath}`);
      return excelPath;
    } catch (e) {
      console.error('⚠️ Failed to create Excel report:', e.message);
      return null;
    }
  }
}

module.exports = EmailReporter;
