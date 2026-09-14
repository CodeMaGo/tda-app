'use client';

import {
  AUTHORITY_SCOPES,
  DECISION_SIGNIFICANCES,
  SIGNIFICANCE_LABELS,
} from '@tda/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
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
  Textarea,
} from '@/components/ui/controls';
import { Reference, StatusLabel } from '@/components/ui/signals';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { humanise } from '@/lib/format';
import { useReferenceData } from '@/lib/reference-data';

type Tab = 'types' | 'criteria' | 'authorities';

export default function GovernancePage() {
  return (
    <AppShell>
      <Governance />
    </AppShell>
  );
}

function Governance() {
  const [tab, setTab] = React.useState<Tab>('criteria');

  return (
    <>
      <PageHeader
        title="Governance"
        description="How decisions are classified, how alternatives are scored, and who may decide what."
      />

      <PageBody id="main">
        <nav className="mb-6 flex border-b border-rule" aria-label="Governance settings">
          {(['criteria', 'types', 'authorities'] as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={
                tab === key
                  ? '-mb-px border-b-2 border-blueprint px-4 py-2 text-sm font-medium text-ink'
                  : '-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-ink-muted hover:text-ink'
              }
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </nav>

        {tab === 'criteria' ? <CriteriaEditor /> : null}
        {tab === 'types' ? <DecisionTypes /> : null}
        {tab === 'authorities' ? <Authorities /> : null}
      </PageBody>
    </>
  );
}

const TAB_LABELS: Record<Tab, string> = {
  criteria: 'Evaluation criteria',
  types: 'Decision types',
  authorities: 'Authority matrix',
};

/**
 * Criteria are saved as a set, not one at a time, because the weights have to
 * total 100%. Editing them individually would mean passing through states the
 * rules forbid.
 */
function CriteriaEditor() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reference = useReferenceData();

  const [rows, setRows] = React.useState<{ name: string; weight: number; description: string }[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (reference.data && !loaded) {
      setRows(
        reference.data.criteria.map((criterion) => ({
          name: criterion.name,
          weight: Number(criterion.weight),
          description: criterion.description ?? '',
        })),
      );
      setLoaded(true);
    }
  }, [reference.data, loaded]);

  const total = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const balanced = Math.abs(total - 100) < 0.01;

  const mutation = useMutation({
    mutationFn: () =>
      api.put('/config/decision-criteria', {
        criteria: rows.map((row, index) => ({
          name: row.name,
          weight: Number(row.weight),
          description: row.description || undefined,
          position: index,
        })),
      }),
    onSuccess: () => {
      toast.confirm('Criteria saved', 'New assessments will use these weights.');
      void queryClient.invalidateQueries({ queryKey: ['reference-data'] });
    },
    onError: (error) =>
      toast.problem('Not saved', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (reference.isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="max-w-3xl">
      <p className="mb-5 max-w-prose text-sm text-ink-muted">
        These criteria are used to score alternatives. Weights must total 100%, so that a weighted
        score means the same thing on every decision.
      </p>

      <div className="sheet divide-y divide-rule">
        {rows.map((row, index) => (
          <div key={index} className="grid gap-3 p-4 sm:grid-cols-[1fr_7rem_auto]">
            <div className="space-y-2">
              <Input
                value={row.name}
                aria-label={`Criterion ${index + 1} name`}
                placeholder="Security"
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)),
                  )
                }
              />
              <Textarea
                rows={2}
                value={row.description}
                aria-label={`Criterion ${index + 1} description`}
                placeholder="What assessors should consider when scoring this."
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index ? { ...r, description: event.target.value } : r,
                    ),
                  )
                }
              />
            </div>
            <div>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={row.weight}
                  aria-label={`Criterion ${index + 1} weight`}
                  className="pr-7"
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((r, i) =>
                        i === index ? { ...r, weight: Number(event.target.value) } : r,
                      ),
                    )
                  }
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                  %
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${row.name || `criterion ${index + 1}`}`}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows((current) => [...current, { name: '', weight: 0, description: '' }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add a criterion
        </Button>
        <p className={`text-sm font-medium ${balanced ? 'text-good' : 'text-alert'}`}>
          Total {total}%{balanced ? '' : ` — ${total > 100 ? 'over' : 'under'} by ${Math.abs(100 - total)}`}
        </p>
      </div>

      {!balanced ? (
        <div className="mt-4">
          <Callout tone="warn">
            Weights must add up to exactly 100% before they can be saved.
          </Callout>
        </div>
      ) : null}

      <Button
        className="mt-5"
        variant="primary"
        disabled={!balanced || rows.some((row) => !row.name.trim())}
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Save criteria
      </Button>
    </div>
  );
}

function DecisionTypes() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reference = useReferenceData();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  const create = useMutation({
    mutationFn: () => api.post('/config/decision-types', { name, description: description || undefined }),
    onSuccess: () => {
      toast.confirm('Decision type added');
      setName('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['reference-data'] });
    },
    onError: (error) =>
      toast.problem('Not added', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (reference.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="max-w-3xl">
      <p className="mb-5 max-w-prose text-sm text-ink-muted">
        Decision types classify what kind of question is being asked. They drive reporting and can be
        used to scope an authority.
      </p>

      <ul className="sheet divide-y divide-rule">
        {(reference.data?.types ?? []).map((type) => (
          <li key={type.id} className="px-4 py-3">
            <p className="text-sm font-medium text-ink">{type.name}</p>
            {type.description ? (
              <p className="mt-0.5 text-sm text-ink-muted">{type.description}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="sheet mt-5 space-y-4 p-5">
        <h3 className="font-serif text-base font-semibold">Add a decision type</h3>
        <Field label="Name" required htmlFor="type-name">
          <Input
            id="type-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Architecture Pattern"
          />
        </Field>
        <Field label="Description" htmlFor="type-description">
          <Textarea
            id="type-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={!name.trim()}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Add type
        </Button>
      </div>
    </div>
  );
}

/**
 * The authority matrix (spec §46–47). An authority is a scope plus a ceiling:
 * it says what someone may decide, and how significant a decision they may
 * decide on. The API enforces the same rules at the point of decision.
 */
function Authorities() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reference = useReferenceData();
  const [adding, setAdding] = React.useState(false);

  const [form, setForm] = React.useState({
    userId: '',
    title: '',
    scope: 'organisation',
    maxSignificance: 'major',
    projectIds: [] as string[],
    domains: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/config/authorities', {
        userId: form.userId,
        title: form.title || undefined,
        scope: form.scope,
        maxSignificance: form.maxSignificance,
        projectIds: form.scope === 'project' ? form.projectIds : [],
        domains: form.scope === 'domain' ? form.domains.split(',').map((d) => d.trim()).filter(Boolean) : [],
        decisionTypeIds: [],
      }),
    onSuccess: () => {
      toast.confirm('Authority granted', 'They can now decide within that scope.');
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ['reference-data'] });
    },
    onError: (error) =>
      toast.problem('Not granted', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (reference.isLoading) return <Skeleton className="h-64 w-full" />;

  const authorities = reference.data?.authorities ?? [];

  return (
    <div className="max-w-3xl">
      <p className="mb-5 max-w-prose text-sm text-ink-muted">
        Each authority names a person, the scope they cover, and the highest significance of
        decision they may make. A decision above someone's ceiling must be escalated.
      </p>

      {authorities.length === 0 ? (
        <EmptyState
          title="No authorities defined"
          description="Until someone holds authority, no decision can be formally made."
          action={<Button variant="primary" onClick={() => setAdding(true)}>Grant authority</Button>}
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table className="record-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Title</th>
                <th scope="col">Scope</th>
                <th scope="col">Up to</th>
              </tr>
            </thead>
            <tbody>
              {authorities.map((authority) => (
                <tr key={authority.id}>
                  <td className="font-medium text-ink">{authority.name}</td>
                  <td className="text-ink-muted">{authority.title ?? '—'}</td>
                  <td>
                    <StatusLabel tone="open">{humanise(authority.scope)}</StatusLabel>
                    {authority.domains && authority.domains.length > 0 ? (
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {authority.domains.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ink-muted">
                    {SIGNIFICANCE_LABELS[
                      authority.maxSignificance as keyof typeof SIGNIFICANCE_LABELS
                    ] ?? authority.maxSignificance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!adding && authorities.length > 0 ? (
        <Button className="mt-4" variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Grant authority
        </Button>
      ) : null}

      {adding ? (
        <div className="sheet mt-5 space-y-5 p-5">
          <h3 className="font-serif text-base font-semibold">Grant authority</h3>

          <Field label="Person" required htmlFor="authority-user">
            <Select
              id="authority-user"
              value={form.userId}
              onChange={(event) => setForm((f) => ({ ...f, userId: event.target.value }))}
            >
              <option value="">Choose someone</option>
              {(reference.data?.people ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Title" htmlFor="authority-title" hint="How this role is described internally.">
            <Input
              id="authority-title"
              value={form.title}
              placeholder="Chief Architect"
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Scope" required htmlFor="authority-scope">
              <Select
                id="authority-scope"
                value={form.scope}
                onChange={(event) => setForm((f) => ({ ...f, scope: event.target.value }))}
              >
                {AUTHORITY_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {humanise(scope)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Highest significance"
              required
              htmlFor="authority-significance"
              hint="Anything above this must be escalated."
            >
              <Select
                id="authority-significance"
                value={form.maxSignificance}
                onChange={(event) => setForm((f) => ({ ...f, maxSignificance: event.target.value }))}
              >
                {DECISION_SIGNIFICANCES.map((level) => (
                  <option key={level} value={level}>
                    {SIGNIFICANCE_LABELS[level]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {form.scope === 'domain' ? (
            <Field
              label="Domains"
              htmlFor="authority-domains"
              hint="Comma separated, for example: security, data, networking."
            >
              <Input
                id="authority-domains"
                value={form.domains}
                onChange={(event) => setForm((f) => ({ ...f, domains: event.target.value }))}
              />
            </Field>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-rule pt-4">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!form.userId}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              Grant authority
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
