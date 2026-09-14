import { schema as s } from '@tda/db';
import { DECISION_SIGNIFICANCES, type DecisionSignificance } from '@tda/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from './context.js';
import { forbidden } from './http.js';

/**
 * Spec §46–47. Holding the `tda_authority` role means a person *may* decide
 * something; it does not mean they may decide *this*. Scope, significance,
 * project and decision type are all checked here, server-side, immediately
 * before an outcome is written.
 */

export interface AuthorityCheck {
  allowed: boolean;
  reason?: string;
  matchedAuthorityId?: string;
}

export async function checkAuthority(
  tx: Tx,
  input: {
    organisationId: string;
    userId: string;
    decision: {
      id: string;
      significance: DecisionSignificance;
      projectId: string | null;
      decisionTypeId: string | null;
    };
  },
): Promise<AuthorityCheck> {
  const { organisationId, userId, decision } = input;

  const authorities = await tx
    .select()
    .from(s.tdaAuthorities)
    .where(
      and(
        eq(s.tdaAuthorities.organisationId, organisationId),
        eq(s.tdaAuthorities.userId, userId),
        eq(s.tdaAuthorities.isActive, true),
      ),
    );

  if (authorities.length === 0) {
    return { allowed: false, reason: 'You are not registered as a TDA authority' };
  }

  // Does the decision type demand organisation-level authority?
  let requiresOrgAuthority = false;
  let typeName: string | null = null;
  if (decision.decisionTypeId) {
    const [type] = await tx
      .select({
        requires: s.decisionTypes.requiresOrganisationAuthority,
        name: s.decisionTypes.name,
      })
      .from(s.decisionTypes)
      .where(eq(s.decisionTypes.id, decision.decisionTypeId));
    requiresOrgAuthority = type?.requires ?? false;
    typeName = type?.name ?? null;
  }

  const authorityIds = authorities.map((a) => a.id);
  const [projectLinks, typeLinks] = await Promise.all([
    tx
      .select()
      .from(s.authorityProjects)
      .where(inArray(s.authorityProjects.authorityId, authorityIds)),
    tx
      .select()
      .from(s.authorityDecisionTypes)
      .where(inArray(s.authorityDecisionTypes.authorityId, authorityIds)),
  ]);

  const significanceRank = (value: DecisionSignificance) => DECISION_SIGNIFICANCES.indexOf(value);
  const failures: string[] = [];

  for (const authority of authorities) {
    if (requiresOrgAuthority && authority.scope !== 'organisation') {
      failures.push(
        `${typeName ?? 'This type of'} decisions require an organisation-wide TDA authority`,
      );
      continue;
    }

    if (significanceRank(decision.significance) > significanceRank(authority.maxSignificance)) {
      failures.push(
        `Your authority covers decisions up to ${authority.maxSignificance} significance`,
      );
      continue;
    }

    // A type restriction, when present, is a whitelist.
    const boundTypes = typeLinks.filter((l) => l.authorityId === authority.id);
    if (boundTypes.length > 0) {
      if (!decision.decisionTypeId || !boundTypes.some((l) => l.decisionTypeId === decision.decisionTypeId)) {
        failures.push('Your authority does not cover this decision type');
        continue;
      }
    }

    if (authority.scope === 'project') {
      const boundProjects = projectLinks.filter((l) => l.authorityId === authority.id);
      if (!decision.projectId || !boundProjects.some((l) => l.projectId === decision.projectId)) {
        failures.push('Your authority is limited to specific projects');
        continue;
      }
    }

    if (authority.scope === 'domain') {
      const domains = authority.domains.map((d) => d.toLowerCase());
      const matchesDomain = typeName ? domains.includes(typeName.toLowerCase()) : false;
      if (!matchesDomain) {
        failures.push(
          `Your authority covers ${authority.domains.join(', ') || 'a specific domain'}`,
        );
        continue;
      }
    }

    return { allowed: true, matchedAuthorityId: authority.id };
  }

  return { allowed: false, reason: failures[0] ?? 'This decision is outside your authority' };
}

export async function assertAuthority(
  tx: Tx,
  input: Parameters<typeof checkAuthority>[1],
): Promise<string> {
  const result = await checkAuthority(tx, input);
  if (!result.allowed) throw forbidden(result.reason!);
  return result.matchedAuthorityId!;
}
