import type { OrgRole } from './domain.js';

/**
 * Capability model.
 *
 * The API is the enforcement point — the UI imports the same helpers only so
 * that it can hide controls the user cannot use. Never trust a UI check.
 */
export const PERMISSIONS = [
  // Organisation administration
  'org:read',
  'org:update',
  'org:manage_users',
  'org:manage_teams',
  'org:manage_projects',
  'org:manage_technologies',
  'org:manage_config',
  'org:manage_authorities',
  // Decisions
  'decision:read',
  'decision:create',
  'decision:update',
  'decision:submit',
  'decision:comment',
  'decision:upload_evidence',
  'decision:review',
  'decision:decide',
  'decision:supersede',
  'decision:withdraw',
  // Actions
  'action:read',
  'action:create',
  'action:update_own',
  'action:update_any',
  // Reporting
  'report:generate',
  'report:export',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ['org:read', 'decision:read', 'action:read', 'report:generate'];

const REVIEWER: Permission[] = [...VIEWER, 'decision:comment', 'decision:review'];

const CONTRIBUTOR: Permission[] = [
  ...VIEWER,
  'decision:create',
  'decision:update',
  'decision:comment',
  'decision:upload_evidence',
  'action:update_own',
  'report:export',
];

const DECISION_OWNER: Permission[] = [
  ...CONTRIBUTOR,
  'decision:submit',
  'decision:withdraw',
  'action:create',
];

const TDA_AUTHORITY: Permission[] = [
  ...DECISION_OWNER,
  'decision:review',
  'decision:decide',
  'decision:supersede',
  'action:update_any',
];

const ORG_ADMIN: Permission[] = [
  ...DECISION_OWNER,
  'org:update',
  'org:manage_users',
  'org:manage_teams',
  'org:manage_projects',
  'org:manage_technologies',
  'org:manage_config',
  'org:manage_authorities',
  'action:update_any',
  'decision:supersede',
];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  viewer: VIEWER,
  reviewer: REVIEWER,
  contributor: CONTRIBUTOR,
  decision_owner: DECISION_OWNER,
  tda_authority: TDA_AUTHORITY,
  org_admin: ORG_ADMIN,
};

/** Resolve the union of permissions granted by a set of roles. */
export function permissionsFor(roles: readonly OrgRole[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

export function hasPermission(roles: readonly OrgRole[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/**
 * Spec §65.15 — platform privileges do not confer decision authority.
 * A Super Admin gets no org permissions here; they must hold an explicit
 * membership in an organisation to act inside it.
 */
export const SUPER_ADMIN_PLATFORM_PERMISSIONS = [
  'platform:read',
  'platform:create_organisation',
  'platform:suspend_organisation',
  'platform:archive_organisation',
  'platform:invite_org_admin',
  'platform:manage_config',
] as const;

export type PlatformPermission = (typeof SUPER_ADMIN_PLATFORM_PERMISSIONS)[number];
