import { schema as s } from '@tda/db';
import {
  formatActionReference,
  formatDecisionReference,
  type AuditEventType,
} from '@tda/shared';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './context.js';

/**
 * Writes an audit record (spec §43). Call this inside the same transaction as
 * the change it describes — the database refuses updates and deletes on this
 * table, so a record written here is permanent.
 */
export async function audit(
  tx: Tx,
  input: {
    organisationId: string | null;
    userId: string | null;
    userName?: string | null;
    eventType: AuditEventType;
    objectType: string;
    objectId?: string | null;
    objectReference?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  },
): Promise<void> {
  await tx.insert(s.auditEvents).values({
    organisationId: input.organisationId,
    userId: input.userId,
    userName: input.userName ?? null,
    eventType: input.eventType,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    objectReference: input.objectReference ?? null,
    oldStatus: input.oldStatus ?? null,
    newStatus: input.newStatus ?? null,
    details: input.details ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}

/**
 * Allocates the next decision reference for an organisation.
 *
 * The counter is held on the organisation row and bumped with `returning`, so
 * concurrent submissions take a row lock and cannot be issued the same number.
 * The sequence restarts each calendar year: TDA-2026-0001.
 */
export async function nextDecisionReference(
  tx: Tx,
  organisationId: string,
): Promise<{ reference: string; year: number; sequence: number }> {
  const year = new Date().getUTCFullYear();
  const [org] = await tx
    .update(s.organisations)
    .set({
      decisionSequenceYear: year,
      decisionSequence: sql`case when ${s.organisations.decisionSequenceYear} = ${year}
                                 then ${s.organisations.decisionSequence} + 1
                                 else 1 end`,
    })
    .where(eq(s.organisations.id, organisationId))
    .returning({ sequence: s.organisations.decisionSequence });

  const sequence = org!.sequence;
  return { reference: formatDecisionReference(year, sequence), year, sequence };
}

export async function nextActionReference(
  tx: Tx,
  organisationId: string,
): Promise<{ reference: string; sequence: number }> {
  const [org] = await tx
    .update(s.organisations)
    .set({ actionSequence: sql`${s.organisations.actionSequence} + 1` })
    .where(eq(s.organisations.id, organisationId))
    .returning({ sequence: s.organisations.actionSequence });

  const sequence = org!.sequence;
  return { reference: formatActionReference(sequence), sequence };
}

/** Bump a decision's version string, e.g. 1.2 -> 1.3, or 1.9 -> 2.0 on a major change. */
export function bumpVersion(current: string, major = false): string {
  const [rawMajor = '1', rawMinor = '0'] = current.split('.');
  const majorPart = Number(rawMajor) || 1;
  const minorPart = Number(rawMinor) || 0;
  return major ? `${majorPart + 1}.0` : `${majorPart}.${minorPart + 1}`;
}
