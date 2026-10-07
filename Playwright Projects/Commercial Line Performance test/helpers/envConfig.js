// Environment URL configuration
// Usage: const { getEnvUrls } = require('./helpers/envConfig');
// const env = process.env.TEST_ENV || 'qa';
// const { writeBizUrl, policyCenterUrl } = getEnvUrls(env);

const ENV_URLS = {
  qa: {
    writeBizUrl: 'https://writebizqa.donegalgroup.com/agentlogin.aspx?bs=c',
    policyCenterUrl: 'https://qa-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
  test: {
    writeBizUrl: 'https://writebiztest.donegalgroup.com/agentlogin.aspx',
    policyCenterUrl: 'http://test-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
  perf: {
    writeBizUrl: 'http://writebizperf.donegalgroup.com/agentlogin.aspx',
    policyCenterUrl: 'http://perf-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
  training: {
    writeBizUrl: 'https://training-www.donegalgroup.com/launch-app?app=WB',
    policyCenterUrl: 'http://training-policycenter.donegalgroup.com:8180/pc/PolicyCenter.do',
  },
};

// Case-insensitive lookup by matching against the ENV_URLS keys' own casing.
// ENV_URLS used to declare "Training" (capital T) while every other key is
// lowercase; getEnvUrls('Training') lowercased its lookup to 'training',
// found nothing, and silently fell through to the qa default - every test
// run with TEST_ENV=Training was therefore actually hitting QA the whole
// time. Fixed two ways: this lookup is now case-insensitive regardless of
// key casing, AND the key itself was renamed to lowercase "training" to
// match the others - runner/server.js indexes ENV_URLS directly by key
// (not through this function), so that direct access needed the matching
// casing too, not just this lookup.
function getEnvUrls(envName = 'qa') {
  const requested = (envName || 'qa').toLowerCase();
  const matchedKey = Object.keys(ENV_URLS).find(k => k.toLowerCase() === requested);
  if (matchedKey) return ENV_URLS[matchedKey];
  return ENV_URLS.qa;
}

module.exports = { getEnvUrls, ENV_URLS };
