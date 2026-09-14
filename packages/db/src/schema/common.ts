import {
  ACTION_STATUSES,
  AUDIT_EVENT_TYPES,
  AUTHORITY_SCOPES,
  DECISION_SIGNIFICANCES,
  DECISION_STATUSES,
  DECISION_VISIBILITIES,
  NOTIFICATION_TYPES,
  ORGANISATION_STATUSES,
  ORG_ROLES,
  PRIORITIES,
  PROJECT_STATUSES,
  RELATIONSHIP_TYPES,
  RISK_LEVELS,
  RISK_STATUSES,
  TECHNOLOGY_STATUSES,
  USER_STATUSES,
} from '@tda/shared';
import { pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Postgres enums are generated from the shared domain constants so the database
 * and the application can never drift apart.
 */
export const organisationStatusEnum = pgEnum('organisation_status', ORGANISATION_STATUSES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const orgRoleEnum = pgEnum('org_role', ORG_ROLES);
export const decisionStatusEnum = pgEnum('decision_status', DECISION_STATUSES);
export const decisionSignificanceEnum = pgEnum('decision_significance', DECISION_SIGNIFICANCES);
export const decisionVisibilityEnum = pgEnum('decision_visibility', DECISION_VISIBILITIES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES);
export const technologyStatusEnum = pgEnum('technology_status', TECHNOLOGY_STATUSES);
export const riskLevelEnum = pgEnum('risk_level', RISK_LEVELS);
export const riskStatusEnum = pgEnum('risk_status', RISK_STATUSES);
export const actionStatusEnum = pgEnum('action_status', ACTION_STATUSES);
export const authorityScopeEnum = pgEnum('authority_scope', AUTHORITY_SCOPES);
export const relationshipTypeEnum = pgEnum('relationship_type', RELATIONSHIP_TYPES);
export const auditEventTypeEnum = pgEnum('audit_event_type', AUDIT_EVENT_TYPES);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
export const designationEnum = pgEnum('technology_designation', [
  'strategic',
  'tactical',
  'undesignated',
]);
export const commentKindEnum = pgEnum('comment_kind', ['comment', 'question', 'response']);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const primaryId = uuid('id').primaryKey().defaultRandom();
