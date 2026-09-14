import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import {
  DECISION_SIGNIFICANCES,
  DECISION_STATUSES,
  PRIORITIES,
  RISK_LEVELS,
  savedSearchSchema,
  type SearchInput,
} from '@tda/shared';
import { aliasedTable, and, asc, desc, eq, exists, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { withOrg } from '../core/context.js';
import { boolQuery, csv, intQuery, json, readBody, readQuery } from '../core/http.js';
import { z } from 'zod';

const ownerUser = aliasedTable(s.users, 'owner_user');
const authorityUser = aliasedTable(s.users, 'authority_user');

/**
 * Search (spec §38–40).
 *
 * Postgres full-text carries the free-text half; everything else is a
 * structured filter. The ranked `ts_rank_cd` ordering is only used when there
 * is a query to rank against — otherwise the sort the user asked for wins.
 *
 * Note the organisation predicate is not optional and not derived from input:
 * `scope.where` puts it on every branch.
 */

const querySchema = z.object({
  text: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(40).optional(),
  statuses: csv(DECISION_STATUSES),
  significances: csv(DECISION_SIGNIFICANCES),
  priorities: csv(PRIORITIES),
  riskRatings: csv(RISK_LEVELS),
  ownerIds: z.string().optional().transform(splitIds),
  authorityIds: z.string().optional().transform(splitIds),
  contributorIds: z.string().optional().transform(splitIds),
  projectIds: z.string().optional().transform(splitIds),
  teamIds: z.string().optional().transform(splitIds),
  technologyIds: z.string().optional().transform(splitIds),
  typeIds: z.string().optional().transform(splitIds),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  decidedFrom: z.string().optional(),
  decidedTo: z.string().optional(),
  requiredFrom: z.string().optional(),
  requiredTo: z.string().optional(),
  hasOpenActions: boolQuery,
  hasOverdueActions: boolQuery,
  sort: z
    .enum(['relevance', 'created_at', 'required_by', 'decided_at', 'priority', 'reference'])
    .optional()
    .default('created_at'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: intQuery(1, 1, 10_000),
  pageSize: intQuery(25, 1, 200),
});

function splitIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const ids = value.split(',').map((v) => v.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

app.http('decisionSearch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'decisions',
  handler: withOrg({ permissions: ['decision:read'] }, async (ctx) => {
    const q = readQuery(ctx.request, querySchema);
    const filters: (SQL | undefined)[] = [];

    const tsQuery = q.text ? sql`websearch_to_tsquery('english', ${q.text})` : null;
    if (tsQuery) {
      // Match the ranked index, or fall back to a trigram title match so that a
      // half-remembered title still finds the decision.
      filters.push(
        or(
          sql`${s.decisions.searchVector} @@ ${tsQuery}`,
          ilike(s.decisions.title, `%${q.text}%`),
          ilike(s.decisions.reference, `%${q.text}%`),
        ),
      );
    }
    if (q.reference) filters.push(ilike(s.decisions.reference, `%${q.reference}%`));
    if (q.statuses?.length) filters.push(inArray(s.decisions.status, q.statuses));
    if (q.significances?.length) filters.push(inArray(s.decisions.significance, q.significances));
    if (q.priorities?.length) filters.push(inArray(s.decisions.priority, q.priorities));
    if (q.ownerIds) filters.push(inArray(s.decisions.ownerId, q.ownerIds));
    if (q.authorityIds) filters.push(inArray(s.decisions.authorityId, q.authorityIds));
    if (q.projectIds) filters.push(inArray(s.decisions.projectId, q.projectIds));
    if (q.typeIds) filters.push(inArray(s.decisions.decisionTypeId, q.typeIds));
    if (q.createdFrom) filters.push(gte(s.decisions.createdAt, new Date(q.createdFrom)));
    if (q.createdTo) filters.push(lte(s.decisions.createdAt, endOfDay(q.createdTo)));
    if (q.decidedFrom) filters.push(gte(s.decisions.decidedAt, new Date(q.decidedFrom)));
    if (q.decidedTo) filters.push(lte(s.decisions.decidedAt, endOfDay(q.decidedTo)));
    if (q.requiredFrom) filters.push(gte(s.decisions.requiredBy, q.requiredFrom));
    if (q.requiredTo) filters.push(lte(s.decisions.requiredBy, q.requiredTo));

    if (q.contributorIds) {
      filters.push(
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(s.decisionContributors)
            .where(
              and(
                eq(s.decisionContributors.decisionId, s.decisions.id),
                inArray(s.decisionContributors.userId, q.contributorIds),
              ),
            ),
        ),
      );
    }
    if (q.teamIds) {
      filters.push(
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(s.decisionTeams)
            .where(
              and(eq(s.decisionTeams.decisionId, s.decisions.id), inArray(s.decisionTeams.teamId, q.teamIds)),
            ),
        ),
      );
    }
    if (q.technologyIds) {
      filters.push(
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(s.decisionTechnologies)
            .where(
              and(
                eq(s.decisionTechnologies.decisionId, s.decisions.id),
                inArray(s.decisionTechnologies.technologyId, q.technologyIds),
              ),
            ),
        ),
      );
    }
    if (q.riskRatings?.length) {
      filters.push(
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(s.risks)
            .where(and(eq(s.risks.decisionId, s.decisions.id), inArray(s.risks.rating, q.riskRatings))),
        ),
      );
    }

    const openActions = sql<number>`(
      select count(*) from actions a
       where a.decision_id = ${s.decisions.id}
         and a.status in ('not_started','in_progress','blocked')
    )`.mapWith(Number);

    const overdueActions = sql<number>`(
      select count(*) from actions a
       where a.decision_id = ${s.decisions.id}
         and a.status in ('not_started','in_progress','blocked')
         and a.due_date is not null and a.due_date < current_date
    )`.mapWith(Number);

    if (q.hasOpenActions) filters.push(sql`${openActions} > 0`);
    if (q.hasOverdueActions) filters.push(sql`${overdueActions} > 0`);

    // Restricted decisions are filtered in SQL rather than after paging, so the
    // result count the user sees is the count they are allowed to see.
    filters.push(visibilityFilter(ctx));

    const where = ctx.scope.where(s.decisions, ...filters);

    const rank = tsQuery
      ? sql<number>`ts_rank_cd(${s.decisions.searchVector}, ${tsQuery})`.mapWith(Number)
      : sql<number>`0`.mapWith(Number);

    const direction = q.direction === 'asc' ? asc : desc;
    const orderBy =
      q.sort === 'relevance' && tsQuery
        ? [desc(rank), desc(s.decisions.createdAt)]
        : q.sort === 'required_by'
          ? [direction(s.decisions.requiredBy)]
          : q.sort === 'decided_at'
            ? [direction(s.decisions.decidedAt)]
            : q.sort === 'reference'
              ? [direction(s.decisions.reference)]
              : q.sort === 'priority'
                ? [direction(s.decisions.priority), desc(s.decisions.requiredBy)]
                : [direction(s.decisions.createdAt)];

    const [{ total } = { total: 0 }] = await ctx.tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(s.decisions)
      .where(where);

    const items = await ctx.tx
      .select({
        id: s.decisions.id,
        reference: s.decisions.reference,
        title: s.decisions.title,
        status: s.decisions.status,
        significance: s.decisions.significance,
        priority: s.decisions.priority,
        requiredBy: s.decisions.requiredBy,
        decidedAt: s.decisions.decidedAt,
        createdAt: s.decisions.createdAt,
        typeName: s.decisionTypes.name,
        projectName: s.projects.name,
        projectCode: s.projects.code,
        ownerName: ownerUser.name,
        authorityName: authorityUser.name,
        openActionCount: openActions,
        overdueActionCount: overdueActions,
        highestRiskRating: sql<string | null>`(
          select r.rating from risks r
           where r.decision_id = ${s.decisions.id} and r.status <> 'closed'
           order by array_position(
             array['very_low','low','medium','high','critical']::text[], r.rating::text) desc
           limit 1
        )`,
        rank,
      })
      .from(s.decisions)
      .leftJoin(s.decisionTypes, eq(s.decisionTypes.id, s.decisions.decisionTypeId))
      .leftJoin(s.projects, eq(s.projects.id, s.decisions.projectId))
      .leftJoin(ownerUser, eq(ownerUser.id, s.decisions.ownerId))
      .leftJoin(authorityUser, eq(authorityUser.id, s.decisions.authorityId))
      .where(where)
      .orderBy(...orderBy)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    return json({ items, page: q.page, pageSize: q.pageSize, total });
  }),
});

/* ------------------------------------------------------------------ */
/* Saved searches                                                      */
/* ------------------------------------------------------------------ */

app.http('savedSearchList', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'saved-searches',
  handler: withOrg({ permissions: ['decision:read'] }, async (ctx) => {
    if (ctx.request.method === 'POST') {
      const input = await readBody(ctx.request, savedSearchSchema);
      const [created] = await ctx.tx
        .insert(s.savedSearches)
        .values(
          ctx.scope.own({
            userId: ctx.session.userId,
            name: input.name,
            criteria: input.criteria as unknown as Record<string, unknown>,
            isShared: input.isShared,
          }),
        )
        .onConflictDoUpdate({
          target: [s.savedSearches.organisationId, s.savedSearches.userId, s.savedSearches.name],
          set: { criteria: input.criteria as unknown as Record<string, unknown>, isShared: input.isShared },
        })
        .returning();
      return json(created, 201);
    }

    const rows = await ctx.tx
      .select()
      .from(s.savedSearches)
      .where(
        ctx.scope.where(
          s.savedSearches,
          or(eq(s.savedSearches.userId, ctx.session.userId), eq(s.savedSearches.isShared, true)),
        ),
      )
      .orderBy(s.savedSearches.name);
    return json({ items: rows });
  }),
});

/* ------------------------------------------------------------------ */

/**
 * Restricted and project decisions are filtered in SQL rather than after
 * paging, so the number of results reported is the number the caller is
 * entitled to see (spec §65.13).
 */
function visibilityFilter(ctx: {
  session: { userId: string };
  can: (permission: 'org:manage_config') => boolean;
}): SQL | undefined {
  if (ctx.can('org:manage_config')) return undefined;
  const userId = ctx.session.userId;
  return sql`(
    ${s.decisions.visibility} = 'organisation'
    or ${s.decisions.ownerId} = ${userId}
    or ${s.decisions.authorityId} = ${userId}
    or ${s.decisions.createdByUserId} = ${userId}
    or ${s.decisions.technicalLeadId} = ${userId}
    or exists (
      select 1 from decision_contributors dc
       where dc.decision_id = ${s.decisions.id} and dc.user_id = ${userId}
    )
    or (
      ${s.decisions.visibility} = 'project'
      and exists (
        select 1 from project_members pm
         where pm.project_id = ${s.decisions.projectId} and pm.user_id = ${userId}
      )
    )
  )`;
}

function endOfDay(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

export type { SearchInput };
