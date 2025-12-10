// stepLogger.js
class StepLogger {
  constructor() {
    this.steps = [];
    this.startTime = new Date();
  }

  logStep(name, status = "PASS") {
    const timestamp = new Date();
    this.steps.push({ name, status, timestamp });
    console.log(`[${timestamp.toISOString()}] ${name} - ${status}`);
  }

  failStep(name, error) {
    const timestamp = new Date();
    this.steps.push({ name, status: "FAIL", timestamp, error: error.message || error });
    console.error(`[${timestamp.toISOString()}] ${name} - FAIL: ${error}`);
  }

  getDuration() {
    return ((new Date()) - this.startTime) / 1000; // duration in seconds
  }
}

module.exports = StepLogger;
