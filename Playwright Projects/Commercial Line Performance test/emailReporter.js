// emailReporter.js
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const XLSX       = require('xlsx');

class EmailReporter {
  constructor(options) {
    this.options    = options || {};
    this.suiteLabel = null;
    this.runId      = null;
  }

  _detectSuite() {
    const s = (process.env.TEST_TYPE || '').toUpperCase();
    if (s === 'BOP')     return 'BOP';
    if (s === 'PACKAGE') return 'Package';
    if (s === 'CA')      return 'CA';
    return 'Package';
  }

  _getSuiteLabel() {
    if (!this.suiteLabel) this.suiteLabel = this._detectSuite();
    return this.suiteLabel;
  }

  _isBatchRun(suiteLC) {
    return fs.existsSync(path.join(__dirname, `.batch-run-in-progress-${suiteLC}`)) ||
           fs.existsSync(path.join(__dirname, '.batch-run-in-progress'));
  }

  onBegin() {
    const suite    = this._getSuiteLabel();
    const suiteLC  = suite.toLowerCase();
    const lockFile = path.join(__dirname, `parallel-run-lock-${suiteLC}.json`);

    if (this._isBatchRun(suiteLC)) {
      let lockData = {};
      if (fs.existsSync(lockFile)) {
        try { lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8')); } catch (_) {}
      }
      this.runId = lockData.runId || new Date().toISOString();
      console.log(`[EmailReporter] Batch run, shared runId: ${this.runId}`);
    } else {
      // Solo run - clear shared iter file
      const iterFile = path.join(__dirname, `iterations-data-${suiteLC}.json`);
      if (fs.existsSync(iterFile)) fs.unlinkSync(iterFile);
      this.runId = new Date().toISOString();
      console.log(`[EmailReporter] Solo run, runId: ${this.runId}`);
    }
  }

  onTestEnd(test, result) {
    try {
      const suite     = this._getSuiteLabel();
      const suiteLC   = suite.toLowerCase();
      const testState = (process.env.TEST_STATE || '').toUpperCase();

      console.log(`onTestEnd: suite=${suite}, state=${testState}, runId=${this.runId}, result=${result.status}`);

      const stateFile    = testState ? path.join(__dirname, `test-data-${testState}.json`) : null;
      const fallback     = path.join(__dirname, 'test-data.json');
      const testDataFile = stateFile && fs.existsSync(stateFile) ? stateFile : fallback;

      if (!fs.existsSync(testDataFile)) {
        console.log(`[EmailReporter] No test data file: ${testDataFile}`);
        return;
      }

      const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));

      // Trust policyNumber over Playwright result status
      const hasPolicyNumber    = testData.policyNumber && testData.policyNumber !== 'N/A';
      const hasFailedMilestone = Array.isArray(testData.milestones) &&
        testData.milestones.some(m => (m.status || '').toUpperCase() === 'FAILED');
      let status = result.status.toUpperCase();
      if (!hasFailedMilestone && hasPolicyNumber) status = 'PASSED';

      const entry = {
        iterationNumber : 1,
        status,
        state           : testData.state    || testState || 'N/A',
        stateName       : testData.stateName || 'N/A',
        quoteNumber     : testData.quoteNumber  || 'N/A',
        policyNumber    : testData.policyNumber || 'N/A',
        milestones      : testData.milestones           || [],
        coverageChanges : testData.coverageChanges      || [],
        coverageSectionStats: testData.coverageSectionStats || [],
        addCoverageTimings  : testData.addCoverageTimings   || [],
        timestamp       : new Date().toISOString(),
        duration        : Array.isArray(testData.milestones)
          ? testData.milestones.reduce((s, m) => s + parseFloat(m.duration || 0), 0).toFixed(2)
          : '0',
        runId : this.runId,
        suite,
      };

      // KEY FIX: write to a per-state file, NOT the shared iterations file
      // This eliminates all parallel write conflicts between states
      const stateKey     = (testData.state || testState || 'UNKNOWN').toUpperCase();
      const stateIterFile = path.join(__dirname, `iterations-data-${suiteLC}-${stateKey}.json`);
      fs.writeFileSync(stateIterFile, JSON.stringify([entry], null, 2));
      console.log(`Saved state iteration: ${stateIterFile} (${status})`);

    } catch (e) {
      console.log('onTestEnd error:', e.message);
    }
  }

  async onEnd() {
    const suite   = this._getSuiteLabel();
    const suiteLC = suite.toLowerCase();

    if (this._isBatchRun(suiteLC)) {
      console.log('[EmailReporter] Batch marker present - skipping individual state email');
      return;
    }

    // Solo run - merge state files and send
    await this._mergeAndSend(suiteLC, `WB ${suite} Smoke Test Report`);
  }

  // Merge per-state files into the shared iterations file and return all iterations
  static _mergeStateFiles(suiteLC, runId) {
    const dir = __dirname;
    const pattern = new RegExp(`^iterations-data-${suiteLC}-([A-Z]+)\\.json$`);
    const stateFiles = fs.readdirSync(dir).filter(f => pattern.test(f));

    console.log(`Merging ${stateFiles.length} state file(s) for suite: ${suiteLC}`);

    let iterations = [];
    for (const file of stateFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const matching = runId ? data.filter(it => it.runId === runId) : data;
        if (matching.length) {
          iterations = iterations.concat(matching);
          console.log(`  ${file}: ${matching.length} iteration(s) (state: ${matching[0].state})`);
        } else {
          console.log(`  ${file}: no iterations matching runId ${runId}`);
        }
      } catch (e) {
        console.log(`  ${file}: read error - ${e.message}`);
      }
    }

    // Sort by state name for consistent ordering
    iterations.sort((a, b) => (a.state || '').localeCompare(b.state || ''));

    // Write merged file for reference/debugging
    const mergedFile = path.join(dir, `iterations-data-${suiteLC}.json`);
    fs.writeFileSync(mergedFile, JSON.stringify(iterations, null, 2));
    console.log(`Merged ${iterations.length} total iteration(s) into ${mergedFile}`);

    return iterations;
  }

  async _mergeAndSend(suiteLC, subjectPrefix) {
    const lockFile = path.join(__dirname, `parallel-run-lock-${suiteLC}.json`);
    let runId = this.runId;
    if (!runId && fs.existsSync(lockFile)) {
      try { runId = JSON.parse(fs.readFileSync(lockFile, 'utf-8')).runId; } catch (_) {}
    }

    const iterations = EmailReporter._mergeStateFiles(suiteLC, runId);
    if (!iterations.length) { console.log('No iterations to email'); return; }

    await this._sendEmail(iterations, subjectPrefix);
  }

  // ── Average milestone table ───────────────────────────────────────────────
  _buildAverageMilestoneTable(iterations) {
    const map = new Map();
    iterations.forEach(it => {
      (it.milestones || []).forEach(m => {
        if (!m.name) return;
        if (!map.has(m.name)) map.set(m.name, { durations: [], statuses: [] });
        const dur = parseFloat(m.duration) || 0;
        map.get(m.name).durations.push(dur);
        map.get(m.name).statuses.push((m.status || 'N/A').toUpperCase());
      });
    });

    if (map.size === 0) return '<p style="color:#999;">No milestone data available.</p>';

    const rows = Array.from(map.entries()).map(([name, data], idx) => {
      const avg     = (data.durations.reduce((s,d) => s+d, 0) / data.durations.length).toFixed(2);
      const minD    = Math.min(...data.durations).toFixed(2);
      const maxD    = Math.max(...data.durations).toFixed(2);
      const allPass = data.statuses.every(s => s === 'PASSED');
      const color   = allPass ? '#4CAF50' : '#f44336';
      const bg      = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
      return `
        <tr style="background:${bg};">
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;">${idx+1}</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;">${name}</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;text-align:right;">${avg}s</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;text-align:right;">${minD}s</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;text-align:right;">${maxD}s</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;">${data.durations.length}</td>
          <td style="padding:9px 12px;border:1px solid #ddd;font-size:12px;font-weight:bold;color:${color};">${allPass ? 'PASSED' : 'MIXED'}</td>
        </tr>`;
    }).join('');

    return `
      <table style="width:100%;border-collapse:collapse;margin:10px 0;">
        <thead>
          <tr style="background:#1976d2;color:white;">
            <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;">#</th>
            <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;">Milestone</th>
            <th style="padding:9px 12px;text-align:right;border:1px solid #ddd;font-size:11px;">Avg</th>
            <th style="padding:9px 12px;text-align:right;border:1px solid #ddd;font-size:11px;">Min</th>
            <th style="padding:9px 12px;text-align:right;border:1px solid #ddd;font-size:11px;">Max</th>
            <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;">States</th>
            <th style="padding:9px 12px;text-align:left;border:1px solid #ddd;font-size:11px;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async _sendEmail(iterations, subjectPrefix) {
    const passed      = iterations.filter(it => it.status === 'PASSED').length;
    const failed      = iterations.length - passed;
    const overallPass = failed === 0;
    const totalDur    = iterations.reduce((s, it) => s + parseFloat(it.duration || 0), 0).toFixed(2);

    const stateRows = iterations.map((it, idx) => {
      const color = it.status === 'PASSED' ? '#4CAF50' : '#f44336';
      const icon  = it.status === 'PASSED' ? '&#10003;' : '&#10007;';
      return `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f5f5f5'};">
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.state}</td>
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.stateName}</td>
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.quoteNumber}</td>
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.policyNumber}</td>
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;">${it.duration}s</td>
          <td style="padding:10px;border:1px solid #ddd;font-size:12px;font-weight:bold;color:${color};">${icon} ${it.status}</td>
        </tr>`;
    }).join('');

    const detailHtml = iterations.map(it => {
      const sc   = it.status === 'PASSED' ? '#4CAF50' : '#f44336';
      const icon = it.status === 'PASSED' ? '&#10003;' : '&#10007;';
      const rows = (it.milestones || []).map((m, i) => {
        const mc = (m.status || '').toUpperCase() === 'PASSED' ? '#4CAF50' : '#f44336';
        return `
          <tr style="background:${i%2===0?'#fff':'#f8f9fa'};">
            <td style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">${i+1}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">${m.name||'-'}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;font-size:11px;color:${mc};font-weight:bold;">${m.status||'-'}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;font-size:11px;text-align:right;">${m.duration||'-'}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;font-size:11px;color:#666;">${m.details||'-'}</td>
          </tr>`;
      }).join('');
      return `
        <div style="margin:16px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
          <div style="background:${sc};padding:10px 16px;">
            <span style="color:white;font-size:13px;font-weight:bold;">
              ${icon} ${it.suite||'Test'} | ${it.state} (${it.stateName}) | Quote: ${it.quoteNumber} | Policy: ${it.policyNumber} | ${it.duration}s
            </span>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">#</th>
                <th style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">Milestone</th>
                <th style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">Status</th>
                <th style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">Duration</th>
                <th style="padding:8px 12px;border:1px solid #ddd;font-size:11px;">Details</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="5" style="padding:8px;color:#999;">No milestone data</td></tr>'}</tbody>
          </table>
        </div>`;
    }).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto;">
        <h1 style="color:#1976d2;">WB ${subjectPrefix}</h1>
        <div style="background:#f5f5f5;padding:15px;margin:15px 0;border-radius:5px;border-left:4px solid #1976d2;">
          <h3 style="margin-top:0;">Test Summary</h3>
          <p><b>Overall:</b> ${overallPass ? 'ALL PASSED' : 'SOME FAILED'}</p>
          <p><b>States Run:</b> ${iterations.length} &nbsp;|&nbsp;
             <b>Passed:</b> <span style="color:green;font-weight:bold;">${passed}</span> &nbsp;|&nbsp;
             <b>Failed:</b> <span style="color:red;font-weight:bold;">${failed}</span></p>
          <p><b>Total Duration:</b> ${totalDur}s</p>
        </div>
        <h2 style="color:#333;margin-top:24px;">Results by State</h2>
        <table style="width:100%;border-collapse:collapse;margin:10px 0;">
          <thead>
            <tr style="background:#1976d2;color:white;">
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">State</th>
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">State Name</th>
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">Quote #</th>
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">Policy #</th>
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">Duration</th>
              <th style="padding:12px;text-align:left;border:1px solid #ddd;">Status</th>
            </tr>
          </thead>
          <tbody>${stateRows}</tbody>
        </table>
        <h2 style="color:#333;margin-top:30px;">Average Milestone Timings (All States)</h2>
        <p style="color:#666;font-size:12px;">Averaged across all ${iterations.length} state run(s).</p>
        ${this._buildAverageMilestoneTable(iterations)}
        <h2 style="color:#333;margin-top:30px;">Milestone Details (Per State)</h2>
        ${detailHtml || '<p style="color:#999;">No milestone data.</p>'}
      </div>`;

    const excelFile   = await this._createExcelReport(iterations);
    const attachments = excelFile ? [{ filename: path.basename(excelFile), path: excelFile }] : [];

    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('SMTP not configured; email skipped');
      return;
    }

    const transporter = nodemailer.createTransport({
      host  : process.env.SMTP_HOST,
      port  : Number(process.env.SMTP_PORT) || 25,
      secure: false,
      tls   : { rejectUnauthorized: false },
    });

    const today   = new Date().toLocaleDateString('en-US', { year:'numeric', month:'2-digit', day:'2-digit' });
    const subject = `WB ${subjectPrefix}: ${today} - ${passed} Passed, ${failed} Failed`;

    await transporter.sendMail({ from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL, subject, html, attachments });
    console.log(`Email sent: ${subject}`);
  }

  async _createExcelReport(iterations) {
    try {
      const excelPath = path.join(__dirname, `WB_Test_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
      const wb        = XLSX.utils.book_new();

      const summaryData = iterations.map(it => ({
        'State'        : it.state,
        'State Name'   : it.stateName,
        'Suite'        : it.suite,
        'Status'       : it.status,
        'Quote Number' : it.quoteNumber,
        'Policy Number': it.policyNumber,
        'Duration (s)' : it.duration,
        'Timestamp'    : it.timestamp,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Summary');

      const map = new Map();
      iterations.forEach(it => {
        (it.milestones || []).forEach(m => {
          if (!m.name) return;
          if (!map.has(m.name)) map.set(m.name, { durations: [], statuses: [] });
          map.get(m.name).durations.push(parseFloat(m.duration) || 0);
          map.get(m.name).statuses.push((m.status || '').toUpperCase());
        });
      });
      const avgData = Array.from(map.entries()).map(([name, data]) => ({
        'Milestone'        : name,
        'Avg Duration (s)' : (data.durations.reduce((s,d)=>s+d,0)/data.durations.length).toFixed(2),
        'Min (s)'          : Math.min(...data.durations).toFixed(2),
        'Max (s)'          : Math.max(...data.durations).toFixed(2),
        'States Run'       : data.durations.length,
        'Status'           : data.statuses.every(s=>s==='PASSED') ? 'PASSED' : 'MIXED',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(avgData), 'Avg_Milestones');

      const usedNames = new Set(wb.SheetNames);
      iterations.forEach(it => {
        const data = (it.milestones || []).map((m, i) => ({
          '#'           : i+1,
          'Milestone'   : m.name    || '-',
          'Status'      : m.status  || '-',
          'Duration (s)': m.duration|| '-',
          'Details'     : m.details || '-',
        }));
        const base = `${(it.suite||'Suite').replace(/[^A-Za-z0-9]/g,'_')}_${it.state}`.substring(0,31);
        let name = base; let suf = 2;
        while (usedNames.has(name)) name = `${base.substring(0,28)}_${suf++}`.substring(0,31);
        usedNames.add(name);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
      });

      XLSX.writeFile(wb, excelPath);
      return excelPath;
    } catch (e) {
      console.error('Excel creation failed:', e.message);
      return null;
    }
  }

  // Called by runner after all states finish
  static async sendBatchEmailReport(iterationFilesOverride, subjectPrefixOverride) {
    console.log('Sending consolidated batch email...');

    // Determine suite from the iteration files list
    const files = iterationFilesOverride || ['iterations-data-package.json'];
    const suiteLC = (files[0] || 'iterations-data-package.json')
      .replace('iterations-data-', '').replace('.json', '');

    // Read the lock file to get the shared runId
    const lockFile = path.join(__dirname, `parallel-run-lock-${suiteLC}.json`);
    let runId = null;
    if (fs.existsSync(lockFile)) {
      try { runId = JSON.parse(fs.readFileSync(lockFile, 'utf-8')).runId; } catch (_) {}
    }

    console.log(`Suite: ${suiteLC}, runId: ${runId}`);

    // Merge per-state files - this is the source of truth
    const iterations = EmailReporter._mergeStateFiles(suiteLC, runId);

    if (!iterations.length) {
      console.log('No iterations found - checking shared iter file as fallback...');
      // Fallback: try reading the shared file directly
      for (const file of files) {
        const fp = path.join(__dirname, file);
        if (!fs.existsSync(fp)) continue;
        try {
          const all      = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
          const runIds   = [...new Set(all.map(it => it.runId).filter(Boolean))].sort();
          const latest   = runIds.slice(-1)[0];
          const filtered = latest ? all.filter(it => it.runId === latest) : all;
          if (filtered.length) {
            console.log(`Fallback: using ${filtered.length} iterations from ${file}`);
            const reporter = new EmailReporter();
            await reporter._sendEmail(filtered, subjectPrefixOverride || 'WB Smoke Test Report');
            return;
          }
        } catch (_) {}
      }
      console.log('No iterations found for batch email');
      return;
    }

    console.log(`Sending email for ${iterations.length} state(s)...`);
    const reporter = new EmailReporter();
    await reporter._sendEmail(iterations, subjectPrefixOverride || 'WB Smoke Test Report');
  }
}

module.exports = EmailReporter;
module.exports.EmailReporter = EmailReporter;
