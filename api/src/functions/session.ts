import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import { eq, isNull } from 'drizzle-orm';
import { withAuth, withOrg } from '../core/context.js';
import { json, noContent } from '../core/http.js';

/** Who am I, what organisation am I in, and what may I do. */
app.http('sessionGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'session',
  handler: withAuth(async (session) => json(session)),
});

/** Unread notifications for the signed-in user. */
app.http('notificationsList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications',
  handler: withOrg({ permissions: [] }, async (ctx) => {
    const rows = await ctx.tx
      .select()
      .from(s.notifications)
      .where(ctx.scope.where(s.notifications, eq(s.notifications.userId, ctx.session.userId)))
      .orderBy(s.notifications.createdAt)
      .limit(50);
    return json({ items: rows.reverse(), unread: rows.filter((r) => !r.readAt).length });
  }),
});

app.http('notificationsMarkRead', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'notifications/read',
  handler: withOrg({ permissions: [] }, async (ctx) => {
    await ctx.tx
      .update(s.notifications)
      .set({ readAt: new Date() })
      .where(
        ctx.scope.where(
          s.notifications,
          eq(s.notifications.userId, ctx.session.userId),
          isNull(s.notifications.readAt),
        ),
      );
    return noContent();
  }),
});
