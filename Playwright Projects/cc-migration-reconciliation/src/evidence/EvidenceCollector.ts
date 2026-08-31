import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../comparison/types';
import { logger } from '../logging/logger';

export type ScreenshotPolicy = 'unexpected-only' | 'all' | 'none';

export interface Evidence {
  findingPath: string;
  claimNumber: string;
  onpremScreenshot?: string;
  cloudScreenshot?: string;
  capturedAt: string;
}

const NEEDS_EVIDENCE: ReadonlySet<string> = new Set(['UNEXPECTED_DIFFERENCE', 'MISMATCH', 'MISSING_IN_CLOUD', 'MISSING_ON_PREM', 'EXTRA_TRANSACTION']);

/**
 * Captures a screenshot per environment for findings that warrant it
 * (Section 18) — never for MATCH/EXPECTED_DIFFERENCE/INFO, which would
 * just burn disk space and slow the run for findings nobody needs to look
 * at. `unexpected-only` (default) captures only findings whose
 * classification is in NEEDS_EVIDENCE; `all` captures every non-MATCH
 * finding; `none` disables capture entirely (useful for a fast smoke run).
 */
export class EvidenceCollector {
  private readonly evidenceDir: string;
  private readonly policy: ScreenshotPolicy;

  constructor(evidenceDir = process.env.EVIDENCE_DIR ?? 'evidence', policy: ScreenshotPolicy = (process.env.SCREENSHOT_ON as ScreenshotPolicy) ?? 'unexpected-only') {
    this.evidenceDir = evidenceDir;
    this.policy = policy;
  }

  private shouldCapture(finding: Finding): boolean {
    if (this.policy === 'none') return false;
    if (this.policy === 'all') return finding.classification !== 'MATCH';
    return NEEDS_EVIDENCE.has(finding.classification);
  }

  async capture(finding: Finding, onpremPage: Page | null, cloudPage: Page | null): Promise<Evidence | null> {
    if (!this.shouldCapture(finding)) return null;

    const dir = path.join(this.evidenceDir, finding.claimNumber);
    fs.mkdirSync(dir, { recursive: true });
    const safePath = finding.path.replace(/[^\w.-]/g, '_').slice(0, 120);
    const ts = Date.now();

    const evidence: Evidence = { findingPath: finding.path, claimNumber: finding.claimNumber, capturedAt: new Date().toISOString() };

    if (onpremPage && !onpremPage.isClosed()) {
      const file = path.join(dir, `onprem-${safePath}-${ts}.png`);
      await onpremPage.screenshot({ path: file }).then(() => { evidence.onpremScreenshot = file; }).catch((e) => {
        logger.warn('EvidenceCollector: on-prem screenshot failed', { claimNumber: finding.claimNumber, error: String(e) });
      });
    }
    if (cloudPage && !cloudPage.isClosed()) {
      const file = path.join(dir, `cloud-${safePath}-${ts}.png`);
      await cloudPage.screenshot({ path: file }).then(() => { evidence.cloudScreenshot = file; }).catch((e) => {
        logger.warn('EvidenceCollector: cloud screenshot failed', { claimNumber: finding.claimNumber, error: String(e) });
      });
    }

    return evidence;
  }
}
