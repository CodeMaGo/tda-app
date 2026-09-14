import { schema as s } from '@tda/db';
import {
  DECIDED_DECISION_STATUSES,
  DECISION_STATUS_LABELS,
  OPEN_DECISION_STATUSES,
  PENDING_DECISION_STATUSES,
  type ReportModel,
  type ReportRequest,
} from '@tda/shared';
import { aliasedTable, and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { RequestContext } from './context.js';

const ownerUser = aliasedTable(s.users, 'r_owner');
const authorityUser = aliasedTable(s.users, 'r_authority');

/**
 * Builds the report model straight from the current database (spec §64), so
 * "Latest TDA report" always means latest. Nothing is cached and no figure is
 * carried over from a previous run.
 */
export async function buildReport(
  ctx: RequestContext,
  request: ReportRequest,
): Promise<ReportModel> {
  const { periodStart, periodEnd } = request;
  const periodFilter = and(
    gte(s.decisions.createdAt, new Date(`${periodStart}T00:00:00Z`)),
    lte(s.decisions.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
  );

  const narrowing: (SQL | undefined)[] = [];
  if (request.projectIds.length > 0) narrowing.push(inArray(s.decisions.projectId, request.projectIds));
  if (request.decisionTypeIds.length > 0) {
    narrowing.push(inArray(s.decisions.decisionTypeId, request.decisionTypeIds));
  }

  const [org] = await ctx.tx
    .select()
    .from(s.organisations)
    .where(eq(s.organisations.id, ctx.scope.organisationId));

  const summaryColumns = {
    id: s.decisions.id,
    reference: s.decisions.reference,
    title: s.decisions.title,
    status: s.decisions.status,
    significance: s.decisions.significance,
    priority: s.decisions.priority,
    typeName: s.decisionTypes.name,
    projectName: s.projects.name,
    projectCode: s.projects.code,
    ownerName: ownerUser.name,
    authorityName: authorityUser.name,
    requiredBy: s.decisions.requiredBy,
    decidedAt: s.decisions.decidedAt,
    createdAt: s.decisions.createdAt,
    openActionCount: sql<number>`(select count(*) from actions a where a.decision_id = ${s.decisions.id}
        and a.status in ('not_started','in_progress','blocked'))`.mapWith(Number),
    overdueActionCount: sql<number>`(select count(*) from actions a where a.decision_id = ${s.decisions.id}
        and a.status in ('not_started','in_progress','blocked')
        and a.due_date is not null and a.due_date < current_date)`.mapWith(Number),
    highestRiskRating: sql<string | null>`(select r.rating from risks r
        where r.decision_id = ${s.decisions.id} and r.status <> 'closed'
        order by array_position(array['very_low','low','medium','high','critical']::text[], r.rating::text) desc
        limit 1)`,
  };

  const baseQuery = () =>
    ctx.tx
      .select(summaryColumns)
      .from(s.decisions)
      .leftJoin(s.decisionTypes, eq(s.decisionTypes.id, s.decisions.decisionTypeId))
      .leftJoin(s.projects, eq(s.projects.id, s.decisions.projectId))
      .leftJoin(ownerUser, eq(ownerUser.id, s.decisions.ownerId))
      .leftJoin(authorityUser, eq(authorityUser.id, s.decisions.authorityId));

  const [raisedInPeriod, decisionsTaken, openDecisions, pendingDecisions] = await Promise.all([
    baseQuery().where(ctx.scope.where(s.decisions, periodFilter, ...narrowing)),
    baseQuery()
      .where(
        ctx.scope.where(
          s.decisions,
          inArray(s.decisions.status, [...DECIDED_DECISION_STATUSES]),
          isNotNull(s.decisions.decidedAt),
          gte(s.decisions.decidedAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(s.decisions.decidedAt, new Date(`${periodEnd}T23:59:59.999Z`)),
          ...narrowing,
        ),
      )
      .orderBy(asc(s.decisions.decidedAt)),
    baseQuery()
      .where(
        ctx.scope.where(s.decisions, inArray(s.decisions.status, [...OPEN_DECISION_STATUSES]), ...narrowing),
      )
      .orderBy(sql`${s.decisions.requiredBy} nulls last`),
    baseQuery()
      .where(
        ctx.scope.where(
          s.decisions,
          inArray(s.decisions.status, [...PENDING_DECISION_STATUSES]),
          ...narrowing,
        ),
      )
      .orderBy(sql`${s.decisions.requiredBy} nulls last`),
  ]);

  const countStatus = (statuses: string[]) =>
    raisedInPeriod.filter((d) => statuses.includes(d.status)).length;

  const outstandingActions = await ctx.tx
    .select({
      id: s.actions.id,
      reference: s.actions.reference,
      description: s.actions.description,
      status: s.actions.status,
      priority: s.actions.priority,
      dueDate: s.actions.dueDate,
      ownerName: s.users.name,
      ownerTeamName: s.teams.name,
      decisionReference: s.decisions.reference,
      decisionTitle: s.decisions.title,
      isOverdue: sql<boolean>`(${s.actions.dueDate} is not null and ${s.actions.dueDate} < current_date)`,
    })
    .from(s.actions)
    .leftJoin(s.users, eq(s.users.id, s.actions.ownerId))
    .leftJoin(s.teams, eq(s.teams.id, s.actions.ownerTeamId))
    .leftJoin(s.decisions, eq(s.decisions.id, s.actions.decisionId))
    .where(
      ctx.scope.where(s.actions, inArray(s.actions.status, ['not_started', 'in_progress', 'blocked'])),
    )
    .orderBy(sql`${s.actions.dueDate} nulls last`);

  const risks = await ctx.tx
    .select({
      decisionReference: s.decisions.reference,
      decisionTitle: s.decisions.title,
      summary: s.risks.summary,
      rating: s.risks.rating,
      residualRating: s.risks.residualRating,
      mitigation: s.risks.mitigation,
      ownerName: s.users.name,
      status: s.risks.status,
    })
    .from(s.risks)
    .innerJoin(s.decisions, eq(s.decisions.id, s.risks.decisionId))
    .leftJoin(s.users, eq(s.users.id, s.risks.ownerId))
    .where(
      ctx.scope.where(
        s.risks,
        inArray(s.risks.rating, ['high', 'critical']),
        inArray(s.risks.status, ['open', 'mitigating', 'accepted']),
      ),
    )
    .orderBy(sql`array_position(array['very_low','low','medium','high','critical']::text[], ${s.risks.rating}::text) desc`);

  // Technical exceptions carry standing risk, so they get their own section.
  const exceptions = await ctx.tx
    .select({
      reference: s.decisions.reference,
      title: s.decisions.title,
      decidedAt: s.decisions.decidedAt,
      authorityName: authorityUser.name,
      conditions: sql<string[]>`coalesce((
        select array_agg(dc.description) from decision_conditions dc
         where dc.decision_id = ${s.decisions.id} and dc.satisfied_at is null), '{}')`,
      expiresOn: sql<string | null>`(
        select min(dc.due_date)::text from decision_conditions dc
         where dc.decision_id = ${s.decisions.id} and dc.satisfied_at is null)`,
    })
    .from(s.decisions)
    .innerJoin(s.decisionTypes, eq(s.decisionTypes.id, s.decisions.decisionTypeId))
    .leftJoin(authorityUser, eq(authorityUser.id, s.decisions.decidedByUserId))
    .where(
      ctx.scope.where(
        s.decisions,
        inArray(s.decisionTypes.name, ['Technical Exception', 'Technical Risk']),
        inArray(s.decisions.status, ['approved', 'approved_with_conditions', 'implementation']),
      ),
    );

  const [timing] = await ctx.tx
    .select({
      averageDays: sql<number | null>`avg(extract(epoch from (${s.decisions.decidedAt} - ${s.decisions.createdAt})) / 86400)`,
    })
    .from(s.decisions)
    .where(
      ctx.scope.where(
        s.decisions,
        isNotNull(s.decisions.decidedAt),
        gte(s.decisions.decidedAt, new Date(`${periodStart}T00:00:00Z`)),
        lte(s.decisions.decidedAt, new Date(`${periodEnd}T23:59:59.999Z`)),
      ),
    );

  const analytics = await buildAnalytics(ctx, periodStart, periodEnd);

  return {
    organisation: { name: org!.name, code: org!.code, logoUrl: org!.logoUrl },
    period: { start: periodStart, end: periodEnd },
    generatedAt: new Date().toISOString(),
    generatedBy: ctx.session.name,
    summary: {
      raised: raisedInPeriod.length,
      completed: countStatus([...DECIDED_DECISION_STATUSES]),
      approved: countStatus(['approved', 'implementation', 'implemented', 'closed']),
      approvedWithConditions: countStatus(['approved_with_conditions']),
      rejected: countStatus(['rejected']),
      deferred: countStatus(['deferred']),
      open: openDecisions.length,
      pending: pendingDecisions.length,
      overdueDecisions: openDecisions.filter(
        (d) => d.requiredBy && d.requiredBy < new Date().toISOString().slice(0, 10),
      ).length,
      outstandingActions: outstandingActions.length,
      overdueActions: outstandingActions.filter((a) => a.isOverdue).length,
      averageDaysToDecision:
        timing?.averageDays == null ? null : Math.round(Number(timing.averageDays) * 10) / 10,
    },
    decisionsTaken: decisionsTaken as unknown as ReportModel['decisionsTaken'],
    openDecisions: openDecisions as unknown as ReportModel['openDecisions'],
    pendingDecisions: pendingDecisions.map((d) => ({
      ...d,
      waitingOn: DECISION_STATUS_LABELS[d.status],
    })) as unknown as ReportModel['pendingDecisions'],
    outstandingActions: outstandingActions as unknown as ReportModel['outstandingActions'],
    risks: risks as unknown as ReportModel['risks'],
    exceptions: exceptions as unknown as ReportModel['exceptions'],
    analytics,
  };
}

async function buildAnalytics(
  ctx: RequestContext,
  periodStart: string,
  periodEnd: string,
): Promise<ReportModel['analytics']> {
  const inPeriod = and(
    gte(s.decisions.createdAt, new Date(`${periodStart}T00:00:00Z`)),
    lte(s.decisions.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
  );

  const tally = sql<number>`count(*)`.mapWith(Number);

  const [byType, byProject, byOutcome, byAuthority, byTechnology] = await Promise.all([
    ctx.tx
      .select({ label: s.decisionTypes.name, count: tally })
      .from(s.decisions)
      .innerJoin(s.decisionTypes, eq(s.decisionTypes.id, s.decisions.decisionTypeId))
      .where(ctx.scope.where(s.decisions, inPeriod))
      .groupBy(s.decisionTypes.name),
    ctx.tx
      .select({ label: s.projects.name, count: tally })
      .from(s.decisions)
      .innerJoin(s.projects, eq(s.projects.id, s.decisions.projectId))
      .where(ctx.scope.where(s.decisions, inPeriod))
      .groupBy(s.projects.name),
    ctx.tx
      .select({ label: sql<string>`${s.decisions.status}::text`, count: tally })
      .from(s.decisions)
      .where(ctx.scope.where(s.decisions, inPeriod))
      .groupBy(s.decisions.status),
    ctx.tx
      .select({ label: authorityUser.name, count: tally })
      .from(s.decisions)
      .innerJoin(authorityUser, eq(authorityUser.id, s.decisions.decidedByUserId))
      .where(ctx.scope.where(s.decisions, inPeriod))
      .groupBy(authorityUser.name),
    ctx.tx
      .select({ label: s.technologies.name, count: tally })
      .from(s.decisionTechnologies)
      .innerJoin(s.technologies, eq(s.technologies.id, s.decisionTechnologies.technologyId))
      .innerJoin(s.decisions, eq(s.decisions.id, s.decisionTechnologies.decisionId))
      .where(ctx.scope.where(s.decisionTechnologies, inPeriod))
      .groupBy(s.technologies.name)
      .orderBy(sql`count(*) desc`)
      .limit(15),
  ]);

  const clean = (rows: { label: string | null; count: number }[]) =>
    rows
      .filter((r): r is { label: string; count: number } => Boolean(r.label))
      .sort((a, b) => b.count - a.count);

  return {
    byType: clean(byType),
    byProject: clean(byProject),
    byOutcome: clean(
      byOutcome.map((r) => ({
        label: DECISION_STATUS_LABELS[r.label as keyof typeof DECISION_STATUS_LABELS] ?? r.label,
        count: r.count,
      })),
    ),
    byAuthority: clean(byAuthority),
    byTechnology: clean(byTechnology),
  };
}
