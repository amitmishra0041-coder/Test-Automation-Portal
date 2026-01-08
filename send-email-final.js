#!/usr/bin/env node

// Force reload dotenv from disk
delete require.cache[require.resolve('dotenv')];
require('dotenv').config();

console.log('\n=== Email Send Debug ===');
console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_PORT:', process.env.SMTP_PORT);
console.log('FROM_EMAIL:', process.env.FROM_EMAIL);
console.log('TO_EMAIL:', process.env.TO_EMAIL);
console.log('========================\n');

const EmailReporter = require('./emailReporter.js');
EmailReporter.sendBatchEmailReport(['iterations-data-bop.json'], 'WB BOP Report - Manual Resend')
  .then(() => {
    console.log('\n✅ Email send completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Email send failed:', err.message);
    process.exit(1);
  });
