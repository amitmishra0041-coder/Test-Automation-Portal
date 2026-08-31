/**
 * Result shapes for the "Data Update & Dropdown Validation" test — a
 * DIFFERENT kind of check from the read-only reconciliation tool: it opens
 * each section's Edit mode, compares the OPTION LISTS of dropdown/enum
 * fields between platforms (not their current values), then clicks Update
 * to confirm the underlying (old, possibly pre-migration) claim data can
 * still be saved cleanly — a real save failure here is a migration defect,
 * not a tool bug.
 */
export interface DropdownFieldOptions {
  fieldLabel: string;
  options: string[]; // rendered option/choice text, in DOM order, including any "<none>"-style placeholder
}

export interface DropdownComparison {
  fieldLabel: string;
  onpremOptions: string[] | null; // null = field not found on this platform
  cloudOptions: string[] | null;
  match: boolean; // same option SET (order-independent) on both sides
  onlyOnPrem: string[];
  onlyCloud: string[];
}

export interface UpdateResult {
  attempted: boolean;
  succeeded: boolean;
  errorMessage?: string;
}

/** One editable region (one "Edit" button and everything it opens) on one platform. */
export interface EditRegionResult {
  environment: 'onprem' | 'cloud';
  claimNumber: string;
  editButtonIndex: number; // 0, 1, 2, ... when a page has more than one independent Edit region
  fields: DropdownFieldOptions[];
  update: UpdateResult;
}

/** One catalog section's result for one claim pair — the on-prem/cloud edit regions found there (may be a different count on each side), plus the field-by-field dropdown comparison across whichever regions line up by index. */
export interface SectionUpdateResult {
  sectionKey: string;
  sectionLabel: string;
  onpremRegions: EditRegionResult[];
  cloudRegions: EditRegionResult[];
  dropdownComparisons: DropdownComparison[];
}

export interface ClaimUpdateResult {
  claimNumber: string; // on-prem claim number
  cloudClaimNumber: string;
  claimType?: string;
  sections: SectionUpdateResult[];
  technicalFailure?: string;
}

export interface UpdateValidationReport {
  generatedAt: string;
  tier: string;
  claims: ClaimUpdateResult[];
}
