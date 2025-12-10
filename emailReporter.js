require('dotenv').config();
const nodemailer = require("nodemailer");

class EmailReporter {
  constructor() {
    this.steps = [];
    this.startTime = new Date();
  }

  onBegin(config, suite) {
    console.log("🚀 Test run started at", this.startTime.toISOString());
  }

  onTestEnd(test, result) {
    const timestamp = new Date();
    this.steps.push({
      name: test.title,
      status: result.status.toUpperCase(),
      timestamp,
      error: result.error ? result.error.message : "",
    });
    console.log(`[${timestamp.toISOString()}] ${test.title} - ${result.status.toUpperCase()}`);
  }

  async onEnd(result) {
    const endTime = new Date();
    const totalDuration = ((endTime - this.startTime) / 1000).toFixed(2);

    const htmlReport = `
      <h2>Playwright Test Automation Report</h2>
      <p><b>Start Time:</b> ${this.startTime.toISOString()}</p>
      <p><b>End Time:</b> ${endTime.toISOString()}</p>
      <p><b>Total Duration:</b> ${totalDuration} seconds</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th>Step Name</th>
          <th>Status</th>
          <th>Timestamp</th>
          <th>Error</th>
        </tr>
        ${this.steps
          .map(step => `
            <tr>
              <td>${step.name}</td>
              <td style="color:${step.status === "PASSED" ? "green" : "red"};">${step.status}</td>
              <td>${step.timestamp.toISOString()}</td>
              <td>${step.error || ""}</td>
            </tr>
          `).join('')}
      </table>
    `;

    // Configure SMTP relay from .env
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false }
    });

    try {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: "Playwright Test Automation Report",
        html: htmlReport
      });
      console.log("✔ Email report sent successfully via internal relay.");
    } catch (e) {
      console.error("❌ Failed to send email via internal relay:", e.message);
    }
  }

  logStep(stepName) {
    this.steps.push({
      name: stepName,
      status: "PASSED",
      timestamp: new Date(),
      error: ""
    });
  }

  logStepFail(stepName, error) {
    this.steps.push({
      name: stepName,
      status: "FAILED",
      timestamp: new Date(),
      error: error.message || String(error)
    });
  }
}

module.exports = EmailReporter;
