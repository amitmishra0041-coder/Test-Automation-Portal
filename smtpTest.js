const nodemailer = require("nodemailer");

// Replace with your company's SMTP relay info
const transporter = nodemailer.createTransport({
  host: "smtp.donegalgroup.com", // your internal SMTP server
  port: 25,                 // usually 25 or 587
  secure: false,            // false for internal relay
  tls: { rejectUnauthorized: false } // bypass TLS cert check
});

// Test email details
const mailOptions = {
  from: "automation@company.com", // generic sender allowed by relay
  to: "amitmishra@donegalgroup.com",          // your email
  subject: "SMTP Relay Test",
  text: "This is a test email sent via internal SMTP relay."
};

// Send the test email
transporter.sendMail(mailOptions, (err, info) => {
  if (err) {
    console.error("❌ Failed to send test email:", err.message);
  } else {
    console.log("✅ Test email sent successfully:", info.response);
  }
});
