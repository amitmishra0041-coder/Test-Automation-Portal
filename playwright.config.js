const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 300 * 1000, // 5 minutes for entire test
  expect: { timeout: 40 * 1000 },

  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    actionTimeout: 60 * 1000,
    navigationTimeout: 60 * 1000,
    video: 'retain-on-failure', // Record video only on failure for debugging
    screenshot: 'only-on-failure', // Capture screenshot on failure
  },

  reporter: [
    ['list'],
    ['./emailReporter.js'], // our updated reporter
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
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
