import { test, expect } from '@playwright/test';
import path from 'path';

import { extractPdfText } from './utils/pdf/pdfExtractor.mjs';
import { normalizeText } from './utils/pdf/pdfNormalizer.mjs';
import { parsePolicy } from './utils/pdf/policyParser.mjs';
import { comparePolicies } from './utils/pdf/policyComparator.mjs';

test('Compare policy PDFs from two processes', async ({ page }, testInfo) => {
  // ---- Process A ----
  await page.goto('/processA');

  const [downloadA] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#generatePolicy')
  ]);

  const pdfAPath = path.join(testInfo.outputDir, 'policyA.pdf');
  await downloadA.saveAs(pdfAPath);

  // ---- Process B ----
  await page.goto('/processB');

  const [downloadB] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#generatePolicy')
  ]);

  const pdfBPath = path.join(testInfo.outputDir, 'policyB.pdf');
  await downloadB.saveAs(pdfBPath);

  // ---- Extract & Normalize ----
  const textA = normalizeText(await extractPdfText(pdfAPath));
  const textB = normalizeText(await extractPdfText(pdfBPath));

  // ---- Parse ----
  const policyA = parsePolicy(textA);
  const policyB = parsePolicy(textB);

  // ---- Compare ----
  const differences = comparePolicies(policyA, policyB);

  // ---- Attach report ----
  testInfo.attach('PDF Policy Differences', {
    body: JSON.stringify(differences, null, 2),
    contentType: 'application/json'
  });

  // ---- Assertion ----
  expect(differences.length, 'Policy documents have differences').toBe(0);
});
