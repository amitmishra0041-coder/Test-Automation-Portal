require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

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
    // fallback: infer from test titles or default to Package
    if (this.options?.suiteName && /BOP/i.test(this.options.suiteName)) return 'BOP';
    return 'Package';
  }

  onBegin() {
    // In parallel runs, the orchestrator (PowerShell) initializes/cleans files.
    // Only clear files when no lock file exists (single-run scenarios).
    try {
      if (!fs.existsSync(this.lockFile)) {
        if (fs.existsSync(this.iterationsFile)) {
          fs.unlinkSync(this.iterationsFile);
          console.log('🗑️ Cleared previous iterations data (single run)');
        }
        const testDataFile = path.join(__dirname, 'test-data.json');
        if (fs.existsSync(testDataFile)) {
          fs.unlinkSync(testDataFile);
          console.log('🗑️ Cleared previous test-data.json (single run)');
        }
        this.runId = new Date().toISOString();
      } else {
        console.log('🔒 Lock file present; skipping cleanup (parallel run)');
        // Ensure a shared runId exists in the lock file so all parallel workers tag iterations consistently
        try {
          let lockData = {};
          if (fs.existsSync(this.lockFile)) {
            lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8')) || {};
          }
          if (!lockData.runId) {
            lockData.runId = new Date().toISOString();
            fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2), 'utf8');
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
        
        // Load existing iterations
        let iterations = [];
        if (fs.existsSync(this.iterationsFile)) {
          iterations = JSON.parse(fs.readFileSync(this.iterationsFile, 'utf-8'));
        }
        
        // Add this iteration's data (tag with runId and suite to scope to current run)
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
          suite: this.suiteLabel
        });
        
        // Save updated iterations
        fs.writeFileSync(this.iterationsFile, JSON.stringify(iterations, null, 2), 'utf8');
        console.log(`💾 Iteration ${iterations.length} data saved`);
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

    // Load iterations only for current run and suite; otherwise prefer test-data
    let iterations = [];
    try {
      if (fs.existsSync(this.iterationsFile)) {
        const allIterations = JSON.parse(fs.readFileSync(this.iterationsFile, 'utf-8'));
        let lockData = {};
        try {
          lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8')) || {};
        } catch {}
        const activeRunId = lockData.runId || this.runId;
        iterations = Array.isArray(allIterations)
          ? allIterations.filter(it => it.runId === activeRunId && it.suite === this.suiteLabel)
          : [];
        console.log(`📂 Loaded ${iterations.length} iteration(s) for runId=${activeRunId}, suite=${this.suiteLabel}`);
      }
    } catch (e) {
      console.log('⚠️ Failed to read iterations file:', e.message);
    }

    // Fallback: if no iterations recorded (e.g., single test run edge-case),
    // attempt to read current test-data.json directly so milestones still render
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

    // Check if this is a parallel run with multiple states
    const currentState = process.env.TEST_STATE;
    let targetStates = ['DE', 'PA', 'WI', 'OH', 'MI'];
    if (fs.existsSync(this.lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8'));
        if (Array.isArray(lockData.targetStates) && lockData.targetStates.length > 0) {
          targetStates = lockData.targetStates;
        }
      } catch (e) {
        console.log('⚠️ Failed to read lock file for targetStates:', e.message);
      }
    }

    if (currentState && targetStates.includes(currentState)) {
      console.log(`🔄 Parallel run detected for state: ${currentState}`);

      // Update lock file with completed state and send email only when all targetStates complete
      try {
        let lockData = { targetStates, completedStates: [], startTime: new Date().toISOString() };
        if (fs.existsSync(this.lockFile)) {
          lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8'));
          if (!Array.isArray(lockData.targetStates) || lockData.targetStates.length === 0) {
            lockData.targetStates = targetStates;
          }
          if (!Array.isArray(lockData.completedStates)) {
            lockData.completedStates = [];
          }
        }

        if (!lockData.completedStates.includes(currentState)) {
          lockData.completedStates.push(currentState);
          fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2), 'utf8');
          console.log(`✅ State ${currentState} marked as complete. Total completed: ${lockData.completedStates.length}/${lockData.targetStates.length}`);
        }

        const remaining = lockData.targetStates.filter(s => !lockData.completedStates.includes(s));
        if (remaining.length > 0) {
          console.log(`⏳ Waiting for remaining states: ${remaining.join(', ')}`);
          console.log('📧 Email will be sent after all target states complete');
          return; // Skip sending email
        }

        console.log('🎉 All target states completed! Sending consolidated email report...');
        try {
          fs.unlinkSync(this.lockFile);
          console.log('🗑️ Lock file cleaned up');
        } catch (e) {
          console.log('⚠️ Could not delete lock file:', e.message);
        }
      } catch (e) {
        console.log('⚠️ Error managing lock file:', e.message);
        console.log('📧 Skipping email to avoid duplicates during parallel run');
        return; // Skip sending email if lock file has issues during parallel run
      }
    }

    // Prefer iteration-based aggregation when available (parallel runs)
    let total = this.results.length;
    let passed = this.results.filter(r => r.status === 'PASSED').length;
    let failed = total - passed;
    let overallPassed = failed === 0;

    if (iterations.length > 0) {
      // Derive overall from all iterations collected across states
      const itPassed = iterations.filter(it => it.status === 'PASSED').length;
      const itFailed = iterations.filter(it => it.status !== 'PASSED').length;
      total = iterations.length;
      passed = itPassed;
      failed = itFailed;
      overallPassed = itFailed === 0;
    }

    // Calculate average duration
    const avgDuration = iterations.length > 0 
      ? (iterations.reduce((sum, it) => sum + parseFloat(it.duration || 0), 0) / iterations.length).toFixed(2)
      : '0';

    // Build consolidated milestone table (explicit PASS/FAIL per milestone)
    let milestonesHtml = '';
    if (iterations.length > 0 && iterations[0].milestones && iterations[0].milestones.length > 0) {
      const isSingle = iterations.length === 1;
      if (isSingle) {
        const it = iterations[0];
        const allMilestoneNames = Array.from(new Set(it.milestones.map(m => m.name)));
        const rows = allMilestoneNames.map((name, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f1f8f4';
          const m = it.milestones.find(x => x.name === name) || {};
          const status = (m.status || '').toString().toUpperCase();
          const isPassed = status === 'PASSED';
          const isFailed = status === 'FAILED';
          const isSkipped = status === 'SKIPPED';
          const icon = isPassed ? '✅' : (isFailed ? '❌' : (isSkipped ? '⏭️' : '◌'));
          const label = isPassed ? 'PASSED' : (isFailed ? 'FAILED' : (isSkipped ? 'SKIPPED' : 'N/A'));
          const labelColor = isPassed ? '#2e7d32' : (isFailed ? '#c62828' : (isSkipped ? '#6d4c41' : '#616161'));
          const duration = m.duration || '-';
          return `
            <tr style="background:${bg};">
              <td style="padding:8px;font-weight:bold;border:1px solid #ddd;">${name}</td>
              <td style="padding:6px;text-align:center;border:1px solid #ddd;color:${labelColor};font-weight:bold;">${icon} ${label}</td>
              <td style="padding:6px;text-align:right;border:1px solid #ddd;color:#1565c0;font-weight:bold;">${duration}</td>
            </tr>
          `;
        }).join('');

        milestonesHtml = `
          <div style="margin-bottom:15px;padding:12px;background:#e3f2fd;border-radius:5px;border-left:4px solid #1976d2;">
            <p style="margin:5px 0;font-size:0.95em;"><b>State:</b> ${it.state} (${it.stateName})</p>
            <p style="margin:5px 0;font-size:0.95em;"><b>Quote Number:</b> ${it.quoteNumber}</p>
            <p style="margin:5px 0;font-size:0.95em;"><b>Policy Number:</b> ${it.policyNumber}</p>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:400px;">
              <thead>
                <tr style="background:#c8e6c9;">
                  <th style="padding:8px;text-align:left;border:1px solid #a5d6a7;">Milestone</th>
                  <th style="padding:8px;text-align:center;border:1px solid #a5d6a7;">Status</th>
                  <th style="padding:8px;text-align:right;border:1px solid #a5d6a7;">Time</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
                <tr style="background:#c8e6c9;font-weight:bold;">
                  <td style="padding:8px;border:1px solid #a5d6a7;">Total Duration</td>
                  <td colspan="2" style="padding:8px;text-align:center;border:1px solid #a5d6a7;color:#1565c0;font-size:1.05em;">${iterations[0].duration}s</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
      } else {
        // Determine suite label (BOP or Package)
        const suiteEnv = (process.env.TEST_TYPE || '').toUpperCase();
        const suiteLabel = suiteEnv === 'BOP' ? 'BOP' : (suiteEnv === 'PACKAGE' ? 'Package' : (this.results.some(r => /BOP/i.test(r.name)) ? 'BOP' : 'Package'));
        const milestoneNames = iterations[0].milestones.map(m => m.name);
        // Multi-iteration consolidated table
        const headerRow = `
          <tr style="background:#c8e6c9;">
            <th style="padding:8px;text-align:left;border:1px solid #a5d6a7;position:sticky;left:0;background:#c8e6c9;z-index:10;width:220px;">Milestone</th>
            ${iterations.map((it, idx) => `
              <th colspan="2" style="padding:8px;text-align:center;border:1px solid #a5d6a7;background:#b2dfdb;">
                ${suiteLabel} #${it.iterationNumber} - ${it.state} (${it.stateName})<br/>
                <span style="font-size:0.85em;font-weight:normal;">Quote: ${it.quoteNumber}</span><br/>
                <span style="font-size:0.85em;font-weight:normal;">Policy: ${it.policyNumber}</span>
              </th>
            `).join('')}
          </tr>
          <tr style="background:#c8e6c9;">
            <th style="padding:6px;border:1px solid #a5d6a7;position:sticky;left:0;background:#c8e6c9;z-index:10;"></th>
            ${iterations.map(() => `
              <th style="padding:6px;text-align:center;border:1px solid #a5d6a7;width:90px;">Status</th>
              <th style="padding:6px;text-align:right;border:1px solid #a5d6a7;width:70px;">Time</th>
            `).join('')}
          </tr>
        `;

        const allMilestoneNames = iterations.length > 0 
          ? Array.from(new Set(iterations.flatMap(it => it.milestones.map(m => m.name))))
          : milestoneNames;

        const milestoneRows = allMilestoneNames.map((milestoneName, mIdx) => {
          const bg = mIdx % 2 === 0 ? '#ffffff' : '#f1f8f4';
          const cells = iterations.map(it => {
            const milestone = it.milestones.find(m => m.name === milestoneName);
            const status = (milestone?.status || '').toString().toUpperCase();
            const isPassed = status === 'PASSED';
            const isFailed = status === 'FAILED';
            const isSkipped = status === 'SKIPPED';
            const icon = isPassed ? '✅' : (isFailed ? '❌' : (isSkipped ? '⏭️' : '◌'));
            const label = isPassed ? 'PASSED' : (isFailed ? 'FAILED' : (isSkipped ? 'SKIPPED' : 'N/A'));
            const labelColor = isPassed ? '#2e7d32' : (isFailed ? '#c62828' : (isSkipped ? '#6d4c41' : '#616161'));
            const duration = milestone?.duration || '-';
            return `
              <td style="padding:6px;text-align:center;border:1px solid #ddd;color:${labelColor};font-weight:bold;">${icon} ${label}</td>
              <td style="padding:6px;text-align:right;border:1px solid #ddd;color:#1565c0;font-weight:bold;">${duration}</td>
            `;
          }).join('');

          return `
            <tr style="background:${bg};">
              <td style="padding:8px;font-weight:bold;border:1px solid #ddd;position:sticky;left:0;background:${bg};z-index:9;">${milestoneName}</td>
              ${cells}
            </tr>
          `;
        }).join('');

        const totalRow = `
          <tr style="background:#c8e6c9;font-weight:bold;">
            <td style="padding:8px;border:1px solid #a5d6a7;position:sticky;left:0;background:#c8e6c9;z-index:9;">Total Duration</td>
            ${iterations.map(it => `
              <td colspan="2" style="padding:8px;text-align:center;border:1px solid #a5d6a7;color:#1565c0;font-size:1.05em;">${it.duration}s</td>
            `).join('')}
          </tr>
        `;

        milestonesHtml = `
          <div style="overflow-x:auto;">
            <table style="width:auto;border-collapse:collapse;min-width:600px;">
              <thead>
                ${headerRow}
              </thead>
              <tbody>
                ${milestoneRows}
                ${totalRow}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2 style="color:#333;">🎭 Playwright Test Automation Report</h2>
        <div style="background:#f5f5f5;padding:15px;margin:10px 0;border-radius:5px;">
          <h3 style="margin-top:0;">📊 Summary</h3>
          <p><b>Overall:</b> ${overallPassed ? '✅ PASSED' : '❌ FAILED'}</p>
          ${iterations.length > 1 ? `
            <p><b>Total Iterations:</b> ${iterations.length}</p>
            <p><b>Passed Iterations:</b> <span style="color:green;">${iterations.filter(it => it.status === 'PASSED').length}</span> &nbsp; <b>Failed Iterations:</b> <span style="color:red;">${iterations.filter(it => it.status === 'FAILED').length}</span></p>
          ` : ''}
          <p><b>Total Duration:</b> ${totalDuration}s</p>
          ${iterations.length > 1 ? `<p><b>Average Duration per Iteration:</b> ${avgDuration}s</p>` : ''}
          <p><b>Total Tests:</b> ${total} &nbsp; <b>Passed:</b> <span style="color:green;">${passed}</span> &nbsp; <b>Failed:</b> <span style="color:red;">${failed}</span></p>
        </div>
        ${milestonesHtml ? `
          <div style="background:#e8f5e9;padding:15px;margin:10px 0;border-radius:5px;border-left:4px solid #4CAF50;">
            <h3 style="margin-top:0;color:#2e7d32;">🎯 Test Milestones - ${iterations.length > 1 ? 'All Iterations' : 'Single Iteration'}</h3>
            <div style="margin-bottom:15px;padding:10px;background:#fff3e0;border-radius:3px;font-size:0.9em;">
              <b>Status Legend:</b> ✅ = Passed | ❌ = Failed | ⏭️ = Skipped | ◌ = Not Executed
            </div>
            ${milestonesHtml}
          </div>
        ` : '<p style="color:#666;">No milestones tracked</p>'}
        <div style="margin-top:20px;padding:10px;background:#f5f5f5;border-radius:5px;text-align:center;color:#666;">
          <p style="margin:5px 0;font-size:0.9em;">Generated by Playwright Test Automation Framework</p>
          <p style="margin:5px 0;font-size:0.9em;">Report Date: ${new Date().toLocaleDateString()}</p>
        </div>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false }
    });

    const overallStatus = overallPassed ? '✅ PASSED' : '❌ FAILED';
    const lastIteration = iterations[iterations.length - 1] || {};
    const subjectLine = iterations.length > 1 
      ? `${overallStatus} - WB Test Report - ${this.suiteLabel} - ${iterations.length} Iterations - ${passed}/${total} Passed`
      : `${overallStatus} - WB Smoke Test Report - ${this.suiteLabel} Policy`;

    console.log('📧 SMTP Config:', { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL });
    console.log('🎨 HTML length:', html.length, 'characters');
    console.log(`📨 Subject: ${subjectLine}`);
    console.log('📊 Final Test Summary:');
    console.log(`   Overall: ${overallPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Iterations: ${iterations.length}`);
    console.log(`   Passed: ${passed} | Failed: ${failed} | Total: ${total}`);
    console.log(`   Duration: ${totalDuration}s`);
    
    // Check if SMTP credentials are available
    if (!process.env.SMTP_HOST || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
      console.log('⚠️ SMTP credentials not configured. Email report will not be sent.');
      console.log('ℹ️  To enable email reports, set SMTP_HOST, SMTP_PORT, FROM_EMAIL, and TO_EMAIL in .env file');
      console.log('ℹ️  Test data has been saved to:', path.join(__dirname, 'test-data.json'));
      if (iterations.length > 0) {
        console.log('ℹ️  Iterations data saved to:', this.iterationsFile);
      }
      return;
    }
    
    try {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: subjectLine,
        html,
      });
      console.log('✔ Email report sent successfully via internal relay.');
    } catch (e) {
      console.error('❌ Failed to send email via internal relay:', e.message);
      console.error('Stack:', e.stack);
      console.log('📊 Test Summary - Overall:', overallPassed ? 'PASSED' : 'FAILED', '| Passed:', passed, '| Failed:', failed);
    }
  }
}

module.exports = EmailReporter;
