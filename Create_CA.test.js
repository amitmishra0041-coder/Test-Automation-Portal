const { test } = require('@playwright/test');
const { blinqClick } = require('./utils/blinqClick');
const { submitPolicyForApproval } = require('./helpers/SFA_SFI_Workflow_simplified');

test('Run Guidewire workflow using Blinq locators', async ({ page, context }) => {
  // Increase test timeout for longer UI workflows that interact with PolicyCenter
  test.setTimeout(120000);
  const page1 = await context.newPage();

  // run your workflow up to Risk Analysis
  await submitPolicyForApproval(page, page1, "3003177722"); 

  // define Blinq-style locators
  const riskAnalysisLocators = [
    'internal:text="Risk Analysis"i',
    'internal:text="Risk Analysis"s',
    'div >> internal:has-text=/^Risk Analysis$/',
    'internal:text="QuQualificationPCPolicy"i >> div >> internal:has-text="Risk Analysis"i',
    'internal:text="QuQualificationPCPolicy ContractPIPolicy"i >> div >> internal:has-text="Risk Analysis"i'
  ];

  // click Risk Analysis on the same page we used for navigation (`page1`)
  const ok = await blinqClick(page1, riskAnalysisLocators, { aggressive: true });
  if (!ok) throw new Error("Risk Analysis click failed");
});
