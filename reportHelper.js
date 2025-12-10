// reportHelper.js
const fs = require('fs');
const path = require('path');

class TestReport {
    constructor() {
        this.scenarios = [];
        this.currentScenario = null;
    }

    startScenario(name) {
        this.currentScenario = { name, steps: [] };
        this.scenarios.push(this.currentScenario);
    }

    addStep(stepName, status, duration) {
        if (this.currentScenario) {
            this.currentScenario.steps.push({ stepName, status, duration });
        }
    }

    endScenario() {
        this.currentScenario = null;
    }

    saveHtml(filePath) {
        let html = `<html><head><title>BOP Test Report</title></head><body>`;
        html += `<h1>BOP Automation Test Report</h1>`;

        this.scenarios.forEach((scenario) => {
            html += `<h2>Scenario: ${scenario.name}</h2>`;
            html += `<table border="1" cellpadding="5" cellspacing="0">
                        <tr><th>Step</th><th>Status</th><th>Duration (ms)</th></tr>`;
            scenario.steps.forEach((step) => {
                html += `<tr>
                            <td>${step.stepName}</td>
                            <td>${step.status}</td>
                            <td>${step.duration}</td>
                         </tr>`;
            });
            html += `</table><br/>`;
        });

        html += `</body></html>`;
        fs.writeFileSync(path.resolve(filePath), html, 'utf8');
    }
}

module.exports = { TestReport };
