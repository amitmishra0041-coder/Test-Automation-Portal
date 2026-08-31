import { FieldObservation } from '../extraction/FieldObservation';
import { BusinessKeyed } from './common';

/**
 * CONFIRMED shape — ported from readExposuresOnPrem / readExposuresCloud in
 * the prototype. Both readers return a DYNAMIC set of grid columns (the
 * exposures grid's header row varies per LOB/config), not a fixed schema,
 * so this model mirrors that rather than pretending a fixed column list is
 * proven. Columns commonly observed: Claimant, Coverage, Type, Status.
 *
 * Business key (Section G): claimant + coverage + exposureType — never the
 * grid row index or a technical exposure id, both of which are unstable
 * across a migration.
 */
export interface ExposureData extends BusinessKeyed {
  columns: Record<string, FieldObservation>;
}

export function exposureBusinessKey(columns: Record<string, FieldObservation>): string {
  const claimant = columns['Claimant']?.value ?? '';
  const coverage = columns['Coverage']?.value ?? '';
  const type = columns['Type']?.value ?? '';
  return `${claimant}|${coverage}|${type}`;
}
