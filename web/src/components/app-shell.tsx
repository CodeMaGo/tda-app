'use client';

import type { Permission } from '@tda/shared';
import {
  Building2,
  CheckSquare,
  FileText,
  GitBranch,
  LayoutGrid,
  LogOut,
  Search,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Button, Skeleton } from '@/components/ui/controls';
import { useRequireSession } from '@/components/session-provider';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  platformOnly?: boolean;
}

const PRIMARY: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/decisions', label: 'Decisions', icon: GitBranch },
  { href: '/actions', label: 'Actions', icon: CheckSquare },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/report', label: 'TDA report', icon: FileText },
];

const ADMIN: NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: Users, permission: 'org:manage_users' },
  { href: '/admin/organisation', label: 'Organisation', icon: Building2, permission: 'org:manage_config' },
  { href: '/admin/governance', label: 'Governance', icon: Shield, permission: 'org:manage_config' },
  { href: '/admin/audit', label: 'Audit trail', icon: Settings, permission: 'org:read' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, can, signOut } = useRequireSession();
  const pathname = usePathname();

  if (loading) return <ShellSkeleton />;
  if (!session) return null;

  // Signed in, but not yet attached to an organisation.
  if (!session.organisation && !session.isSuperAdmin) {
    return <NoOrganisation />;
  }

  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <nav
        className="no-print flex flex-col border-b border-rule bg-paper lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r"
        aria-label="Main"
      >
        <div className="border-b border-rule px-5 py-4">
          <p className="font-serif text-lg font-semibold leading-tight text-ink">
            Technical Decision Authority
          </p>
          {session.organisation ? (
            <OrganisationBadge
              name={session.organisation.name}
              code={session.organisation.code}
            />
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroup items={visible(PRIMARY)} pathname={pathname} />

          {visible(ADMIN).length > 0 ? (
            <>
              <p className="mb-1.5 mt-6 px-2 text-xs font-semibold text-ink-faint">
                Administration
              </p>
              <NavGroup items={visible(ADMIN)} pathname={pathname} />
            </>
          ) : null}

          {session.isSuperAdmin ? (
            <>
              <p className="mb-1.5 mt-6 px-2 text-xs font-semibold text-ink-faint">Platform</p>
              <NavGroup
                items={[{ href: '/platform', label: 'Organisations', icon: Building2 }]}
                pathname={pathname}
              />
            </>
          ) : null}
        </div>

        <div className="border-t border-rule px-3 py-3">
          {session.memberships.length > 1 ? <OrganisationSwitcher /> : null}
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{session.name}</p>
              <p className="truncate text-xs text-ink-muted">{roleSummary(session.roles)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      <main className="min-w-0 bg-wash">{children}</main>
    </div>
  );
}

function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-blueprint-wash font-medium text-blueprint-dark'
                  : 'text-ink-muted hover:bg-wash hover:text-ink',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function OrganisationBadge({ name, code }: { name: string; code: string }) {
  return (
    <p className="mt-2 flex items-baseline gap-1.5 text-xs">
      <span className="font-mono font-medium text-blueprint">{code}</span>
      <span className="truncate text-ink-muted">{name}</span>
    </p>
  );
}

function OrganisationSwitcher() {
  const { session, switchOrganisation } = useRequireSession();
  if (!session) return null;

  return (
    <div className="mb-2 px-2">
      <label htmlFor="org-switcher" className="mb-1 block text-xs text-ink-muted">
        Organisation
      </label>
      <select
        id="org-switcher"
        value={session.organisation?.id ?? ''}
        onChange={(event) => switchOrganisation(event.target.value)}
        className="w-full rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm"
      >
        {session.memberships.map((membership) => (
          <option key={membership.organisationId} value={membership.organisationId}>
            {membership.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function roleSummary(roles: string[]): string {
  if (roles.length === 0) return 'No roles assigned';
  const labels: Record<string, string> = {
    org_admin: 'Admin',
    tda_authority: 'TDA authority',
    decision_owner: 'Decision owner',
    contributor: 'Contributor',
    reviewer: 'Reviewer',
    viewer: 'Viewer',
  };
  return roles.map((role) => labels[role] ?? role).join(', ');
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <div className="border-r border-rule bg-paper p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    </div>
  );
}

function NoOrganisation() {
  const { signOut } = useRequireSession();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="sheet max-w-md p-8">
        <h1 className="font-serif text-xl font-semibold">No organisation yet</h1>
        <p className="mt-3 text-sm text-ink-muted">
          Your account is active but it is not attached to an organisation. An organisation admin
          needs to add you before you can see any decisions.
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Page header used by every screen inside the shell. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-rule bg-paper px-6 py-5 lg:px-8">
      <div className="mx-auto flex max-w-sheet flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold leading-tight text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>
          ) : null}
          {children}
        </div>
        {actions ? <div className="no-print flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PageBody({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Usually "main" — the skip link target for this page. */
  id?: string;
}) {
  return (
    <div id={id} className={cn('mx-auto max-w-sheet px-6 py-6 lg:px-8 lg:py-8', className)}>
      {children}
    </div>
  );
}
