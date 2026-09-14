import { z } from 'zod';
import {
  ACTION_STATUSES,
  AUTHORITY_SCOPES,
  DECISION_SIGNIFICANCES,
  DECISION_STATUSES,
  DECISION_VISIBILITIES,
  ORGANISATION_STATUSES,
  ORG_ROLES,
  PRIORITIES,
  PROJECT_STATUSES,
  RELATIONSHIP_TYPES,
  RISK_LEVELS,
  RISK_STATUSES,
  TECHNOLOGY_STATUSES,
} from './domain.js';

const uuid = z.string().uuid();
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().max(20_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

/* ------------------------------------------------------------------ */
/* Platform / organisations                                            */
/* ------------------------------------------------------------------ */

export const createOrganisationSchema = z.object({
  name: shortText,
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'Use capitals, digits and hyphens only'),
  description: longText.optional(),
  country: z.string().trim().max(64).optional(),
  timezone: z.string().trim().max(64).default('Europe/London'),
  language: z.string().trim().max(16).default('en-GB'),
  primaryContactName: shortText.optional(),
  contactEmail: z.string().trim().email(),
  website: z.string().trim().url().optional().or(z.literal('')),
  logoUrl: z.string().trim().url().optional().or(z.literal('')),
  admin: z.object({
    name: shortText,
    email: z.string().trim().email(),
  }),
});
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;

export const updateOrganisationSchema = createOrganisationSchema
  .omit({ admin: true, code: true })
  .partial();

export const organisationStatusSchema = z.object({
  status: z.enum(ORGANISATION_STATUSES),
  reason: z.string().trim().max(2000).optional(),
});

/* ------------------------------------------------------------------ */
/* Users, teams, projects                                              */
/* ------------------------------------------------------------------ */

export const inviteUserSchema = z.object({
  name: shortText,
  email: z.string().trim().email(),
  jobTitle: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  roles: z.array(z.enum(ORG_ROLES)).min(1, 'Give the user at least one role'),
  teamIds: z.array(uuid).default([]),
  projectIds: z.array(uuid).default([]),
  disciplines: z.array(z.string().trim().max(80)).default([]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = inviteUserSchema.omit({ email: true }).partial().extend({
  status: z.enum(['invited', 'active', 'deactivated']).optional(),
});

export const teamSchema = z.object({
  name: shortText,
  description: longText.optional(),
  teamLeadId: uuid.nullish(),
  parentTeamId: uuid.nullish(),
  disciplines: z.array(z.string().trim().max(80)).default([]),
  memberIds: z.array(uuid).default([]),
});
export type TeamInput = z.infer<typeof teamSchema>;

export const projectSchema = z.object({
  name: shortText,
  code: z.string().trim().min(2).max(16),
  description: longText.optional(),
  managerId: uuid.nullish(),
  technicalLeadId: uuid.nullish(),
  status: z.enum(PROJECT_STATUSES).default('active'),
  startDate: isoDate.nullish(),
  targetEndDate: isoDate.nullish(),
  teamIds: z.array(uuid).default([]),
  memberIds: z.array(uuid).default([]),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const technologySchema = z.object({
  name: shortText,
  category: z.string().trim().min(1).max(80),
  version: z.string().trim().max(40).optional(),
  status: z.enum(TECHNOLOGY_STATUSES).default('under_review'),
  ownerTeamId: uuid.nullish(),
  supplier: z.string().trim().max(120).optional(),
  designation: z.enum(['strategic', 'tactical', 'undesignated']).default('undesignated'),
  introducedOn: isoDate.nullish(),
  reviewDate: isoDate.nullish(),
  documentationUrl: z.string().trim().url().optional().or(z.literal('')),
  notes: longText.optional(),
});
export type TechnologyInput = z.infer<typeof technologySchema>;

/* ------------------------------------------------------------------ */
/* Organisation configuration                                          */
/* ------------------------------------------------------------------ */

export const decisionTypeSchema = z.object({
  name: shortText,
  description: longText.optional(),
  requiresOrganisationAuthority: z.boolean().default(false),
  requiredReviews: z.array(z.string().trim().max(80)).default([]),
  isActive: z.boolean().default(true),
});

export const decisionCriterionSchema = z.object({
  name: shortText,
  description: longText.optional(),
  weight: z.number().int().min(0).max(100),
  isActive: z.boolean().default(true),
});

/** Weights across active criteria must total 100 (spec §26). */
export const criteriaSetSchema = z
  .array(decisionCriterionSchema)
  .refine(
    (criteria) =>
      criteria.filter((c) => c.isActive).reduce((total, c) => total + c.weight, 0) === 100,
    { message: 'Active criteria weights must total 100%' },
  );

export const authoritySchema = z.object({
  userId: uuid,
  scope: z.enum(AUTHORITY_SCOPES),
  title: z.string().trim().max(120).optional(),
  projectIds: z.array(uuid).default([]),
  domains: z.array(z.string().trim().max(80)).default([]),
  decisionTypeIds: z.array(uuid).default([]),
  maxSignificance: z.enum(DECISION_SIGNIFICANCES).default('critical'),
  isActive: z.boolean().default(true),
});
export type AuthorityInput = z.infer<typeof authoritySchema>;

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

export const createDecisionSchema = z.object({
  title: shortText,
  decisionTypeId: uuid,
  significance: z.enum(DECISION_SIGNIFICANCES),
  priority: z.enum(PRIORITIES).default('medium'),
  requiredBy: isoDate.nullish(),
  problem: longText.min(1, 'Describe the problem this decision resolves'),
  background: longText.optional(),
  desiredOutcome: longText.optional(),
  scope: longText.optional(),
  constraints: longText.optional(),
  requirements: longText.optional(),
  projectId: uuid.nullish(),
  ownerId: uuid.nullish(),
  authorityId: uuid.nullish(),
  technicalLeadId: uuid.nullish(),
  teamIds: z.array(uuid).default([]),
  technologyIds: z.array(uuid).default([]),
  contributorIds: z.array(uuid).default([]),
  stakeholderIds: z.array(uuid).default([]),
  visibility: z.enum(DECISION_VISIBILITIES).default('organisation'),
  tags: z.array(z.string().trim().max(40)).default([]),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const updateDecisionSchema = createDecisionSchema.partial().extend({
  recommendation: longText.optional(),
  recommendationRationale: longText.optional(),
  recommendedAlternativeId: uuid.nullish(),
  /** Optimistic concurrency — rejected if it does not match the stored version. */
  expectedVersion: z.string().trim().max(16).optional(),
});

export const alternativeSchema = z.object({
  name: shortText,
  description: longText.optional(),
  advantages: longText.optional(),
  disadvantages: longText.optional(),
  risks: longText.optional(),
  cost: longText.optional(),
  technicalImplications: longText.optional(),
  recommendation: longText.optional(),
  position: z.number().int().min(0).default(0),
});

export const assessmentSchema = z.object({
  alternativeId: uuid,
  criterionId: uuid,
  score: z.number().min(0).max(10),
  comment: z.string().trim().max(2000).optional(),
});

export const riskSchema = z.object({
  summary: shortText,
  description: longText.optional(),
  category: z.string().trim().max(80).optional(),
  probability: z.enum(RISK_LEVELS),
  impact: z.enum(RISK_LEVELS),
  mitigation: longText.optional(),
  ownerId: uuid.nullish(),
  residualProbability: z.enum(RISK_LEVELS).nullish(),
  residualImpact: z.enum(RISK_LEVELS).nullish(),
  status: z.enum(RISK_STATUSES).default('open'),
});
export type RiskInput = z.infer<typeof riskSchema>;

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  parentId: uuid.nullish(),
  kind: z.enum(['comment', 'question', 'response']).default('comment'),
});

export const relationshipSchema = z.object({
  targetDecisionId: uuid,
  type: z.enum(RELATIONSHIP_TYPES),
  note: z.string().trim().max(1000).optional(),
});

/* ------------------------------------------------------------------ */
/* Workflow transitions                                                */
/* ------------------------------------------------------------------ */

export const submitDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

const conditionSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  ownerId: uuid.nullish(),
  ownerTeamId: uuid.nullish(),
  dueDate: isoDate,
});

/**
 * The TDA outcome. Each branch carries exactly the evidence the spec
 * requires of it (§33) — a rationale is never optional on a formal decision.
 */
export const decisionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('approved'),
    rationale: z.string().trim().min(10, 'Record why this decision was approved'),
    decisionText: z.string().trim().min(1, 'State the decision that has been made'),
    effectiveDate: isoDate,
    comments: longText.optional(),
  }),
  z.object({
    outcome: z.literal('approved_with_conditions'),
    rationale: z.string().trim().min(10, 'Record why this decision was approved'),
    decisionText: z.string().trim().min(1, 'State the decision that has been made'),
    effectiveDate: isoDate,
    conditions: z.array(conditionSchema).min(1, 'Conditional approval requires conditions'),
    comments: longText.optional(),
  }),
  z.object({
    outcome: z.literal('rejected'),
    rationale: z.string().trim().min(10, 'Record why this decision was rejected'),
    comments: longText.optional(),
  }),
  z.object({
    outcome: z.literal('deferred'),
    rationale: z.string().trim().min(5, 'Record why this decision is deferred'),
    reviewDate: isoDate,
  }),
  z.object({
    outcome: z.literal('escalated'),
    rationale: z.string().trim().min(5, 'Record why this decision is escalated'),
    escalatedToUserId: uuid,
  }),
  z.object({
    outcome: z.literal('more_information_required'),
    rationale: z.string().trim().min(5, 'State what information is required'),
    assignedToUserId: uuid,
    dueDate: isoDate.nullish(),
  }),
]);
export type DecisionOutcomeInput = z.infer<typeof decisionOutcomeSchema>;

export const informationResponseSchema = z.object({
  response: z.string().trim().min(1).max(10_000),
  returnToReview: z.boolean().default(true),
});

export const supersedeDecisionSchema = z.object({
  supersedingDecisionId: uuid.nullish(),
  newDecision: createDecisionSchema.optional(),
  reason: z.string().trim().min(5).max(2000),
});

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export const actionSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  detail: longText.optional(),
  decisionId: uuid.nullish(),
  ownerId: uuid.nullish(),
  ownerTeamId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  priority: z.enum(PRIORITIES).default('medium'),
  status: z.enum(ACTION_STATUSES).default('not_started'),
});
export type ActionInput = z.infer<typeof actionSchema>;

export const updateActionSchema = actionSchema.partial().extend({
  completionNote: z.string().trim().max(4000).optional(),
});

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
  'application/zip',
] as const;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const requestUploadSchema = z.object({
  decisionId: uuid,
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES, {
    errorMap: () => ({ message: 'That file type is not accepted' }),
  }),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 50 MB or smaller'),
  description: z.string().trim().max(1000).optional(),
  version: z.string().trim().max(20).default('1.0'),
});

export const confirmUploadSchema = z.object({
  uploadId: uuid,
  storageKey: z.string().trim().min(1).max(500),
});

/* ------------------------------------------------------------------ */
/* Search & reporting                                                  */
/* ------------------------------------------------------------------ */

export const searchSchema = z.object({
  text: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(40).optional(),
  statuses: z.array(z.enum(DECISION_STATUSES)).optional(),
  decisionTypeIds: z.array(uuid).optional(),
  significances: z.array(z.enum(DECISION_SIGNIFICANCES)).optional(),
  priorities: z.array(z.enum(PRIORITIES)).optional(),
  ownerIds: z.array(uuid).optional(),
  authorityIds: z.array(uuid).optional(),
  contributorIds: z.array(uuid).optional(),
  projectIds: z.array(uuid).optional(),
  teamIds: z.array(uuid).optional(),
  technologyIds: z.array(uuid).optional(),
  riskRatings: z.array(z.enum(RISK_LEVELS)).optional(),
  createdFrom: isoDate.optional(),
  createdTo: isoDate.optional(),
  decidedFrom: isoDate.optional(),
  decidedTo: isoDate.optional(),
  requiredFrom: isoDate.optional(),
  requiredTo: isoDate.optional(),
  hasOpenActions: z.boolean().optional(),
  hasOverdueActions: z.boolean().optional(),
  sort: z
    .enum(['relevance', 'created_at', 'required_by', 'decided_at', 'priority', 'reference'])
    .default('created_at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
});
export type SearchInput = z.infer<typeof searchSchema>;

export const savedSearchSchema = z.object({
  name: shortText,
  criteria: searchSchema,
  isShared: z.boolean().default(false),
});

export const reportRequestSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  projectIds: z.array(uuid).default([]),
  decisionTypeIds: z.array(uuid).default([]),
  sections: z
    .object({
      executiveSummary: z.boolean().default(true),
      decisionsTaken: z.boolean().default(true),
      openDecisions: z.boolean().default(true),
      pendingDecisions: z.boolean().default(true),
      outstandingActions: z.boolean().default(true),
      risksAndExceptions: z.boolean().default(true),
      analytics: z.boolean().default(true),
    })
    .default({}),
  format: z.enum(['html', 'pdf', 'csv']).default('html'),
});
export type ReportRequest = z.infer<typeof reportRequestSchema>;
