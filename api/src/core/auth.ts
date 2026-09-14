import { getDatabase, schema as s } from '@tda/db';
import { permissionsFor, type OrgRole, type SessionContext } from '@tda/shared';
import type { HttpRequest } from '@azure/functions';
import { and, eq } from 'drizzle-orm';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { forbidden, unauthorised } from './http.js';

/**
 * Identity comes from Supabase Auth. This module does two things and nothing
 * else: prove the caller is who the token says they are, then look up what that
 * person is allowed to do *from the database*.
 *
 * Organisation context is never read from a header, query parameter or body
 * field (spec §7). It is derived from the caller's membership rows.
 */

const issuer = () => process.env.SUPABASE_JWT_ISSUER ?? `${process.env.SUPABASE_URL}/auth/v1`;

let keyStore: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet> | null =
  null;

function jwks() {
  if (keyStore) return keyStore;
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  keyStore = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return keyStore;
}

interface SupabaseClaims extends JWTPayload {
  sub: string;
  email?: string;
  user_metadata?: { name?: string; full_name?: string };
}

async function verifyToken(token: string): Promise<SupabaseClaims> {
  // Legacy projects sign with a shared HS256 secret; newer ones publish a JWKS.
  const legacySecret = process.env.SUPABASE_JWT_SECRET;
  try {
    if (legacySecret) {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(legacySecret), {
        issuer: issuer(),
        audience: 'authenticated',
      });
      return payload as SupabaseClaims;
    }
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: issuer(),
      audience: 'authenticated',
    });
    return payload as SupabaseClaims;
  } catch {
    throw unauthorised('Your session has expired. Sign in again.');
  }
}

function bearerToken(request: HttpRequest): string {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorised();
  return token;
}

/**
 * Resolve the full session. The active organisation is:
 *   1. the one named by `x-tda-organisation`, but only if the caller is a member
 *      of it — the header selects between memberships, it never grants one;
 *   2. otherwise the caller's single membership;
 *   3. otherwise null, and the UI shows the organisation chooser.
 */
export async function resolveSession(request: HttpRequest): Promise<SessionContext> {
  const claims = await verifyToken(bearerToken(request));
  const db = getDatabase();

  const [user] = await db.select().from(s.users).where(eq(s.users.authUserId, claims.sub)).limit(1);

  // First sign-in after accepting an invitation: link the auth user to the
  // profile that was created when they were invited.
  const resolved = user ?? (claims.email ? await linkByEmail(claims) : undefined);
  if (!resolved) throw forbidden('This account has not been granted access to the platform');

  const rows = await db
    .select({
      membershipId: s.memberships.id,
      status: s.memberships.status,
      organisationId: s.organisations.id,
      reference: s.organisations.reference,
      name: s.organisations.name,
      code: s.organisations.code,
      orgStatus: s.organisations.status,
      logoUrl: s.organisations.logoUrl,
      timezone: s.organisations.timezone,
      role: s.membershipRoles.role,
    })
    .from(s.memberships)
    .innerJoin(s.organisations, eq(s.organisations.id, s.memberships.organisationId))
    .leftJoin(s.membershipRoles, eq(s.membershipRoles.membershipId, s.memberships.id))
    .where(and(eq(s.memberships.userId, resolved.id), eq(s.memberships.status, 'active')));

  const byOrg = new Map<string, { info: (typeof rows)[number]; roles: OrgRole[] }>();
  for (const row of rows) {
    const entry = byOrg.get(row.organisationId) ?? { info: row, roles: [] };
    if (row.role) entry.roles.push(row.role);
    byOrg.set(row.organisationId, entry);
  }

  const memberships = [...byOrg.values()].map((e) => ({
    organisationId: e.info.organisationId,
    name: e.info.name,
    code: e.info.code,
    roles: e.roles,
  }));

  const requested = request.headers.get('x-tda-organisation');
  const selected = requested
    ? byOrg.get(requested)
    : byOrg.size === 1
      ? [...byOrg.values()][0]
      : undefined;

  if (requested && !byOrg.has(requested)) {
    // Asking for an organisation you are not in is not a routing mistake.
    throw forbidden('You are not a member of that organisation');
  }

  if (selected && selected.info.orgStatus !== 'active') {
    throw forbidden(
      selected.info.orgStatus === 'suspended'
        ? 'This organisation is suspended. Contact your administrator.'
        : 'This organisation is no longer active.',
    );
  }

  const roles = selected?.roles ?? [];

  return {
    userId: resolved.id,
    email: resolved.email,
    name: resolved.name,
    isSuperAdmin: resolved.isSuperAdmin,
    organisation: selected
      ? {
          id: selected.info.organisationId,
          reference: selected.info.reference,
          name: selected.info.name,
          code: selected.info.code,
          status: selected.info.orgStatus,
          logoUrl: selected.info.logoUrl,
          timezone: selected.info.timezone,
        }
      : null,
    roles,
    permissions: [...permissionsFor(roles)],
    memberships,
  };
}

async function linkByEmail(claims: SupabaseClaims) {
  const db = getDatabase();
  const email = claims.email!.toLowerCase();
  const [existing] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  if (!existing) return undefined;
  const [linked] = await db
    .update(s.users)
    .set({
      authUserId: claims.sub,
      lastSignInAt: new Date(),
      name: existing.name || claims.user_metadata?.full_name || claims.user_metadata?.name || email,
    })
    .where(eq(s.users.id, existing.id))
    .returning();
  return linked;
}
