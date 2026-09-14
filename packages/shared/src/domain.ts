/**
 * Core domain vocabulary for the TDA platform.
 *
 * These values are the single source of truth. The Drizzle schema builds its
 * Postgres enums from these arrays, the Zod schemas validate against them, and
 * the UI renders their labels. Changing a value here is a migration.
 */

export const PLATFORM_ROLES = ['super_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Roles held *within* an organisation. A user may hold several. */
export const ORG_ROLES = [
  'org_admin',
  'tda_authority',
  'decision_owner',
  'contributor',
  'reviewer',
  'viewer',
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  org_admin: 'Organisation admin',
  tda_authority: 'TDA authority',
  decision_owner: 'Decision owner',
  contributor: 'Contributor',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

export const ORGANISATION_STATUSES = [
  'provisioning',
  'active',
  'suspended',
  'archived',
] as const;
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

export const DECISION_STATUSES = [
  'draft',
  'submitted',
  'under_analysis',
  'ready_for_review',
  'under_tda_review',
  'more_information_required',
  'approved',
  'approved_with_conditions',
  'rejected',
  'deferred',
  'escalated',
  'implementation',
  'implemented',
  'closed',
  'withdrawn',
  'superseded',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_analysis: 'Under analysis',
  ready_for_review: 'Ready for review',
  under_tda_review: 'Under TDA review',
  more_information_required: 'More information required',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
  deferred: 'Deferred',
  escalated: 'Escalated',
  implementation: 'Implementation',
  implemented: 'Implemented',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
  superseded: 'Superseded',
};

/** Statuses that mean the decision is still live work. */
export const OPEN_DECISION_STATUSES: readonly DecisionStatus[] = [
  'draft',
  'submitted',
  'under_analysis',
  'ready_for_review',
  'under_tda_review',
  'more_information_required',
  'deferred',
  'escalated',
  'approved',
  'approved_with_conditions',
  'implementation',
];

/** Statuses awaiting someone else before the decision can progress. */
export const PENDING_DECISION_STATUSES: readonly DecisionStatus[] = [
  'submitted',
  'under_analysis',
  'ready_for_review',
  'under_tda_review',
  'more_information_required',
  'escalated',
];

/** Statuses where a formal outcome has been recorded. */
export const DECIDED_DECISION_STATUSES: readonly DecisionStatus[] = [
  'approved',
  'approved_with_conditions',
  'rejected',
  'implementation',
  'implemented',
  'closed',
  'superseded',
];

/**
 * Permitted lifecycle transitions (spec §21).
 * Anything not listed here is rejected by the workflow engine.
 */
export const DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_analysis', 'draft', 'withdrawn'],
  under_analysis: ['ready_for_review', 'withdrawn'],
  ready_for_review: ['under_tda_review', 'under_analysis', 'withdrawn'],
  under_tda_review: [
    'more_information_required',
    'approved',
    'approved_with_conditions',
    'rejected',
    'deferred',
    'escalated',
  ],
  more_information_required: ['under_analysis', 'under_tda_review'],
  approved: ['implementation', 'superseded'],
  approved_with_conditions: ['implementation', 'superseded'],
  rejected: ['closed', 'superseded'],
  deferred: ['under_tda_review', 'withdrawn'],
  escalated: ['under_tda_review', 'approved', 'approved_with_conditions', 'rejected'],
  implementation: ['implemented', 'superseded'],
  implemented: ['closed'],
  closed: ['superseded'],
  withdrawn: [],
  superseded: [],
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return DECISION_TRANSITIONS[from].includes(to);
}

export const DECISION_SIGNIFICANCES = ['routine', 'significant', 'major', 'critical'] as const;
export type DecisionSignificance = (typeof DECISION_SIGNIFICANCES)[number];

export const SIGNIFICANCE_LABELS: Record<DecisionSignificance, string> = {
  routine: 'Level 1 — Routine',
  significant: 'Level 2 — Significant',
  major: 'Level 3 — Major',
  critical: 'Level 4 — Critical',
};

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_DECISION_TYPES = [
  'Architecture',
  'Infrastructure',
  'Software',
  'Cybersecurity',
  'Data',
  'Integration',
  'Technology Selection',
  'Technical Risk',
  'Technical Exception',
  'Technical Standard',
] as const;

export const DECISION_VISIBILITIES = ['organisation', 'project', 'restricted'] as const;
export type DecisionVisibility = (typeof DECISION_VISIBILITIES)[number];

export const RELATIONSHIP_TYPES = [
  'related_to',
  'depends_on',
  'supersedes',
  'superseded_by',
  'derived_from',
  'conflicts_with',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** The inverse relationship written on the far side of the link. */
export const INVERSE_RELATIONSHIP: Record<RelationshipType, RelationshipType> = {
  related_to: 'related_to',
  depends_on: 'related_to',
  supersedes: 'superseded_by',
  superseded_by: 'supersedes',
  derived_from: 'related_to',
  conflicts_with: 'conflicts_with',
};

/* ------------------------------------------------------------------ */
/* Authority                                                           */
/* ------------------------------------------------------------------ */

export const AUTHORITY_SCOPES = ['organisation', 'project', 'domain'] as const;
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

/* ------------------------------------------------------------------ */
/* Risks, actions, technology                                          */
/* ------------------------------------------------------------------ */

export const RISK_LEVELS = ['very_low', 'low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_STATUSES = ['open', 'mitigating', 'mitigated', 'accepted', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const ACTION_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'complete',
  'cancelled',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export const OPEN_ACTION_STATUSES: readonly ActionStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
];

export const TECHNOLOGY_STATUSES = [
  'preferred',
  'approved',
  'allowed',
  'experimental',
  'under_review',
  'deprecated',
  'prohibited',
] as const;
export type TechnologyStatus = (typeof TECHNOLOGY_STATUSES)[number];

export const TECHNOLOGY_CATEGORIES = [
  'Cloud',
  'Programming Languages',
  'Frameworks',
  'Databases',
  'Operating Systems',
  'Infrastructure',
  'Containers',
  'Messaging',
  'Identity',
  'Security',
  'Monitoring',
  'DevOps',
  'Data Platforms',
  'AI/ML',
] as const;

export const PROJECT_STATUSES = [
  'planning',
  'active',
  'on_hold',
  'complete',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export const AUDIT_EVENT_TYPES = [
  'organisation_created',
  'organisation_status_changed',
  'user_invited',
  'user_activated',
  'user_deactivated',
  'user_roles_changed',
  'decision_created',
  'decision_updated',
  'decision_status_changed',
  'decision_submitted',
  'decision_approved',
  'decision_approved_with_conditions',
  'decision_rejected',
  'decision_deferred',
  'decision_escalated',
  'information_requested',
  'information_provided',
  'decision_superseded',
  'contributor_added',
  'contributor_removed',
  'comment_added',
  'attachment_uploaded',
  'attachment_removed',
  'risk_recorded',
  'action_created',
  'action_assigned',
  'action_completed',
  'action_overdue',
  'report_generated',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_TYPES = [
  'decision_assigned',
  'contributor_added',
  'action_assigned',
  'information_requested',
  'decision_submitted_for_review',
  'decision_approved',
  'decision_rejected',
  'decision_deferred',
  'decision_escalated',
  'action_due_soon',
  'action_overdue',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Risk rating matrix: probability x impact -> rating (spec §28). */
export function calculateRiskRating(probability: RiskLevel, impact: RiskLevel): RiskLevel {
  const score = (RISK_LEVELS.indexOf(probability) + 1) * (RISK_LEVELS.indexOf(impact) + 1);
  if (score >= 20) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  if (score >= 3) return 'low';
  return 'very_low';
}

/** Reference format: TDA-2026-0042 */
export function formatDecisionReference(year: number, sequence: number): string {
  return `TDA-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Reference format: ACTION-0047 */
export function formatActionReference(sequence: number): string {
  return `ACTION-${String(sequence).padStart(4, '0')}`;
}

/** Reference format: ORG-00027 */
export function formatOrganisationReference(sequence: number): string {
  return `ORG-${String(sequence).padStart(5, '0')}`;
}
