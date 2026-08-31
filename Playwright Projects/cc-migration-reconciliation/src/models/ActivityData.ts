import { FieldObservation } from '../extraction/FieldObservation';
import { BusinessKeyed } from './common';

/**
 * STUB shape — Section 9's field list. No activities-GRID reader exists in
 * the prototype yet. (A DIFFERENT thing is confirmed there: the activity
 * DETAIL FORM's workflow-completion question fields — "Was contact able to
 * be made?", "Subro Potential?" — are ExtJS comboboxes findable via
 * TreeWalker text-node search, see feedback_cc_activity_fields memory. That
 * is about DRIVING the form during test setup, not reading an activity's
 * business data for reconciliation, so it doesn't fill this model.)
 *
 * Business key: activityType + subject + dueDate — never the technical
 * activity id, which Section 9 explicitly says "may legitimately change
 * during migration."
 */
export interface ActivityData extends BusinessKeyed {
  activityType: FieldObservation;
  subject: FieldObservation;
  description: FieldObservation;
  status: FieldObservation;
  priority: FieldObservation;
  assignedUser: FieldObservation;
  assignedGroup: FieldObservation;
  dueDate: FieldObservation;
  creationDate: FieldObservation;
  completionDate: FieldObservation;
  escalationDate: FieldObservation;
  mandatory: FieldObservation<boolean | null>;
  relatedTo: FieldObservation;      // related claim/exposure
  activityPattern: FieldObservation;
  assignmentStatus: FieldObservation;
  technicalId: FieldObservation;    // captured for evidence; excluded from comparison by default
}

/**
 * CONFIRMED, both platforms — live pass against the "Workplan" grid.
 * `itemType` kept as NOT_PRESENT: no confirmed "type" column exists on
 * either platform's grid (real columns are Due/Priority/Status/Subject/
 * Description/Exposure/Assigned By/Assigned To) — extending with the real
 * fields rather than forcing them into the originally-assumed shape,
 * same reasoning as TransactionData's own doc comment.
 */
export interface WorkplanItemData extends BusinessKeyed {
  itemType: FieldObservation;   // not present on the grid — see doc comment
  subject: FieldObservation;
  description: FieldObservation;
  status: FieldObservation;
  priority: FieldObservation;
  dueDate: FieldObservation;
  assignedBy: FieldObservation;
  assignedTo: FieldObservation;
  exposure: FieldObservation;
}
