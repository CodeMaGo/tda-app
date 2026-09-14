'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/controls';
import { Reference, SignalCell, StatusLabel } from '@/components/ui/signals';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Organisation {
  id: string;
  reference: string;
  name: string;
  code: string;
  status: 'provisioning' | 'active' | 'suspended' | 'archived';
  userCount: number;
  decisionCount: number;
  createdAt: string;
  lastActivityAt: string | null;
}

/**
 * The platform console (spec §8–10).
 *
 * A Super Admin manages organisations but holds no rights inside them — they can
 * see that an organisation exists and how busy it is, never its decisions. That
 * separation is enforced by the API; this screen simply has nowhere to click
 * through to.
 */
export default function PlatformPage() {
  return (
    <AppShell>
      <Platform />
    </AppShell>
  );
}

function Platform() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api.get<{ organisations: Organisation[]; totals: Record<string, number> }>(
      '/platform/overview',
    ),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
  const organisations = data?.organisations ?? [];

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Every tenant on the platform. You can create and suspend organisations, but not see inside them."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New organisation
          </Button>
        }
      />

      <PageBody id="main">
        {creating ? (
          <CreateOrganisation
            onClose={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              invalidate();
            }}
          />
        ) : null}

        {data ? (
          <dl className="mb-6 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
            <Figure label="Organisations" value={data.totals.organisations} />
            <Figure label="Active" value={data.totals.active} />
            <Figure label="Users" value={data.totals.users} />
            <Figure label="Decisions" value={data.totals.decisions} />
          </dl>
        ) : null}

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : organisations.length === 0 ? (
          <EmptyState
            title="No organisations yet"
            description="Create the first one and invite its admin."
            action={<Button variant="primary" onClick={() => setCreating(true)}>New organisation</Button>}
          />
        ) : (
          <div className="sheet overflow-x-auto">
            <table className="record-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Organisation</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Users</th>
                  <th scope="col" className="text-right">Decisions</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last active</th>
                </tr>
              </thead>
              <tbody>
                {organisations.map((organisation) => (
                  <tr key={organisation.id}>
                    <SignalCell tone={STATUS_TONE[organisation.status]}>
                      <Reference>{organisation.reference}</Reference>
                    </SignalCell>
                    <td>
                      <span className="font-medium text-ink">{organisation.name}</span>
                      <span className="ml-2 font-mono text-xs text-ink-muted">
                        {organisation.code}
                      </span>
                    </td>
                    <td>
                      <OrganisationStatus organisation={organisation} onChange={invalidate} />
                    </td>
                    <td className="text-right text-ink-muted">{organisation.userCount}</td>
                    <td className="text-right text-ink-muted">{organisation.decisionCount}</td>
                    <td className="text-ink-muted">{formatDate(organisation.createdAt)}</td>
                    <td className="text-ink-muted">{formatDate(organisation.lastActivityAt)}</td>
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

const STATUS_TONE = {
  provisioning: 'warn',
  active: 'good',
  suspended: 'alert',
  archived: 'neutral',
} as const;

function CreateOrganisation({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState({
    name: '',
    code: '',
    adminName: '',
    adminEmail: '',
  });
  const [problem, setProblem] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ reference: string }>('/platform/organisations', {
        name: form.name,
        code: form.code.toUpperCase(),
        adminName: form.adminName,
        adminEmail: form.adminEmail,
      }),
    onSuccess: (created) => {
      toast.confirm(
        `${created.reference} created`,
        `${form.adminName} has been invited as the organisation admin.`,
      );
      onCreated();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'The organisation could not be created.'),
  });

  return (
    <div className="sheet mb-6 p-6">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-blueprint" />
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">New organisation</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            The organisation is created with default decision types, criteria and risk categories.
            Its admin will be invited by email and completes setup themselves.
          </p>
        </div>
      </div>

      {problem ? (
        <div className="mt-4">
          <Callout tone="alert">{problem}</Callout>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Organisation name" required htmlFor="org-name">
          <Input
            id="org-name"
            value={form.name}
            autoFocus
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
        </Field>
        <Field
          label="Short code"
          required
          htmlFor="org-code"
          hint="Two to eight letters. Appears throughout the interface."
        >
          <Input
            id="org-code"
            value={form.code}
            maxLength={8}
            className="font-mono uppercase"
            onChange={(event) => setForm((f) => ({ ...f, code: event.target.value.toUpperCase() }))}
          />
        </Field>
        <Field label="Admin name" required htmlFor="admin-name">
          <Input
            id="admin-name"
            value={form.adminName}
            onChange={(event) => setForm((f) => ({ ...f, adminName: event.target.value }))}
          />
        </Field>
        <Field label="Admin email" required htmlFor="admin-email">
          <Input
            id="admin-email"
            type="email"
            value={form.adminEmail}
            onChange={(event) => setForm((f) => ({ ...f, adminEmail: event.target.value }))}
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
          disabled={!form.name || !form.code || !form.adminEmail || !form.adminName}
          onClick={() => mutation.mutate()}
        >
          Create and invite admin
        </Button>
      </div>
    </div>
  );
}

function OrganisationStatus({
  organisation,
  onChange,
}: {
  organisation: Organisation;
  onChange: () => void;
}) {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (status: string) =>
      api.post(`/platform/organisations/${organisation.id}/status`, { status }),
    onSuccess: (_result, status) => {
      toast.confirm(
        status === 'suspended'
          ? `${organisation.name} suspended`
          : `${organisation.name} is now ${status}`,
        status === 'suspended' ? 'Nobody there can sign in until it is reactivated.' : undefined,
      );
      onChange();
    },
    onError: (error) =>
      toast.problem('Status not changed', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (organisation.status === 'archived') {
    return <StatusLabel tone="neutral">Archived</StatusLabel>;
  }

  return (
    <Select
      aria-label={`Status of ${organisation.name}`}
      className="h-8 text-xs"
      value={organisation.status}
      disabled={mutation.isPending}
      onChange={(event) => mutation.mutate(event.target.value)}
    >
      <option value="provisioning">Provisioning</option>
      <option value="active">Active</option>
      <option value="suspended">Suspended</option>
      <option value="archived">Archived</option>
    </Select>
  );
}

function Figure({ label, value }: { label: string; value?: number }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dd className="font-serif text-2xl font-semibold leading-none text-ink">{value ?? 0}</dd>
      <dt className="mt-1.5 text-xs text-ink-muted">{label}</dt>
    </div>
  );
}
