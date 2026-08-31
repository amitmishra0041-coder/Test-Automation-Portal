import { Browser } from '@playwright/test';
import { EnvironmentConfig } from '../../config/environments';
import { Credentials, createAuthProvider } from '../auth';
import { openExistingClaim } from '../navigation/openExistingClaim';
import { navigationCatalog } from '../../config/navigation/navigationCatalog';
import { validateSection, compareDropdownRegions } from './sectionValidator';
import { ClaimUpdateResult, SectionUpdateResult } from '../models/DropdownValidation';
import { withRetry } from '../orchestration/retry';
import { logger } from '../logging/logger';

/**
 * Every catalog section that has a real, confirmed `navPath` — sections
 * still marked stub-with-no-confirmed-page (segmentation, coverage, …)
 * have no navPath at all and are skipped here; there's nothing to open
 * Edit on for a page that doesn't exist. This is the SAME catalog the
 * read-only reconciliation tool walks — this test reuses it rather than
 * keeping a second, separately-maintained section list.
 */
function sectionsWithNavPath() {
  return navigationCatalog.filter((s) => s.enabled && s.navPath && s.navPath.length > 0);
}

export interface UpdateValidationOptions {
  browser: Browser;
  claimNumber: string;
  cloudClaimNumber?: string;
  claimType?: string;
  envs: { onprem: EnvironmentConfig; cloud: EnvironmentConfig };
  credentials: Credentials;
}

export async function validateClaimUpdates(options: UpdateValidationOptions): Promise<ClaimUpdateResult> {
  const { browser, claimNumber, claimType, envs, credentials } = options;
  const cloudClaimNumber = options.cloudClaimNumber ?? claimNumber;

  const onpremContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const cloudContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const onpremPage = await onpremContext.newPage();
  const cloudPage = await cloudContext.newPage();

  try {
    const onpremAuth = createAuthProvider(envs.onprem);
    const cloudAuth = createAuthProvider(envs.cloud);

    try {
      await withRetry(`login onprem ${claimNumber}`, 2, () => onpremAuth.login(onpremPage, credentials));
      await withRetry(`login cloud ${cloudClaimNumber}`, 2, () => cloudAuth.login(cloudPage, credentials));
      await openExistingClaim(onpremPage, claimNumber, envs.onprem, onpremAuth, credentials);
      await openExistingClaim(cloudPage, cloudClaimNumber, envs.cloud, cloudAuth, credentials);
    } catch (err) {
      return {
        claimNumber, cloudClaimNumber, claimType, sections: [],
        technicalFailure: `LOGIN_OR_NAVIGATION_FAILURE: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const sections: SectionUpdateResult[] = [];
    for (const section of sectionsWithNavPath()) {
      try {
        const [onpremRegions, cloudRegions] = await Promise.all([
          validateSection(onpremPage, 'onprem', claimNumber, section.key, section.navPath as string[]),
          validateSection(cloudPage, 'cloud', cloudClaimNumber, section.key, section.navPath as string[]),
        ]);
        sections.push({
          sectionKey: section.key,
          sectionLabel: section.label,
          onpremRegions,
          cloudRegions,
          dropdownComparisons: compareDropdownRegions(onpremRegions, cloudRegions),
        });
      } catch (err) {
        logger.error('dropdown validation: section failed', {
          claimNumber, section: section.key, error: err instanceof Error ? err.message : String(err),
        });
        sections.push({ sectionKey: section.key, sectionLabel: section.label, onpremRegions: [], cloudRegions: [], dropdownComparisons: [] });
      }
    }

    return { claimNumber, cloudClaimNumber, claimType, sections };
  } finally {
    await onpremContext.close().catch(() => {});
    await cloudContext.close().catch(() => {});
  }
}
