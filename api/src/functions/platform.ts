import { app } from '@azure/functions';
import { getDatabase, schema as s } from '@tda/db';
import {
  createOrganisationSchema,
  DEFAULT_DECISION_TYPES,
  formatOrganisationReference,
  organisationStatusSchema,
} from '@tda/shared';
import { randomBytes, createHash } from 'node:crypto';
import { count, desc, eq, sql } from 'drizzle-orm';
import { audit } from '../core/audit.js';
import { withPlatform } from '../core/context.js';
import { conflict, json, readBody, uuidParam } from '../core/http.js';
import { sendEmails } from '../core/notify.js';

/**
 * Platform administration (spec §8–10).
 *
 * Super Admin is deliberately narrow: create organisations, move them through
 * their lifecycle, and invite the first administrator. It confers no authority
 * to read or decide anything inside an organisation (spec §65.15) — to do that,
 * a Super Admin must be given a membership like anyone else, and that grant is
 * itself audited.
 */

app.http('platformOverview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'platform/overview',
  handler: withPlatform(['platform:read'], async (ctx) => {
    const [orgStats] = await ctx.tx
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${s.organisations.status} = 'active')`.mapWith(Number),
        suspended: sql<number>`count(*) filter (where ${s.organisations.status} = 'suspended')`.mapWith(Number),
        archived: sql<number>`count(*) filter (where ${s.organisations.status} = 'archived')`.mapWith(Number),
        provisioning: sql<number>`count(*) filter (where ${s.organisations.status} = 'provisioning')`.mapWith(Number),
      })
      .from(s.organisations);

    const [users] = await ctx.tx.select({ value: count() }).from(s.memberships);
    const [decisions] = await ctx.tx.select({ value: count() }).from(s.decisions);

    const organisations = await ctx.tx
      .select({
        id: s.organisations.id,
        reference: s.organisations.reference,
        name: s.organisations.name,
        code: s.organisations.code,
        status: s.organisations.status,
        createdAt: s.organisations.createdAt,
        userCount: sql<number>`(select count(*) from memberships m where m.organisation_id = ${s.organisations.id})`.mapWith(Number),
        decisionCount: sql<number>`(select count(*) from decisions d where d.organisation_id = ${s.organisations.id})`.mapWith(Number),
      })
      .from(s.organisations)
      .orderBy(desc(s.organisations.createdAt));

    return json({
      counts: {
        organisations: orgStats?.total ?? 0,
        active: orgStats?.active ?? 0,
        suspended: orgStats?.suspended ?? 0,
        archived: orgStats?.archived ?? 0,
        provisioning: orgStats?.provisioning ?? 0,
        users: users?.value ?? 0,
        decisions: decisions?.value ?? 0,
      },
      organisations,
    });
  }),
});

app.http('platformCreateOrganisation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'platform/organisations',
  handler: withPlatform(['platform:create_organisation'], async (ctx) => {
    const input = await readBody(ctx.request, createOrganisationSchema);

    const [existing] = await ctx.tx
      .select({ id: s.organisations.id })
      .from(s.organisations)
      .where(eq(s.organisations.code, input.code));
    if (existing) throw conflict(`The code ${input.code} is already in use`);

    const [org] = await ctx.tx
      .insert(s.organisations)
      .values({
        reference: 'ORG-PENDING',
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        country: input.country ?? null,
        timezone: input.timezone,
        language: input.language,
        primaryContactName: input.primaryContactName ?? null,
        contactEmail: input.contactEmail,
        website: input.website || null,
        logoUrl: input.logoUrl || null,
        status: 'provisioning',
      })
      .returning();

    // The serial `sequence` column is only known after insert, so the
    // human-facing reference is written back immediately.
    const [withReference] = await ctx.tx
      .update(s.organisations)
      .set({ reference: formatOrganisationReference(org!.sequence) })
      .where(eq(s.organisations.id, org!.id))
      .returning();

    await seedOrganisationDefaults(ctx.tx, org!.id);

    const invitation = await inviteAdministrator(ctx.tx, {
      organisationId: org!.id,
      organisationName: input.name,
      name: input.admin.name,
      email: input.admin.email.toLowerCase(),
      invitedByUserId: ctx.session.userId,
    });

    await audit(ctx.tx, {
      organisationId: org!.id,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'organisation_created',
      objectType: 'organisation',
      objectId: org!.id,
      objectReference: withReference!.reference,
      newStatus: 'provisioning',
      details: { adminEmail: input.admin.email },
    });

    return json({ organisation: withReference, invitation: { email: invitation.email } }, 201);
  }),
});

app.http('platformSetOrganisationStatus', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'platform/organisations/{id}/status',
  handler: withPlatform(['platform:suspend_organisation'], async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, organisationStatusSchema);

    const [org] = await ctx.tx.select().from(s.organisations).where(eq(s.organisations.id, id));
    if (!org) throw conflict('That organisation no longer exists');

    // Archiving preserves everything; there is no destructive path here by
    // design (spec §10).
    const [updated] = await ctx.tx
      .update(s.organisations)
      .set({
        status: input.status,
        suspendedAt: input.status === 'suspended' ? new Date() : null,
        suspensionReason: input.status === 'suspended' ? (input.reason ?? null) : null,
        archivedAt: input.status === 'archived' ? new Date() : org.archivedAt,
      })
      .where(eq(s.organisations.id, id))
      .returning();

    await audit(ctx.tx, {
      organisationId: id,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'organisation_status_changed',
      objectType: 'organisation',
      objectId: id,
      objectReference: org.reference,
      oldStatus: org.status,
      newStatus: input.status,
      details: input.reason ? { reason: input.reason } : undefined,
    });

    return json(updated);
  }),
});

app.http('platformResendAdminInvite', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'platform/organisations/{id}/invite',
  handler: withPlatform(['platform:invite_org_admin'], async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const [org] = await ctx.tx.select().from(s.organisations).where(eq(s.organisations.id, id));
    if (!org) throw conflict('That organisation no longer exists');

    const [pending] = await ctx.tx
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.organisationId, id))
      .orderBy(desc(s.invitations.createdAt))
      .limit(1);
    if (!pending) throw conflict('There is no pending administrator invitation to resend');

    const invitation = await inviteAdministrator(ctx.tx, {
      organisationId: id,
      organisationName: org.name,
      name: pending.name,
      email: pending.email,
      invitedByUserId: ctx.session.userId,
    });
    return json({ email: invitation.email });
  }),
});

/* ------------------------------------------------------------------ */

type Tx = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0];

/** Every new organisation starts with a usable default configuration. */
async function seedOrganisationDefaults(tx: Tx, organisationId: string): Promise<void> {
  await tx.insert(s.decisionTypes).values(
    DEFAULT_DECISION_TYPES.map((name, position) => ({
      organisationId,
      name,
      position,
      requiresOrganisationAuthority:
        name === 'Technical Exception' || name === 'Technical Standard',
    })),
  );

  await tx.insert(s.decisionCriteria).values(
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
    ).map(([name, weight], position) => ({ organisationId, name, weight, position })),
  );

  await tx.insert(s.riskCategories).values(
    ['Security', 'Availability', 'Cost', 'Delivery', 'Compliance', 'Supportability'].map(
      (name) => ({ organisationId, name }),
    ),
  );
}

async function inviteAdministrator(
  tx: Tx,
  input: {
    organisationId: string;
    organisationName: string;
    name: string;
    email: string;
    invitedByUserId: string;
  },
): Promise<{ email: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await tx.insert(s.invitations).values({
    organisationId: input.organisationId,
    email: input.email,
    name: input.name,
    roles: ['org_admin'],
    tokenHash,
    expiresAt,
    invitedByUserId: input.invitedByUserId,
  });

  // Create the profile and membership up front so that the first sign-in with
  // this email address links straight through (see auth.linkByEmail).
  const [user] = await tx
    .insert(s.users)
    .values({ email: input.email, name: input.name })
    .onConflictDoUpdate({ target: s.users.email, set: { name: input.name } })
    .returning();

  const [membership] = await tx
    .insert(s.memberships)
    .values({
      organisationId: input.organisationId,
      userId: user!.id,
      status: 'active',
      invitedAt: new Date(),
      activatedAt: new Date(),
      jobTitle: 'Organisation administrator',
    })
    .onConflictDoNothing()
    .returning();

  if (membership) {
    await tx
      .insert(s.membershipRoles)
      .values({
        organisationId: input.organisationId,
        membershipId: membership.id,
        role: 'org_admin',
        grantedByUserId: input.invitedByUserId,
      })
      .onConflictDoNothing();
  }

  void sendEmails([
    {
      to: input.email,
      name: input.name,
      subject: `Set up ${input.organisationName} on the TDA platform`,
      body: `You have been made the administrator for ${input.organisationName}.\n\nSet a password to sign in, then work through the ten-step setup to configure teams, projects, your technical stack and TDA authorities.`,
      linkPath: `/accept-invitation?token=${token}`,
    },
  ]);

  return { email: input.email, token };
}

/** Exposed for tests. */
export { seedOrganisationDefaults };
