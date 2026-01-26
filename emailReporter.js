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

  // Detect suite type from environment or test file
  _detectSuite() {
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    if (suiteEnv === 'CA') return 'CA';
    return 'Package';
  }

  _getSuiteLabel() {
    if (!this.suiteLabel) {
      this.suiteLabel = this._detectSuite();
    }
    return this.suiteLabel;
  }

  // Playwright lifecycle hooks
  onBegin() {
    const suiteLabel = this._getSuiteLabel();
    const batchMarker = path.join(__dirname, '.batch-run-in-progress');
    const isBatchRun = fs.existsSync(batchMarker);
    const lockFile = path.join(__dirname, `parallel-run-lock-${suiteLabel.toLowerCase()}.json`);

    if (!isBatchRun) {
      // Single run: clear old data
      const iterFile = path.join(__dirname, `iterations-data-${suiteLabel.toLowerCase()}.json`);
      if (fs.existsSync(iterFile)) fs.unlinkSync(iterFile);
      this.runId = new Date().toISOString();
    } else {
      // Batch run: get or create shared runId
      let lockData = {};
      if (fs.existsSync(lockFile)) {
        lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      }
      if (!lockData.runId) lockData.runId = new Date().toISOString();
      fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
      this.runId = lockData.runId;
    }
  }

  onTestEnd(test, result) {
    try {
      const suite = this._getSuiteLabel();
      const testState = (process.env.TEST_STATE || '').toUpperCase();
      
      console.log(`🔍 onTestEnd called: suite=${suite}, state=${testState}, runId=${this.runId}, result=${result.status}`);
      
      // Read state-specific test data file
      const testDataFile = testState 
        ? path.join(__dirname, `test-data-${testState}.json`)
        : path.join(__dirname, 'test-data.json');
      
      console.log(`🔍 Looking for test data: ${testDataFile}, exists: ${fs.existsSync(testDataFile)}`);
      
      if (!fs.existsSync(testDataFile)) return;
      const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
      
      const iterFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);
      let iterations = fs.existsSync(iterFile) ? JSON.parse(fs.readFileSync(iterFile, 'utf-8')) : [];

      // Check for duplicate (same state+runId)
      const isDuplicate = iterations.some(it => it.state === testData.state && it.runId === this.runId);
      if (isDuplicate) {
        console.log(`⚠️ Duplicate skipped: state=${testData.state}, runId=${this.runId}`);
        return;
      }

      // Determine status: override if has policy but no failed milestones
      let status = result.status.toUpperCase();
      const hasFailedMilestones = Array.isArray(testData.milestones) && 
        testData.milestones.some(m => (m.status || '').toUpperCase() === 'FAILED');
      const hasPolicyNumber = testData.policyNumber && testData.policyNumber !== 'N/A';
      if (!hasFailedMilestones && hasPolicyNumber) status = 'PASSED';

      iterations.push({
        iterationNumber: iterations.length + 1,
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
      });

      fs.writeFileSync(iterFile, JSON.stringify(iterations, null, 2));
      console.log(`💾 Saved iteration ${iterations.length}: suite=${suite}, state=${testData.state}, quote=${testData.quoteNumber}`);
    } catch (e) {
      console.log('⚠️ onTestEnd error:', e.message);
    }
  }

  async onEnd() {
    // Skip if batch run (wrapper will send consolidated email)
    const batchMarker = path.join(__dirname, '.batch-run-in-progress');
    if (fs.existsSync(batchMarker)) {
      console.log('⏸️ Batch run detected; skipping individual email');
      return;
    }

    const suite = this._getSuiteLabel();
    const iterFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);
    
    console.log(`🔍 Looking for iterations file: ${iterFile}`);
    console.log(`🔍 File exists: ${fs.existsSync(iterFile)}`);
    console.log(`🔍 Current runId: ${this.runId}`);
    
    if (!fs.existsSync(iterFile)) {
      console.log('⚠️ No iterations to email');
      return;
    }

    const allIterations = JSON.parse(fs.readFileSync(iterFile, 'utf-8'));
    console.log(`🔍 Total iterations in file: ${Array.isArray(allIterations) ? allIterations.length : 'not an array'}`);
    
    const iterations = this.runId ? allIterations.filter(it => it.runId === this.runId) : allIterations;
    console.log(`🔍 Filtered iterations (runId filter): ${iterations.length}`);

    if (!iterations.length) {
      console.log('⚠️ No iterations for this runId, sending all available iterations instead');
      // Fall back to sending all iterations if runId doesn't match
      await this._sendEmail(allIterations, 'WB Smoke Testing Report');
      return;
    }

    await this._sendEmail(iterations, 'WB Smoke Testing Report');
  }

  // Send email with iterations data
  async _sendEmail(iterations, subjectPrefix) {
    const passed = iterations.filter(it => it.status === 'PASSED').length;
    const failed = iterations.length - passed;
    const overallPassed = failed === 0;

    // Build passed iterations table
    const passedIterations = iterations.filter(it => it.status === 'PASSED');
    const passedTableHtml = passedIterations.length > 0 ? `
      <h3 style="color:#4CAF50;margin-top:20px;">✅ Passed Iterations (${passedIterations.length})</h3>
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
          ${passedIterations.map((it, idx) => {
            const bg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
            const lobDisplay = `${it.suite || 'Package'} (${it.state || 'N/A'})`;
            return `
              <tr style="background:${bg};">
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">#${it.iterationNumber}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${lobDisplay}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.quoteNumber}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.policyNumber}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    ` : '';

    // Build failed iterations table
    const failedIterations = iterations.filter(it => it.status === 'FAILED');
    const failedTableHtml = failedIterations.length > 0 ? `
      <h3 style="color:#f44336;margin-top:20px;">❌ Failed Iterations (${failedIterations.length})</h3>
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
          ${failedIterations.map((it, idx) => {
            const bg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
            const lobDisplay = `${it.suite || 'Package'} (${it.state || 'N/A'})`;
            return `
              <tr style="background:${bg};">
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">#${it.iterationNumber}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${lobDisplay}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.quoteNumber}</td>
                <td style="padding:10px;border:1px solid #ddd;font-size:12px;color:#f44336;font-weight:bold;">FAILED</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    ` : '';

    const totalDuration = iterations.reduce((sum, it) => sum + parseFloat(it.duration || 0), 0).toFixed(2);

    // Build combined coverage changes and add coverage table
    const coverageDetailsHtml = iterations.map(it => {
      if ((!it.coverageChanges || it.coverageChanges.length === 0) && (!it.addCoverageTimings || it.addCoverageTimings.length === 0)) return '';
      
      // Aggregate coverage changes by section
      const sectionMap = {};
      if (it.coverageChanges && it.coverageChanges.length > 0) {
        it.coverageChanges.forEach(change => {
          if (!sectionMap[change.coverageSection]) {
            sectionMap[change.coverageSection] = {
              coverageSection: change.coverageSection,
              changes: [],
              totalDuration: 0,
              totalCount: 0
            };
          }
          const duration = parseFloat(change.durationSeconds || 0);
          sectionMap[change.coverageSection].changes.push(change);
          sectionMap[change.coverageSection].totalDuration += duration;
          sectionMap[change.coverageSection].totalCount++;
        });
      }
      
      // Create aggregated details (one entry per coverage section showing total time)
      const allDetails = [];
      Object.keys(sectionMap).forEach(sectionName => {
        const section = sectionMap[sectionName];
        allDetails.push({
          type: 'coverage_section',
          coverageSection: section.coverageSection,
          detail: `${section.totalCount} dropdown(s) updated`,
          status: 'Updated',
          duration: `${section.totalDuration.toFixed(2)}s`
        });
      });
      
      // Add coverage button timings (only add actions, not remove)
      if (it.addCoverageTimings && it.addCoverageTimings.length > 0) {
        it.addCoverageTimings.forEach(timing => {
          if (timing.action === 'Add Coverage') {
            allDetails.push({
              type: 'add_coverage',
              coverageSection: 'Commercial Auto',
              detail: `${timing.coverage || `Coverage #${timing.index}`}`,
              status: 'Added',
              duration: `${timing.duration}s`
            });
          }
        });
      }
      
      if (allDetails.length === 0) return '';
      
      const rows = allDetails.map((detail, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
        const statusColor = detail.status === 'Added' ? '#2196F3' : '#4CAF50';
        return `
          <tr style="background:${bg};">
            <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${detail.coverageSection}</td>
            <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${detail.detail}</td>
            <td style="padding:10px;border:1px solid #ddd;font-size:12px;color:${statusColor};font-weight:bold;">${detail.status}</td>
            <td style="padding:10px;border:1px solid #ddd;font-size:12px;text-align:center;">${detail.duration}</td>
          </tr>
        `;
      }).join('');
      
      return `
        <div style="margin:20px 0;page-break-inside:avoid;">
          <h3 style="color:#1976d2;margin-bottom:10px;">${it.suite} (${it.state}) - Coverage updates</h3>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#2196F3;color:white;">
                <th style="padding:10px;text-align:left;border:1px solid #ddd;font-size:12px;">Coverage Section</th>
                <th style="padding:10px;text-align:left;border:1px solid #ddd;font-size:12px;">Detail</th>
                <th style="padding:10px;text-align:center;border:1px solid #ddd;font-size:12px;">Status</th>
                <th style="padding:10px;text-align:center;border:1px solid #ddd;font-size:12px;">Time (s)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h1 style="color:#1976d2;">🎭 ${subjectPrefix}</h1>
        <div style="background:#f5f5f5;padding:15px;margin:15px 0;border-radius:5px;border-left:4px solid #1976d2;">
          <h3 style="margin-top:0;">📊 Test Summary</h3>
          <p><b>Overall Status:</b> ${overallPassed ? '✅ PASSED' : '❌ FAILED'}</p>
          <p><b>Total Iterations:</b> ${iterations.length}</p>
          <p><b>Passed:</b> <span style="color:green;font-weight:bold;">${passed}</span> &nbsp; <b>Failed:</b> <span style="color:red;font-weight:bold;">${failed}</span></p>
          <p><b>Test Duration:</b> ${totalDuration}s</p>
        </div>
        <h2 style="color:#333;margin-top:30px;">Iteration Details</h2>
        ${passedTableHtml}
        ${failedTableHtml}
        ${coverageDetailsHtml ? `<h2 style="color:#333;margin-top:30px;">Coverage updates</h2>${coverageDetailsHtml}` : ''}
      </div>
    `;

    const excelFile = await this._createExcelReport(iterations);
    const attachments = excelFile ? [{ filename: path.basename(excelFile), path: excelFile }] : [];

    // Check SMTP config
    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('⚠️ SMTP not configured; email skipped');
      if (excelFile) console.log('ℹ️ Excel generated at:', excelFile);
      return;
    }

    // Send email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 25,
      secure: false,
      tls: { rejectUnauthorized: false },
      auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } : undefined
    });

    const todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subjectLine = `${subjectPrefix}: ${todayDate} - ${passed} Passed, ${failed} Failed`;

    try {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: subjectLine,
        html,
        attachments
      });
      console.log('✔ Email sent successfully');
    } catch (err) {
      console.error('❌ Email send failed:', err.message);
      throw err;
    }
  }

  // Create Excel report
  async _createExcelReport(iterations) {
    try {
      const excelPath = path.join(__dirname, 'WB_Test_Report.xlsx');
      
      // Always start fresh to avoid sheet name collisions
      let targetWb = XLSX.utils.book_new();

      // Summary sheet with timestamp
      const summaryData = iterations.map(it => ({
        'Iteration #': it.iterationNumber,
        'Line of Business': `${it.suite || 'Package'} (${it.state || 'N/A'})`,
        'Quote Number': it.quoteNumber,
        'Policy Number': it.policyNumber,
        'Status': it.status,
        'Duration (s)': it.duration,
        'State': it.state
      }));
      const runTag = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
      const summarySheetName = (`Summary_${runTag}`).substring(0, 31);
      XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(summaryData), summarySheetName);

      // Milestones Analytics sheet - aggregate average times by milestone
      // Use a Map to preserve the order milestones are first encountered (tracking order)
      const milestoneAggregates = new Map();
      const passedIterations = iterations.filter(it => it.status === 'PASSED');
      
      passedIterations.forEach(it => {
        (it.milestones || []).forEach(m => {
          if (!m.name || m.status !== 'PASSED') return;
          if (!milestoneAggregates.has(m.name)) {
            milestoneAggregates.set(m.name, { totalDuration: 0, count: 0, runs: [] });
          }
          const duration = parseFloat(m.duration) || 0;
          const existing = milestoneAggregates.get(m.name);
          existing.totalDuration += duration;
          existing.count += 1;
          existing.runs.push({
            suite: it.suite || 'Package',
            state: it.state,
            duration: duration
          });
        });
      });

      // Convert Map to analytics data, preserving the order milestones were tracked
      const analyticsData = Array.from(milestoneAggregates.entries())
        .map(([milestoneName, data]) => ({
          'Milestone': milestoneName,
          'Average Duration (s)': (data.totalDuration / data.count).toFixed(2),
          'Min Duration (s)': Math.min(...data.runs.map(r => r.duration)).toFixed(2),
          'Max Duration (s)': Math.max(...data.runs.map(r => r.duration)).toFixed(2),
          'Total Runs': data.count,
          'Suites': [...new Set(data.runs.map(r => r.suite))].join(', '),
          'States': [...new Set(data.runs.map(r => r.state))].join(', ')
        }));
        // Removed .sort() to maintain tracking order

      const analyticsSheetName = ('Milestones_Analytics').substring(0, 31);
      XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(analyticsData), analyticsSheetName);

      // Coverage Changes Analytics sheet
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
        const coverageSheetName = ('Coverage_Changes').substring(0, 31);
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(coverageAnalyticsData), coverageSheetName);
      }

      // Coverage section timings sheet
      const coverageSectionData = [];
      iterations.forEach(it => {
        (it.coverageSectionStats || []).forEach(row => {
          coverageSectionData.push({
            'Quote Number': row.quoteNumber || 'N/A',
            'Coverage Section': row.coverageSection || 'N/A',
            'Dropdowns Updated': row.dropdownsUpdated || 0,
            'Duration (s)': row.durationSeconds || '0',
            'Suite': it.suite || 'N/A',
            'State': it.state || 'N/A',
            'Iteration': it.iterationNumber
          });
        });
      });
      if (coverageSectionData.length) {
        const sheetName = ('Coverage_Section_Timings').substring(0, 31);
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(coverageSectionData), sheetName);
      }

      // Add Coverage button timings sheet
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
        const sheetName = ('Add_Coverage_Timings').substring(0, 31);
        XLSX.utils.book_append_sheet(targetWb, XLSX.utils.json_to_sheet(addCoverageData), sheetName);
      }

      // Individual iteration sheets with unique names
      iterations.forEach(it => {
        const milestoneData = (it.milestones || []).map(m => ({
          'Milestone': m.name,
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Timestamp': m.timestamp || '-',
        }));
        const ws = XLSX.utils.json_to_sheet(milestoneData);
        // Create unique sheet name: Suite_State_IterNum_Timestamp
        const sheetBase = `${(it.suite || 'Suite').replace(/[^A-Za-z0-9]/g, '_')}_${it.state || 'N_A'}_${it.iterationNumber}`;
        let sheetName = sheetBase.substring(0, 31);
        // If name is exactly 31 chars, append run tag to ensure uniqueness
        if (sheetName.length === 31) {
          sheetName = `${(it.suite || 'Suite').substring(0, 8)}_${(it.state || 'N_A').substring(0, 4)}_${it.iterationNumber}_${runTag.slice(0, 5)}`.substring(0, 31);
        }
        XLSX.utils.book_append_sheet(targetWb, ws, sheetName);
      });

      XLSX.writeFile(targetWb, excelPath);
      return excelPath;
    } catch (e) {
      console.error('⚠️ Failed to create Excel:', e.message);
      return null;
    }
  }

  // Static method for batch email (called by wrapper scripts)
  static async sendBatchEmailReport(iterationFilesOverride, subjectPrefixOverride) {
    console.log('📨 Sending consolidated batch email...');
    let iterations = [];

    const iterationFiles = iterationFilesOverride || ['iterations-data-bop.json', 'iterations-data-package.json'];

    for (const file of iterationFiles) {
      const fp = path.join(__dirname, file);
      if (!fs.existsSync(fp)) continue;
      
      const allIterations = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
      if (!allIterations.length) continue;
      
      // Get latest runId and filter
      const runIds = allIterations.map(it => it.runId).filter(Boolean);
      const latestRunId = runIds.length ? runIds.sort().slice(-1)[0] : null;
      const filtered = latestRunId ? allIterations.filter(it => it.runId === latestRunId) : allIterations;
      
      console.log(`   ${file}: ${allIterations.length} total, using ${filtered.length} from runId ${latestRunId || 'N/A'}`);
      iterations = iterations.concat(filtered);
    }

    if (!iterations.length) {
      console.log('⚠️ No iterations found');
      return;
    }

    const reporter = new EmailReporter();
    await reporter._sendEmail(iterations, subjectPrefixOverride || 'WB Smoke Test Report (Batch)');
  }
}

module.exports = EmailReporter;
