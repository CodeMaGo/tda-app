import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import { ACTION_STATUSES, actionSchema, updateActionSchema } from '@tda/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, nextActionReference } from '../core/audit.js';
import { withOrg } from '../core/context.js';
import { boolQuery, csv, forbidden, json, notFound, readBody, readQuery, uuidParam } from '../core/http.js';
import { notify } from '../core/notify.js';

/** Actions are first-class objects, not a checklist hanging off a decision (spec §35). */

const listQuery = z.object({
  statuses: csv(ACTION_STATUSES),
  ownerId: z.string().uuid().optional(),
  mine: boolQuery,
  overdue: boolQuery,
  decisionId: z.string().uuid().optional(),
});

app.http('actionList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'actions',
  handler: withOrg({ permissions: ['action:read'] }, async (ctx) => {
    const q = readQuery(ctx.request, listQuery);

    const filters = [
      q.statuses?.length ? inArray(s.actions.status, q.statuses) : undefined,
      q.mine ? eq(s.actions.ownerId, ctx.session.userId) : undefined,
      q.ownerId ? eq(s.actions.ownerId, q.ownerId) : undefined,
      q.decisionId ? eq(s.actions.decisionId, q.decisionId) : undefined,
      q.overdue
        ? and(
            lt(s.actions.dueDate, new Date().toISOString().slice(0, 10)),
            inArray(s.actions.status, ['not_started', 'in_progress', 'blocked']),
          )
        : undefined,
    ];

    const items = await ctx.tx
      .select({
        id: s.actions.id,
        reference: s.actions.reference,
        description: s.actions.description,
        detail: s.actions.detail,
        status: s.actions.status,
        priority: s.actions.priority,
        dueDate: s.actions.dueDate,
        completedAt: s.actions.completedAt,
        ownerId: s.actions.ownerId,
        ownerName: s.users.name,
        ownerTeamName: s.teams.name,
        decisionId: s.decisions.id,
        decisionReference: s.decisions.reference,
        decisionTitle: s.decisions.title,
        isOverdue: sql<boolean>`(
          ${s.actions.dueDate} is not null
          and ${s.actions.dueDate} < current_date
          and ${s.actions.status} in ('not_started','in_progress','blocked')
        )`,
      })
      .from(s.actions)
      .leftJoin(s.users, eq(s.users.id, s.actions.ownerId))
      .leftJoin(s.teams, eq(s.teams.id, s.actions.ownerTeamId))
      .leftJoin(s.decisions, eq(s.decisions.id, s.actions.decisionId))
      .where(ctx.scope.where(s.actions, ...filters))
      .orderBy(sql`${s.actions.dueDate} nulls last`, s.actions.reference);

    return json({ items });
  }),
});

app.http('actionCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'actions',
  handler: withOrg({ permissions: ['action:create'] }, async (ctx) => {
    const input = await readBody(ctx.request, actionSchema);
    const { reference, sequence } = await nextActionReference(ctx.tx, ctx.scope.organisationId);

    const [created] = await ctx.tx
      .insert(s.actions)
      .values(
        ctx.scope.own({
          reference,
          sequence,
          description: input.description,
          detail: input.detail ?? null,
          decisionId: input.decisionId ?? null,
          ownerId: input.ownerId ?? null,
          ownerTeamId: input.ownerTeamId ?? null,
          dueDate: input.dueDate ?? null,
          priority: input.priority,
          status: input.status,
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
      objectId: created!.id,
      objectReference: reference,
    });

    if (input.ownerId) {
      await notify(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userIds: [input.ownerId],
        type: 'action_assigned',
        title: `${reference} is assigned to you`,
        body: input.description,
        linkPath: `/actions?highlight=${created!.id}`,
      });
    }

    return json(created, 201);
  }),
});

app.http('actionUpdate', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'actions/{id}',
  handler: withOrg({ permissions: ['action:read'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const input = await readBody(ctx.request, updateActionSchema);

    const [existing] = await ctx.tx
      .select()
      .from(s.actions)
      .where(ctx.scope.where(s.actions, eq(s.actions.id, id)));
    if (!existing) throw notFound('That action');

    const isOwner = existing.ownerId === ctx.session.userId;
    if (!isOwner && !ctx.can('action:update_any')) {
      throw forbidden('This action is assigned to someone else');
    }
    // Reassigning belongs to whoever manages the work, not the assignee.
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId && !ctx.can('action:update_any')) {
      throw forbidden('You cannot reassign this action');
    }

    const completing = input.status === 'complete' && existing.status !== 'complete';

    const [updated] = await ctx.tx
      .update(s.actions)
      .set({
        ...input,
        completedAt: completing ? new Date() : input.status ? null : existing.completedAt,
      })
      .where(ctx.scope.where(s.actions, eq(s.actions.id, id)))
      .returning();

    if (completing) {
      await audit(ctx.tx, {
        organisationId: ctx.scope.organisationId,
        userId: ctx.session.userId,
        userName: ctx.session.name,
        eventType: 'action_completed',
        objectType: 'action',
        objectId: id,
        objectReference: existing.reference,
        oldStatus: existing.status,
        newStatus: 'complete',
      });

      // Completing the last action on a condition satisfies that condition.
      if (existing.conditionId) {
        await ctx.tx
          .update(s.decisionConditions)
          .set({ satisfiedAt: new Date() })
          .where(
            ctx.scope.where(s.decisionConditions, eq(s.decisionConditions.id, existing.conditionId)),
          );
      }
    }

    return json(updated);
  }),
});
