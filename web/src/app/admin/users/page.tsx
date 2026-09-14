'use client';

import { ORG_ROLES, ORG_ROLE_LABELS, type OrgRole } from '@tda/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { useSession } from '@/components/session-provider';
import {
  Button,
  Callout,
  CheckboxGroup,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/controls';
import { Reference, SignalCell, StatusLabel } from '@/components/ui/signals';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDate, humanise } from '@/lib/format';

interface OrgUser {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  status: 'invited' | 'active' | 'suspended' | 'deactivated';
  roles: OrgRole[];
  lastActiveAt: string | null;
  invitedAt: string | null;
}

export default function UsersPage() {
  return (
    <AppShell>
      <Users />
    </AppShell>
  );
}

function Users() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [inviting, setInviting] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['org-users'],
    queryFn: () => api.get<{ items: OrgUser[] }>('/users'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['org-users'] });
    void queryClient.invalidateQueries({ queryKey: ['reference-data'] });
  };

  const users = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can see this organisation's decisions, and what each of them may do."
        actions={
          <Button variant="primary" onClick={() => setInviting(true)}>
            <UserPlus className="h-4 w-4" />
            Invite someone
          </Button>
        }
      />

      <PageBody id="main">
        {inviting ? (
          <InviteForm
            onClose={() => setInviting(false)}
            onInvited={() => {
              setInviting(false);
              invalidate();
            }}
          />
        ) : null}

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : users.length === 0 ? (
          <EmptyState title="No users yet" description="Invite your first colleague to get started." />
        ) : (
          <div className="sheet overflow-x-auto">
            <table className="record-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Job title</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <SignalCell
                      tone={
                        user.status === 'active'
                          ? 'good'
                          : user.status === 'invited'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      <span className="font-medium text-ink">{user.name}</span>
                      {user.id === session?.userId ? (
                        <span className="ml-2 text-xs text-ink-muted">you</span>
                      ) : null}
                    </SignalCell>
                    <td className="text-ink-muted">{user.email}</td>
                    <td className="text-ink-muted">{user.jobTitle ?? '—'}</td>
                    <td>
                      <RoleEditor user={user} onChange={invalidate} />
                    </td>
                    <td>
                      <StatusCell user={user} isSelf={user.id === session?.userId} onChange={invalidate} />
                    </td>
                    <td className="text-ink-muted">
                      {user.status === 'invited'
                        ? `Invited ${formatDate(user.invitedAt)}`
                        : formatDate(user.lastActiveAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}

function InviteForm({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const toast = useToast();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [jobTitle, setJobTitle] = React.useState('');
  const [roles, setRoles] = React.useState<string[]>(['contributor']);
  const [problem, setProblem] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/users', { email, name, jobTitle: jobTitle || undefined, roles }),
    onSuccess: () => {
      toast.confirm('Invitation sent', `${name} will get an email with a link to set a password.`);
      onInvited();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'The invitation could not be sent.'),
  });

  return (
    <div className="sheet mb-6 p-6">
      <h2 className="font-serif text-lg font-semibold text-ink">Invite someone</h2>
      <p className="mt-1 text-sm text-ink-muted">
        They will get an email inviting them to set a password. Roles can be changed at any time.
      </p>

      {problem ? (
        <div className="mt-4">
          <Callout tone="alert">{problem}</Callout>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Full name" required htmlFor="invite-name">
          <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email address" required htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Job title" htmlFor="invite-title">
          <Input id="invite-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5">
        <Field label="Roles" required hint="Most people need Contributor. Roles add up.">
          <CheckboxGroup
            columns={3}
            value={roles}
            onChange={setRoles}
            options={ORG_ROLES.map((role) => ({
              value: role,
              label: ORG_ROLE_LABELS[role],
            }))}
          />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-rule pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={mutation.isPending}
          disabled={!email || !name || roles.length === 0}
          onClick={() => mutation.mutate()}
        >
          Send invitation
        </Button>
      </div>
    </div>
  );
}

function RoleEditor({ user, onChange }: { user: OrgUser; onChange: () => void }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [roles, setRoles] = React.useState<string[]>(user.roles);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, { roles }),
    onSuccess: () => {
      toast.confirm('Roles updated', `${user.name}'s access has changed.`);
      setOpen(false);
      onChange();
    },
    onError: (error) =>
      toast.problem(
        'Roles not changed',
        error instanceof ApiError ? error.message : 'Try again.',
      ),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-left text-sm text-ink hover:text-blueprint"
      >
        {user.roles.length === 0
          ? <span className="text-ink-faint">No roles</span>
          : user.roles.map((role) => ORG_ROLE_LABELS[role]).join(', ')}
      </button>
    );
  }

  return (
    <div className="min-w-[14rem] border border-rule bg-paper p-3">
      <CheckboxGroup
        columns={1}
        value={roles}
        onChange={setRoles}
        options={ORG_ROLES.map((role) => ({ value: role, label: ORG_ROLE_LABELS[role] }))}
      />
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRoles(user.roles);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function StatusCell({
  user,
  isSelf,
  onChange,
}: {
  user: OrgUser;
  isSelf: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (status: string) => api.patch(`/users/${user.id}`, { status }),
    onSuccess: () => {
      toast.confirm('Status updated');
      onChange();
    },
    onError: (error) =>
      toast.problem(
        'Status not changed',
        error instanceof ApiError ? error.message : 'Try again.',
      ),
  });

  // Locking yourself out is the one change nobody makes on purpose.
  if (isSelf) {
    return <StatusLabel tone="good">{humanise(user.status)}</StatusLabel>;
  }

  return (
    <Select
      aria-label={`Status of ${user.name}`}
      className="h-8 text-xs"
      value={user.status}
      disabled={mutation.isPending}
      onChange={(event) => mutation.mutate(event.target.value)}
    >
      <option value="active">Active</option>
      <option value="suspended">Suspended</option>
      <option value="deactivated">Deactivated</option>
      {user.status === 'invited' ? <option value="invited">Invited</option> : null}
    </Select>
  );
}
