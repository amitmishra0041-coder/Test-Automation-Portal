const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 40 * 1000,
  expect: { timeout: 40 * 1000 },

  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    actionTimeout: 40 * 1000,
  },

  reporter: [
    ['list'],
    ['./emailReporter.js'], // our updated reporter
  ],

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
