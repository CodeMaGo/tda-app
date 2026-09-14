/**
 * Seeds a demo organisation. Safe to re-run — it clears and rebuilds ORG demo
 * data only. Never point this at production.
 */
import {
  DEFAULT_DECISION_TYPES,
  calculateRiskRating,
  formatActionReference,
  formatDecisionReference,
  formatOrganisationReference,
} from '@tda/shared';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import * as s from './schema/index.js';

const db = createDatabase();

const people = [
  { name: 'Jane Smith', email: 'jane.smith@acme.test', jobTitle: 'Principal Engineer', roles: ['decision_owner', 'contributor'] as const },
  { name: 'John Brown', email: 'john.brown@acme.test', jobTitle: 'Chief Architect', roles: ['tda_authority', 'contributor'] as const },
  { name: 'Sarah Jones', email: 'sarah.jones@acme.test', jobTitle: 'Head of Security Architecture', roles: ['tda_authority', 'reviewer'] as const },
  { name: 'David Smith', email: 'david.smith@acme.test', jobTitle: 'Infrastructure Lead', roles: ['tda_authority', 'contributor'] as const },
  { name: 'Sarah Wilson', email: 'sarah.wilson@acme.test', jobTitle: 'Security Engineer', roles: ['contributor'] as const },
  { name: 'Dana Jones', email: 'dana.jones@acme.test', jobTitle: 'Platform Engineer', roles: ['contributor'] as const },
  { name: 'Amina Khan', email: 'amina.khan@acme.test', jobTitle: 'Engineering Director', roles: ['org_admin', 'contributor'] as const },
];

async function main() {
  console.log('Seeding demo organisation...');

  await db.delete(s.organisations).where(eq(s.organisations.code, 'ACME'));

  const [org] = await db
    .insert(s.organisations)
    .values({
      reference: formatOrganisationReference(27),
      name: 'Acme Engineering Ltd',
      code: 'ACME',
      description: 'Demonstration organisation for the TDA platform.',
      status: 'active',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      contactEmail: 'governance@acme.test',
      settings: { onboardingComplete: true, actionReminderDaysBefore: 7 },
      decisionSequenceYear: new Date().getFullYear(),
      decisionSequence: 0,
    })
    .returning();
  if (!org) throw new Error('Failed to create organisation');

  // People -------------------------------------------------------------
  const userIds = new Map<string, string>();
  for (const person of people) {
    const [existing] = await db.select().from(s.users).where(eq(s.users.email, person.email));
    const user =
      existing ??
      (
        await db
          .insert(s.users)
          .values({ email: person.email, name: person.name })
          .returning()
      )[0]!;
    userIds.set(person.email, user.id);

    const [membership] = await db
      .insert(s.memberships)
      .values({
        organisationId: org.id,
        userId: user.id,
        jobTitle: person.jobTitle,
        status: 'active',
        activatedAt: new Date(),
      })
      .returning();

    await db.insert(s.membershipRoles).values(
      person.roles.map((role) => ({
        organisationId: org.id,
        membershipId: membership!.id,
        role,
      })),
    );
  }

  const id = (email: string) => userIds.get(email)!;

  // Teams --------------------------------------------------------------
  const teamRows = await db
    .insert(s.teams)
    .values(
      [
        ['Architecture', id('john.brown@acme.test')],
        ['Engineering', id('jane.smith@acme.test')],
        ['Cybersecurity', id('sarah.jones@acme.test')],
        ['Infrastructure', id('david.smith@acme.test')],
        ['Data', null],
        ['Operations', null],
        ['Quality Assurance', null],
      ].map(([name, lead]) => ({
        organisationId: org.id,
        name: name as string,
        teamLeadId: lead as string | null,
      })),
    )
    .returning();
  const team = (name: string) => teamRows.find((t) => t.name === name)!.id;

  // Projects -----------------------------------------------------------
  const projectRows = await db
    .insert(s.projects)
    .values([
      {
        organisationId: org.id,
        name: 'Customer Portal',
        code: 'CP-01',
        description: 'Replacement customer-facing portal.',
        managerId: id('amina.khan@acme.test'),
        technicalLeadId: id('jane.smith@acme.test'),
        status: 'active',
        startDate: '2026-01-06',
        targetEndDate: '2026-12-18',
      },
      {
        organisationId: org.id,
        name: 'Data Platform Migration',
        code: 'DP-02',
        managerId: id('amina.khan@acme.test'),
        technicalLeadId: id('david.smith@acme.test'),
        status: 'active',
        startDate: '2026-03-02',
      },
    ])
    .returning();
  const portal = projectRows[0]!;

  // Technologies -------------------------------------------------------
  const techRows = await db
    .insert(s.technologies)
    .values(
      (
        [
          ['Azure', 'Cloud', 'preferred', 'strategic'],
          ['AWS', 'Cloud', 'allowed', 'tactical'],
          ['Kubernetes', 'Containers', 'approved', 'strategic'],
          ['Terraform', 'DevOps', 'preferred', 'strategic'],
          ['PostgreSQL', 'Databases', 'preferred', 'strategic'],
          ['Kafka', 'Messaging', 'approved', 'tactical'],
          ['React', 'Frameworks', 'preferred', 'strategic'],
          ['.NET', 'Programming Languages', 'approved', 'strategic'],
          ['Python', 'Programming Languages', 'approved', 'strategic'],
        ] as const
      ).map(([name, category, status, designation]) => ({
        organisationId: org.id,
        name,
        category,
        status,
        designation,
        ownerTeamId: team('Architecture'),
      })),
    )
    .returning();
  const tech = (name: string) => techRows.find((t) => t.name === name)!.id;

  // Configuration ------------------------------------------------------
  const typeRows = await db
    .insert(s.decisionTypes)
    .values(
      DEFAULT_DECISION_TYPES.map((name, index) => ({
        organisationId: org.id,
        name,
        position: index,
        requiresOrganisationAuthority:
          name === 'Technical Exception' || name === 'Technical Standard',
        requiredReviews: name === 'Cybersecurity' ? ['security'] : [],
      })),
    )
    .returning();
  const type = (name: string) => typeRows.find((t) => t.name === name)!.id;

  const criterionRows = await db
    .insert(s.decisionCriteria)
    .values(
      (
        [
          ['Security', 25],
          ['Reliability', 20],
          ['Performance', 15],
          ['Cost', 15],
          ['Maintainability', 10],
          ['Scalability', 10],
          ['Strategic alignment', 5],
        ] as const
      ).map(([name, weight], index) => ({
        organisationId: org.id,
        name,
        weight,
        position: index,
      })),
    )
    .returning();

  await db.insert(s.riskCategories).values(
    ['Security', 'Availability', 'Cost', 'Delivery', 'Compliance', 'Supportability'].map(
      (name) => ({ organisationId: org.id, name }),
    ),
  );

  // Authorities --------------------------------------------------------
  const [orgAuthority] = await db
    .insert(s.tdaAuthorities)
    .values({
      organisationId: org.id,
      userId: id('john.brown@acme.test'),
      scope: 'organisation',
      title: 'Enterprise Architecture',
      maxSignificance: 'critical',
    })
    .returning();

  await db.insert(s.tdaAuthorities).values([
    {
      organisationId: org.id,
      userId: id('sarah.jones@acme.test'),
      scope: 'domain',
      title: 'Security Architecture',
      domains: ['Security', 'Cybersecurity'],
      maxSignificance: 'major',
    },
    {
      organisationId: org.id,
      userId: id('david.smith@acme.test'),
      scope: 'project',
      title: 'Infrastructure',
      maxSignificance: 'significant',
    },
  ]);
  void orgAuthority;

  // The worked example from the specification ---------------------------
  const year = new Date().getFullYear();
  const [decision] = await db
    .insert(s.decisions)
    .values({
      organisationId: org.id,
      reference: formatDecisionReference(year, 42),
      year,
      sequence: 42,
      title: 'Cloud Platform Selection',
      decisionTypeId: type('Technology Selection'),
      significance: 'major',
      priority: 'high',
      status: 'under_tda_review',
      problem:
        'The Customer Portal requires a managed cloud platform. The current estate is split across two providers, which duplicates operational tooling and security controls.',
      desiredOutcome:
        'A single strategic cloud platform for new customer-facing workloads, with a supported migration path for existing services.',
      constraints:
        'Must support UK data residency. Must integrate with existing Entra ID tenancy. No increase in run-rate above 10% in year one.',
      projectId: portal.id,
      ownerId: id('jane.smith@acme.test'),
      authorityId: id('john.brown@acme.test'),
      technicalLeadId: id('jane.smith@acme.test'),
      createdByUserId: id('jane.smith@acme.test'),
      recommendation: 'Option B — Azure',
      recommendationRationale:
        'Provides the best combination of security, integration with the existing estate, scalability and operational capability.',
      requiredBy: `${year}-09-18`,
      submittedAt: new Date(),
    })
    .returning();
  const d = decision!;

  await db.insert(s.decisionTechnologies).values(
    ['AWS', 'Azure', 'Kubernetes', 'Terraform'].map((name) => ({
      organisationId: org.id,
      decisionId: d.id,
      technologyId: tech(name),
    })),
  );

  await db.insert(s.decisionTeams).values(
    ['Architecture', 'Infrastructure', 'Cybersecurity'].map((name) => ({
      organisationId: org.id,
      decisionId: d.id,
      teamId: team(name),
    })),
  );

  await db.insert(s.decisionContributors).values(
    ['sarah.wilson@acme.test', 'dana.jones@acme.test', 'david.smith@acme.test'].map((email) => ({
      organisationId: org.id,
      decisionId: d.id,
      userId: id(email),
    })),
  );

  const altRows = await db
    .insert(s.alternatives)
    .values([
      {
        organisationId: org.id,
        decisionId: d.id,
        position: 0,
        name: 'Option A — AWS',
        description: 'Consolidate on AWS using EKS and RDS.',
        advantages: 'Deepest managed service catalogue. Existing team experience in the data group.',
        disadvantages: 'Second identity integration to maintain. Higher egress cost to on-premise.',
        cost: 'Estimated £412k over five years.',
      },
      {
        organisationId: org.id,
        decisionId: d.id,
        position: 1,
        name: 'Option B — Azure',
        description: 'Consolidate on Azure using AKS and Azure Database for PostgreSQL.',
        advantages:
          'Native Entra ID integration. UK South and UK West regions. Existing enterprise agreement.',
        disadvantages: 'Smaller in-house skill base; training required for two teams.',
        cost: 'Estimated £368k over five years.',
        recommendation: 'Recommended.',
      },
      {
        organisationId: org.id,
        decisionId: d.id,
        position: 2,
        name: 'Option C — Retain split estate',
        description: 'Continue with workloads distributed across both providers.',
        advantages: 'No migration effort in the short term.',
        disadvantages: 'Duplicated security tooling and two operating models. Highest run cost.',
        cost: 'Estimated £486k over five years.',
      },
    ])
    .returning();

  const scores: Record<string, number[]> = {
    'Option A — AWS': [7, 8, 8, 6, 7, 9, 6],
    'Option B — Azure': [9, 8, 7, 8, 8, 8, 9],
    'Option C — Retain split estate': [5, 6, 7, 4, 4, 6, 3],
  };
  await db.insert(s.assessments).values(
    altRows.flatMap((alt) =>
      criterionRows.map((criterion, index) => ({
        organisationId: org.id,
        decisionId: d.id,
        alternativeId: alt.id,
        criterionId: criterion.id,
        score: String(scores[alt.name]![index]!),
        assessedByUserId: id('jane.smith@acme.test'),
      })),
    ),
  );

  await db
    .update(s.decisions)
    .set({ recommendedAlternativeId: altRows[1]!.id })
    .where(eq(s.decisions.id, d.id));

  await db.insert(s.risks).values([
    {
      organisationId: org.id,
      decisionId: d.id,
      summary: 'Insufficient Azure operational experience at go-live',
      category: 'Delivery',
      probability: 'high',
      impact: 'medium',
      rating: calculateRiskRating('high', 'medium'),
      mitigation: 'Funded training programme for Infrastructure and Operations before migration.',
      ownerId: id('david.smith@acme.test'),
      residualProbability: 'low',
      residualImpact: 'medium',
      residualRating: calculateRiskRating('low', 'medium'),
      status: 'mitigating',
    },
    {
      organisationId: org.id,
      decisionId: d.id,
      summary: 'Data residency commitments not met by all managed services',
      category: 'Compliance',
      probability: 'medium',
      impact: 'critical',
      rating: calculateRiskRating('medium', 'critical'),
      mitigation: 'Service-by-service residency review before each workload is migrated.',
      ownerId: id('sarah.jones@acme.test'),
      status: 'open',
    },
  ]);

  await db.insert(s.comments).values([
    {
      organisationId: org.id,
      decisionId: d.id,
      userId: id('sarah.jones@acme.test'),
      kind: 'question',
      body: 'Has the five-year operating cost been reviewed against the current run-rate rather than list price?',
    },
    {
      organisationId: org.id,
      decisionId: d.id,
      userId: id('jane.smith@acme.test'),
      kind: 'response',
      body: 'Yes. The figures in each option are discounted under the existing enterprise agreement and reviewed with Finance.',
    },
  ]);

  await db.insert(s.actions).values([
    {
      organisationId: org.id,
      reference: formatActionReference(47),
      sequence: 47,
      description: 'Complete production security review',
      decisionId: d.id,
      ownerTeamId: team('Cybersecurity'),
      ownerId: id('sarah.jones@acme.test'),
      dueDate: `${year}-09-30`,
      priority: 'high',
      status: 'in_progress',
      createdByUserId: id('john.brown@acme.test'),
    },
    {
      organisationId: org.id,
      reference: formatActionReference(48),
      sequence: 48,
      description: 'Confirm UK data residency for each managed service in scope',
      decisionId: d.id,
      ownerId: id('sarah.wilson@acme.test'),
      dueDate: `${year}-08-29`,
      priority: 'high',
      status: 'not_started',
      createdByUserId: id('john.brown@acme.test'),
    },
  ]);

  await db.update(s.organisations).set({ decisionSequence: 42, actionSequence: 48 }).where(eq(s.organisations.id, org.id));

  await db.insert(s.auditEvents).values([
    {
      organisationId: org.id,
      userId: id('jane.smith@acme.test'),
      userName: 'Jane Smith',
      eventType: 'decision_created',
      objectType: 'decision',
      objectId: d.id,
      objectReference: d.reference,
      newStatus: 'draft',
    },
    {
      organisationId: org.id,
      userId: id('jane.smith@acme.test'),
      userName: 'Jane Smith',
      eventType: 'decision_submitted',
      objectType: 'decision',
      objectId: d.id,
      objectReference: d.reference,
      oldStatus: 'ready_for_review',
      newStatus: 'under_tda_review',
    },
  ]);

  console.log(`Seeded ${org.name} (${org.reference}) with decision ${d.reference}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
