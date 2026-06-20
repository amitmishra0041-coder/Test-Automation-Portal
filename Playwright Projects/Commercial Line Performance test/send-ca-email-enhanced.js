// Enhanced email reporter for CA parallel test runs with detailed coverage stats
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

// Calculate aggregate statistics
function calculateAggregateStats(results) {
  const stats = {
    totalStates: results.length,
    passedCount: 0,
    failedCount: 0,
    totalDuration: 0,
    avgDuration: 0,
    coverageSections: {},
    totalDropdownsUpdated: 0,
    totalCoverageAdded: 0,
    avgCoverageUpdateTime: 0
  };

  results.forEach(result => {
    if (result.TestStatus === 'PASSED') stats.passedCount++;
    else stats.failedCount++;
    
    stats.totalDuration += parseFloat(result.Duration || 0);

    // Parse coverage stats from milestones
    if (result.Milestones && Array.isArray(result.Milestones)) {
      result.Milestones.forEach(m => {
        if (m.name && m.name.includes('Coverage')) {
          const section = m.name.replace(/Coverage/, '').trim();
          if (!stats.coverageSections[section]) {
            stats.coverageSections[section] = {
              count: 0,
              totalTime: 0,
              avgTime: 0
            };
          }
          stats.coverageSections[section].count++;
          const duration = parseFloat(m.duration) || 0;
          stats.coverageSections[section].totalTime += duration;
          stats.totalCoverageAdded++;
        }
      });
    }
  });

  stats.avgDuration = (stats.totalDuration / stats.totalStates).toFixed(2);
  
  // Calculate average time per coverage section
  Object.keys(stats.coverageSections).forEach(section => {
    const data = stats.coverageSections[section];
    data.avgTime = (data.totalTime / data.count).toFixed(2);
  });

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

// Build iteration details table
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

// Build coverage updates section
let coverageUpdatesHtml = '';
resultsData.forEach(result => {
  if (result.Milestones && Array.isArray(result.Milestones)) {
    const coverageMilestones = result.Milestones.filter(m => 
      m.name && (m.name.includes('coverage') || m.name.toLowerCase().includes('added'))
    );
    
    if (coverageMilestones.length > 0) {
      coverageUpdatesHtml += `
        <div style="background: #f9f9f9; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #4CAF50;">
          <div style="font-weight: bold; color: #333; margin-bottom: 10px; font-size: 14px;">CA (${result.State}) - Coverage updates</div>
          ${coverageMilestones.map(m => `
            <div style="font-size: 12px; color: #666; margin: 5px 0;">
              <strong>${m.name}:</strong> ${m.status} 
              ${m.duration ? `(<strong>Average time: ${m.duration}s</strong>)` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }
  }
});

// Build coverage statistics table
let coverageStatsHtml = '';
const sortedSections = Object.entries(aggregateStats.coverageSections)
  .sort((a, b) => parseFloat(b[1].totalTime) - parseFloat(a[1].totalTime))
  .slice(0, 10); // Top 10 coverage sections

if (sortedSections.length > 0) {
  coverageStatsHtml = `
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
      <thead>
        <tr style="background:#1976d2;color:white;">
          <th style="padding:10px;text-align:left;border:1px solid #ddd;">Coverage Section</th>
          <th style="padding:10px;text-align:center;border:1px solid #ddd;">Updates</th>
          <th style="padding:10px;text-align:center;border:1px solid #ddd;">Average Time (s)</th>
          <th style="padding:10px;text-align:center;border:1px solid #ddd;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${sortedSections.map((section, idx) => {
          const bgColor = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
          return `
            <tr style="background-color: ${bgColor};">
              <td style="padding:10px;border:1px solid #ddd;">${section[0] || 'N/A'}</td>
              <td style="padding:10px;border:1px solid #ddd;text-align:center;">${section[1].count}</td>
              <td style="padding:10px;border:1px solid #ddd;text-align:center;"><strong>${section[1].avgTime}</strong></td>
              <td style="padding:10px;border:1px solid #ddd;text-align:center;"><span style="color:#4CAF50;font-weight:bold;">✓ Updated</span></td>
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
    
    <div class="section-title">Coverage Updates - Average Statistics</div>
    ${coverageStatsHtml}
    
    <div class="section-title">Coverage Updates - Detailed</div>
    ${coverageUpdatesHtml}
    
    <div class="footer">
      <p><strong>Report Generated:</strong> ${timestamp}</p>
      <p><strong>Environment:</strong> ${testEnv}</p>
      <p><strong>Note:</strong> This is an automated test report. Detailed state-wise data is available in the attached Excel file.</p>
    </div>
  </div>
</body>
</html>
`;

// Create Excel report with detailed state information
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
      'Avg Duration (s)': aggregateStats.avgDuration,
      'Report Generated': timestamp,
      'Environment': testEnv
    }];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Iteration Details sheet
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
    
    // Coverage Details sheet per state
    results.forEach((result, idx) => {
      if (result.Milestones && Array.isArray(result.Milestones)) {
        const coverageData = result.Milestones
          .filter(m => m.name && (m.name.includes('Coverage') || m.name.includes('coverage')))
          .map(m => ({
            'Milestone': m.name,
            'Status': m.status || 'N/A',
            'Duration (s)': m.duration || '-',
            'Timestamp': m.timestamp || '-'
          }));
        
        if (coverageData.length > 0) {
          const ws = XLSX.utils.json_to_sheet(coverageData);
          const sheetName = `Coverage_${result.State}`.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
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
