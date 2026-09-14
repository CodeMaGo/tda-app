import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  designationEnum,
  orgRoleEnum,
  organisationStatusEnum,
  primaryId,
  projectStatusEnum,
  technologyStatusEnum,
  timestamps,
  userStatusEnum,
} from './common.js';

/* ------------------------------------------------------------------ */
/* Organisations                                                       */
/* ------------------------------------------------------------------ */

export const organisations = pgTable(
  'organisations',
  {
    id: primaryId,
    /** Human reference, e.g. ORG-00027 */
    reference: text('reference').notNull().unique(),
    sequence: serial('sequence').notNull(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    description: text('description'),
    status: organisationStatusEnum('status').notNull().default('provisioning'),
    country: text('country'),
    timezone: text('timezone').notNull().default('Europe/London'),
    language: text('language').notNull().default('en-GB'),
    primaryContactName: text('primary_contact_name'),
    contactEmail: text('contact_email').notNull(),
    website: text('website'),
    logoUrl: text('logo_url'),
    /** Per-organisation workflow and notification settings. */
    settings: jsonb('settings')
      .$type<{
        requireTechnicalReview?: boolean;
        requireSecurityReviewForTypes?: string[];
        notifyOnDecisionSubmitted?: boolean;
        actionReminderDaysBefore?: number;
        onboardingStep?: number;
        onboardingComplete?: boolean;
      }>()
      .notNull()
      .default({}),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Next decision sequence number, per calendar year. */
    decisionSequenceYear: integer('decision_sequence_year').notNull().default(0),
    decisionSequence: integer('decision_sequence').notNull().default(0),
    actionSequence: integer('action_sequence').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('organisations_status_idx').on(t.status)],
);

/* ------------------------------------------------------------------ */
/* Users and membership                                                */
/* ------------------------------------------------------------------ */

/**
 * Application-level user profile. The credential itself lives in Supabase Auth;
 * `authUserId` is the link. A person with accounts in two organisations has one
 * auth user and two membership rows.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId,
    authUserId: uuid('auth_user_id').unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('users_auth_idx').on(t.authUserId)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobTitle: text('job_title'),
    department: text('department'),
    disciplines: text('disciplines').array().notNull().default([]),
    status: userStatusEnum('status').notNull().default('invited'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('memberships_org_user_key').on(t.organisationId, t.userId),
    index('memberships_org_idx').on(t.organisationId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
  },
  (t) => [
    unique('membership_roles_key').on(t.membershipId, t.role),
    index('membership_roles_org_idx').on(t.organisationId),
  ],
);

/** Pending invitations, both for org admins (from Super Admin) and users. */
export const invitations = pgTable(
  'invitations',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    roles: orgRoleEnum('roles').array().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('invitations_org_idx').on(t.organisationId),
    index('invitations_email_idx').on(t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

export const teams = pgTable(
  'teams',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    teamLeadId: uuid('team_lead_id').references(() => users.id, { onDelete: 'set null' }),
    parentTeamId: uuid('parent_team_id'),
    disciplines: text('disciplines').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('teams_org_name_key').on(t.organisationId, t.name),
    index('teams_org_idx').on(t.organisationId),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('team_members_key').on(t.teamId, t.userId),
    index('team_members_org_idx').on(t.organisationId),
  ],
);

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export const projects = pgTable(
  'projects',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    technicalLeadId: uuid('technical_lead_id').references(() => users.id, { onDelete: 'set null' }),
    status: projectStatusEnum('status').notNull().default('active'),
    startDate: date('start_date'),
    targetEndDate: date('target_end_date'),
    ...timestamps,
  },
  (t) => [
    unique('projects_org_code_key').on(t.organisationId, t.code),
    index('projects_org_idx').on(t.organisationId),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('project_members_key').on(t.projectId, t.userId),
    index('project_members_org_idx').on(t.organisationId),
    index('project_members_user_idx').on(t.userId),
  ],
);

export const projectTeams = pgTable(
  'project_teams',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('project_teams_key').on(t.projectId, t.teamId)],
);

/* ------------------------------------------------------------------ */
/* Technology catalogue                                                */
/* ------------------------------------------------------------------ */

export const technologies = pgTable(
  'technologies',
  {
    id: primaryId,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    version: text('version'),
    status: technologyStatusEnum('status').notNull().default('under_review'),
    ownerTeamId: uuid('owner_team_id').references(() => teams.id, { onDelete: 'set null' }),
    supplier: text('supplier'),
    designation: designationEnum('designation').notNull().default('undesignated'),
    introducedOn: date('introduced_on'),
    reviewDate: date('review_date'),
    documentationUrl: text('documentation_url'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    unique('technologies_org_name_version_key').on(t.organisationId, t.name, t.version),
    index('technologies_org_idx').on(t.organisationId),
    index('technologies_category_idx').on(t.organisationId, t.category),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const organisationsRelations = relations(organisations, ({ many }) => ({
  memberships: many(memberships),
  teams: many(teams),
  projects: many(projects),
  technologies: many(technologies),
}));

export const membershipsRelations = relations(memberships, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [memberships.organisationId],
    references: [organisations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  roles: many(membershipRoles),
}));

export const membershipRolesRelations = relations(membershipRoles, ({ one }) => ({
  membership: one(memberships, {
    fields: [membershipRoles.membershipId],
    references: [memberships.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [teams.organisationId],
    references: [organisations.id],
  }),
  lead: one(users, { fields: [teams.teamLeadId], references: [users.id] }),
  members: many(teamMembers),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [projects.organisationId],
    references: [organisations.id],
  }),
  manager: one(users, { fields: [projects.managerId], references: [users.id] }),
  members: many(projectMembers),
}));
