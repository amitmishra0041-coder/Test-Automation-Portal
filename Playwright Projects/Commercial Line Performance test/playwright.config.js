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
  timeout: 1200 * 1000, // 20 minutes for entire test
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
