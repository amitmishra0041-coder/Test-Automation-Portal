require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailReporter {
  constructor(options) {
    this.options = options || {};
    this.results = [];
    this.startTime = new Date();
    this.iterationsFile = path.join(__dirname, 'iterations-data.json');
  }

  onBegin() {
    // Clear iterations file and test data at the start of a test run
    try {
      if (fs.existsSync(this.iterationsFile)) {
        fs.unlinkSync(this.iterationsFile);
        console.log('🗑️ Cleared previous iterations data');
      }
      
      // Also clear test-data.json to prevent stale data
      const testDataFile = path.join(__dirname, 'test-data.json');
      if (fs.existsSync(testDataFile)) {
        fs.unlinkSync(testDataFile);
        console.log('🗑️ Cleared previous test-data.json');
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
          duration: testData.milestones?.reduce((sum, m) => sum + parseFloat(m.duration || 0), 0).toFixed(2) || '0'
        });
        
        // Save updated iterations
        fs.writeFileSync(this.iterationsFile, JSON.stringify(iterations, null, 2));
        console.log(`💾 Iteration ${iterations.length} data saved`);
      }
    } catch (e) {
      console.log('⚠️ Could not save iteration data:', e.message);
    }
  }

  async onEnd() {
    console.log('🎬 EmailReporter.onEnd() called');
    const endTime = new Date();
    const totalDuration = ((endTime - this.startTime) / 1000).toFixed(2);

    // Load all iterations
    let iterations = [];
    try {
      if (fs.existsSync(this.iterationsFile)) {
        iterations = JSON.parse(fs.readFileSync(this.iterationsFile, 'utf-8'));
        console.log(`📂 Loaded ${iterations.length} iteration(s) from file`);
      }
    } catch (e) {
      console.log('⚠️ Failed to read iterations file:', e.message);
    }

    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = total - passed;
    const overallPassed = failed === 0;

    // Calculate average duration
    const avgDuration = iterations.length > 0 
      ? (iterations.reduce((sum, it) => sum + parseFloat(it.duration || 0), 0) / iterations.length).toFixed(2)
      : '0';

    // Build consolidated milestone table
    let milestonesHtml = '';
    if (iterations.length > 0 && iterations[0].milestones && iterations[0].milestones.length > 0) {
      const milestoneNames = iterations[0].milestones.map(m => m.name);
      
      // Build header row with iteration info
      const headerRow = `
        <tr style="background:#c8e6c9;">
          <th style="padding:8px;text-align:left;border:1px solid #a5d6a7;position:sticky;left:0;background:#c8e6c9;z-index:10;width:150px;">Milestone</th>
          ${iterations.map((it, idx) => `
            <th colspan="2" style="padding:8px;text-align:center;border:1px solid #a5d6a7;background:#b2dfdb;">
              #${it.iterationNumber} - ${it.state} (${it.stateName})<br/>
              <span style="font-size:0.85em;font-weight:normal;">Quote: ${it.quoteNumber}</span><br/>
              <span style="font-size:0.85em;font-weight:normal;">Policy: ${it.policyNumber}</span>
            </th>
          `).join('')}
        </tr>
        <tr style="background:#c8e6c9;">
          <th style="padding:6px;border:1px solid #a5d6a7;position:sticky;left:0;background:#c8e6c9;z-index:10;"></th>
          ${iterations.map(() => `
            <th style="padding:6px;text-align:center;border:1px solid #a5d6a7;width:35px;">✓</th>
            <th style="padding:6px;text-align:right;border:1px solid #a5d6a7;width:55px;">Time</th>
          `).join('')}
        </tr>
      `;

      // Build milestone rows
      const milestoneRows = milestoneNames.map((milestoneName, mIdx) => {
        const bg = mIdx % 2 === 0 ? '#ffffff' : '#f1f8f4';
        const cells = iterations.map(it => {
          const milestone = it.milestones.find(m => m.name === milestoneName);
          const icon = milestone?.status === 'PASSED' ? '✅' : (milestone?.status === 'FAILED' ? '❌' : '-');
          const duration = milestone?.duration || '-';
          return `
            <td style="padding:6px;text-align:center;border:1px solid #ddd;">${icon}</td>
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

      // Build total duration row
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
      ? `${overallStatus} - WB Test Report - ${iterations.length} Iterations - ${passed}/${total} Passed`
      : `${overallStatus} - WB Smoke Test Report - Policy: ${lastIteration.policyNumber || 'N/A'}`;

    console.log('📧 SMTP Config:', { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL });
    console.log('🎨 HTML length:', html.length, 'characters');
    console.log(`📨 Subject: ${subjectLine}`);
    
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
      console.log(html);
    }
  }
}

module.exports = EmailReporter;
