import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import {
  CrossTenantAccessError,
  getDatabase,
  NotFoundError,
  tenantScope,
  type TenantScope,
} from '@tda/db';
import type { Permission, PlatformPermission, SessionContext } from '@tda/shared';
import { sql } from 'drizzle-orm';
import { forbidden, HttpError, json, notFound, unauthorised } from './http.js';
import { resolveSession } from './auth.js';

type Db = ReturnType<typeof getDatabase>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface RequestContext {
  session: SessionContext;
  /** Organisation-bound query helpers. Present whenever an organisation is selected. */
  scope: TenantScope;
  /** Transaction with `app.organisation_id` set, so RLS applies to every query. */
  tx: Tx;
  request: HttpRequest;
  invocation: InvocationContext;
  can(permission: Permission): boolean;
  require(permission: Permission): void;
}

export interface PlatformRequestContext {
  session: SessionContext;
  tx: Tx;
  request: HttpRequest;
  invocation: InvocationContext;
}

interface Options {
  /** Permissions the caller must hold in the active organisation. */
  permissions?: Permission[];
  /** Skip the organisation requirement (e.g. the session endpoint itself). */
  organisationOptional?: boolean;
}

/**
 * Wraps an organisation-scoped handler.
 *
 * Everything runs inside one transaction so that a workflow change and its
 * audit record either both land or neither does, and so that the RLS session
 * variables are scoped to this request alone.
 */
export function withOrg(
  options: Options,
  handler: (ctx: RequestContext) => Promise<HttpResponseInit>,
) {
  return async (request: HttpRequest, invocation: InvocationContext) => {
    try {
      const session = await resolveSession(request);
      if (!session.organisation) {
        if (!options.organisationOptional) {
          throw forbidden('Choose an organisation before continuing');
        }
        throw forbidden('No organisation selected');
      }

      const held = new Set(session.permissions);
      for (const permission of options.permissions ?? []) {
        if (!held.has(permission)) {
          throw forbidden(deniedMessage(permission));
        }
      }

      const organisationId = session.organisation.id;
      const db = getDatabase();

      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.organisation_id', ${organisationId}, true),
                     set_config('app.user_id', ${session.userId}, true)`,
        );
        const scope = tenantScope(organisationId, session.userId);
        return handler({
          session,
          scope,
          tx,
          request,
          invocation,
          can: (p) => held.has(p),
          require: (p) => {
            if (!held.has(p)) throw forbidden(deniedMessage(p));
          },
        });
      });
    } catch (error) {
      return toResponse(error, invocation);
    }
  };
}

/** Wraps a platform-level (Super Admin) handler. */
export function withPlatform(
  _permissions: PlatformPermission[],
  handler: (ctx: PlatformRequestContext) => Promise<HttpResponseInit>,
) {
  return async (request: HttpRequest, invocation: InvocationContext) => {
    try {
      const session = await resolveSession(request);
      if (!session.isSuperAdmin) throw forbidden('This area is restricted to platform administrators');
      const db = getDatabase();
      return await db.transaction(async (tx) => {
        // Platform work spans organisations, so no app.organisation_id is set.
        // This connection role is exempt from tenant RLS; see sql/001_platform.sql.
        await tx.execute(sql`select set_config('app.user_id', ${session.userId}, true)`);
        return handler({ session, tx, request, invocation });
      });
    } catch (error) {
      return toResponse(error, invocation);
    }
  };
}

/** Wraps a handler that only needs an authenticated caller. */
export function withAuth(
  handler: (session: SessionContext, request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>,
) {
  return async (request: HttpRequest, invocation: InvocationContext) => {
    try {
      return await handler(await resolveSession(request), request, invocation);
    } catch (error) {
      return toResponse(error, invocation);
    }
  };
}

const PERMISSION_MESSAGES: Partial<Record<Permission, string>> = {
  'decision:decide': 'Only a TDA authority can record a decision',
  'decision:submit': 'Only the decision owner can submit this for review',
  'org:manage_users': 'Only an organisation admin can manage users',
  'org:manage_config': 'Only an organisation admin can change this configuration',
  'org:manage_authorities': 'Only an organisation admin can change TDA authorities',
};

function deniedMessage(permission: Permission): string {
  return PERMISSION_MESSAGES[permission] ?? 'You do not have permission to do that';
}

function toResponse(error: unknown, invocation: InvocationContext): HttpResponseInit {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  }
  if (error instanceof CrossTenantAccessError) {
    // Answer identically to a genuine miss so that IDs cannot be probed.
    invocation.warn('Cross-tenant access blocked', { message: error.message });
    const nf = notFound();
    return json({ error: { code: nf.code, message: nf.message } }, nf.status);
  }
  if (error instanceof NotFoundError) {
    return json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
  }
  if (error instanceof Error && error.message.includes('is locked')) {
    return json(
      {
        error: {
          code: 'DECISION_LOCKED',
          message: 'This decision has been formally recorded. Supersede it to record a change.',
        },
      },
      409,
    );
  }
  invocation.error('Unhandled error', error);
  return json(
    { error: { code: 'INTERNAL', message: 'Something went wrong. Try again.' } },
    500,
  );
}

export { unauthorised };
