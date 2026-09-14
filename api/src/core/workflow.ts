import { schema as s } from '@tda/db';
import {
  canTransition,
  DECISION_STATUS_LABELS,
  type AuditEventType,
  type DecisionStatus,
} from '@tda/shared';
import { and, count, eq } from 'drizzle-orm';
import { audit, bumpVersion } from './audit.js';
import type { RequestContext, Tx } from './context.js';
import { conflict, unprocessable } from './http.js';

type Decision = typeof s.decisions.$inferSelect;

/**
 * The lifecycle engine (spec §21).
 *
 * Two rules hold everywhere:
 *   - a transition that is not on the map does not happen;
 *   - a transition and its audit record are written together.
 */

export interface TransitionInput {
  decision: Decision;
  to: DecisionStatus;
  eventType: AuditEventType;
  /** Additional decision columns to write as part of the transition. */
  set?: Partial<typeof s.decisions.$inferInsert>;
  details?: Record<string, unknown>;
  /** Bump the version string — used for material content changes. */
  version?: 'minor' | 'major';
}

export async function transition(ctx: RequestContext, input: TransitionInput): Promise<Decision> {
  const { decision, to } = input;

  if (decision.status === to) {
    throw conflict(`This decision is already ${DECISION_STATUS_LABELS[to].toLowerCase()}`);
  }

  if (!canTransition(decision.status, to)) {
    throw conflict(
      `A decision that is ${DECISION_STATUS_LABELS[decision.status].toLowerCase()} cannot move to ${DECISION_STATUS_LABELS[to].toLowerCase()}`,
      { from: decision.status, to },
    );
  }

  const version = input.version
    ? bumpVersion(decision.version, input.version === 'major')
    : decision.version;

  const [updated] = await ctx.tx
    .update(s.decisions)
    .set({ status: to, version, ...input.set })
    .where(
      and(
        eq(s.decisions.id, decision.id),
        eq(s.decisions.organisationId, ctx.scope.organisationId),
        // Optimistic guard: if someone else moved it first, affect no rows.
        eq(s.decisions.status, decision.status),
      ),
    )
    .returning();

  if (!updated) {
    throw conflict('Someone else changed this decision. Reload and try again.');
  }

  await audit(ctx.tx, {
    organisationId: ctx.scope.organisationId,
    userId: ctx.session.userId,
    userName: ctx.session.name,
    eventType: input.eventType,
    objectType: 'decision',
    objectId: decision.id,
    objectReference: decision.reference,
    oldStatus: decision.status,
    newStatus: to,
    details: input.details,
    ipAddress: ctx.request.headers.get('x-forwarded-for'),
  });

  return updated;
}

/**
 * Checks a decision is complete enough to put in front of a TDA authority.
 * Proportional to significance (spec §3.3) — a routine decision is not held to
 * the same evidentiary standard as a critical one.
 */
export async function assertReadyForReview(tx: Tx, decision: Decision): Promise<void> {
  const problems: string[] = [];

  if (!decision.ownerId) problems.push('Assign a decision owner');
  if (!decision.problem?.trim()) problems.push('Describe the problem');

  if (decision.significance !== 'routine') {
    if (!decision.authorityId) problems.push('Nominate the TDA authority who will decide this');
    if (!decision.recommendation?.trim()) problems.push('Record a recommendation');

    const [{ value: alternativeCount } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(s.alternatives)
      .where(eq(s.alternatives.decisionId, decision.id));
    if (alternativeCount < 2) problems.push('Record at least two alternatives that were considered');
  }

  if (decision.significance === 'major' || decision.significance === 'critical') {
    const [{ value: riskCount } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(s.risks)
      .where(eq(s.risks.decisionId, decision.id));
    if (riskCount === 0) problems.push('Record the technical risks considered');

    const [{ value: evidenceCount } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(s.attachments)
      .where(eq(s.attachments.decisionId, decision.id));
    if (evidenceCount === 0) problems.push('Attach the supporting evidence');
  }

  if (problems.length > 0) {
    throw unprocessable('This decision is not ready for review yet', { problems });
  }
}

/**
 * Weighted scoring across criteria (spec §26). Returned as a decision aid — the
 * platform never converts a score into an outcome.
 */
export async function scoreAlternatives(
  tx: Tx,
  organisationId: string,
  decisionId: string,
): Promise<{ alternativeId: string; name: string; weightedScore: number; coverage: number }[]> {
  const [alts, criteria, rows] = await Promise.all([
    tx
      .select()
      .from(s.alternatives)
      .where(eq(s.alternatives.decisionId, decisionId))
      .orderBy(s.alternatives.position),
    tx
      .select()
      .from(s.decisionCriteria)
      .where(
        and(
          eq(s.decisionCriteria.organisationId, organisationId),
          eq(s.decisionCriteria.isActive, true),
        ),
      ),
    tx.select().from(s.assessments).where(eq(s.assessments.decisionId, decisionId)),
  ]);

  const weights = new Map(criteria.map((c) => [c.id, c.weight]));
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0) || 1;

  return alts.map((alt) => {
    const scored = rows.filter((r) => r.alternativeId === alt.id);
    const weighted = scored.reduce(
      (sum, r) => sum + Number(r.score) * (weights.get(r.criterionId) ?? 0),
      0,
    );
    return {
      alternativeId: alt.id,
      name: alt.name,
      weightedScore: Math.round((weighted / totalWeight) * 100) / 100,
      coverage: criteria.length === 0 ? 0 : scored.length / criteria.length,
    };
  });
}
