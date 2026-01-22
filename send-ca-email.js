// Consolidated email reporter for CA Tarmika parallel test runs
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

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
// Ensure resultsData is an array (PowerShell may serialize differently)
if (!Array.isArray(resultsData)) {
  // If it's an object with numeric keys, convert to array
  resultsData = Object.values(resultsData);
}

const totalTime = emailData.totalTime || 'unknown';
const testEnv = (emailData.env || 'QA').toUpperCase();

if (resultsData.length === 0) {
  console.log('No results to email. Exiting.');
  process.exit(0);
}

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

// Build HTML email
const timestamp = new Date().toLocaleString('en-US', { 
  dateStyle: 'full', 
  timeStyle: 'short' 
});

let tableRows = '';
let passCount = 0;
let failCount = 0;

resultsData.forEach((result, index) => {
  const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
  const status = result.ExitCode === 0 ? 'PASSED' : 'FAILED';
  const statusColor = result.ExitCode === 0 ? '#4CAF50' : '#f44336';
  const quoteRequestNumber = result.QuoteRequestNumber || 'N/A';
  const insuredName = result.InsuredName || 'N/A';
  
  if (result.ExitCode === 0) {
    passCount++;
  } else {
    failCount++;
  }
  
  tableRows += `
    <tr style="background-color: ${bgColor};">
      <td style="padding: 10px; text-align: center;"><strong>${result.State}</strong></td>
      <td style="padding: 10px; text-align: center; color: ${statusColor}; font-weight: bold;">${status}</td>
      <td style="padding: 10px; text-align: left;">${quoteRequestNumber}</td>
      <td style="padding: 10px; text-align: left;">${insuredName}</td>
    </tr>
  `;
});

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
    .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid #4CAF50; padding-bottom: 10px; }
    .summary { background-color: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .summary-item { margin: 5px 0; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background-color: #4CAF50; color: white; padding: 12px; text-align: center; font-weight: bold; }
    td { border: 1px solid #ddd; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚗 CA Tarmika Test Results - ${testEnv} Environment</h1>
    
    <div class="summary">
      <div class="summary-item"><strong>📅 Test Run Date:</strong> ${timestamp}</div>
      <div class="summary-item"><strong>⏱️ Total Execution Time:</strong> ${totalTime}</div>
      <div class="summary-item"><strong>📊 Total States Tested:</strong> ${resultsData.length}</div>
      <div class="summary-item"><strong>✅ Passed:</strong> <span style="color: #4CAF50; font-weight: bold;">${passCount}</span></div>
      <div class="summary-item"><strong>❌ Failed:</strong> <span style="color: #f44336; font-weight: bold;">${failCount}</span></div>
      <div class="summary-item"><strong>📈 Success Rate:</strong> ${((passCount / resultsData.length) * 100).toFixed(1)}%</div>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>State</th>
          <th>Status</th>
          <th>Quote Request Number</th>
          <th>Insured Name</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    <div class="footer">
      <p><strong>Note:</strong> This is an automated test report from the CA Tarmika test suite running in parallel.</p>
      <p>For detailed logs, check the individual state log files: <code>test-run-output-ca-{STATE}.txt</code></p>
    </div>
  </div>
</body>
</html>
`;

// Send email
const mailOptions = {
  from: process.env.FROM_EMAIL || 'automation@donegalgroup.com',
  to: process.env.TO_EMAIL || 'amitmishra@donegalgroup.com',
  subject: `CA Tarmika Test Results - ${testEnv} - ${timestamp.split(',')[0]} - ${passCount}/${resultsData.length} Passed`,
  html: htmlContent
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
