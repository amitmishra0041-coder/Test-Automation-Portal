// Enhanced email reporter for CA parallel test runs with coverage detail format
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Read results from temp file written by PowerShell
const tempFilePath = path.join(__dirname, 'ca-email-temp.json');

if (!fs.existsSync(tempFilePath)) {
  console.error('Error: ca-email-temp.json not found. Email cannot be sent.');
  process.exit(1);
}

let emailData;
try {
  const rawData = fs.readFileSync(tempFilePath, 'utf8');
  emailData = JSON.parse(rawData);
} catch (e) {
  console.error('Failed to read or parse email data:', e.message);
  process.exit(1);
}

let resultsData = emailData.results || [];
if (!Array.isArray(resultsData)) {
  resultsData = Object.values(resultsData);
}

const testEnv = (emailData.env || 'QA').toUpperCase();

if (resultsData.length === 0) {
  console.log('No results to email. Exiting.');
  process.exit(0);
}

// Parse coverage section stats from milestones across all states
function parseCoverageStats(results) {
  const coverageMap = new Map(); // Key: coverage name, Value: { detail, times[], status }
  
  results.forEach(result => {
    if (!result.Milestones || !Array.isArray(result.Milestones)) return;
    
    result.Milestones.forEach(milestone => {
      const mileName = milestone.name || '';
      const duration = parseFloat(milestone.duration) || 0;
      
      // Detect coverage updates vs additions
      let coverageSection = null;
      let detail = null;
      let status = 'Updated';
      
      // Pattern: "Coverage section: X dropdown(s) updated" or similar
      if (mileName.includes('additional Coverage Added')) {
        coverageSection = 'Commercial Auto additional Coverage Added';
        detail = 'Coverage Added';
        status = 'Added';
      } else if (mileName.includes('Coverage') && mileName.includes('updated')) {
        // Extract coverage name and dropdown count
        const match = mileName.match(/(\d+)\s+dropdown/i);
        const dropdownCount = match ? match[1] : '1';
        coverageSection = mileName.replace(/:\s*\d+.*$/i, '').trim();
        detail = `${dropdownCount} dropdown(s) updated`;
        status = 'Updated';
      } else if (mileName.includes('Coverage')) {
        coverageSection = mileName;
        detail = 'Coverage processed';
        status = mileName.includes('Added') ? 'Added' : 'Updated';
      }
      
      if (coverageSection) {
        if (!coverageMap.has(coverageSection)) {
          coverageMap.set(coverageSection, {
            detail: detail || 'N/A',
            times: [],
            status: status,
            count: 0
          });
        }
        const entry = coverageMap.get(coverageSection);
        if (duration > 0) entry.times.push(duration);
        entry.count++;
      }
    });
  });
  
  // Convert to array and calculate averages
  const coverageArray = Array.from(coverageMap.entries()).map(([name, data]) => {
    const avgTime = data.times.length > 0 
      ? (data.times.reduce((a, b) => a + b, 0) / data.times.length).toFixed(2)
      : 'N/A';
    return {
      name,
      detail: data.detail,
      status: data.status,
      avgTime,
      times: data.times,
      count: data.count
    };
  });
  
  // Sort by frequency and then by time
  return coverageArray.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return parseFloat(b.avgTime) - parseFloat(a.avgTime);
  });
}

const coverageStats = parseCoverageStats(resultsData);

// Calculate aggregate statistics
function calculateAggregateStats(results) {
  const stats = {
    totalStates: results.length,
    passedCount: 0,
    failedCount: 0,
    totalDuration: 0,
    avgDuration: 0
  };

  results.forEach(result => {
    if (result.TestStatus === 'PASSED') stats.passedCount++;
    else stats.failedCount++;
    
    stats.totalDuration += parseFloat(result.Duration || 0);
  });

  stats.avgDuration = (stats.totalDuration / stats.totalStates).toFixed(2);
  return stats;
}

const aggregateStats = calculateAggregateStats(resultsData);

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.donegalgroup.com',
  port: parseInt(process.env.SMTP_PORT || '25'),
  secure: false,
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

// Build iteration summary table
let iterationTableRows = '';
resultsData.forEach((result, index) => {
  const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
  const status = result.TestStatus || 'UNKNOWN';
  const statusIcon = status === 'PASSED' ? '✓' : '✗';
  const statusColor = status === 'PASSED' ? '#4CAF50' : '#f44336';
  const quoteNumber = result.QuoteNumber || 'N/A';
  const state = result.State || 'N/A';
  
  iterationTableRows += `
    <tr style="background-color: ${bgColor};">
      <td style="padding: 10px; text-align: center;"><strong>${index + 1}</strong></td>
      <td style="padding: 10px; text-align: left;"><strong>CA (${state})</strong></td>
      <td style="padding: 10px; text-align: left;">${quoteNumber}</td>
      <td style="padding: 10px; text-align: center; color: ${statusColor}; font-weight: bold;">${statusIcon} ${status}</td>
    </tr>
  `;
});

// Build coverage updates table (matching format from screenshot)
let coverageTableHtml = '';
if (coverageStats.length > 0) {
  coverageTableHtml = `
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
      <thead>
        <tr style="background:#1976d2;color:white;">
          <th style="padding:10px;text-align:left;border:1px solid #ddd;">Coverage Section</th>
          <th style="padding:10px;text-align:left;border:1px solid #ddd;">Detail</th>
          <th style="padding:10px;text-align:center;border:1px solid #ddd;width:80px;">Status</th>
          <th style="padding:10px;text-align:center;border:1px solid #ddd;width:80px;">Time (s)</th>
        </tr>
      </thead>
      <tbody>
        ${coverageStats.map((cov, idx) => {
          const bgColor = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
          const statusColor = cov.status === 'Added' ? '#2196F3' : '#4CAF50';
          return `
            <tr style="background-color: ${bgColor};">
              <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">${cov.name}</td>
              <td style="padding:10px;border:1px solid #ddd;">${cov.detail}</td>
              <td style="padding:10px;border:1px solid #ddd;text-align:center;">
                <span style="color:${statusColor};font-weight:bold;">${cov.status}</span>
              </td>
              <td style="padding:10px;border:1px solid #ddd;text-align:center;font-weight:bold;">${cov.avgTime}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

const timestamp = new Date().toLocaleString('en-US', { 
  dateStyle: 'full', 
  timeStyle: 'short' 
});

const overallStatus = aggregateStats.failedCount === 0 ? '✓ PASSED' : '✗ FAILED';
const overallStatusColor = aggregateStats.failedCount === 0 ? '#4CAF50' : '#f44336';

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; max-width: 1200px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 15px; margin-bottom: 30px; border-bottom: 3px solid #1976d2; padding-bottom: 20px; }
    .header h1 { color: #1976d2; margin: 0; font-size: 28px; font-weight: bold; }
    .header-icon { font-size: 32px; }
    
    .summary-box { background-color: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #1976d2; }
    .summary-title { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 15px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .summary-item { background: white; padding: 15px; border-radius: 5px; border: 1px solid #ddd; }
    .summary-item-label { font-size: 12px; color: #666; text-transform: uppercase; font-weight: bold; }
    .summary-item-value { font-size: 24px; font-weight: bold; margin-top: 8px; }
    .summary-item-value.passed { color: #4CAF50; }
    .summary-item-value.failed { color: #f44336; }
    .summary-item-value.neutral { color: #1976d2; }
    
    .section-title { font-size: 16px; font-weight: bold; color: #333; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #1976d2; padding-bottom: 10px; }
    
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background-color: #1976d2; color: white; padding: 12px; text-align: left; font-weight: bold; }
    td { border: 1px solid #ddd; padding: 12px; }
    
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-icon">🚗</div>
      <h1>WB Smoke Testing Report</h1>
    </div>
    
    <div class="summary-box">
      <div class="summary-title">📊 Test Summary</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-item-label">Overall Status</div>
          <div class="summary-item-value" style="color: ${overallStatusColor};">${overallStatus}</div>
        </div>
        <div class="summary-item">
          <div class="summary-item-label">Total Iterations</div>
          <div class="summary-item-value neutral">${aggregateStats.totalStates}</div>
        </div>
        <div class="summary-item">
          <div class="summary-item-label">Test Duration</div>
          <div class="summary-item-value neutral">${aggregateStats.totalDuration.toFixed(2)}s</div>
        </div>
      </div>
      
      <div class="summary-grid" style="margin-top: 15px;">
        <div class="summary-item">
          <div class="summary-item-label">Passed</div>
          <div class="summary-item-value passed">${aggregateStats.passedCount}</div>
        </div>
        <div class="summary-item">
          <div class="summary-item-label">Failed</div>
          <div class="summary-item-value failed">${aggregateStats.failedCount}</div>
        </div>
        <div class="summary-item">
          <div class="summary-item-label">Success Rate</div>
          <div class="summary-item-value neutral">${((aggregateStats.passedCount / aggregateStats.totalStates) * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
    
    <div class="section-title">Iteration Details</div>
    <table>
      <thead>
        <tr>
          <th>Iteration</th>
          <th>Line of Business</th>
          <th>Quote Number</th>
          <th style="text-align: center;">Overall Status</th>
        </tr>
      </thead>
      <tbody>
        ${iterationTableRows}
      </tbody>
    </table>
    
    <div class="section-title">Coverage Updates - Combined Statistics</div>
    ${coverageTableHtml}
    
    <div class="footer">
      <p><strong>Report Generated:</strong> ${timestamp}</p>
      <p><strong>Environment:</strong> ${testEnv}</p>
      <p><strong>Note:</strong> Detailed state-wise milestone data is available in the attached Excel file.</p>
    </div>
  </div>
</body>
</html>
`;

// Create Excel report with detailed milestone information per state
function createExcelReport(results) {
  try {
    const wb = XLSX.utils.book_new();
    
    // Summary sheet
    const summaryData = [{
      'Overall Status': overallStatus,
      'Total States': aggregateStats.totalStates,
      'Passed': aggregateStats.passedCount,
      'Failed': aggregateStats.failedCount,
      'Success Rate (%)': ((aggregateStats.passedCount / aggregateStats.totalStates) * 100).toFixed(1),
      'Total Duration (s)': aggregateStats.totalDuration.toFixed(2),
      'Avg Duration per State (s)': aggregateStats.avgDuration,
      'Report Generated': timestamp,
      'Environment': testEnv
    }];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Coverage Summary sheet
    const coverageSummaryData = coverageStats.map((cov, idx) => ({
      'Rank': idx + 1,
      'Coverage Section': cov.name,
      'Detail': cov.detail,
      'Status': cov.status,
      'Average Time (s)': cov.avgTime,
      'Occurrences': cov.count
    }));
    const coverageSummaryWs = XLSX.utils.json_to_sheet(coverageSummaryData);
    XLSX.utils.book_append_sheet(wb, coverageSummaryWs, 'Coverage Summary');
    
    // Iteration summary sheet
    const iterationData = results.map((result, idx) => ({
      'Iteration #': idx + 1,
      'State': result.State,
      'Line of Business': `CA (${result.State})`,
      'Quote Number': result.QuoteNumber || 'N/A',
      'Policy Number': result.PolicyNumber || 'N/A',
      'Overall Status': result.TestStatus,
      'Duration (s)': result.Duration || 'N/A'
    }));
    const iterationWs = XLSX.utils.json_to_sheet(iterationData);
    XLSX.utils.book_append_sheet(wb, iterationWs, 'Iterations');
    
    // Per-state milestone details
    results.forEach((result, idx) => {
      if (result.Milestones && Array.isArray(result.Milestones) && result.Milestones.length > 0) {
        const milestoneData = result.Milestones.map((m, mIdx) => ({
          'Rank': mIdx + 1,
          'Milestone': m.name || 'N/A',
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Timestamp': m.timestamp ? new Date(m.timestamp).toLocaleString() : '-'
        }));
        
        const ws = XLSX.utils.json_to_sheet(milestoneData);
        const sheetName = `${result.State}_Milestones`.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    });
    
    const excelPath = path.join(__dirname, `WB_Test_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    XLSX.writeFile(wb, excelPath);
    console.log('✅ Excel report created:', excelPath);
    return excelPath;
  } catch (e) {
    console.error('⚠️ Failed to create Excel report:', e.message);
    return null;
  }
}

const excelFile = createExcelReport(resultsData);

// Send email
const mailOptions = {
  from: process.env.FROM_EMAIL || 'automation@donegalgroup.com',
  to: process.env.TO_EMAIL || 'amitmishra@donegalgroup.com',
  subject: `WB Smoke Testing Report: ${testEnv} - ${aggregateStats.passedCount}/${aggregateStats.totalStates} Passed`,
  html: htmlContent,
  attachments: excelFile ? [{ filename: path.basename(excelFile), path: excelFile }] : []
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Failed to send email:', error.message);
    process.exit(1);
  } else {
    console.log('✅ Email sent successfully:', info.messageId);
    process.exit(0);
  }
});
