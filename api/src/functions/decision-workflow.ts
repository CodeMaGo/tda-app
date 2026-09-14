import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import {
  decisionOutcomeSchema,
  informationResponseSchema,
  submitDecisionSchema,
  supersedeDecisionSchema,
  type DecisionStatus,
} from '@tda/shared';
import { eq, inArray, isNull } from 'drizzle-orm';
import { audit, nextActionReference } from '../core/audit.js';
import { assertAuthority, checkAuthority } from '../core/authority.js';
import type { RequestContext } from '../core/context.js';
import { withOrg } from '../core/context.js';
import { conflict, forbidden, json, notFound, readBody, uuidParam } from '../core/http.js';
import { notify } from '../core/notify.js';
import { assertReadyForReview, transition } from '../core/workflow.js';
import { assertVisible, loadDecision } from './decisions.js';

/**
 * The governance path (spec §21, §31–36).
 *
 * Everything in this file writes an audit record, and every state change runs
 * through the transition map. Nothing here trusts a status supplied by the
 * client: the caller says what they want to *do*, and the engine decides what
 * that means for the record.
 */

/* ------------------------------------------------------------------ */
/* Submit for review                                                   */
/* ------------------------------------------------------------------ */

app.http('decisionSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/submit',
  handler: withOrg({ permissions: ['decision:submit'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, submitDecisionSchema);
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    if (decision.ownerId !== ctx.session.userId && !ctx.can('org:manage_config')) {
      throw forbidden('Only the decision owner can submit this for review');
    }

    await assertReadyForReview(ctx.tx, decision);

    // Draft goes via Submitted; work already under analysis goes straight up.
    const next: DecisionStatus =
      decision.status === 'draft' || decision.status === 'submitted'
        ? 'submitted'
        : 'under_tda_review';

    let updated = await transition(ctx, {
      decision,
      to: next,
      eventType: 'decision_submitted',
      set: { submittedAt: new Date() },
      details: { note: input.note },
    });

    if (next === 'submitted') {
      // Analysis opens automatically; the owner should not have to press twice.
      updated = await transition(ctx, {
        decision: updated,
        to: 'under_analysis',
        eventType: 'decision_status_changed',
      });
    }

    if (decision.authorityId) {
      await notify(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userIds: [decision.authorityId],
        type: 'decision_submitted_for_review',
        title: `${decision.reference} is heading for your review`,
        body: `${ctx.session.name} submitted "${decision.title}".`,
        linkPath: `/decisions/detail?id=${id}`,
      });
    }

    return json(updated);
  }),
});

/** Move an analysed decision in front of the TDA authority. */
app.http('decisionReadyForReview', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/ready',
  handler: withOrg({ permissions: ['decision:submit'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);
    await assertReadyForReview(ctx.tx, decision);

    const ready = await transition(ctx, {
      decision,
      to: 'ready_for_review',
      eventType: 'decision_status_changed',
    });
    const underReview = await transition(ctx, {
      decision: ready,
      to: 'under_tda_review',
      eventType: 'decision_status_changed',
    });

    if (decision.authorityId) {
      await notify(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userIds: [decision.authorityId],
        type: 'decision_submitted_for_review',
        title: `${decision.reference} is awaiting your decision`,
        body: decision.title,
        linkPath: `/decisions/detail?id=${id}`,
      });
    }

    return json(underReview);
  }),
});

/* ------------------------------------------------------------------ */
/* The TDA outcome                                                     */
/* ------------------------------------------------------------------ */

app.http('decisionDecide', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/decide',
  handler: withOrg({ permissions: ['decision:decide'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, decisionOutcomeSchema);
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    if (decision.status !== 'under_tda_review' && decision.status !== 'escalated') {
      throw conflict('This decision is not currently under review');
    }

    // Scope, significance, project and type are all checked here — holding the
    // role is not the same as holding authority over this decision (spec §47).
    await assertAuthority(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      decision: {
        id: decision.id,
        significance: decision.significance,
        projectId: decision.projectId,
        decisionTypeId: decision.decisionTypeId,
      },
    });

    const now = new Date();
    const watchers = await participants(ctx, decision);

    switch (input.outcome) {
      case 'approved':
      case 'approved_with_conditions': {
        const updated = await transition(ctx, {
          decision,
          to: input.outcome,
          eventType:
            input.outcome === 'approved' ? 'decision_approved' : 'decision_approved_with_conditions',
          set: {
            decisionText: input.decisionText,
            decisionRationale: input.rationale,
            decidedByUserId: ctx.session.userId,
            decidedAt: now,
            effectiveDate: input.effectiveDate,
            // From here the record is frozen; changes require Supersede.
            lockedAt: now,
          },
          details: { comments: input.comments },
          version: 'major',
        });

        if (input.outcome === 'approved_with_conditions') {
          await createConditionActions(ctx, decision.id, decision.reference, input.conditions);
        }

        // An approved decision moves straight into implementation.
        const implementing = await transition(ctx, {
          decision: updated,
          to: 'implementation',
          eventType: 'decision_status_changed',
        });

        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: watchers,
          type: 'decision_approved',
          title: `${decision.reference} was approved`,
          body: `${ctx.session.name} approved "${decision.title}".\n\n${input.rationale}`,
          linkPath: `/decisions/detail?id=${id}`,
        });

        return json(implementing);
      }

      case 'rejected': {
        const updated = await transition(ctx, {
          decision,
          to: 'rejected',
          eventType: 'decision_rejected',
          set: {
            decisionRationale: input.rationale,
            decidedByUserId: ctx.session.userId,
            decidedAt: now,
            lockedAt: now,
          },
          details: { comments: input.comments },
          version: 'major',
        });

        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: watchers,
          type: 'decision_rejected',
          title: `${decision.reference} was not approved`,
          body: `${ctx.session.name} rejected "${decision.title}".\n\n${input.rationale}`,
          linkPath: `/decisions/detail?id=${id}`,
        });

        return json(updated);
      }

      case 'deferred': {
        const updated = await transition(ctx, {
          decision,
          to: 'deferred',
          eventType: 'decision_deferred',
          set: { deferredUntil: input.reviewDate, decisionRationale: input.rationale },
        });

        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: watchers,
          type: 'decision_deferred',
          title: `${decision.reference} was deferred to ${input.reviewDate}`,
          body: input.rationale,
          linkPath: `/decisions/detail?id=${id}`,
        });

        return json(updated);
      }

      case 'escalated': {
        const escalatedTo = await memberOfThisOrg(ctx, input.escalatedToUserId);

        // Escalating to someone who cannot decide it either would be a dead end.
        const check = await checkAuthority(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userId: input.escalatedToUserId,
          decision: {
            id: decision.id,
            significance: decision.significance,
            projectId: decision.projectId,
            decisionTypeId: decision.decisionTypeId,
          },
        });
        if (!check.allowed) {
          throw conflict(
            `${escalatedTo.name} cannot decide this either: ${check.reason?.toLowerCase()}`,
          );
        }

        const updated = await transition(ctx, {
          decision,
          to: 'escalated',
          eventType: 'decision_escalated',
          set: {
            escalatedToUserId: input.escalatedToUserId,
            authorityId: input.escalatedToUserId,
            decisionRationale: input.rationale,
          },
          details: { escalatedTo: escalatedTo.name },
        });

        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: [input.escalatedToUserId, ...watchers],
          type: 'decision_escalated',
          title: `${decision.reference} was escalated to ${escalatedTo.name}`,
          body: input.rationale,
          linkPath: `/decisions/detail?id=${id}`,
        });

        return json(updated);
      }

      case 'more_information_required': {
        await memberOfThisOrg(ctx, input.assignedToUserId);

        const updated = await transition(ctx, {
          decision,
          to: 'more_information_required',
          eventType: 'information_requested',
          details: { request: input.rationale, assignedTo: input.assignedToUserId },
        });

        const [request] = await ctx.tx
          .insert(s.informationRequests)
          .values(
            ctx.scope.own({
              decisionId: id,
              requestedByUserId: ctx.session.userId,
              assignedToUserId: input.assignedToUserId,
              request: input.rationale,
              dueDate: input.dueDate ?? null,
            }),
          )
          .returning();

        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: [input.assignedToUserId],
          type: 'information_requested',
          title: `${decision.reference}: more information needed`,
          body: input.rationale,
          linkPath: `/decisions/detail?id=${id}`,
        });

        return json({ decision: updated, request });
      }
    }
  }),
});

/* ------------------------------------------------------------------ */
/* Responding to a request for information                             */
/* ------------------------------------------------------------------ */

app.http('informationRespond', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/information/{requestId}',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const requestId = uuidParam(ctx.request, 'requestId');
    const input = await readBody(ctx.request, informationResponseSchema);
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    const [request] = await ctx.tx
      .select()
      .from(s.informationRequests)
      .where(
        ctx.scope.where(
          s.informationRequests,
          eq(s.informationRequests.id, requestId),
          eq(s.informationRequests.decisionId, id),
        ),
      );
    if (!request) throw notFound('That request');
    if (request.respondedAt) throw conflict('That request has already been answered');
    if (request.assignedToUserId !== ctx.session.userId && !ctx.can('org:manage_config')) {
      throw forbidden('This request was assigned to someone else');
    }

    await ctx.tx
      .update(s.informationRequests)
      .set({ response: input.response, respondedAt: new Date() })
      .where(ctx.scope.where(s.informationRequests, eq(s.informationRequests.id, requestId)));

    // The response is also a comment, so the collaboration thread stays whole.
    await ctx.tx.insert(s.comments).values(
      ctx.scope.own({
        decisionId: id,
        userId: ctx.session.userId,
        kind: 'response' as const,
        body: input.response,
      }),
    );

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'information_provided',
      objectType: 'decision',
      objectId: id,
      objectReference: decision.reference,
    });

    let updated = decision;
    if (input.returnToReview) {
      const outstanding = await ctx.tx
        .select({ id: s.informationRequests.id })
        .from(s.informationRequests)
        .where(
          ctx.scope.where(
            s.informationRequests,
            eq(s.informationRequests.decisionId, id),
            isNull(s.informationRequests.respondedAt),
          ),
        );

      if (outstanding.length === 0 && decision.status === 'more_information_required') {
        updated = await transition(ctx, {
          decision,
          to: 'under_tda_review',
          eventType: 'decision_status_changed',
        });
        await notify(ctx.tx, {
          organisationId: ctx.scope.organisationId,
          userIds: [request.requestedByUserId],
          type: 'decision_submitted_for_review',
          title: `${decision.reference} is back with you`,
          body: `${ctx.session.name} answered your request for information.`,
          linkPath: `/decisions/detail?id=${id}`,
        });
      }
    }

    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Implementation and closure                                          */
/* ------------------------------------------------------------------ */

app.http('decisionAdvance', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/advance',
  handler: withOrg({ permissions: ['decision:update'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    if (decision.status === 'implementation') {
      // A decision is not implemented while its conditions are outstanding.
      const remaining = await ctx.tx
        .select({ id: s.actions.id })
        .from(s.actions)
        .where(
          ctx.scope.where(
            s.actions,
            eq(s.actions.decisionId, id),
            inArray(s.actions.status, ['not_started', 'in_progress', 'blocked']),
          ),
        );
      if (remaining.length > 0) {
        throw conflict(
          `${remaining.length} action${remaining.length === 1 ? '' : 's'} must be completed or cancelled first`,
        );
      }

      return json(
        await transition(ctx, {
          decision,
          to: 'implemented',
          eventType: 'decision_status_changed',
        }),
      );
    }

    if (decision.status === 'implemented' || decision.status === 'rejected') {
      return json(
        await transition(ctx, {
          decision,
          to: 'closed',
          eventType: 'decision_status_changed',
          set: { closedAt: new Date() },
        }),
      );
    }

    throw conflict('There is nothing to advance from this state');
  }),
});

app.http('decisionWithdraw', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/withdraw',
  handler: withOrg({ permissions: ['decision:withdraw'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);
    if (decision.ownerId !== ctx.session.userId && !ctx.can('org:manage_config')) {
      throw forbidden('Only the decision owner can withdraw this');
    }
    return json(
      await transition(ctx, {
        decision,
        to: 'withdrawn',
        eventType: 'decision_status_changed',
        set: { closedAt: new Date() },
      }),
    );
  }),
});

/* ------------------------------------------------------------------ */
/* Supersede                                                           */
/* ------------------------------------------------------------------ */

app.http('decisionSupersede', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'decisions/{id}/supersede',
  handler: withOrg({ permissions: ['decision:supersede'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, supersedeDecisionSchema);
    const decision = await loadDecision(ctx, id);
    await assertVisible(ctx, decision);

    if (!input.supersedingDecisionId) {
      throw conflict('Name the decision that supersedes this one');
    }
    const replacement = await loadDecision(ctx, input.supersedingDecisionId);

    const updated = await transition(ctx, {
      decision,
      to: 'superseded',
      eventType: 'decision_superseded',
      details: { supersededBy: replacement.reference, reason: input.reason },
    });

    await ctx.tx
      .insert(s.decisionRelationships)
      .values([
        ctx.scope.own({
          sourceDecisionId: decision.id,
          targetDecisionId: replacement.id,
          type: 'superseded_by' as const,
          note: input.reason,
          createdByUserId: ctx.session.userId,
        }),
        ctx.scope.own({
          sourceDecisionId: replacement.id,
          targetDecisionId: decision.id,
          type: 'supersedes' as const,
          note: input.reason,
          createdByUserId: ctx.session.userId,
        }),
      ])
      .onConflictDoNothing();

    // Superseded decisions stay searchable (spec §65.11) — nothing is removed.
    return json(updated);
  }),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Conditions attached to an approval become tracked actions (spec §36), so a
 * conditional approval can never quietly become an unconditional one.
 */
async function createConditionActions(
  ctx: RequestContext,
  decisionId: string,
  decisionReference: string,
  conditions: { description: string; ownerId?: string | null; ownerTeamId?: string | null; dueDate: string }[],
): Promise<void> {
  for (const condition of conditions) {
    const [row] = await ctx.tx
      .insert(s.decisionConditions)
      .values(
        ctx.scope.own({
          decisionId,
          description: condition.description,
          ownerId: condition.ownerId ?? null,
          ownerTeamId: condition.ownerTeamId ?? null,
          dueDate: condition.dueDate,
        }),
      )
      .returning();

    const { reference, sequence } = await nextActionReference(ctx.tx, ctx.scope.organisationId);

    const [action] = await ctx.tx
      .insert(s.actions)
      .values(
        ctx.scope.own({
          reference,
          sequence,
          description: condition.description,
          decisionId,
          conditionId: row!.id,
          ownerId: condition.ownerId ?? null,
          ownerTeamId: condition.ownerTeamId ?? null,
          dueDate: condition.dueDate,
          priority: 'high' as const,
          status: 'not_started' as const,
          createdByUserId: ctx.session.userId,
        }),
      )
      .returning();

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'action_created',
      objectType: 'action',
      objectId: action!.id,
      objectReference: reference,
      details: { decision: decisionReference, condition: condition.description },
    });

    if (condition.ownerId) {
      await notify(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userIds: [condition.ownerId],
        type: 'action_assigned',
        title: `${reference} is assigned to you`,
        body: `${condition.description}\n\nCondition of ${decisionReference}. Due ${condition.dueDate}.`,
        linkPath: `/actions?highlight=${action!.id}`,
      });
    }
  }
}

async function participants(
  ctx: RequestContext,
  decision: typeof s.decisions.$inferSelect,
): Promise<string[]> {
  const rows = await ctx.tx
    .select({ userId: s.decisionContributors.userId })
    .from(s.decisionContributors)
    .where(ctx.scope.where(s.decisionContributors, eq(s.decisionContributors.decisionId, decision.id)));

  return [...new Set([...rows.map((r) => r.userId), decision.ownerId, decision.technicalLeadId])].filter(
    (id): id is string => Boolean(id) && id !== ctx.session.userId,
  );
}

async function memberOfThisOrg(ctx: RequestContext, userId: string) {
  const [row] = await ctx.tx
    .select({ id: s.users.id, name: s.users.name })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(
      ctx.scope.where(
        s.memberships,
        eq(s.memberships.userId, userId),
        eq(s.memberships.status, 'active'),
      ),
    );
  if (!row) throw notFound('That person');
  return row;
}
