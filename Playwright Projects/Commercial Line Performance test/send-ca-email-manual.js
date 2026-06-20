// Manual email sender for CA test - reads test-data-DE.json and sends email
const EmailReporter = require('./emailReporter');
const fs = require('fs');
const path = require('path');

async function sendManualEmail() {
  try {
    // Read the test data file from the last run
    const testDataFile = path.join(__dirname, 'test-data-DE.json');
    
    if (!fs.existsSync(testDataFile)) {
      console.log('❌ test-data-DE.json not found');
      return;
    }
    
    const testData = JSON.parse(fs.readFileSync(testDataFile, 'utf-8'));
    console.log('✅ Loaded test data:', testData.quoteNumber, testData.policyNumber);
    
    // Create iterations data manually
    const iterations = [{
      iterationNumber: 1,
      status: testData.policyNumber !== 'N/A' ? 'PASSED' : 'FAILED',
      state: testData.state || 'DE',
      stateName: testData.stateName || 'Delaware',
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
      runId: new Date().toISOString(),
      suite: 'CA'
    }];
    
    // Save to iterations file for CA
    const iterFile = path.join(__dirname, 'iterations-data-ca.json');
    fs.writeFileSync(iterFile, JSON.stringify(iterations, null, 2));
    console.log(`✅ Created ${iterFile}`);
    
    // Send email using the reporter's static method
    const reporter = new EmailReporter();
    await reporter._sendEmail(iterations, 'WB CA Test Report (Manual)');
    
    console.log('✅ Email sent successfully!');
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    console.error(error.stack);
  }
}

sendManualEmail();
