import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import { OPEN_DECISION_STATUSES, PENDING_DECISION_STATUSES } from '@tda/shared';
import { aliasedTable, and, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { withOrg } from '../core/context.js';
import { json } from '../core/http.js';

const ownerUser = aliasedTable(s.users, 'owner_user');

/**
 * The dashboard (spec §37).
 *
 * The counts are secondary. What a person opening this screen actually needs is
 * the list of things waiting on them, so the queues are returned alongside and
 * the interface leads with them.
 */
app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: withOrg({ permissions: ['decision:read'] }, async (ctx) => {
    const me = ctx.session.userId;
    const isAdmin = ctx.can('org:manage_config');
    const isAuthority = ctx.can('decision:decide');

    const openStatuses = [...OPEN_DECISION_STATUSES];
    const pendingStatuses = [...PENDING_DECISION_STATUSES];
    const openActionStatuses = ['not_started', 'in_progress', 'blocked'] as const;

    const countDecisions = async (...filters: Parameters<typeof and>) => {
      const [row] = await ctx.tx
        .select({ value: count() })
        .from(s.decisions)
        .where(ctx.scope.where(s.decisions, and(...filters)));
      return row?.value ?? 0;
    };

    const [
      myDecisions,
      myContributions,
      myActions,
      myOverdueActions,
      openDecisions,
      awaitingMyDecision,
      pendingInformation,
      overdueActions,
      decisionsThisYear,
    ] = await Promise.all([
      countDecisions(eq(s.decisions.ownerId, me), inArray(s.decisions.status, openStatuses)),
      ctx.tx
        .select({ value: count() })
        .from(s.decisionContributors)
        .where(ctx.scope.where(s.decisionContributors, eq(s.decisionContributors.userId, me)))
        .then((r) => r[0]?.value ?? 0),
      ctx.tx
        .select({ value: count() })
        .from(s.actions)
        .where(
          ctx.scope.where(
            s.actions,
            eq(s.actions.ownerId, me),
            inArray(s.actions.status, [...openActionStatuses]),
          ),
        )
        .then((r) => r[0]?.value ?? 0),
      ctx.tx
        .select({ value: count() })
        .from(s.actions)
        .where(
          ctx.scope.where(
            s.actions,
            eq(s.actions.ownerId, me),
            inArray(s.actions.status, [...openActionStatuses]),
            lt(s.actions.dueDate, today()),
          ),
        )
        .then((r) => r[0]?.value ?? 0),
      countDecisions(inArray(s.decisions.status, openStatuses)),
      countDecisions(
        eq(s.decisions.authorityId, me),
        inArray(s.decisions.status, ['under_tda_review', 'escalated']),
      ),
      countDecisions(eq(s.decisions.status, 'more_information_required')),
      ctx.tx
        .select({ value: count() })
        .from(s.actions)
        .where(
          ctx.scope.where(
            s.actions,
            inArray(s.actions.status, [...openActionStatuses]),
            lt(s.actions.dueDate, today()),
          ),
        )
        .then((r) => r[0]?.value ?? 0),
      countDecisions(
        sql`extract(year from ${s.decisions.decidedAt}) = extract(year from current_date)`,
      ),
    ]);

    // Requests for information that are sitting with me.
    const [pendingMyAction] = await ctx.tx
      .select({ value: count() })
      .from(s.informationRequests)
      .where(
        ctx.scope.where(
          s.informationRequests,
          eq(s.informationRequests.assignedToUserId, me),
          isNull(s.informationRequests.respondedAt),
        ),
      );

    const counts: Record<string, number> = {
      myDecisions,
      myContributions,
      myActions,
      myOverdueActions,
      pendingMyAction: pendingMyAction?.value ?? 0,
      openDecisions,
      awaitingMyDecision,
      pendingInformation,
      overdueActions,
      decisionsThisYear,
    };

    if (isAdmin) {
      const [users, projects, teams, technologies] = await Promise.all([
        ctx.tx
          .select({ value: count() })
          .from(s.memberships)
          .where(ctx.scope.where(s.memberships, eq(s.memberships.status, 'active')))
          .then((r) => r[0]?.value ?? 0),
        ctx.tx
          .select({ value: count() })
          .from(s.projects)
          .where(ctx.scope.where(s.projects))
          .then((r) => r[0]?.value ?? 0),
        ctx.tx
          .select({ value: count() })
          .from(s.teams)
          .where(ctx.scope.where(s.teams))
          .then((r) => r[0]?.value ?? 0),
        ctx.tx
          .select({ value: count() })
          .from(s.technologies)
          .where(ctx.scope.where(s.technologies))
          .then((r) => r[0]?.value ?? 0),
      ]);
      Object.assign(counts, { users, projects, teams, technologies });
    }

    /* The queues ---------------------------------------------------- */

    const decisionColumns = {
      id: s.decisions.id,
      reference: s.decisions.reference,
      title: s.decisions.title,
      status: s.decisions.status,
      significance: s.decisions.significance,
      priority: s.decisions.priority,
      requiredBy: s.decisions.requiredBy,
      ownerName: ownerUser.name,
      projectCode: s.projects.code,
    };

    const queue = (filter: SQL | undefined) =>
      ctx.tx
        .select(decisionColumns)
        .from(s.decisions)
        .leftJoin(ownerUser, eq(ownerUser.id, s.decisions.ownerId))
        .leftJoin(s.projects, eq(s.projects.id, s.decisions.projectId))
        .where(ctx.scope.where(s.decisions, filter))
        .orderBy(
          sql`case ${s.decisions.priority}
                when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
          sql`${s.decisions.requiredBy} nulls last`,
        )
        .limit(12);

    const [awaitingMe, mine, needingInformation, myOpenActions] = await Promise.all([
      isAuthority
        ? queue(
            and(
              eq(s.decisions.authorityId, me),
              inArray(s.decisions.status, ['under_tda_review', 'escalated']),
            ),
          )
        : Promise.resolve([]),
      queue(
        and(
          or(eq(s.decisions.ownerId, me), eq(s.decisions.technicalLeadId, me)),
          inArray(s.decisions.status, openStatuses),
        ),
      ),
      queue(inArray(s.decisions.status, pendingStatuses)),
      ctx.tx
        .select({
          id: s.actions.id,
          reference: s.actions.reference,
          description: s.actions.description,
          status: s.actions.status,
          priority: s.actions.priority,
          dueDate: s.actions.dueDate,
          decisionReference: s.decisions.reference,
          decisionId: s.decisions.id,
        })
        .from(s.actions)
        .leftJoin(s.decisions, eq(s.decisions.id, s.actions.decisionId))
        .where(
          ctx.scope.where(
            s.actions,
            eq(s.actions.ownerId, me),
            inArray(s.actions.status, [...openActionStatuses]),
          ),
        )
        .orderBy(sql`${s.actions.dueDate} nulls last`)
        .limit(12),
    ]);

    const recent = await ctx.tx
      .select({
        id: s.auditEvents.id,
        eventType: s.auditEvents.eventType,
        userName: s.auditEvents.userName,
        objectReference: s.auditEvents.objectReference,
        objectId: s.auditEvents.objectId,
        oldStatus: s.auditEvents.oldStatus,
        newStatus: s.auditEvents.newStatus,
        occurredAt: s.auditEvents.occurredAt,
      })
      .from(s.auditEvents)
      .where(ctx.scope.where(s.auditEvents))
      .orderBy(desc(s.auditEvents.occurredAt))
      .limit(15);

    return json({
      counts,
      queues: { awaitingMe, mine, needingInformation, myOpenActions },
      recent,
    });
  }),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
