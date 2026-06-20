// Environment URL configuration
// Usage: const { getEnvUrls } = require('./helpers/envConfig');
// const env = process.env.TEST_ENV || 'qa';
// const { writeBizUrl, policyCenterUrl } = getEnvUrls(env);

const ENV_URLS = {
  qa: {
    writeBizUrl: 'https://nautilustest.donegalgroup.com/agentlogin.aspx?bs=c',
    policyCenterUrl: 'http://test-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
  test: {
    writeBizUrl: 'https://writebiztest.donegalgroup.com/agentlogin.aspx',
    policyCenterUrl: 'http://test-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
  perf: {
    writeBizUrl: 'http://writebizperf.donegalgroup.com/agentlogin.aspx',
    policyCenterUrl: 'http://perf-policycenter.donegalgroup.com/pc/PolicyCenter.do',
  },
};

function getEnvUrls(envName = 'qa') {
  const key = (envName || 'qa').toLowerCase();
  if (ENV_URLS[key]) return ENV_URLS[key];
  return ENV_URLS.qa;
}

module.exports = { getEnvUrls };
