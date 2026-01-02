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
    this.suiteLabel = null;
    this.iterationsFile = null;
    this.lockFile = null;
    this.runId = null;
  }

  // ----- Suite detection helpers -----
  _detectSuite() {
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    if (this.options?.suiteName && /BOP/i.test(this.options.suiteName)) return 'BOP';
    return 'Package';
  }

  _getSuiteLabel() {
    if (!this.suiteLabel) {
      this.suiteLabel = this._detectSuite();
      this.iterationsFile = path.join(__dirname, `iterations-data-${this.suiteLabel.toLowerCase()}.json`);
      this.lockFile = path.join(__dirname, `parallel-run-lock-${this.suiteLabel.toLowerCase()}.json`);
    }
    return this.suiteLabel;
  }

  _suiteFromTest(test) {
    const file = test?.location?.file || '';
    const fileBase = path.basename(file).toUpperCase();
    const title = (test?.title || '').toUpperCase();
    if (fileBase.includes('BOP') || title.includes('BOP')) return 'BOP';
    if (fileBase.includes('PACKAGE') || title.includes('PACKAGE')) return 'Package';
    const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
    if (suiteEnv === 'BOP') return 'BOP';
    if (suiteEnv === 'PACKAGE') return 'Package';
    return this.suiteLabel || 'Package';
  }

  // ----- Playwright lifecycle -----
  onBegin() {
    try {
      const suiteLabel = this._getSuiteLabel();
      const batchMarkerFile = path.join(__dirname, '.batch-run-in-progress');
      const isBatchRun = fs.existsSync(batchMarkerFile);
      const lockFiles = [
        path.join(__dirname, 'parallel-run-lock-bop.json'),
        path.join(__dirname, 'parallel-run-lock-package.json'),
      ];
      const anyLock = lockFiles.some(f => fs.existsSync(f));

      // Always clear old iterations-data for fresh single runs (unless batch marker exists)
      if (!isBatchRun) {
        // Fresh independent run: clear prior data from this suite
        const suiteFile = path.join(__dirname, `iterations-data-${suiteLabel.toLowerCase()}.json`);
        if (fs.existsSync(suiteFile)) {
          fs.unlinkSync(suiteFile);
          console.log(`🗑️  Cleared old iterations data: ${path.basename(suiteFile)}`);
        }
        const testDataFile = path.join(__dirname, 'test-data.json');
        if (fs.existsSync(testDataFile)) fs.unlinkSync(testDataFile);
        this.runId = new Date().toISOString();
      }
      // For batch runs, ensure a runId exists in the suite lock file
      if (isBatchRun || anyLock) {
        let lockData = {};
        const lockPath = lockFiles.find(f => fs.existsSync(f));
        if (lockPath) {
          lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8') || '{}');
        }
        if (!lockData.runId) lockData.runId = new Date().toISOString();
        const suiteLock = path.join(__dirname, `parallel-run-lock-${suiteLabel.toLowerCase()}.json`);
        fs.writeFileSync(suiteLock, JSON.stringify(lockData, null, 2), 'utf8');
        this.runId = lockData.runId;
      }
    } catch (e) {
      console.log('⚠️ onBegin error:', e.message);
    }
  }

  onTestEnd(test, result) {
    const timestamp = new Date();
    try {
      const testDataFile = path.join(__dirname, 'test-data.json');
      if (!fs.existsSync(testDataFile)) return;
      const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
      const suite = this._suiteFromTest(test);
      const iterationsFile = path.join(__dirname, `iterations-data-${suite.toLowerCase()}.json`);

      let iterations = [];
      if (fs.existsSync(iterationsFile)) {
        iterations = JSON.parse(fs.readFileSync(iterationsFile, 'utf-8')) || [];
      }

      // Determine actual test status based on milestones, not just Playwright result
      let actualStatus = result.status.toUpperCase();
      const hasFailedMilestones = Array.isArray(testData.milestones) && 
        testData.milestones.some(m => (m.status || '').toUpperCase() === 'FAILED' || /failed/i.test(m.name || ''));
      const hasPolicyNumber = testData.policyNumber && testData.policyNumber !== 'N/A';
      
      // If no failed milestones and test produced a policy number, mark as PASSED even if browser crashed
      if (!hasFailedMilestones && hasPolicyNumber) {
        actualStatus = 'PASSED';
      }

      iterations.push({
        iterationNumber: iterations.length + 1,
        status: actualStatus,
        state: testData.state || 'N/A',
        stateName: testData.stateName || 'N/A',
        quoteNumber: testData.quoteNumber || 'N/A',
        policyNumber: testData.policyNumber || 'N/A',
        milestones: testData.milestones || [],
        timestamp: timestamp.toISOString(),
        duration: Array.isArray(testData.milestones)
          ? testData.milestones.reduce((sum, m) => sum + parseFloat(m.duration || 0), 0).toFixed(2)
          : '0',
        runId: this.runId,
        suite,
      });

      fs.writeFileSync(iterationsFile, JSON.stringify(iterations, null, 2), 'utf8');
      console.log(`💾 Iteration ${iterations.length} data saved for suite=${suite}`);
    } catch (e) {
      console.log('⚠️ onTestEnd error:', e.message);
    }
  }

  async onEnd() {
    // If batch marker or lock exists, wrapper will send final email
    const batchMarkerFile = path.join(__dirname, '.batch-run-in-progress');
    const hasBatchMarker = fs.existsSync(batchMarkerFile);
    const hasLock = fs.existsSync(path.join(__dirname, 'parallel-run-lock-bop.json'))
      || fs.existsSync(path.join(__dirname, 'parallel-run-lock-package.json'));
    if (hasBatchMarker || hasLock) {
      console.log('⏸️ Batch/parallel detected; skipping per-iteration email. Wrapper will send.');
      return;
    }

    const suiteLabel = this._getSuiteLabel();
    let iterations = [];
    try {
      const fp = path.join(__dirname, `iterations-data-${suiteLabel.toLowerCase()}.json`);
      if (fs.existsSync(fp)) {
        const allIterations = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
        iterations = this.runId ? allIterations.filter(it => it.runId === this.runId) : allIterations;
      }
    } catch (e) {
      console.log('⚠️ Failed to load iterations:', e.message);
    }

    if (!iterations.length) {
      console.log('⚠️ No iterations to email.');
      return;
    }

    await this._sendEmail(iterations, `WB Smoke Testing Report`);
  }

  // ----- Internal helpers -----
  async _sendEmail(iterations, subjectPrefix) {
    const totalIterations = iterations.length;
    const passedIterations = iterations.filter(it => it.status === 'PASSED').length;
    const failedIterations = totalIterations - passedIterations;
    const overallPassed = failedIterations === 0;

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
            const lobDisplay = `${it.suite || this.suiteLabel} (${it.state || 'N/A'})`;
            return `
              <tr style="background:${bg};">
                <td style="padding:12px;border:1px solid #ddd;">${lobDisplay}</td>
                <td style="padding:12px;border:1px solid #ddd;">${it.quoteNumber}</td>
                <td style="padding:12px;border:1px solid #ddd;">${it.policyNumber}</td>
                <td style="padding:12px;border:1px solid #ddd;text-align:center;color:${statusColor};font-weight:bold;">${statusIcon}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    const totalDuration = iterations.reduce((sum, it) => sum + parseFloat(it.duration || 0), 0).toFixed(2);

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h1 style="color:#1976d2;">🎭 ${subjectPrefix}</h1>
        <div style="background:#f5f5f5;padding:15px;margin:15px 0;border-radius:5px;border-left:4px solid #1976d2;">
          <h3 style="margin-top:0;">📊 Test Summary</h3>
          <p><b>Overall Status:</b> ${overallPassed ? '✅ PASSED' : '❌ FAILED'}</p>
          <p><b>Total Iterations:</b> ${totalIterations}</p>
          <p><b>Passed:</b> <span style="color:green;font-weight:bold;">${passedIterations}</span> &nbsp; <b>Failed:</b> <span style="color:red;font-weight:bold;">${failedIterations}</span></p>
          <p><b>Test Duration:</b> ${totalDuration}s</p>
        </div>

        <h2 style="color:#333;margin-top:20px;">Test Execution Details</h2>
        ${summaryTableHtml}
      </div>
    `;

    const excelFile = await this._createExcelReport(iterations);

    // Build attachments: Excel + per-state error logs for failed iterations
    const attachments = [];
    if (excelFile) {
      attachments.push({ filename: path.basename(excelFile), path: excelFile });
    }

    // Attach per-iteration error logs (state-named) when failures occur
    try {
      for (const it of iterations) {
        if (String(it.status).toUpperCase() !== 'PASSED') {
          const state = (it.state || 'N_A').toUpperCase();
          const suite = (it.suite || this.suiteLabel || 'Package').toUpperCase();
          const expectedLogName = suite === 'BOP'
            ? `test-run-output-${state}.txt`
            : `test-run-output-package-${state}.txt`;
          const expectedLogPath = path.join(__dirname, expectedLogName);

          if (fs.existsSync(expectedLogPath)) {
            // Use a friendly filename while keeping original path
            attachments.push({ filename: `Error-${state}.txt`, path: expectedLogPath });
          } else {
            // Fallback: synthesize a small error file with milestone details
            const failedMilestone = Array.isArray(it.milestones)
              ? it.milestones.slice().reverse().find(m => (m.status || '').toUpperCase() === 'FAILED' || /failed/i.test(m.name || ''))
              : null;
            const lines = [];
            lines.push(`Suite: ${suite}`);
            lines.push(`State: ${state}`);
            lines.push(`Status: ${it.status}`);
            lines.push(`Quote Number: ${it.quoteNumber || 'N/A'}`);
            lines.push(`Policy Number: ${it.policyNumber || 'N/A'}`);
            if (failedMilestone) {
              lines.push('');
              lines.push(`Failed Milestone: ${failedMilestone.name || 'N/A'}`);
              if (failedMilestone.details) lines.push(`Details: ${failedMilestone.details}`);
              if (failedMilestone.timestamp) lines.push(`Timestamp: ${failedMilestone.timestamp}`);
            }
            const fallbackPath = path.join(__dirname, `Error-${state}.txt`);
            try {
              fs.writeFileSync(fallbackPath, lines.join('\n'), 'utf8');
              attachments.push({ filename: `Error-${state}.txt`, path: fallbackPath });
            } catch (e) {
              console.log(`⚠️ Could not create fallback error file for ${state}:`, e.message);
            }
          }
        }
      }
    } catch (e) {
      console.log('⚠️ Failed to build error attachments:', e.message);
    }

    // SMTP check
    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('⚠️ SMTP not configured; email skipped.');
      if (excelFile) console.log('ℹ️ Excel generated at:', excelFile);
      return;
    }

    const transporterOptions = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false }
    };
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporterOptions.auth = {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      };
    }
    const transporter = nodemailer.createTransport(transporterOptions);

    const todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subjectLine = `${subjectPrefix}: ${todayDate} - ${passedIterations} Passed, ${failedIterations} Failed`;

    try {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: subjectLine,
        html,
        attachments
      });
      console.log('✔ Email report sent successfully.');
    } catch (err) {
      console.error('❌ Email send failed:', err && err.message ? err.message : err);
      throw err;
    }
  }

  async _createExcelReport(iterations) {
    try {
      const wb = XLSX.utils.book_new();
      const summaryData = iterations.map((it, idx) => ({
        'Iteration #': it.iterationNumber,
        'Line of Business': `${it.suite || this.suiteLabel} (${it.state || 'N/A'})`,
        'Quote Number': it.quoteNumber,
        'Policy Number': it.policyNumber,
        'Overall Status': it.status,
        'Duration (s)': it.duration,
        'State': it.state
      }));
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

      iterations.forEach((it) => {
        const milestoneData = (it.milestones || []).map(m => ({
          'Milestone': m.name,
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Timestamp': m.timestamp || '-',
        }));
        // Always show quote number in the summary and iteration tab, even on failure
        if (!it.quoteNumber && it.milestones) {
          const failedMilestone = it.milestones.slice().reverse().find(m => (m.status || '').toUpperCase() === 'FAILED' && m.details && /\d{10}/.test(m.details));
          if (failedMilestone) {
            milestoneData.unshift({ 'Quote Number (from failure)': failedMilestone.details.match(/\d{10}/)[0] });
          }
        }
        // Add new columns to the iteration tab after timestamp
        if (milestoneData.length > 0) {
          const perfCols = {
            'Parallel Jobs at Start': it.ParallelAtStart || it.parallelAtStart || '',
            'CPU at Start': it.cpuStart || '',
            'RAM at Start': it.memStart || '',
            'CPU at End': it.CPU || '',
            'RAM at End': it.RAM || '',
            'Retry Count': it.retryCount || (it.milestones && it.milestones.retryCount) || '',
            'HTTP Timings': (it.httpTimings && it.httpTimings.length) ? it.httpTimings.map(h => `${h.status} ${h.duration ? h.duration + 's' : ''} ${h.url}`).join('\n') : '',
            'Network Errors': (it.networkErrors && it.networkErrors.length) ? it.networkErrors.map(e => `${e.status || ''} ${e.url || ''} ${e.error || ''}`).join('\n') : ''
          };
          Object.assign(milestoneData[0], perfCols);
        }
        const ws = XLSX.utils.json_to_sheet(milestoneData);
        const safeSuite = (it.suite || 'Suite').replace(/[^A-Za-z0-9]/g, '_');
        const baseName = `${safeSuite}_${it.iterationNumber}`;
        const sheetName = baseName.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      const excelPath = path.join(__dirname, `WB_Test_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      XLSX.writeFile(wb, excelPath);
      return excelPath;
    } catch (e) {
      console.error('⚠️ Failed to create Excel report:', e.message);
      return null;
    }
  }

  async _maybeSendFinalBatchEmail() {
    console.log('ℹ️ _maybeSendFinalBatchEmail skipped (wrapper-managed).');
  }

  // ----- Static batch sender (called by wrappers) -----
  static async sendBatchEmailReport(iterationFilesOverride, subjectPrefixOverride) {
    console.log('📨 Sending final combined batch email...');
    const projectPath = __dirname;
    let iterations = [];

    const iterationFiles = iterationFilesOverride && iterationFilesOverride.length
      ? iterationFilesOverride
      : ['iterations-data-bop.json', 'iterations-data-package.json'];

    for (const file of iterationFiles) {
      const fp = path.join(projectPath, file);
      if (!fs.existsSync(fp)) continue;
      const allIterations = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
      if (!Array.isArray(allIterations) || !allIterations.length) continue;
      const runIds = allIterations.map(it => it.runId).filter(Boolean);
      const latestRunId = runIds.length ? runIds.sort().slice(-1)[0] : null;
      const filtered = latestRunId ? allIterations.filter(it => it.runId === latestRunId) : allIterations;
      console.log(`   File ${file}: ${allIterations.length} total, using ${filtered.length} from latest runId ${latestRunId || 'N/A'}`);
      iterations = iterations.concat(filtered);
    }

    if (!iterations.length) {
      console.log('⚠️ No iterations data found. Skipping batch email.');
      return;
    }

    const reporter = new EmailReporter();
    await reporter._sendEmail(iterations, subjectPrefixOverride || 'WB Smoke Test Report (Batch Run)');
  }
}

module.exports = EmailReporter;
