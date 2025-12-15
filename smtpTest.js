const nodemailer = require("nodemailer");

// Configure transport for internal SMTP relay
const transporter = nodemailer.createTransport({
  host: "smtp.donegalgroup.com", // internal SMTP server
  port: 25,                      // typical port for internal relay
  secure: false,                 // no TLS for internal relay
  logger: true,                  // enable debug logging
  debug: true                    // print SMTP conversation to console
});

// Test email details
const mailOptions = {
  from: "automation@donegalgroup.com", // generic sender allowed by relay
  to: "amitmishra@donegalgroup.com",   // your email
  subject: "SMTP Relay Test",
  text: "This is a test email sent via internal SMTP relay."
};

// Verify connection to SMTP server
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ Connection to SMTP server failed:", err.message);
  } else {
    console.log("✅ SMTP server is ready. Sending test email...");
    
    // Send the email
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("❌ Failed to send test email:", err.message);
      } else {
        console.log("✅ Test email sent successfully!");
        console.log("Response:", info.response);
      }
    });
  }
});
