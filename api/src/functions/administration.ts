import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import {
  authoritySchema,
  criteriaSetSchema,
  decisionTypeSchema,
  inviteUserSchema,
  projectSchema,
  teamSchema,
  technologySchema,
  updateOrganisationSchema,
  updateUserSchema,
} from '@tda/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { audit } from '../core/audit.js';
import type { RequestContext } from '../core/context.js';
import { withOrg } from '../core/context.js';
import { conflict, json, noContent, notFound, readBody, unprocessable, uuidParam } from '../core/http.js';
import { sendEmails } from '../core/notify.js';

/* ------------------------------------------------------------------ */
/* Reference data — everything the decision forms need in one call     */
/* ------------------------------------------------------------------ */

app.http('referenceData', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reference-data',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    const [people, teams, projects, technologies, types, criteria, riskCategories, authorities] =
      await Promise.all([
        ctx.tx
          .select({
            id: s.users.id,
            name: s.users.name,
            email: s.users.email,
            jobTitle: s.memberships.jobTitle,
            status: s.memberships.status,
          })
          .from(s.memberships)
          .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
          .where(ctx.scope.where(s.memberships, eq(s.memberships.status, 'active')))
          .orderBy(asc(s.users.name)),
        ctx.tx.select().from(s.teams).where(ctx.scope.where(s.teams)).orderBy(asc(s.teams.name)),
        ctx.tx
          .select()
          .from(s.projects)
          .where(ctx.scope.where(s.projects))
          .orderBy(asc(s.projects.name)),
        ctx.tx
          .select()
          .from(s.technologies)
          .where(ctx.scope.where(s.technologies))
          .orderBy(asc(s.technologies.category), asc(s.technologies.name)),
        ctx.tx
          .select()
          .from(s.decisionTypes)
          .where(ctx.scope.where(s.decisionTypes, eq(s.decisionTypes.isActive, true)))
          .orderBy(asc(s.decisionTypes.position)),
        ctx.tx
          .select()
          .from(s.decisionCriteria)
          .where(ctx.scope.where(s.decisionCriteria, eq(s.decisionCriteria.isActive, true)))
          .orderBy(asc(s.decisionCriteria.position)),
        ctx.tx
          .select()
          .from(s.riskCategories)
          .where(ctx.scope.where(s.riskCategories))
          .orderBy(asc(s.riskCategories.name)),
        ctx.tx
          .select({
            id: s.tdaAuthorities.id,
            userId: s.tdaAuthorities.userId,
            name: s.users.name,
            scope: s.tdaAuthorities.scope,
            title: s.tdaAuthorities.title,
            maxSignificance: s.tdaAuthorities.maxSignificance,
            domains: s.tdaAuthorities.domains,
          })
          .from(s.tdaAuthorities)
          .innerJoin(s.users, eq(s.users.id, s.tdaAuthorities.userId))
          .where(ctx.scope.where(s.tdaAuthorities, eq(s.tdaAuthorities.isActive, true))),
      ]);

    return json({ people, teams, projects, technologies, types, criteria, riskCategories, authorities });
  }),
});

/* ------------------------------------------------------------------ */
/* Organisation profile                                                */
/* ------------------------------------------------------------------ */

app.http('organisationGet', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'organisation',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    if (ctx.request.method === 'PATCH') {
      ctx.require('org:update');
      const input = await readBody(ctx.request, updateOrganisationSchema);
      const [updated] = await ctx.tx
        .update(s.organisations)
        .set({
          ...input,
          website: input.website || null,
          logoUrl: input.logoUrl || null,
        })
        .where(eq(s.organisations.id, ctx.scope.organisationId))
        .returning();
      return json(updated);
    }

    const [org] = await ctx.tx
      .select()
      .from(s.organisations)
      .where(eq(s.organisations.id, ctx.scope.organisationId));
    return json(org);
  }),
});

/** Records progress through the ten-step setup (spec §11). */
app.http('organisationOnboarding', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'organisation/onboarding',
  handler: withOrg({ permissions: ['org:manage_config'] }, async (ctx) => {
    const body = (await ctx.request.json()) as { step?: number; complete?: boolean };
    const [org] = await ctx.tx
      .select()
      .from(s.organisations)
      .where(eq(s.organisations.id, ctx.scope.organisationId));

    const settings = {
      ...(org?.settings ?? {}),
      onboardingStep: body.step ?? org?.settings.onboardingStep ?? 1,
      onboardingComplete: body.complete ?? org?.settings.onboardingComplete ?? false,
    };

    const [updated] = await ctx.tx
      .update(s.organisations)
      .set({ settings, status: body.complete ? 'active' : org!.status })
      .where(eq(s.organisations.id, ctx.scope.organisationId))
      .returning();
    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

app.http('userList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users',
  handler: withOrg({ permissions: ['org:manage_users'] }, async (ctx) => {
    const rows = await ctx.tx
      .select({
        membershipId: s.memberships.id,
        userId: s.users.id,
        name: s.users.name,
        email: s.users.email,
        jobTitle: s.memberships.jobTitle,
        department: s.memberships.department,
        disciplines: s.memberships.disciplines,
        status: s.memberships.status,
        lastSignInAt: s.users.lastSignInAt,
        roles: sql<string[]>`coalesce(array_agg(${s.membershipRoles.role}) filter (where ${s.membershipRoles.role} is not null), '{}')`,
      })
      .from(s.memberships)
      .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
      .leftJoin(s.membershipRoles, eq(s.membershipRoles.membershipId, s.memberships.id))
      .where(ctx.scope.where(s.memberships))
      .groupBy(s.memberships.id, s.users.id)
      .orderBy(asc(s.users.name));
    return json({ items: rows });
  }),
});

app.http('userInvite', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users',
  handler: withOrg({ permissions: ['org:manage_users'] }, async (ctx) => {
    const input = await readBody(ctx.request, inviteUserSchema);
    const email = input.email.toLowerCase();

    const [user] = await ctx.tx
      .insert(s.users)
      .values({ email, name: input.name })
      .onConflictDoUpdate({ target: s.users.email, set: { name: input.name } })
      .returning();

    const [existing] = await ctx.tx
      .select()
      .from(s.memberships)
      .where(ctx.scope.where(s.memberships, eq(s.memberships.userId, user!.id)));
    if (existing) throw conflict(`${input.name} is already a member of this organisation`);

    const [membership] = await ctx.tx
      .insert(s.memberships)
      .values(
        ctx.scope.own({
          userId: user!.id,
          jobTitle: input.jobTitle ?? null,
          department: input.department ?? null,
          disciplines: input.disciplines,
          status: 'active' as const,
          invitedAt: new Date(),
          activatedAt: new Date(),
        }),
      )
      .returning();

    await ctx.tx.insert(s.membershipRoles).values(
      input.roles.map((role) =>
        ctx.scope.own({ membershipId: membership!.id, role, grantedByUserId: ctx.session.userId }),
      ),
    );

    await setTeamsAndProjects(ctx, user!.id, (input.teamIds ?? []), (input.projectIds ?? []));

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'user_invited',
      objectType: 'user',
      objectId: user!.id,
      details: { email, roles: input.roles },
    });

    void sendEmails([
      {
        to: email,
        name: input.name,
        subject: `You have been added to ${ctx.session.organisation?.name}`,
        body: `${ctx.session.name} has given you access to the Technical Decision Authority platform.\n\nSign in with this email address to get started.`,
        linkPath: '/sign-in',
      },
    ]);

    return json({ membership, userId: user!.id }, 201);
  }),
});

app.http('userUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: withOrg({ permissions: ['org:manage_users'] }, async (ctx) => {
    const userId = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, updateUserSchema);

    const [membership] = await ctx.tx
      .select()
      .from(s.memberships)
      .where(ctx.scope.where(s.memberships, eq(s.memberships.userId, userId)));
    if (!membership) throw notFound('That person');

    // An organisation must never be left without an administrator.
    if (input.status === 'deactivated' || input.roles) {
      await assertAnAdminRemains(ctx, membership.id, input.roles, input.status);
    }

    const [updated] = await ctx.tx
      .update(s.memberships)
      .set({
        jobTitle: input.jobTitle,
        department: input.department,
        disciplines: input.disciplines,
        status: input.status,
        deactivatedAt: input.status === 'deactivated' ? new Date() : null,
      })
      .where(ctx.scope.where(s.memberships, eq(s.memberships.id, membership.id)))
      .returning();

    if (input.name) {
      await ctx.tx.update(s.users).set({ name: input.name }).where(eq(s.users.id, userId));
    }

    if (input.roles) {
      await ctx.tx
        .delete(s.membershipRoles)
        .where(ctx.scope.where(s.membershipRoles, eq(s.membershipRoles.membershipId, membership.id)));
      await ctx.tx.insert(s.membershipRoles).values(
        input.roles.map((role) =>
          ctx.scope.own({ membershipId: membership.id, role, grantedByUserId: ctx.session.userId }),
        ),
      );
      await audit(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userId: ctx.session.userId,
        userName: ctx.session.name,
        eventType: 'user_roles_changed',
        objectType: 'user',
        objectId: userId,
        details: { roles: input.roles },
      });
    }

    if (input.teamIds !== undefined || input.projectIds !== undefined) {
      await setTeamsAndProjects(ctx, userId, (input.teamIds ?? []), (input.projectIds ?? []));
    }

    if (input.status) {
      await audit(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userId: ctx.session.userId,
        userName: ctx.session.name,
        eventType: input.status === 'deactivated' ? 'user_deactivated' : 'user_activated',
        objectType: 'user',
        objectId: userId,
        oldStatus: membership.status,
        newStatus: input.status,
      });
    }

    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Teams, projects, technologies                                       */
/* ------------------------------------------------------------------ */

app.http('teamList', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'teams',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    if (ctx.request.method === 'POST') {
      ctx.require('org:manage_teams');
      const input = await readBody(ctx.request, teamSchema);
      const [created] = await ctx.tx
        .insert(s.teams)
        .values(
          ctx.scope.own({
            name: input.name,
            description: input.description ?? null,
            teamLeadId: input.teamLeadId ?? null,
            parentTeamId: input.parentTeamId ?? null,
            disciplines: input.disciplines,
          }),
        )
        .returning();
      if ((input.memberIds ?? []).length > 0) {
        await ctx.tx
          .insert(s.teamMembers)
          .values(ctx.scope.ownAll((input.memberIds ?? []).map((userId) => ({ teamId: created!.id, userId }))))
          .onConflictDoNothing();
      }
      return json(created, 201);
    }

    const rows = await ctx.tx
      .select({
        team: s.teams,
        leadName: s.users.name,
        memberCount: sql<number>`(select count(*) from team_members tm where tm.team_id = ${s.teams.id})`.mapWith(Number),
      })
      .from(s.teams)
      .leftJoin(s.users, eq(s.users.id, s.teams.teamLeadId))
      .where(ctx.scope.where(s.teams))
      .orderBy(asc(s.teams.name));
    return json({ items: rows.map((r) => ({ ...r.team, leadName: r.leadName, memberCount: r.memberCount })) });
  }),
});

app.http('teamUpdate', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'teams/{id}',
  handler: withOrg({ permissions: ['org:manage_teams'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    if (ctx.request.method === 'DELETE') {
      await ctx.tx
        .update(s.teams)
        .set({ isActive: false })
        .where(ctx.scope.where(s.teams, eq(s.teams.id, id)));
      return noContent();
    }
    const input = await readBody(ctx.request, teamSchema.partial());
    const [updated] = await ctx.tx
      .update(s.teams)
      .set({
        name: input.name,
        description: input.description,
        teamLeadId: input.teamLeadId,
        disciplines: input.disciplines,
      })
      .where(ctx.scope.where(s.teams, eq(s.teams.id, id)))
      .returning();
    if (!updated) throw notFound('That team');

    if (input.memberIds !== undefined) {
      await ctx.tx
        .delete(s.teamMembers)
        .where(ctx.scope.where(s.teamMembers, eq(s.teamMembers.teamId, id)));
      if ((input.memberIds ?? []).length > 0) {
        await ctx.tx
          .insert(s.teamMembers)
          .values(ctx.scope.ownAll((input.memberIds ?? []).map((userId) => ({ teamId: id, userId }))));
      }
    }
    return json(updated);
  }),
});

app.http('projectList', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'projects',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    if (ctx.request.method === 'POST') {
      ctx.require('org:manage_projects');
      const input = await readBody(ctx.request, projectSchema);
      const [created] = await ctx.tx
        .insert(s.projects)
        .values(
          ctx.scope.own({
            name: input.name,
            code: input.code,
            description: input.description ?? null,
            managerId: input.managerId ?? null,
            technicalLeadId: input.technicalLeadId ?? null,
            status: input.status,
            startDate: input.startDate ?? null,
            targetEndDate: input.targetEndDate ?? null,
          }),
        )
        .returning();

      if ((input.memberIds ?? []).length > 0) {
        await ctx.tx
          .insert(s.projectMembers)
          .values(ctx.scope.ownAll((input.memberIds ?? []).map((userId) => ({ projectId: created!.id, userId }))))
          .onConflictDoNothing();
      }
      if ((input.teamIds ?? []).length > 0) {
        await ctx.tx
          .insert(s.projectTeams)
          .values(ctx.scope.ownAll((input.teamIds ?? []).map((teamId) => ({ projectId: created!.id, teamId }))))
          .onConflictDoNothing();
      }
      return json(created, 201);
    }

    const rows = await ctx.tx
      .select({
        project: s.projects,
        managerName: s.users.name,
        decisionCount: sql<number>`(select count(*) from decisions d where d.project_id = ${s.projects.id})`.mapWith(Number),
      })
      .from(s.projects)
      .leftJoin(s.users, eq(s.users.id, s.projects.managerId))
      .where(ctx.scope.where(s.projects))
      .orderBy(asc(s.projects.name));
    return json({
      items: rows.map((r) => ({ ...r.project, managerName: r.managerName, decisionCount: r.decisionCount })),
    });
  }),
});

app.http('projectUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'projects/{id}',
  handler: withOrg({ permissions: ['org:manage_projects'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, projectSchema.partial());
    const [updated] = await ctx.tx
      .update(s.projects)
      .set({
        name: input.name,
        description: input.description,
        managerId: input.managerId,
        technicalLeadId: input.technicalLeadId,
        status: input.status,
        startDate: input.startDate,
        targetEndDate: input.targetEndDate,
      })
      .where(ctx.scope.where(s.projects, eq(s.projects.id, id)))
      .returning();
    if (!updated) throw notFound('That project');

    if (input.memberIds !== undefined) {
      await ctx.tx
        .delete(s.projectMembers)
        .where(ctx.scope.where(s.projectMembers, eq(s.projectMembers.projectId, id)));
      if ((input.memberIds ?? []).length > 0) {
        await ctx.tx
          .insert(s.projectMembers)
          .values(ctx.scope.ownAll((input.memberIds ?? []).map((userId) => ({ projectId: id, userId }))));
      }
    }
    return json(updated);
  }),
});

app.http('technologyList', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'technologies',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    if (ctx.request.method === 'POST') {
      ctx.require('org:manage_technologies');
      const input = await readBody(ctx.request, technologySchema);
      const [created] = await ctx.tx
        .insert(s.technologies)
        .values(
          ctx.scope.own({
            name: input.name,
            category: input.category,
            version: input.version ?? null,
            status: input.status,
            ownerTeamId: input.ownerTeamId ?? null,
            supplier: input.supplier ?? null,
            designation: input.designation,
            introducedOn: input.introducedOn ?? null,
            reviewDate: input.reviewDate ?? null,
            documentationUrl: input.documentationUrl || null,
            notes: input.notes ?? null,
          }),
        )
        .returning();
      return json(created, 201);
    }

    const rows = await ctx.tx
      .select({
        technology: s.technologies,
        ownerTeamName: s.teams.name,
        decisionCount: sql<number>`(select count(*) from decision_technologies dt where dt.technology_id = ${s.technologies.id})`.mapWith(Number),
      })
      .from(s.technologies)
      .leftJoin(s.teams, eq(s.teams.id, s.technologies.ownerTeamId))
      .where(ctx.scope.where(s.technologies))
      .orderBy(asc(s.technologies.category), asc(s.technologies.name));
    return json({
      items: rows.map((r) => ({
        ...r.technology,
        ownerTeamName: r.ownerTeamName,
        decisionCount: r.decisionCount,
      })),
    });
  }),
});

app.http('technologyUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'technologies/{id}',
  handler: withOrg({ permissions: ['org:manage_technologies'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, technologySchema.partial());
    const [updated] = await ctx.tx
      .update(s.technologies)
      .set({ ...input, documentationUrl: input.documentationUrl || null })
      .where(ctx.scope.where(s.technologies, eq(s.technologies.id, id)))
      .returning();
    if (!updated) throw notFound('That technology');
    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Decision configuration                                              */
/* ------------------------------------------------------------------ */

app.http('decisionTypeManage', {
  methods: ['POST', 'PATCH'],
  authLevel: 'anonymous',
  route: 'config/decision-types/{id?}',
  handler: withOrg({ permissions: ['org:manage_config'] }, async (ctx) => {
    if (ctx.request.method === 'POST') {
      const input = await readBody(ctx.request, decisionTypeSchema);
      const [created] = await ctx.tx
        .insert(s.decisionTypes)
        .values(ctx.scope.own({ ...input, description: input.description ?? null }))
        .returning();
      return json(created, 201);
    }
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, decisionTypeSchema.partial());
    const [updated] = await ctx.tx
      .update(s.decisionTypes)
      .set(input)
      .where(ctx.scope.where(s.decisionTypes, eq(s.decisionTypes.id, id)))
      .returning();
    if (!updated) throw notFound('That decision type');
    return json(updated);
  }),
});

/**
 * Criteria are saved as a set, because their weights have to total 100 and a
 * per-row endpoint would let the set pass through invalid intermediate states.
 */
app.http('decisionCriteriaSet', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'config/decision-criteria',
  handler: withOrg({ permissions: ['org:manage_config'] }, async (ctx) => {
    const body = await ctx.request.json();
    const parsed = criteriaSetSchema.safeParse(body);
    if (!parsed.success) {
      throw unprocessable(
        parsed.error.issues[0]?.message ?? 'Criteria weights must total 100%',
        { issues: parsed.error.issues },
      );
    }

    await ctx.tx
      .delete(s.decisionCriteria)
      .where(ctx.scope.where(s.decisionCriteria));

    const rows = await ctx.tx
      .insert(s.decisionCriteria)
      .values(
        parsed.data.map((criterion, position) =>
          ctx.scope.own({
            name: criterion.name,
            description: criterion.description ?? null,
            weight: criterion.weight,
            isActive: criterion.isActive,
            position,
          }),
        ),
      )
      .returning();
    return json({ items: rows });
  }),
});

app.http('authorityManage', {
  methods: ['GET', 'POST', 'PATCH'],
  authLevel: 'anonymous',
  route: 'config/authorities/{id?}',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    if (ctx.request.method === 'GET') {
      const rows = await ctx.tx
        .select({
          authority: s.tdaAuthorities,
          name: s.users.name,
          email: s.users.email,
          projectIds: sql<string[]>`coalesce((
            select array_agg(ap.project_id) from authority_projects ap
             where ap.authority_id = ${s.tdaAuthorities.id}), '{}')`,
          decisionTypeIds: sql<string[]>`coalesce((
            select array_agg(adt.decision_type_id) from authority_decision_types adt
             where adt.authority_id = ${s.tdaAuthorities.id}), '{}')`,
        })
        .from(s.tdaAuthorities)
        .innerJoin(s.users, eq(s.users.id, s.tdaAuthorities.userId))
        .where(ctx.scope.where(s.tdaAuthorities));
      return json({
        items: rows.map((r) => ({
          ...r.authority,
          name: r.name,
          email: r.email,
          projectIds: r.projectIds,
          decisionTypeIds: r.decisionTypeIds,
        })),
      });
    }

    ctx.require('org:manage_authorities');
    const input = await readBody(ctx.request, authoritySchema);

    // Being an authority requires the role; the two must not drift apart.
    const [membership] = await ctx.tx
      .select({ id: s.memberships.id })
      .from(s.memberships)
      .where(ctx.scope.where(s.memberships, eq(s.memberships.userId, input.userId)));
    if (!membership) throw notFound('That person');

    await ctx.tx
      .insert(s.membershipRoles)
      .values(
        ctx.scope.own({
          membershipId: membership.id,
          role: 'tda_authority' as const,
          grantedByUserId: ctx.session.userId,
        }),
      )
      .onConflictDoNothing();

    const authorityId =
      ctx.request.method === 'PATCH' ? uuidParam(ctx.request, 'id') : undefined;

    const values = {
      userId: input.userId,
      scope: input.scope,
      title: input.title ?? null,
      domains: input.domains,
      maxSignificance: input.maxSignificance,
      isActive: input.isActive,
    };

    const [authority] = authorityId
      ? await ctx.tx
          .update(s.tdaAuthorities)
          .set(values)
          .where(ctx.scope.where(s.tdaAuthorities, eq(s.tdaAuthorities.id, authorityId)))
          .returning()
      : await ctx.tx.insert(s.tdaAuthorities).values(ctx.scope.own(values)).returning();

    if (!authority) throw notFound('That authority');

    await ctx.tx
      .delete(s.authorityProjects)
      .where(ctx.scope.where(s.authorityProjects, eq(s.authorityProjects.authorityId, authority.id)));
    if ((input.projectIds ?? []).length > 0) {
      await ctx.tx
        .insert(s.authorityProjects)
        .values(
          ctx.scope.ownAll((input.projectIds ?? []).map((projectId) => ({ authorityId: authority.id, projectId }))),
        );
    }

    await ctx.tx
      .delete(s.authorityDecisionTypes)
      .where(
        ctx.scope.where(s.authorityDecisionTypes, eq(s.authorityDecisionTypes.authorityId, authority.id)),
      );
    if ((input.decisionTypeIds ?? []).length > 0) {
      await ctx.tx.insert(s.authorityDecisionTypes).values(
        ctx.scope.ownAll(
          (input.decisionTypeIds ?? []).map((decisionTypeId) => ({ authorityId: authority.id, decisionTypeId })),
        ),
      );
    }

    return json(authority, authorityId ? 200 : 201);
  }),
});

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

app.http('auditLog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit',
  handler: withOrg({ permissions: ['org:read'] }, async (ctx) => {
    const rows = await ctx.tx
      .select()
      .from(s.auditEvents)
      .where(ctx.scope.where(s.auditEvents))
      .orderBy(sql`${s.auditEvents.occurredAt} desc`)
      .limit(250);
    return json({ items: rows });
  }),
});

/* ------------------------------------------------------------------ */

async function setTeamsAndProjects(
  ctx: RequestContext,
  userId: string,
  teamIds?: string[],
  projectIds?: string[],
): Promise<void> {
  if (teamIds) {
    await ctx.tx
      .delete(s.teamMembers)
      .where(ctx.scope.where(s.teamMembers, eq(s.teamMembers.userId, userId)));
    if (teamIds.length > 0) {
      await ctx.tx
        .insert(s.teamMembers)
        .values(ctx.scope.ownAll(teamIds.map((teamId) => ({ teamId, userId }))))
        .onConflictDoNothing();
    }
  }
  if (projectIds) {
    await ctx.tx
      .delete(s.projectMembers)
      .where(ctx.scope.where(s.projectMembers, eq(s.projectMembers.userId, userId)));
    if (projectIds.length > 0) {
      await ctx.tx
        .insert(s.projectMembers)
        .values(ctx.scope.ownAll(projectIds.map((projectId) => ({ projectId, userId }))))
        .onConflictDoNothing();
    }
  }
}

/** Refuse the change that would leave nobody able to administer the organisation. */
async function assertAnAdminRemains(
  ctx: RequestContext,
  membershipId: string,
  newRoles?: string[],
  newStatus?: string,
): Promise<void> {
  const losingAdmin =
    newStatus === 'deactivated' || (newRoles !== undefined && !newRoles.includes('org_admin'));
  if (!losingAdmin) return;

  const admins = await ctx.tx
    .select({ membershipId: s.membershipRoles.membershipId })
    .from(s.membershipRoles)
    .innerJoin(s.memberships, eq(s.memberships.id, s.membershipRoles.membershipId))
    .where(
      ctx.scope.where(
        s.membershipRoles,
        eq(s.membershipRoles.role, 'org_admin'),
        eq(s.memberships.status, 'active'),
      ),
    );

  const remaining = admins.filter((a) => a.membershipId !== membershipId);
  if (remaining.length === 0) {
    throw conflict(
      'This is the only organisation admin. Give someone else the role first.',
    );
  }
}
