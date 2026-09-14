'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import {
  Button,
  Callout,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/controls';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useReferenceData } from '@/lib/reference-data';

interface Organisation {
  id: string;
  reference: string;
  name: string;
  code: string;
  status: string;
  logoUrl: string | null;
  settings: {
    industry?: string;
    timezone?: string;
    decisionPrefix?: string;
    requireAlternativesFrom?: string;
    onboardingCompletedSteps?: string[];
  } | null;
}

type Tab = 'details' | 'setup' | 'structure';

export default function OrganisationPage() {
  return (
    <AppShell>
      <OrganisationSettings />
    </AppShell>
  );
}

function OrganisationSettings() {
  const [tab, setTab] = React.useState<Tab>('setup');

  return (
    <>
      <PageHeader
        title="Organisation"
        description="Your organisation's details, structure and setup progress."
      />

      <PageBody id="main">
        <nav className="mb-6 flex border-b border-rule" aria-label="Organisation settings">
          {(['setup', 'details', 'structure'] as Tab[]).map((key) => (
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
              {{ setup: 'Setup', details: 'Details', structure: 'Teams and projects' }[key]}
            </button>
          ))}
        </nav>

        {tab === 'setup' ? <SetupProgress /> : null}
        {tab === 'details' ? <Details /> : null}
        {tab === 'structure' ? <Structure /> : null}
      </PageBody>
    </>
  );
}

/**
 * Setup progress (spec §11).
 *
 * The ten steps are shown as a checklist rather than a forced wizard: an admin
 * can use the platform immediately and come back to finish. Each step is marked
 * done by what actually exists in the database, not by a flag someone clicked.
 */
function SetupProgress() {
  const reference = useReferenceData();
  const { data, isLoading } = useQuery({
    queryKey: ['organisation'],
    queryFn: () => api.get<Organisation>('/organisation'),
  });

  if (isLoading || reference.isLoading) return <Skeleton className="h-96 w-full" />;

  const ref = reference.data;
  const criteriaTotal = (ref?.criteria ?? []).reduce((sum, c) => sum + Number(c.weight), 0);

  const steps = [
    {
      title: 'Organisation details',
      description: 'Name, code and time zone.',
      done: Boolean(data?.name && data?.code),
      href: '#',
      onTab: 'details' as const,
    },
    {
      title: 'Invite your people',
      description: 'At least one other person needs access.',
      done: (ref?.people.length ?? 0) > 1,
      href: '/admin/users',
    },
    {
      title: 'Create teams',
      description: 'Teams let you record who a decision affects.',
      done: (ref?.teams.length ?? 0) > 0,
      href: '#',
      onTab: 'structure' as const,
    },
    {
      title: 'Add projects',
      description: 'Decisions can be scoped to a project.',
      done: (ref?.projects.length ?? 0) > 0,
      href: '#',
      onTab: 'structure' as const,
    },
    {
      title: 'Build the technology catalogue',
      description: 'What you already run, so decisions can point at it.',
      done: (ref?.technologies.length ?? 0) > 0,
      href: '#',
      onTab: 'structure' as const,
    },
    {
      title: 'Confirm decision types',
      description: 'Ten sensible defaults are already in place.',
      done: (ref?.types.length ?? 0) > 0,
      href: '/admin/governance',
    },
    {
      title: 'Set evaluation criteria',
      description: 'Weights must total 100%.',
      done: Math.abs(criteriaTotal - 100) < 0.01 && (ref?.criteria.length ?? 0) > 0,
      href: '/admin/governance',
    },
    {
      title: 'Define risk categories',
      description: 'How technical risks are grouped in reporting.',
      done: (ref?.riskCategories.length ?? 0) > 0,
      href: '/admin/governance',
    },
    {
      title: 'Appoint TDA authorities',
      description: 'Nobody can make a decision until someone holds authority.',
      done: (ref?.authorities.length ?? 0) > 0,
      href: '/admin/governance',
    },
    {
      title: 'Raise your first decision',
      description: 'The best way to see whether the setup fits.',
      done: false,
      href: '/decisions/new',
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-ink">
            {completed} of {steps.length} steps complete
          </p>
          <p className="text-sm text-ink-muted">
            {completed === steps.length ? 'All set' : 'You can use the platform while you finish'}
          </p>
        </div>
        <div className="mt-2 h-1.5 bg-rule">
          <div
            className="h-1.5 bg-blueprint transition-all"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <ol className="sheet divide-y divide-rule">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-4 px-5 py-4">
            <span
              className={
                step.done
                  ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good text-white'
                  : 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rule text-xs text-ink-muted'
              }
              aria-hidden
            >
              {step.done ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{step.description}</p>
            </div>
            {!step.done && step.href !== '#' ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={step.href}>Set up</Link>
              </Button>
            ) : null}
            <span className="sr-only">{step.done ? 'Complete' : 'Not yet done'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Details() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['organisation'],
    queryFn: () => api.get<Organisation>('/organisation'),
  });

  const [form, setForm] = React.useState({ name: '', industry: '', timezone: 'Europe/London' });
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (data && !loaded) {
      setForm({
        name: data.name,
        industry: data.settings?.industry ?? '',
        timezone: data.settings?.timezone ?? 'Europe/London',
      });
      setLoaded(true);
    }
  }, [data, loaded]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch('/organisation', {
        name: form.name,
        settings: { industry: form.industry, timezone: form.timezone },
      }),
    onSuccess: () => {
      toast.confirm('Details saved');
      void queryClient.invalidateQueries({ queryKey: ['organisation'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) =>
      toast.problem('Not saved', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="sheet max-w-xl space-y-5 p-6">
      <Field label="Organisation name" required htmlFor="org-name">
        <Input
          id="org-name"
          value={form.name}
          onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        />
      </Field>

      <Field
        label="Short code"
        htmlFor="org-code"
        hint="Set when the organisation was created and cannot be changed, because it appears in references."
      >
        <Input id="org-code" value={data?.code ?? ''} disabled className="font-mono" />
      </Field>

      <Field label="Industry" htmlFor="org-industry">
        <Input
          id="org-industry"
          value={form.industry}
          onChange={(event) => setForm((f) => ({ ...f, industry: event.target.value }))}
        />
      </Field>

      <Field label="Time zone" htmlFor="org-timezone" hint="Used for due dates and reporting periods.">
        <Select
          id="org-timezone"
          value={form.timezone}
          onChange={(event) => setForm((f) => ({ ...f, timezone: event.target.value }))}
        >
          {['Europe/London', 'Europe/Dublin', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney', 'UTC'].map(
            (zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ),
          )}
        </Select>
      </Field>

      <div className="border-t border-rule pt-4">
        <p className="mb-3 text-sm text-ink-muted">
          Reference <span className="font-mono text-ink">{data?.reference}</span>
        </p>
        <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save details
        </Button>
      </div>
    </div>
  );
}

function Structure() {
  const reference = useReferenceData();
  if (reference.isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-2">
      <SimpleCreator
        title="Teams"
        description="Teams record who a decision affects and who is implementing it."
        endpoint="/teams"
        items={(reference.data?.teams ?? []).map((team) => ({
          id: team.id,
          primary: team.name,
          secondary: team.description,
        }))}
        fields={[
          { key: 'name', label: 'Team name', required: true },
          { key: 'description', label: 'Description', textarea: true },
        ]}
      />

      <SimpleCreator
        title="Projects"
        description="Decisions can be scoped to a project, and an authority can be limited to one."
        endpoint="/projects"
        items={(reference.data?.projects ?? []).map((project) => ({
          id: project.id,
          primary: project.name,
          secondary: project.code,
        }))}
        fields={[
          { key: 'name', label: 'Project name', required: true },
          { key: 'code', label: 'Code', required: true, hint: 'Short, e.g. CP-01' },
          { key: 'description', label: 'Description', textarea: true },
        ]}
      />

      <SimpleCreator
        className="lg:col-span-2"
        title="Technology catalogue"
        description="What you already run. Decisions point at these, so you can ask what depends on what."
        endpoint="/technologies"
        items={(reference.data?.technologies ?? []).map((technology) => ({
          id: technology.id,
          primary: technology.name,
          secondary: [technology.version, technology.category, technology.status]
            .filter(Boolean)
            .join(' · '),
        }))}
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'version', label: 'Version' },
          { key: 'vendor', label: 'Vendor' },
        ]}
      />
    </div>
  );
}

function SimpleCreator({
  title,
  description,
  endpoint,
  items,
  fields,
  className,
}: {
  title: string;
  description: string;
  endpoint: string;
  items: { id: string; primary: string; secondary?: string | null }[];
  fields: { key: string; label: string; required?: boolean; hint?: string; textarea?: boolean }[];
  className?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post(endpoint, values),
    onSuccess: () => {
      toast.confirm(`${title.replace(/s$/, '')} added`);
      setValues({});
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ['reference-data'] });
    },
    onError: (error) =>
      toast.problem('Not added', error instanceof ApiError ? error.message : 'Try again.'),
  });

  const complete = fields.every((field) => !field.required || values[field.key]?.trim());

  return (
    <section className={className}>
      <div className="rule-heading mb-3">
        <h2 className="font-serif text-base font-semibold">{title}</h2>
        <span className="text-sm text-ink-muted">{items.length}</span>
      </div>
      <p className="mb-3 text-sm text-ink-muted">{description}</p>

      {items.length > 0 ? (
        <ul className="sheet mb-3 max-h-72 divide-y divide-rule overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-2.5">
              <p className="text-sm text-ink">{item.primary}</p>
              {item.secondary ? (
                <p className="text-xs text-ink-muted">{item.secondary}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="sheet space-y-4 p-4">
          {fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              required={field.required}
              hint={field.hint}
              htmlFor={`${endpoint}-${field.key}`}
            >
              {field.textarea ? (
                <Textarea
                  id={`${endpoint}-${field.key}`}
                  rows={2}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`${endpoint}-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              )}
            </Field>
          ))}
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!complete}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add {title.toLowerCase().replace(/s$/, '')}
        </Button>
      )}
    </section>
  );
}
