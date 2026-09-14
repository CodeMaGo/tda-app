import { app, type InvocationContext, type Timer } from '@azure/functions';
import { getDatabase, schema as s } from '@tda/db';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { audit } from '../core/audit.js';
import { sendEmails } from '../core/notify.js';

/**
 * Scheduled work (spec §42).
 *
 * Timer triggers are enough at this scale and keep the deployment to one
 * resource. If the platform grows to need retries, fan-out or step functions,
 * these three jobs become Inngest functions with no change to their bodies —
 * that is why each is written as a plain exported function.
 *
 * These run outside any user session, so they set the RLS organisation context
 * per organisation as they go rather than running unscoped.
 */

const OPEN_STATUSES = ['not_started', 'in_progress', 'blocked'] as const;

/** 07:00 UTC daily — flag what has gone overdue and tell the owners. */
app.timer('flagOverdueActions', {
  schedule: '0 0 7 * * *',
  handler: async (_timer: Timer, context: InvocationContext) => {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    const overdue = await db
      .select({
        id: s.actions.id,
        organisationId: s.actions.organisationId,
        reference: s.actions.reference,
        description: s.actions.description,
        dueDate: s.actions.dueDate,
        ownerId: s.actions.ownerId,
        ownerEmail: s.users.email,
        ownerName: s.users.name,
        decisionReference: s.decisions.reference,
      })
      .from(s.actions)
      .leftJoin(s.users, eq(s.users.id, s.actions.ownerId))
      .leftJoin(s.decisions, eq(s.decisions.id, s.actions.decisionId))
      .where(
        and(
          inArray(s.actions.status, [...OPEN_STATUSES]),
          lt(s.actions.dueDate, today),
          isNull(s.actions.overdueNotifiedAt),
        ),
      );

    context.log(`Overdue actions to flag: ${overdue.length}`);
    if (overdue.length === 0) return;

    for (const action of overdue) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.organisation_id', ${action.organisationId}, true)`,
        );

        await tx
          .update(s.actions)
          .set({ overdueNotifiedAt: new Date() })
          .where(eq(s.actions.id, action.id));

        await audit(tx, {
          organisationId: action.organisationId,
          userId: null,
          userName: 'Platform',
          eventType: 'action_overdue',
          objectType: 'action',
          objectId: action.id,
          objectReference: action.reference,
          details: { dueDate: action.dueDate },
        });

        if (action.ownerId) {
          await tx.insert(s.notifications).values({
            organisationId: action.organisationId,
            userId: action.ownerId,
            type: 'action_overdue',
            title: `${action.reference} is overdue`,
            body: action.description,
            linkPath: `/actions?highlight=${action.id}`,
          });
        }
      });
    }

    await sendEmails(
      overdue
        .filter((a) => a.ownerEmail)
        .map((a) => ({
          to: a.ownerEmail!,
          name: a.ownerName ?? '',
          subject: `${a.reference} is overdue`,
          body: `${a.description}\n\nThis action was due on ${a.dueDate}${
            a.decisionReference ? ` and comes from ${a.decisionReference}` : ''
          }.`,
          linkPath: '/actions',
        })),
    );
  },
});

/** 07:15 UTC daily — remind owners a week before an action is due. */
app.timer('remindUpcomingActions', {
  schedule: '0 15 7 * * *',
  handler: async (_timer: Timer, context: InvocationContext) => {
    const db = getDatabase();
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 7);
    const horizonDate = horizon.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const upcoming = await db
      .select({
        id: s.actions.id,
        organisationId: s.actions.organisationId,
        reference: s.actions.reference,
        description: s.actions.description,
        dueDate: s.actions.dueDate,
        ownerId: s.actions.ownerId,
        ownerEmail: s.users.email,
        ownerName: s.users.name,
      })
      .from(s.actions)
      .leftJoin(s.users, eq(s.users.id, s.actions.ownerId))
      .where(
        and(
          inArray(s.actions.status, [...OPEN_STATUSES]),
          lte(s.actions.dueDate, horizonDate),
          sql`${s.actions.dueDate} >= ${today}`,
          isNull(s.actions.dueSoonNotifiedAt),
        ),
      );

    context.log(`Upcoming actions to remind: ${upcoming.length}`);

    for (const action of upcoming) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.organisation_id', ${action.organisationId}, true)`,
        );
        await tx
          .update(s.actions)
          .set({ dueSoonNotifiedAt: new Date() })
          .where(eq(s.actions.id, action.id));

        if (action.ownerId) {
          await tx.insert(s.notifications).values({
            organisationId: action.organisationId,
            userId: action.ownerId,
            type: 'action_due_soon',
            title: `${action.reference} is due on ${action.dueDate}`,
            body: action.description,
            linkPath: `/actions?highlight=${action.id}`,
          });
        }
      });
    }

    await sendEmails(
      upcoming
        .filter((a) => a.ownerEmail)
        .map((a) => ({
          to: a.ownerEmail!,
          name: a.ownerName ?? '',
          subject: `${a.reference} is due on ${a.dueDate}`,
          body: a.description,
          linkPath: '/actions',
        })),
    );
  },
});

/**
 * 03:00 UTC daily — clear up upload rows the browser never confirmed. Without
 * this, an abandoned upload would show as evidence that cannot be downloaded.
 */
app.timer('cleanupAbandonedUploads', {
  schedule: '0 0 3 * * *',
  handler: async (_timer: Timer, context: InvocationContext) => {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const removed = await db
      .delete(s.attachments)
      .where(and(isNull(s.attachments.uploadConfirmedAt), lt(s.attachments.createdAt, cutoff)))
      .returning({ id: s.attachments.id });

    context.log(`Removed ${removed.length} abandoned upload records`);
  },
});

/** 08:00 Monday — nudge authorities with decisions sitting in their queue. */
app.timer('remindPendingReviews', {
  schedule: '0 0 8 * * 1',
  handler: async (_timer: Timer, context: InvocationContext) => {
    const db = getDatabase();

    const waiting = await db
      .select({
        organisationId: s.decisions.organisationId,
        authorityId: s.decisions.authorityId,
        email: s.users.email,
        name: s.users.name,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(s.decisions)
      .innerJoin(s.users, eq(s.users.id, s.decisions.authorityId))
      .where(inArray(s.decisions.status, ['under_tda_review', 'escalated']))
      .groupBy(s.decisions.organisationId, s.decisions.authorityId, s.users.email, s.users.name);

    context.log(`Authorities with a queue: ${waiting.length}`);

    await sendEmails(
      waiting.map((row) => ({
        to: row.email,
        name: row.name,
        subject: `${row.count} decision${row.count === 1 ? '' : 's'} awaiting your decision`,
        body: `You have ${row.count} technical decision${row.count === 1 ? '' : 's'} waiting on you.`,
        linkPath: '/',
      })),
    );
  },
});
