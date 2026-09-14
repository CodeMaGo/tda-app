import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import {
  alternativeSchema,
  assessmentSchema,
  calculateRiskRating,
  commentSchema,
  createDecisionSchema,
  relationshipSchema,
  riskSchema,
  updateDecisionSchema,
  INVERSE_RELATIONSHIP,
} from '@tda/shared';
import { desc, eq, inArray, isNull } from 'drizzle-orm';
import { audit, bumpVersion, nextDecisionReference } from '../core/audit.js';
import type { RequestContext } from '../core/context.js';
import { withOrg } from '../core/context.js';
import { conflict, forbidden, json, noContent, notFound, readBody, uuidParam } from '../core/http.js';
import { notify } from '../core/notify.js';
import { scoreAlternatives } from '../core/workflow.js';

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

app.http('decisionCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions',
  handler: withOrg({ permissions: ['decision:create'] }, async (ctx) => {
    const input = await readBody(ctx.request, createDecisionSchema);
    await assertReferencesBelongToOrg(ctx, input);

    const { reference, year, sequence } = await nextDecisionReference(
      ctx.tx,
      ctx.scope.organisationId,
    );

    const [decision] = await ctx.tx
      .insert(s.decisions)
      .values(
        ctx.scope.own({
          reference,
          year,
          sequence,
          title: input.title,
          decisionTypeId: input.decisionTypeId,
          significance: input.significance,
          priority: input.priority,
          status: 'draft' as const,
          visibility: input.visibility,
          problem: input.problem,
          background: input.background ?? null,
          desiredOutcome: input.desiredOutcome ?? null,
          scope: input.scope ?? null,
          constraints: input.constraints ?? null,
          requirements: input.requirements ?? null,
          projectId: input.projectId ?? null,
          // Whoever raises the decision owns it unless they say otherwise.
          ownerId: input.ownerId ?? ctx.session.userId,
          authorityId: input.authorityId ?? null,
          technicalLeadId: input.technicalLeadId ?? null,
          createdByUserId: ctx.session.userId,
          requiredBy: input.requiredBy ?? null,
          tags: input.tags,
        }),
      )
      .returning();

    await writeLinks(ctx, decision!.id, input);

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'decision_created',
      objectType: 'decision',
      objectId: decision!.id,
      objectReference: reference,
      newStatus: 'draft',
    });

    const watchers = [
      ...input.contributorIds,
      ...(input.ownerId && input.ownerId !== ctx.session.userId ? [input.ownerId] : []),
    ];
    if (watchers.length > 0) {
      await notify(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userIds: watchers,
        type: 'contributor_added',
        title: `You have been named on ${reference}`,
        body: `${ctx.session.name} raised "${input.title}" and named you on it.`,
        linkPath: `/decisions/detail?id=${decision!.id}`,
      });
    }

    return json(decision, 201);
  }),
});

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

app.http('decisionGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'decisions/{id}',
  handler: withOrg({ permissions: ['decision:read'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    const [
      type,
      project,
      ownerRow,
      authorityRow,
      contributors,
      teams,
      technologies,
      alternatives,
      assessments,
      risks,
      comments,
      attachments,
      actions,
      conditions,
      relationships,
      history,
      requests,
      versions,
    ] = await Promise.all([
      decision.decisionTypeId
        ? ctx.tx.select().from(s.decisionTypes).where(eq(s.decisionTypes.id, decision.decisionTypeId))
        : Promise.resolve([]),
      decision.projectId
        ? ctx.tx.select().from(s.projects).where(eq(s.projects.id, decision.projectId))
        : Promise.resolve([]),
      decision.ownerId
        ? ctx.tx.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(eq(s.users.id, decision.ownerId))
        : Promise.resolve([]),
      decision.authorityId
        ? ctx.tx.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(eq(s.users.id, decision.authorityId))
        : Promise.resolve([]),
      ctx.tx
        .select({
          id: s.decisionContributors.id,
          userId: s.users.id,
          name: s.users.name,
          email: s.users.email,
          role: s.decisionContributors.role,
        })
        .from(s.decisionContributors)
        .innerJoin(s.users, eq(s.users.id, s.decisionContributors.userId))
        .where(ctx.scope.where(s.decisionContributors, eq(s.decisionContributors.decisionId, id))),
      ctx.tx
        .select({ id: s.teams.id, name: s.teams.name })
        .from(s.decisionTeams)
        .innerJoin(s.teams, eq(s.teams.id, s.decisionTeams.teamId))
        .where(ctx.scope.where(s.decisionTeams, eq(s.decisionTeams.decisionId, id))),
      ctx.tx
        .select({
          id: s.technologies.id,
          name: s.technologies.name,
          version: s.technologies.version,
          status: s.technologies.status,
          category: s.technologies.category,
        })
        .from(s.decisionTechnologies)
        .innerJoin(s.technologies, eq(s.technologies.id, s.decisionTechnologies.technologyId))
        .where(ctx.scope.where(s.decisionTechnologies, eq(s.decisionTechnologies.decisionId, id))),
      ctx.tx
        .select()
        .from(s.alternatives)
        .where(ctx.scope.where(s.alternatives, eq(s.alternatives.decisionId, id)))
        .orderBy(s.alternatives.position),
      ctx.tx
        .select()
        .from(s.assessments)
        .where(ctx.scope.where(s.assessments, eq(s.assessments.decisionId, id))),
      ctx.tx
        .select({
          risk: s.risks,
          ownerName: s.users.name,
        })
        .from(s.risks)
        .leftJoin(s.users, eq(s.users.id, s.risks.ownerId))
        .where(ctx.scope.where(s.risks, eq(s.risks.decisionId, id)))
        .orderBy(desc(s.risks.createdAt)),
      ctx.tx
        .select({
          id: s.comments.id,
          body: s.comments.body,
          kind: s.comments.kind,
          parentId: s.comments.parentId,
          createdAt: s.comments.createdAt,
          retractedAt: s.comments.retractedAt,
          userId: s.users.id,
          userName: s.users.name,
        })
        .from(s.comments)
        .innerJoin(s.users, eq(s.users.id, s.comments.userId))
        .where(ctx.scope.where(s.comments, eq(s.comments.decisionId, id)))
        .orderBy(s.comments.createdAt),
      ctx.tx
        .select({
          id: s.attachments.id,
          filename: s.attachments.filename,
          description: s.attachments.description,
          version: s.attachments.version,
          contentType: s.attachments.contentType,
          sizeBytes: s.attachments.sizeBytes,
          createdAt: s.attachments.createdAt,
          uploadedBy: s.users.name,
          scanStatus: s.attachments.scanStatus,
        })
        .from(s.attachments)
        .innerJoin(s.users, eq(s.users.id, s.attachments.uploadedByUserId))
        .where(
          ctx.scope.where(
            s.attachments,
            eq(s.attachments.decisionId, id),
            isNull(s.attachments.deletedAt),
          ),
        ),
      ctx.tx
        .select({
          action: s.actions,
          ownerName: s.users.name,
          ownerTeamName: s.teams.name,
        })
        .from(s.actions)
        .leftJoin(s.users, eq(s.users.id, s.actions.ownerId))
        .leftJoin(s.teams, eq(s.teams.id, s.actions.ownerTeamId))
        .where(ctx.scope.where(s.actions, eq(s.actions.decisionId, id))),
      ctx.tx
        .select()
        .from(s.decisionConditions)
        .where(ctx.scope.where(s.decisionConditions, eq(s.decisionConditions.decisionId, id))),
      ctx.tx
        .select({
          id: s.decisionRelationships.id,
          type: s.decisionRelationships.type,
          note: s.decisionRelationships.note,
          targetId: s.decisions.id,
          targetReference: s.decisions.reference,
          targetTitle: s.decisions.title,
          targetStatus: s.decisions.status,
        })
        .from(s.decisionRelationships)
        .innerJoin(s.decisions, eq(s.decisions.id, s.decisionRelationships.targetDecisionId))
        .where(
          ctx.scope.where(s.decisionRelationships, eq(s.decisionRelationships.sourceDecisionId, id)),
        ),
      ctx.tx
        .select()
        .from(s.auditEvents)
        .where(ctx.scope.where(s.auditEvents, eq(s.auditEvents.objectId, id)))
        .orderBy(desc(s.auditEvents.occurredAt))
        .limit(100),
      ctx.tx
        .select({
          request: s.informationRequests,
          requestedBy: s.users.name,
        })
        .from(s.informationRequests)
        .innerJoin(s.users, eq(s.users.id, s.informationRequests.requestedByUserId))
        .where(ctx.scope.where(s.informationRequests, eq(s.informationRequests.decisionId, id)))
        .orderBy(desc(s.informationRequests.createdAt)),
      ctx.tx
        .select({
          version: s.decisionVersions.version,
          summary: s.decisionVersions.summary,
          createdAt: s.decisionVersions.createdAt,
        })
        .from(s.decisionVersions)
        .where(ctx.scope.where(s.decisionVersions, eq(s.decisionVersions.decisionId, id)))
        .orderBy(desc(s.decisionVersions.createdAt)),
    ]);

    const scores = await scoreAlternatives(ctx.tx, ctx.scope.organisationId, id);

    return json({
      decision,
      type: type[0] ?? null,
      project: project[0] ?? null,
      owner: ownerRow[0] ?? null,
      authority: authorityRow[0] ?? null,
      contributors,
      teams,
      technologies,
      alternatives,
      assessments,
      scores,
      risks: risks.map((r) => ({ ...r.risk, ownerName: r.ownerName })),
      comments,
      attachments,
      actions: actions.map((a) => ({ ...a.action, ownerName: a.ownerName, ownerTeamName: a.ownerTeamName })),
      conditions,
      relationships,
      informationRequests: requests.map((r) => ({ ...r.request, requestedBy: r.requestedBy })),
      versions,
      history,
    });
  }),
});

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

app.http('decisionUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'decisions/{id}',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, updateDecisionSchema);
    const decision = await loadDecision(ctx, id);
    await assertEditable(ctx, decision);

    if (input.expectedVersion && input.expectedVersion !== decision.version) {
      throw conflict('This decision has changed since you opened it. Reload and try again.', {
        yourVersion: input.expectedVersion,
        currentVersion: decision.version,
      });
    }

    await assertReferencesBelongToOrg(ctx, input);

    // A change to the framing or the reasoning is material and takes a version.
    const materialFields = [
      'problem',
      'desiredOutcome',
      'scope',
      'constraints',
      'requirements',
      'recommendation',
      'recommendationRationale',
    ] as const;
    const isMaterial = materialFields.some(
      (field) => input[field] !== undefined && input[field] !== decision[field],
    );

    const [updated] = await ctx.tx
      .update(s.decisions)
      .set({
        ...pick(input, [
          'title',
          'decisionTypeId',
          'significance',
          'priority',
          'problem',
          'background',
          'desiredOutcome',
          'scope',
          'constraints',
          'requirements',
          'projectId',
          'ownerId',
          'authorityId',
          'technicalLeadId',
          'requiredBy',
          'visibility',
          'tags',
          'recommendation',
          'recommendationRationale',
          'recommendedAlternativeId',
        ]),
        version: isMaterial ? bumpVersion(decision.version) : decision.version,
      })
      .where(ctx.scope.where(s.decisions, eq(s.decisions.id, id)))
      .returning();

    if (isMaterial) {
      await ctx.tx.insert(s.decisionVersions).values(
        ctx.scope.own({
          decisionId: id,
          version: updated!.version,
          summary: describeChange(decision, updated!),
          snapshot: decision as unknown as Record<string, unknown>,
          createdByUserId: ctx.session.userId,
        }),
      );
    }

    await writeLinks(ctx, id, input);

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'decision_updated',
      objectType: 'decision',
      objectId: id,
      objectReference: decision.reference,
      details: { fields: Object.keys(input), version: updated!.version },
    });

    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Alternatives                                                        */
/* ------------------------------------------------------------------ */

app.http('alternativeCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/alternatives',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, alternativeSchema);
    const decision = await loadDecision(ctx, id);
    await assertEditable(ctx, decision);

    const [created] = await ctx.tx
      .insert(s.alternatives)
      .values(ctx.scope.own({ ...input, decisionId: id }))
      .returning();
    return json(created, 201);
  }),
});

app.http('alternativeUpdate', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/alternatives/{alternativeId}',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const alternativeId = uuidParam(ctx.request, 'alternativeId');
    const decision = await loadDecision(ctx, id);
    await assertEditable(ctx, decision);

    if (ctx.request.method === 'DELETE') {
      await ctx.tx
        .delete(s.alternatives)
        .where(
          ctx.scope.where(
            s.alternatives,
            eq(s.alternatives.id, alternativeId),
            eq(s.alternatives.decisionId, id),
          ),
        );
      return noContent();
    }

    const input = await readBody(ctx.request, alternativeSchema.partial());
    const [updated] = await ctx.tx
      .update(s.alternatives)
      .set(input)
      .where(
        ctx.scope.where(
          s.alternatives,
          eq(s.alternatives.id, alternativeId),
          eq(s.alternatives.decisionId, id),
        ),
      )
      .returning();
    if (!updated) throw notFound('That alternative');
    return json(updated);
  }),
});

app.http('assessmentUpsert', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/assessments',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, assessmentSchema);
    const decision = await loadDecision(ctx, id);
    await assertEditable(ctx, decision);

    const [created] = await ctx.tx
      .insert(s.assessments)
      .values(
        ctx.scope.own({
          decisionId: id,
          alternativeId: input.alternativeId,
          criterionId: input.criterionId,
          score: String(input.score),
          comment: input.comment ?? null,
          assessedByUserId: ctx.session.userId,
        }),
      )
      .onConflictDoUpdate({
        target: [s.assessments.alternativeId, s.assessments.criterionId],
        set: {
          score: String(input.score),
          comment: input.comment ?? null,
          assessedByUserId: ctx.session.userId,
        },
      })
      .returning();

    const scores = await scoreAlternatives(ctx.tx, ctx.scope.organisationId, id);
    return json({ assessment: created, scores });
  }),
});

/* ------------------------------------------------------------------ */
/* Risks                                                               */
/* ------------------------------------------------------------------ */

app.http('riskCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/risks',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, riskSchema);
    const decision = await loadDecision(ctx, id);
    await assertEditable(ctx, decision);

    const [created] = await ctx.tx
      .insert(s.risks)
      .values(
        ctx.scope.own({
          decisionId: id,
          summary: input.summary,
          description: input.description ?? null,
          category: input.category ?? null,
          probability: input.probability,
          impact: input.impact,
          rating: calculateRiskRating(input.probability, input.impact),
          mitigation: input.mitigation ?? null,
          ownerId: input.ownerId ?? null,
          residualProbability: input.residualProbability ?? null,
          residualImpact: input.residualImpact ?? null,
          residualRating:
            input.residualProbability && input.residualImpact
              ? calculateRiskRating(input.residualProbability, input.residualImpact)
              : null,
          status: input.status,
        }),
      )
      .returning();

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'risk_recorded',
      objectType: 'risk',
      objectId: created!.id,
      objectReference: decision.reference,
      details: { summary: input.summary, rating: created!.rating },
    });

    return json(created, 201);
  }),
});

app.http('riskUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/risks/{riskId}',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const riskId = uuidParam(ctx.request, 'riskId');
    const input = await readBody(ctx.request, riskSchema.partial());
    await loadDecision(ctx, id);

    const [existing] = await ctx.tx
      .select()
      .from(s.risks)
      .where(ctx.scope.where(s.risks, eq(s.risks.id, riskId), eq(s.risks.decisionId, id)));
    if (!existing) throw notFound('That risk');

    const probability = input.probability ?? existing.probability;
    const impact = input.impact ?? existing.impact;
    const residualProbability = input.residualProbability ?? existing.residualProbability;
    const residualImpact = input.residualImpact ?? existing.residualImpact;

    const [updated] = await ctx.tx
      .update(s.risks)
      .set({
        ...input,
        rating: calculateRiskRating(probability, impact),
        residualRating:
          residualProbability && residualImpact
            ? calculateRiskRating(residualProbability, residualImpact)
            : null,
      })
      .where(ctx.scope.where(s.risks, eq(s.risks.id, riskId)))
      .returning();
    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

app.http('commentCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/comments',
  handler: withOrg({ permissions: ['decision:comment'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, commentSchema);
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    const [created] = await ctx.tx
      .insert(s.comments)
      .values(
        ctx.scope.own({
          decisionId: id,
          userId: ctx.session.userId,
          body: input.body,
          kind: input.kind,
          parentId: input.parentId ?? null,
        }),
      )
      .returning();

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'comment_added',
      objectType: 'decision',
      objectId: id,
      objectReference: decision.reference,
    });

    // Tell the people accountable for the decision, but not the author.
    const participants = await ctx.tx
      .select({ userId: s.decisionContributors.userId })
      .from(s.decisionContributors)
      .where(ctx.scope.where(s.decisionContributors, eq(s.decisionContributors.decisionId, id)));

    const recipients = [
      ...participants.map((p) => p.userId),
      decision.ownerId,
      decision.authorityId,
    ].filter((userId): userId is string => Boolean(userId) && userId !== ctx.session.userId);

    await notify(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userIds: recipients,
      type: 'contributor_added',
      title: `${ctx.session.name} commented on ${decision.reference}`,
      body: input.body.slice(0, 280),
      linkPath: `/decisions/detail?id=${id}`,
      sendEmail: input.kind === 'question',
    });

    return json({ ...created, userName: ctx.session.name }, 201);
  }),
});

/** Comments are retracted, never erased (spec §30). */
app.http('commentRetract', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/comments/{commentId}',
  handler: withOrg({ permissions: ['decision:comment'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const commentId = uuidParam(ctx.request, 'commentId');

    const [existing] = await ctx.tx
      .select()
      .from(s.comments)
      .where(ctx.scope.where(s.comments, eq(s.comments.id, commentId), eq(s.comments.decisionId, id)));
    if (!existing) throw notFound('That comment');
    if (existing.userId !== ctx.session.userId && !ctx.can('org:manage_config')) {
      throw forbidden('You can only retract your own comments');
    }

    const [updated] = await ctx.tx
      .update(s.comments)
      .set({ retractedAt: new Date(), retractedByUserId: ctx.session.userId })
      .where(ctx.scope.where(s.comments, eq(s.comments.id, commentId)))
      .returning();
    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Relationships                                                       */
/* ------------------------------------------------------------------ */

app.http('relationshipCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/relationships',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, relationshipSchema);
    if (input.targetDecisionId === id) throw conflict('A decision cannot be linked to itself');

    await loadDecision(ctx, id);
    await loadDecision(ctx, input.targetDecisionId);

    const [created] = await ctx.tx
      .insert(s.decisionRelationships)
      .values(
        ctx.scope.own({
          sourceDecisionId: id,
          targetDecisionId: input.targetDecisionId,
          type: input.type,
          note: input.note ?? null,
          createdByUserId: ctx.session.userId,
        }),
      )
      .onConflictDoNothing()
      .returning();

    // Write the mirror side so the link is navigable from either decision.
    await ctx.tx
      .insert(s.decisionRelationships)
      .values(
        ctx.scope.own({
          sourceDecisionId: input.targetDecisionId,
          targetDecisionId: id,
          type: INVERSE_RELATIONSHIP[input.type],
          note: input.note ?? null,
          createdByUserId: ctx.session.userId,
        }),
      )
      .onConflictDoNothing();

    return json(created, 201);
  }),
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

export async function loadDecision(ctx: RequestContext, id: string) {
  const [decision] = await ctx.tx
    .select()
    .from(s.decisions)
    .where(ctx.scope.where(s.decisions, eq(s.decisions.id, id)));
  if (!decision) throw notFound('That decision');
  return decision;
}

/** Project and restricted decisions obey their configured visibility (spec §65.13). */
export async function assertVisible(
  ctx: RequestContext,
  decision: typeof s.decisions.$inferSelect,
): Promise<void> {
  if (decision.visibility === 'organisation') return;
  if (ctx.can('org:manage_config')) return;

  const isNamed =
    decision.ownerId === ctx.session.userId ||
    decision.authorityId === ctx.session.userId ||
    decision.createdByUserId === ctx.session.userId ||
    decision.technicalLeadId === ctx.session.userId;
  if (isNamed) return;

  const [contributor] = await ctx.tx
    .select({ id: s.decisionContributors.id })
    .from(s.decisionContributors)
    .where(
      ctx.scope.where(
        s.decisionContributors,
        eq(s.decisionContributors.decisionId, decision.id),
        eq(s.decisionContributors.userId, ctx.session.userId),
      ),
    );
  if (contributor) return;

  if (decision.visibility === 'project' && decision.projectId) {
    const [member] = await ctx.tx
      .select({ id: s.projectMembers.id })
      .from(s.projectMembers)
      .where(
        ctx.scope.where(
          s.projectMembers,
          eq(s.projectMembers.projectId, decision.projectId),
          eq(s.projectMembers.userId, ctx.session.userId),
        ),
      );
    if (member) return;
  }

  // Indistinguishable from a decision that does not exist.
  throw notFound('That decision');
}

async function assertEditable(
  ctx: RequestContext,
  decision: typeof s.decisions.$inferSelect,
): Promise<void> {
  await assertVisible(ctx, decision);
  if (decision.lockedAt) {
    throw conflict(
      `${decision.reference} has been formally recorded. Supersede it to record a change.`,
    );
  }
  const mayEdit =
    decision.ownerId === ctx.session.userId ||
    decision.createdByUserId === ctx.session.userId ||
    decision.technicalLeadId === ctx.session.userId ||
    ctx.can('org:manage_config');
  if (mayEdit) return;

  const [contributor] = await ctx.tx
    .select({ id: s.decisionContributors.id })
    .from(s.decisionContributors)
    .where(
      ctx.scope.where(
        s.decisionContributors,
        eq(s.decisionContributors.decisionId, decision.id),
        eq(s.decisionContributors.userId, ctx.session.userId),
      ),
    );
  if (!contributor) throw forbidden('You are not named on this decision');
}

/**
 * Every foreign key supplied by the client is checked against this
 * organisation before it is written. Without this, a valid-looking id from
 * another tenant could be attached to a local decision.
 */
async function assertReferencesBelongToOrg(
  ctx: RequestContext,
  input: Partial<{
    decisionTypeId: string | null;
    projectId: string | null;
    ownerId: string | null;
    authorityId: string | null;
    technicalLeadId: string | null;
    teamIds: string[];
    technologyIds: string[];
    contributorIds: string[];
    stakeholderIds: string[];
    recommendedAlternativeId: string | null;
  }>,
): Promise<void> {
  const checks: Promise<void>[] = [];

  if (input.decisionTypeId) {
    checks.push(
      exists(ctx, s.decisionTypes, [input.decisionTypeId], 'decision type'),
    );
  }
  if (input.projectId) checks.push(exists(ctx, s.projects, [input.projectId], 'project'));
  if (input.teamIds?.length) checks.push(exists(ctx, s.teams, input.teamIds, 'team'));
  if (input.technologyIds?.length) {
    checks.push(exists(ctx, s.technologies, input.technologyIds, 'technology'));
  }

  const userIds = [
    input.ownerId,
    input.authorityId,
    input.technicalLeadId,
    ...(input.contributorIds ?? []),
    ...(input.stakeholderIds ?? []),
  ].filter((id): id is string => Boolean(id));

  if (userIds.length > 0) {
    checks.push(
      (async () => {
        const rows = await ctx.tx
          .select({ userId: s.memberships.userId })
          .from(s.memberships)
          .where(
            ctx.scope.where(
              s.memberships,
              inArray(s.memberships.userId, [...new Set(userIds)]),
              eq(s.memberships.status, 'active'),
            ),
          );
        const found = new Set(rows.map((r) => r.userId));
        const missing = [...new Set(userIds)].filter((id) => !found.has(id));
        if (missing.length > 0) {
          throw notFound('One of the people named on this decision');
        }
      })(),
    );
  }

  await Promise.all(checks);
}

async function exists(
  ctx: RequestContext,
  table: typeof s.projects | typeof s.teams | typeof s.technologies | typeof s.decisionTypes,
  ids: string[],
  label: string,
): Promise<void> {
  const rows = await ctx.tx
    .select({ id: table.id })
    .from(table)
    .where(ctx.scope.where(table, inArray(table.id, [...new Set(ids)])));
  if (rows.length !== new Set(ids).size) throw notFound(`That ${label}`);
}

/** Replace the join-table rows for whichever collections were supplied. */
async function writeLinks(
  ctx: RequestContext,
  decisionId: string,
  input: Partial<{ teamIds: string[]; technologyIds: string[]; contributorIds: string[]; stakeholderIds: string[] }>,
): Promise<void> {
  if (input.teamIds) {
    await ctx.tx
      .delete(s.decisionTeams)
      .where(ctx.scope.where(s.decisionTeams, eq(s.decisionTeams.decisionId, decisionId)));
    if (input.teamIds.length > 0) {
      await ctx.tx
        .insert(s.decisionTeams)
        .values(ctx.scope.ownAll(input.teamIds.map((teamId) => ({ decisionId, teamId }))));
    }
  }

  if (input.technologyIds) {
    await ctx.tx
      .delete(s.decisionTechnologies)
      .where(
        ctx.scope.where(s.decisionTechnologies, eq(s.decisionTechnologies.decisionId, decisionId)),
      );
    if (input.technologyIds.length > 0) {
      await ctx.tx
        .insert(s.decisionTechnologies)
        .values(
          ctx.scope.ownAll(input.technologyIds.map((technologyId) => ({ decisionId, technologyId }))),
        );
    }
  }

  for (const [role, ids] of [
    ['contributor', input.contributorIds],
    ['stakeholder', input.stakeholderIds],
  ] as const) {
    if (!ids) continue;
    await ctx.tx
      .delete(s.decisionContributors)
      .where(
        ctx.scope.where(
          s.decisionContributors,
          eq(s.decisionContributors.decisionId, decisionId),
          eq(s.decisionContributors.role, role),
        ),
      );
    if (ids.length > 0) {
      await ctx.tx
        .insert(s.decisionContributors)
        .values(ctx.scope.ownAll(ids.map((userId) => ({ decisionId, userId, role }))))
        .onConflictDoNothing();
    }
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

function describeChange(
  before: typeof s.decisions.$inferSelect,
  after: typeof s.decisions.$inferSelect,
): string {
  const changed: string[] = [];
  if (before.problem !== after.problem) changed.push('problem statement');
  if (before.recommendation !== after.recommendation) changed.push('recommendation');
  if (before.constraints !== after.constraints) changed.push('constraints');
  if (before.requirements !== after.requirements) changed.push('requirements');
  if (before.desiredOutcome !== after.desiredOutcome) changed.push('desired outcome');
  if (before.scope !== after.scope) changed.push('scope');
  return changed.length > 0 ? `Updated ${changed.join(', ')}` : 'Updated decision content';
}
