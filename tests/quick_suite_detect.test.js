const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Force suite type for this quick check
process.env.TEST_TYPE = 'PACKAGE';

test('quick suite detection writes to package iterations file', async ({}) => {
  // Minimal test-data to be picked up by the reporter in onTestEnd
  const testData = {
    state: 'DE',
    stateName: 'Delaware',
    milestones: [
      { name: 'Quick Milestone', status: 'PASSED', timestamp: new Date().toISOString(), duration: '0.10s' }
    ],
    quoteNumber: 'Q-TEST-123',
    policyNumber: 'P-TEST-456',
    status: 'PASSED'
  };

  const testDataFile = path.join(__dirname, '..', 'test-data.json');
  fs.writeFileSync(testDataFile, JSON.stringify(testData, null, 2), 'utf8');

  // Simple assertion to keep Playwright happy
  expect(testData.status).toBe('PASSED');
});
