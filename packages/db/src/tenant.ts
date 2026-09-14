import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/** Any table carrying an organisation_id column. */
type TenantTable = PgTable & { organisationId: PgColumn };

/**
 * Tenant isolation (spec §7).
 *
 * Every organisation-scoped query goes through a scope object created from the
 * *authenticated session*, never from a client parameter. The helpers below
 * make it awkward to write a query that forgets the organisation filter, and
 * `assertOwned` catches the case where a row was fetched by primary key alone.
 *
 * This is the application-layer guard. Row Level Security in sql/rls.sql is the
 * second, independent layer — neither one is trusted on its own.
 */
export interface TenantScope {
  readonly organisationId: string;
  readonly userId: string;

  /** `WHERE organisation_id = $org AND ...extra` */
  where(table: TenantTable, ...extra: (SQL | undefined)[]): SQL;

  /** Merge the organisation id into an insert payload. */
  own<T extends Record<string, unknown>>(values: T): T & { organisationId: string };
  ownAll<T extends Record<string, unknown>>(values: T[]): (T & { organisationId: string })[];

  /** Throw unless the row belongs to this organisation. */
  assertOwned<T extends { organisationId: string } | undefined | null>(
    row: T,
    what?: string,
  ): NonNullable<T>;
}

export class CrossTenantAccessError extends Error {
  readonly code = 'CROSS_TENANT_ACCESS';
  constructor(what: string) {
    super(`${what} does not belong to this organisation`);
    this.name = 'CrossTenantAccessError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(what: string) {
    super(`${what} was not found`);
    this.name = 'NotFoundError';
  }
}

export function tenantScope(organisationId: string, userId: string): TenantScope {
  return {
    organisationId,
    userId,

    where(table, ...extra) {
      const clauses = [eq(table.organisationId, organisationId), ...extra].filter(
        (c): c is SQL => c !== undefined,
      );
      return and(...clauses) as SQL;
    },

    own(values) {
      return { ...values, organisationId };
    },

    ownAll(values) {
      return values.map((v) => ({ ...v, organisationId }));
    },

    assertOwned(row, what = 'Record') {
      if (row === null || row === undefined) throw new NotFoundError(what);
      if (row.organisationId !== organisationId) {
        // Reported as "not found" to the caller so that IDs cannot be probed.
        throw new CrossTenantAccessError(what);
      }
      return row as NonNullable<typeof row>;
    },
  };
}
