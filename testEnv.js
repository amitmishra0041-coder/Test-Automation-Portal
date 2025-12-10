// testEnv.js
require('dotenv').config(); // Load .env file

console.log("SMTP_HOST:", process.env.SMTP_HOST);
console.log("SMTP_PORT:", process.env.SMTP_PORT);
console.log("FROM_EMAIL:", process.env.FROM_EMAIL);
console.log("TO_EMAIL:", process.env.TO_EMAIL);
