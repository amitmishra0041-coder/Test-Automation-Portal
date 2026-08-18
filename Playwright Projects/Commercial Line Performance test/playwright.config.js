const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testIgnore: [
  'Compare_PDFs.test.js',
  'Compare_PDFs.test.mjs',
  'tests/**',
  '_BACKUP_*/**',
  'runners/**',
  'cleanup-v3.ps1',
  'deploy-bop.ps1',
  'fix-account-helper.ps1',
],
  // Widened from 20 minutes: confirmed live that a fully successful CP run
  // (estimator, all coverage screens, submission, UW approval, issuance -
  // "Test completed successfully. Policy: 1003059560" was logged) still got
  // marked FAILED by "Test timeout of 1200000ms exceeded", even though
  // Create_Package.test.js/Create_BOP.test.js both call
  // test.setTimeout(1800000) (30 min) at the top of the test body. Whatever
  // the precedence issue, raising the config default above what the tests
  // themselves intend removes the ambiguity outright.
  timeout: 2100 * 1000, // 35 minutes for entire test
  expect: { timeout: 40 * 1000 },

  use: {
    headless: false,
    ignoreHTTPSErrors: true,
    actionTimeout: 60 * 1000,
    navigationTimeout: 60 * 1000,
    video: 'retain-on-failure', // Record video only on failure for debugging
    screenshot: 'only-on-failure', // Capture screenshot on failure
    trace: 'on', // Always capture Playwright trace for troubleshooting
  },

  reporter: [
    ['list'],
    ['./emailReporter.js'],
  ],

  projects: [
    { 
      name: 'chromium', 
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          slowMo: 100 // Add 100ms delay between actions to simulate human timing
        }
      } 
    },
    // Temporarily disabled for focused debugging
    //{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    //{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
