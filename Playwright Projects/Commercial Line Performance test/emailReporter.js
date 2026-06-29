// emailReporter.js
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

class EmailReporter {
  constructor(options) {
    this.options = options || {};
    this.suiteLabel = null;
    this.runId = null;
  }

  _detectSuite() {
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    if (suiteEnv === 'CA') return 'CA';
    return 'Package';
  }

  _getSuiteLabel() {
    if (!this.suiteLabel) this.suiteLabel = this._detectSuite();
    return this.suiteLabel;
  }

  onBegin() {
    const suiteLabel = this._getSuiteLabel();
    const batchMarker = path.join(__dirname, '.batch-run-in-progress');
    const isBatchRun = fs.existsSync(batchMarker);
    const lockFile = path.join(__dirname, `parallel-run-lock-${suiteLabel.toLowerCase()}.json`);

    if (!isBatchRun) {
      const iterFile = path.join(__dirname, `iterations-data-${suiteLabel.toLowerCase()}.json`);
      if (fs.existsSync(iterFile)) fs.unlinkSync(iterFile);
      this.runId = new Date().toISOString();
    } else {
      let lockData = {};
      if (fs.existsSync(lockFile)) lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      if (!lockData.runId) lockData.runId = new Date().toISOString();
      fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
      this.runId = lockData.runId;
    }
  }

  onTestEnd(test, result) {
    try {
      const suite = this._getSuiteLabel();
      const envState = (process.env.TEST_STATE || '').toUpperCase();
      const dataState = (global.testData && global.testData.state ? String(global.testData.state) : '').toUpperCase();
      const testState = envState || dataState;

      console.log(`ðŸ” onTestEnd called: suite=${suite}, state=${testState}, runId=${this.runId}, result=${result.status}`);

      const stateSpecificFile = testState ? path.join(__dirname, `test-data-${testState}.json`) : null;
      const fallbackFile = path.join(__dirname, 'test-data.json');
      const testDataFile = stateSpecificFile && fs.existsSync(stateSpecificFile) ? stateSpecificFile : fallbackFile;

      console.log(`ðŸ” Looking for test data: ${testDataFile}, exists: ${fs.existsSync(testDataFile)}`);
      if (!fs.existsSync(testDataFile)) return;

      const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
      const iterFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);
      let iterations = fs.existsSync(iterFile) ? JSON.parse(fs.readFileSync(iterFile, 'utf-8')) : [];

      // FIX: allow retries to overwrite instead of silently dropping
      const existingIndex = iterations.findIndex(it => it.state === testData.state && it.runId === this.runId);

      let status = result.status.toUpperCase();
      const hasFailedMilestones = Array.isArray(testData.milestones) &&
        testData.milestones.some(m => (m.status || '').toUpperCase() === 'FAILED');
      const hasPolicyNumber = testData.policyNumber && testData.policyNumber !== 'N/A';
      if (!hasFailedMilestones && hasPolicyNumber) status = 'PASSED';

      const iterationEntry = {
        iterationNumber: existingIndex !== -1 ? iterations[existingIndex].iterationNumber : iterations.length + 1,
        status,
        state: testData.state || 'N/A',
        stateName: testData.stateName || 'N/A',
        quoteNumber: testData.quoteNumber || 'N/A',
        policyNumber: testData.policyNumber || 'N/A',
        milestones: testData.milestones || [],
        coverageChanges: testData.coverageChanges || [],
        coverageSectionStats: testData.coverageSectionStats || [],
        addCoverageTimings: testData.addCoverageTimings || [],
        timestamp: new Date().toISOString(),
        duration: Array.isArray(testData.milestones)
          ? testData.milestones.reduce((sum, m) => sum + parseFloat(m.duration || 0), 0).toFixed(2)
          : '0',
        runId: this.runId,
        suite,
      };

      if (existingIndex !== -1) {
        iterations[existingIndex] = iterationEntry;
        console.log(`ðŸ”„ Updated existing iteration for state=${testData.state} (retry result)`);
      } else {
        iterations.push(iterationEntry);
        console.log(`ðŸ’¾ Saved iteration ${iterations.length}: suite=${suite}, state=${testData.state}, quote=${testData.quoteNumber}`);
      }

      fs.writeFileSync(iterFile, JSON.stringify(iterations, null, 2));
    } catch (e) {
      console.log('âš ï¸ onTestEnd error:', e.message);
    }
  }

  async onEnd() {
    const suite = this._getSuiteLabel();
    const batchMarkers = [
      path.join(__dirname, '.batch-run-in-progress'),
      path.join(__dirname, `.batch-run-in-progress-${suite.toLowerCase()}`)
    ];
    const isBatchRun = batchMarkers.some(marker => fs.existsSync(marker));
    if (isBatchRun) {
      console.log('â¸ï¸ Batch run detected; skipping individual email');
      return;
    }

    const iterFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);
    console.log(`ðŸ” Looking for iterations file: ${iterFile}`);
    console.log(`ðŸ” File exists: ${fs.existsSync(iterFile)}`);
    console.log(`ðŸ” Current runId: ${this.runId}`);

    if (!fs.existsSync(iterFile)) {
      console.log('âš ï¸ No iterations to email');
      return;
    }

    const allIterations = JSON.parse(fs.readFileSync(iterFile, 'utf-8'));
    console.log(`ðŸ” Total iterations in file: ${Array.isArray(allIterations) ? allIterations.length : 'not an array'}`);

    const iterations = this.runId ? allIterations.filter(it => it.runId === this.runId) : allIterations;
    console.log(`ðŸ” Filtered iterations (runId filter): ${iterations.length}`);

    if (!iterations.length) {
      console.log('âš ï¸ No iterations for this runId, sending all available iterations instead');
      await this._sendEmail(allIterations, 'WB Smoke Testing Report');
      return;
    }

    await this._sendEmail(iterations, 'WB Smoke Testing Report');
  }

  async _sendEmail(iterations, subjectPrefix) {
    const passed = iterations.filter(it => it.status === 'PASSED').length;
    const failed = iterations.length - passed;
    const overallPassed = failed === 0;
    const totalDuration = iterations.reduce((sum, it) => sum + parseFloat(it.duration || 0), 0).toFixed(2);

    // â”€â”€ Passed iterations table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const passedIterations = iterations.filter(it => it.status === 'PASSED');
    const passedTableHtml = passedIterations.length > 0 ? `
      <h3 style="color:#4CAF50;margin-top:20px;">âœ… Passed Iterations (${passedIterations.length})</h3>
      <table style="width:100%;border-collapse:collapse;margin:10px 0;">
        <thead>
          <tr style="background:#4CAF50;color:white;">
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Iteration</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Line of Business</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Quote Number</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Policy Number</th>
          </tr>
        </thead>
        <tbody>
          ${passedIterations.map((it, idx) => `
            <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f5f5f5'};">
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">#${it.iterationNumber}</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.suite || 'Package'} (${it.state || 'N/A'})</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.quoteNumber}</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.policyNumber}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    // â”€â”€ Failed iterations table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const failedIterations = iterations.filter(it => it.status === 'FAILED');
    const failedTableHtml = failedIterations.length > 0 ? `
      <h3 style="color:#f44336;margin-top:20px;">âŒ Failed Iterations (${failedIterations.length})</h3>
      <table style="width:100%;border-collapse:collapse;margin:10px 0;">
        <thead>
          <tr style="background:#f44336;color:white;">
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Iteration</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Line of Business</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Quote Number</th>
            <th style="padding:12px;text-align:left;border:1px solid #ddd;font-size:12px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${failedIterations.map((it, idx) => `
            <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f5f5f5'};">
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">#${it.iterationNumber}</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.suite || 'Package'} (${it.state || 'N/A'})</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.quoteNumber}</td>
              <td style="padding:10px;border:1px solid #ddd;font-size:12px;color:#f44336;font-weight:bold;">FAILED</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    // â”€â”€ Milestone details â€” replaces coverage section, shown for ALL iterations â”€â”€
    const milestoneDetailsHtml = iterations.map(it => {
      const milestones = it.milestones || [];
      if (milestones.length === 0) return '';

      const statusColor = it.status === 'PASSED' ? '#4CAF50' : '#f44336';
      const statusIcon  = it.status === 'PASSED' ? 'âœ…' : 'âŒ';
      const tabLabel    = `${it.suite || 'Package'}_${it.state || 'N/A'}_${it.iterationNumber}`;

      const rows = milestones.map((m, idx) => {
        const mStatus     = (m.status || 'N/A').toUpperCase();
        const mColor      = mStatus === 'PASSED' ? '#4CAF50' : mStatus === 'FAILED' ? '#f44336' : '#FF9800';
        const durationVal = m.duration ? m.duration : '-';
        return `
          <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
            <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;">${idx + 1}</td>
            <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;">${m.name || '-'}</td>
            <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;font-weight:bold;color:${mColor};">${mStatus}</td>
            <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;text-align:right;">${durationVal}</td>
            <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;color:#666;">${m.details || '-'}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="margin:24px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
          <div style="background:${statusColor};padding:10px 16px;display:flex;align-items:center;gap:8px;">
            <span style="color:white;font-size:13px;font-weight:bold;">
              ${statusIcon} ${tabLabel} â€” ${it.suite || 'Package'} | State: ${it.state || 'N/A'} | Iteration #${it.iterationNumber}
            </span>
            <span style="color:rgba(255,255,255,0.85);font-size:12px;margin-left:auto;">
              Quote: ${it.quoteNumber} &nbsp;|&nbsp; Policy: ${it.policyNumber} &nbsp;|&nbsp; Total: ${it.duration}s
            </span>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;color:#555;">#</th>
                <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;color:#555;">Milestone</th>
                <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;color:#555;">Status</th>
                <th style="padding:9px 12px;text-align:right;border:1px solid #ddd;font-size:11px;color:#555;">Duration</th>
                <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;color:#555;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    // â”€â”€ Assemble full email body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto;">
        <h1 style="color:#1976d2;">ðŸŽ­ ${subjectPrefix}</h1>

        <div style="background:#f5f5f5;padding:15px;margin:15px 0;border-radius:5px;border-left:4px solid #1976d2;">
          <h3 style="margin-top:0;">ðŸ“Š Test Summary</h3>
          <p><b>Overall Status:</b> ${overallPassed ? 'âœ… PASSED' : 'âŒ FAILED'}</p>
          <p><b>Total Iterations:</b> ${iterations.length}</p>
          <p><b>Passed:</b> <span style="color:green;font-weight:bold;">${passed}</span>
             &nbsp; <b>Failed:</b> <span style="color:red;font-weight:bold;">${failed}</span></p>
          <p><b>Test Duration:</b> ${totalDuration}s</p>
        </div>

        <h2 style="color:#333;margin-top:30px;">Iteration Results</h2>
        ${passedTableHtml}
        ${failedTableHtml}

        <h2 style="color:#333;margin-top:30px;">ðŸ“‹ Milestone Details (All Iterations)</h2>
        <p style="color:#666;font-size:12px;margin-bottom:16px;">
          Each section below corresponds to an Excel tab (e.g. Package_DE_1) in the attached report.
        </p>
        ${milestoneDetailsHtml || '<p style="color:#999;">No milestone data available.</p>'}
      </div>
    `;

    const excelFile = await this._createExcelReport(iterations);
    const attachments = excelFile ? [{ filename: path.basename(excelFile), path: excelFile }] : [];

    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('âš ï¸ SMTP not configured; email skipped');
      if (excelFile) console.log('â„¹ï¸ Excel generated at:', excelFile);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 25,
      secure: false,
      tls: { rejectUnauthorized: false },
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    });

    const todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subjectLine = `${subjectPrefix}: ${todayDate} - ${passed} Passed, ${failed} Failed`;

    try {
      await transporter.sendMail({ from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL, subject: subjectLine, html, attachments });
      console.log('âœ” Email sent successfully');
    } catch (err) {
      console.error('âŒ Email send failed:', err.message);
      throw err;
    }
  }

  async _createExcelReport(iterations) {
    try {
      const excelPath = path.join(__dirname, 'WB_Test_Report.xlsx');
      const targetWb = XLSX.utils.book_new();
      const runTag = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);

      // â”€â”€ Summary sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const summaryData = iterations.map(it => ({
        'Iteration #': it.iterationNumber,
        'Line of Business': `${it.suite || 'Package'} (${it.state || 'N/A'})`,
        'Quote Number': it.quoteNumber,
        'Policy Number': it.policyNumber,
        'Status': it.status,
        'Duration (s)': it.duration,
        'State': it.state
      }));
      XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(summaryData), `Summary_${runTag}`.substring(0, 31));

      // â”€â”€ Milestones Analytics sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const milestoneAggregates = new Map();
      iterations.filter(it => it.status === 'PASSED').forEach(it => {
        (it.milestones || []).forEach(m => {
          if (!m.name || m.status !== 'PASSED') return;
          if (!milestoneAggregates.has(m.name)) milestoneAggregates.set(m.name, { totalDuration: 0, count: 0, runs: [] });
          const duration = parseFloat(m.duration) || 0;
          const existing = milestoneAggregates.get(m.name);
          existing.totalDuration += duration;
          existing.count += 1;
          existing.runs.push({ suite: it.suite || 'Package', state: it.state, duration });
        });
      });

      const analyticsData = Array.from(milestoneAggregates.entries()).map(([milestoneName, data]) => ({
        'Milestone': milestoneName,
        'Average Duration (s)': (data.totalDuration / data.count).toFixed(2),
        'Min Duration (s)': Math.min(...data.runs.map(r => r.duration)).toFixed(2),
        'Max Duration (s)': Math.max(...data.runs.map(r => r.duration)).toFixed(2),
        'Total Runs': data.count,
        'Suites': [...new Set(data.runs.map(r => r.suite))].join(', '),
        'States': [...new Set(data.runs.map(r => r.state))].join(', ')
      }));
      XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(analyticsData), 'Milestones_Analytics');

      // â”€â”€ Coverage Changes sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const coverageAnalyticsData = [];
      iterations.forEach(it => {
        (it.coverageChanges || []).forEach(change => {
          coverageAnalyticsData.push({
            'Quote Number': change.quoteNumber || 'N/A',
            'Coverage Section': change.coverageSection || 'N/A',
            'Coverage': change.coverage || 'N/A',
            'Old Value': change.oldValue || 'N/A',
            'New Value': change.newValue || 'N/A',
            'Status': change.status || 'N/A',
            'Suite': it.suite || 'N/A',
            'State': it.state || 'N/A',
            'Iteration': it.iterationNumber
          });
        });
      });
      if (coverageAnalyticsData.length > 0) {
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(coverageAnalyticsData), 'Coverage_Changes');
      }

      // â”€â”€ Coverage Section Timings sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const coverageSectionData = [];
      iterations.forEach(it => {
        (it.coverageSectionStats || []).forEach(row => {
          coverageSectionData.push({
            'Quote Number': row.quoteNumber || 'N/A',
            'Coverage Section': row.coverageSection || 'N/A',
            'Dropdowns Updated': row.dropdownsUpdated || 0,
            'Duration': row.durationFormatted || `${row.durationSeconds || '0'}s`,
            'Suite': it.suite || 'N/A',
            'State': it.state || 'N/A',
            'Iteration': it.iterationNumber
          });
        });
      });
      if (coverageSectionData.length) {
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(coverageSectionData), 'Coverage_Section_Timings');
      }

      // â”€â”€ Add Coverage Timings sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const addCoverageData = [];
      iterations.forEach(it => {
        (it.addCoverageTimings || []).forEach(row => {
          addCoverageData.push({
            'Iteration': it.iterationNumber,
            'Quote Number': it.quoteNumber || 'N/A',
            'Action': row.action || 'Add',
            'Step #': row.index,
            'Coverage Name': row.coverage || 'Unknown',
            'Duration (s)': row.duration || '0',
            'Suite': it.suite || 'N/A',
            'State': it.state || 'N/A'
          });
        });
      });
      if (addCoverageData.length) {
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(addCoverageData), 'Add_Coverage_Timings');
      }

      // â”€â”€ Per-iteration milestone sheets (e.g. Package_DE_1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // FIX: dedup sheet names to prevent XLSX collision on parallel/retry runs
      const usedSheetNames = new Set(targetWb.SheetNames);

      iterations.forEach(it => {
        const milestoneData = (it.milestones || []).map((m, idx) => ({
          '#': idx + 1,
          'Milestone': m.name || '-',
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Details': m.details || '-',
          'Timestamp': m.timestamp || '-',
        }));

        const ws = XLSX.utils.json_to_sheet(milestoneData);

        // Match the label used in the email body: Suite_State_IterNum
        const sheetBase = `${(it.suite || 'Suite').replace(/[^A-Za-z0-9]/g, '_')}_${it.state || 'N_A'}_${it.iterationNumber}`;
        let sheetName = sheetBase.substring(0, 31);

        // Deduplicate if the same name already exists (retry / parallel collision)
        let suffix = 2;
        while (usedSheetNames.has(sheetName)) {
          sheetName = `${sheetBase.substring(0, 28)}_${suffix++}`.substring(0, 31);
        }
        usedSheetNames.add(sheetName);

        XLSX.utils.book_append_sheet(targetWb, ws, sheetName);
      });

      XLSX.writeFile(targetWb, excelPath);
      return excelPath;
    } catch (e) {
      console.error('âš ï¸ Failed to create Excel:', e.message);
      return null;
    }
  }

  static async sendBatchEmailReport(iterationFilesOverride, subjectPrefixOverride) {
    console.log('ðŸ“¨ Sending consolidated batch email...');
    let iterations = [];

    const iterationFiles = iterationFilesOverride || ['iterations-data-bop.json', 'iterations-data-package.json'];

    for (const file of iterationFiles) {
      const fp = path.join(__dirname, file);
      if (!fs.existsSync(fp)) continue;
      const allIterations = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
      if (!allIterations.length) continue;
      const runIds = allIterations.map(it => it.runId).filter(Boolean);
      const latestRunId = runIds.length ? runIds.sort().slice(-1)[0] : null;
      const filtered = latestRunId ? allIterations.filter(it => it.runId === latestRunId) : allIterations;
      console.log(`   ${file}: ${allIterations.length} total, using ${filtered.length} from runId ${latestRunId || 'N/A'}`);
      iterations = iterations.concat(filtered);
    }

    if (!iterations.length) { console.log('âš ï¸ No iterations found'); return; }

    const reporter = new EmailReporter();
    await reporter._sendEmail(iterations, subjectPrefixOverride || 'WB Smoke Test Report (Batch)');
  }
}

module.exports = EmailReporter;
module.exports.EmailReporter = EmailReporter;