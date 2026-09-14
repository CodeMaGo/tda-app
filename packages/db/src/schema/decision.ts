import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  actionStatusEnum,
  authorityScopeEnum,
  auditEventTypeEnum,
  commentKindEnum,
  decisionSignificanceEnum,
  decisionStatusEnum,
  decisionVisibilityEnum,
  notificationTypeEnum,
  primaryId,
  priorityEnum,
  relationshipTypeEnum,
  riskLevelEnum,
  riskStatusEnum,
  timestamps,
} from './common.js';
import { organisations, projects, teams, technologies, users } from './organisation.js';

/** Postgres `tsvector`, maintained by a generated column (see sql/search.sql). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/* ------------------------------------------------------------------ */
/* Organisation-configurable decision vocabulary                       */
/* ------------------------------------------------------------------ */

export const decisionTypes = pgTable(
  'decision_types',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Spec §47 — authority matrix. When true, only organisation-scope TDAs may decide. */
    requiresOrganisationAuthority: boolean('requires_organisation_authority')
      .notNull()
      .default(false),
    /** Named review gates, e.g. ['security', 'risk'] (spec §48). */
    requiredReviews: text('required_reviews').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('decision_types_org_name_key').on(t.organisationId, t.name),
    index('decision_types_org_idx').on(t.organisationId),
  ],
);

export const decisionCriteria = pgTable(
  'decision_criteria',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    weight: integer('weight').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('decision_criteria_org_name_key').on(t.organisationId, t.name),
    index('decision_criteria_org_idx').on(t.organisationId),
  ],
);

export const riskCategories = pgTable(
  'risk_categories',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('risk_categories_org_name_key').on(t.organisationId, t.name)],
);

/* ------------------------------------------------------------------ */
/* TDA authorities                                                     */
/* ------------------------------------------------------------------ */

export const tdaAuthorities = pgTable(
  'tda_authorities',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: authorityScopeEnum('scope').notNull(),
    title: text('title'),
    /** Highest significance this authority may decide alone. */
    maxSignificance: decisionSignificanceEnum('max_significance').notNull().default('critical'),
    domains: text('domains').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('tda_authorities_org_idx').on(t.organisationId, t.userId)],
);

export const authorityProjects = pgTable(
  'authority_projects',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    authorityId: uuid('authority_id')
      .notNull()
      .references(() => tdaAuthorities.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('authority_projects_key').on(t.authorityId, t.projectId)],
);

export const authorityDecisionTypes = pgTable(
  'authority_decision_types',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    authorityId: uuid('authority_id')
      .notNull()
      .references(() => tdaAuthorities.id, { onDelete: 'cascade' }),
    decisionTypeId: uuid('decision_type_id')
      .notNull()
      .references(() => decisionTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('authority_decision_types_key').on(t.authorityId, t.decisionTypeId)],
);

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

export const decisions = pgTable(
  'decisions',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** TDA-2026-0042 */
    reference: text('reference').notNull(),
    year: integer('year').notNull(),
    sequence: integer('sequence').notNull(),

    title: text('title').notNull(),
    decisionTypeId: uuid('decision_type_id').references(() => decisionTypes.id, {
      onDelete: 'restrict',
    }),
    significance: decisionSignificanceEnum('significance').notNull().default('significant'),
    priority: priorityEnum('priority').notNull().default('medium'),
    status: decisionStatusEnum('status').notNull().default('draft'),
    visibility: decisionVisibilityEnum('visibility').notNull().default('organisation'),

    // Context
    problem: text('problem'),
    background: text('background'),
    desiredOutcome: text('desired_outcome'),
    scope: text('scope'),
    constraints: text('constraints'),
    requirements: text('requirements'),

    // Ownership
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    authorityId: uuid('authority_id').references(() => users.id, { onDelete: 'set null' }),
    technicalLeadId: uuid('technical_lead_id').references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    // Recommendation — distinct from the decision itself (spec §29)
    recommendation: text('recommendation'),
    recommendationRationale: text('recommendation_rationale'),
    recommendedAlternativeId: uuid('recommended_alternative_id'),

    // Outcome
    decisionText: text('decision_text'),
    decisionRationale: text('decision_rationale'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    effectiveDate: date('effective_date'),
    deferredUntil: date('deferred_until'),
    escalatedToUserId: uuid('escalated_to_user_id').references(() => users.id),

    tags: text('tags').array().notNull().default([]),
    version: text('version').notNull().default('1.0'),

    requiredBy: date('required_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Frozen once a formal outcome is recorded (spec §65.10). */
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    searchVector: tsvector('search_vector'),
    ...timestamps,
  },
  (t) => [
    unique('decisions_org_reference_key').on(t.organisationId, t.reference),
    index('decisions_org_status_idx').on(t.organisationId, t.status),
    index('decisions_org_owner_idx').on(t.organisationId, t.ownerId),
    index('decisions_org_authority_idx').on(t.organisationId, t.authorityId),
    index('decisions_org_project_idx').on(t.organisationId, t.projectId),
    index('decisions_required_by_idx').on(t.organisationId, t.requiredBy),
    index('decisions_search_idx').using('gin', t.searchVector),
    index('decisions_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
  ],
);

export const decisionContributors = pgTable(
  'decision_contributors',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('contributor'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('decision_contributors_key').on(t.decisionId, t.userId, t.role),
    index('decision_contributors_user_idx').on(t.organisationId, t.userId),
  ],
);

export const decisionTeams = pgTable(
  'decision_teams',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('decision_teams_key').on(t.decisionId, t.teamId)],
);

export const decisionTechnologies = pgTable(
  'decision_technologies',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    technologyId: uuid('technology_id')
      .notNull()
      .references(() => technologies.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('decision_technologies_key').on(t.decisionId, t.technologyId),
    index('decision_technologies_tech_idx').on(t.organisationId, t.technologyId),
  ],
);

export const decisionRelationships = pgTable(
  'decision_relationships',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    sourceDecisionId: uuid('source_decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    targetDecisionId: uuid('target_decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    type: relationshipTypeEnum('type').notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('decision_relationships_key').on(t.sourceDecisionId, t.targetDecisionId, t.type),
    index('decision_relationships_source_idx').on(t.organisationId, t.sourceDecisionId),
  ],
);

/* ------------------------------------------------------------------ */
/* Alternatives and weighted assessment                                */
/* ------------------------------------------------------------------ */

export const alternatives = pgTable(
  'alternatives',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    advantages: text('advantages'),
    disadvantages: text('disadvantages'),
    risks: text('risks'),
    cost: text('cost'),
    technicalImplications: text('technical_implications'),
    recommendation: text('recommendation'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('alternatives_decision_idx').on(t.organisationId, t.decisionId)],
);

export const assessments = pgTable(
  'assessments',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    alternativeId: uuid('alternative_id')
      .notNull()
      .references(() => alternatives.id, { onDelete: 'cascade' }),
    criterionId: uuid('criterion_id')
      .notNull()
      .references(() => decisionCriteria.id, { onDelete: 'cascade' }),
    score: numeric('score', { precision: 4, scale: 2 }).notNull(),
    comment: text('comment'),
    assessedByUserId: uuid('assessed_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [unique('assessments_key').on(t.alternativeId, t.criterionId)],
);

/* ------------------------------------------------------------------ */
/* Risks                                                               */
/* ------------------------------------------------------------------ */

export const risks = pgTable(
  'risks',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    description: text('description'),
    category: text('category'),
    probability: riskLevelEnum('probability').notNull(),
    impact: riskLevelEnum('impact').notNull(),
    rating: riskLevelEnum('rating').notNull(),
    mitigation: text('mitigation'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    residualProbability: riskLevelEnum('residual_probability'),
    residualImpact: riskLevelEnum('residual_impact'),
    residualRating: riskLevelEnum('residual_rating'),
    status: riskStatusEnum('status').notNull().default('open'),
    ...timestamps,
  },
  (t) => [
    index('risks_decision_idx').on(t.organisationId, t.decisionId),
    index('risks_rating_idx').on(t.organisationId, t.rating, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Collaboration                                                       */
/* ------------------------------------------------------------------ */

export const comments = pgTable(
  'comments',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: commentKindEnum('kind').notNull().default('comment'),
    body: text('body').notNull(),
    /** Material comments are retracted, never destroyed (spec §30). */
    retractedAt: timestamp('retracted_at', { withTimezone: true }),
    retractedByUserId: uuid('retracted_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [index('comments_decision_idx').on(t.organisationId, t.decisionId)],
);

export const informationRequests = pgTable(
  'information_requests',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    assignedToUserId: uuid('assigned_to_user_id')
      .notNull()
      .references(() => users.id),
    request: text('request').notNull(),
    response: text('response'),
    dueDate: date('due_date'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('information_requests_decision_idx').on(t.organisationId, t.decisionId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    description: text('description'),
    version: text('version').notNull().default('1.0'),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** R2 object key. Always prefixed with the organisation id. */
    storageKey: text('storage_key').notNull().unique(),
    checksum: text('checksum'),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),
    uploadConfirmedAt: timestamp('upload_confirmed_at', { withTimezone: true }),
    scanStatus: text('scan_status').notNull().default('pending'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('attachments_decision_idx').on(t.organisationId, t.decisionId)],
);

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export const actions = pgTable(
  'actions',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    sequence: integer('sequence').notNull(),
    description: text('description').notNull(),
    detail: text('detail'),
    decisionId: uuid('decision_id').references(() => decisions.id, { onDelete: 'cascade' }),
    /** Set when the action was generated from an approval condition (spec §36). */
    conditionId: uuid('condition_id'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    ownerTeamId: uuid('owner_team_id').references(() => teams.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    priority: priorityEnum('priority').notNull().default('medium'),
    status: actionStatusEnum('status').notNull().default('not_started'),
    completionNote: text('completion_note'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
    dueSoonNotifiedAt: timestamp('due_soon_notified_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('actions_org_reference_key').on(t.organisationId, t.reference),
    index('actions_org_status_idx').on(t.organisationId, t.status),
    index('actions_owner_idx').on(t.organisationId, t.ownerId, t.status),
    index('actions_due_idx').on(t.organisationId, t.dueDate, t.status),
    index('actions_decision_idx').on(t.organisationId, t.decisionId),
  ],
);

export const decisionConditions = pgTable(
  'decision_conditions',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    ownerTeamId: uuid('owner_team_id').references(() => teams.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    satisfiedAt: timestamp('satisfied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('decision_conditions_decision_idx').on(t.organisationId, t.decisionId)],
);

/* ------------------------------------------------------------------ */
/* Audit and versioning                                                */
/* ------------------------------------------------------------------ */

/**
 * Append-only audit record (spec §43, §62). No update or delete path exists in
 * the application; the database revokes those rights from the app role.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryId,
    organisationId: uuid('organisation_id').references(() => organisations.id, {
      onDelete: 'restrict',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name'),
    eventType: auditEventTypeEnum('event_type').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id'),
    objectReference: text('object_reference'),
    oldStatus: text('old_status'),
    newStatus: text('new_status'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_org_time_idx').on(t.organisationId, t.occurredAt),
    index('audit_events_object_idx').on(t.organisationId, t.objectType, t.objectId),
  ],
);

/** Point-in-time snapshot of decision content, written on material change. */
export const decisionVersions = pgTable(
  'decision_versions',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    summary: text('summary').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('decision_versions_key').on(t.decisionId, t.version)],
);

/* ------------------------------------------------------------------ */
/* Notifications and saved searches                                    */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    linkPath: text('link_path'),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.organisationId, t.userId, t.readAt)],
);

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    criteria: jsonb('criteria').$type<Record<string, unknown>>().notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('saved_searches_key').on(t.organisationId, t.userId, t.name)],
);

export const generatedReports = pgTable(
  'generated_reports',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    generatedByUserId: uuid('generated_by_user_id')
      .notNull()
      .references(() => users.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    format: text('format').notNull(),
    storageKey: text('storage_key'),
    parameters: jsonb('parameters').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generated_reports_org_idx').on(t.organisationId, t.createdAt)],
);
