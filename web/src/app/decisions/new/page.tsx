'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createDecisionSchema,
  DECISION_SIGNIFICANCES,
  DECISION_VISIBILITIES,
  PRIORITIES,
  SIGNIFICANCE_LABELS,
  type CreateDecisionInput,
} from '@tda/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { useSession } from '@/components/session-provider';
import {
  Button,
  Callout,
  CheckboxGroup,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/controls';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { humanise } from '@/lib/format';
import { toOptions, useReferenceData } from '@/lib/reference-data';

/**
 * Raising a decision (spec §21–24).
 *
 * The form is in three parts rather than one long scroll, because the first
 * part is the only part that is mandatory: you can record the problem now and
 * fill in analysis later. Nothing here forces a half-formed decision to be
 * complete before it can exist.
 */
export default function NewDecisionPage() {
  return (
    <AppShell>
      <NewDecisionForm />
    </AppShell>
  );
}

type Stage = 'problem' | 'ownership' | 'context';

function NewDecisionForm() {
  const router = useRouter();
  const toast = useToast();
  const { session } = useSession();
  const reference = useReferenceData();
  const [stage, setStage] = React.useState<Stage>('problem');
  const [problem, setProblem] = React.useState<string | null>(null);

  const form = useForm<CreateDecisionInput>({
    resolver: zodResolver(createDecisionSchema),
    defaultValues: {
      title: '',
      decisionTypeId: '',
      significance: 'significant',
      priority: 'medium',
      problem: '',
      teamIds: [],
      technologyIds: [],
      contributorIds: [],
      stakeholderIds: [],
      tags: [],
      visibility: 'organisation',
      ownerId: session?.userId ?? null,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateDecisionInput) =>
      api.post<{ id: string; reference: string }>('/decisions', values),
    onSuccess: (created) => {
      toast.confirm(`${created.reference} raised`, 'Add alternatives and analysis when you are ready.');
      router.push(`/decisions/detail?id=${created.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fields) {
        for (const [field, message] of Object.entries(error.fields)) {
          form.setError(field as keyof CreateDecisionInput, { message });
        }
        setProblem('Some details need fixing before this can be raised.');
        return;
      }
      setProblem(error instanceof ApiError ? error.message : 'That could not be saved. Try again.');
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setProblem(null);
    mutation.mutate(values);
  });

  const significance = form.watch('significance');
  const errors = form.formState.errors;

  return (
    <>
      <PageHeader
        title="Raise a decision"
        description="Record the technical question now. Analysis, alternatives and evidence can follow."
      />

      <PageBody id="main" className="max-w-3xl">
        <nav className="mb-6 flex border-b border-rule" aria-label="Form sections">
          {(['problem', 'ownership', 'context'] as Stage[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStage(key)}
              aria-current={stage === key ? 'step' : undefined}
              className={
                stage === key
                  ? '-mb-px border-b-2 border-blueprint px-4 py-2 text-sm font-medium text-ink'
                  : '-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-ink-muted hover:text-ink'
              }
            >
              {STAGE_LABELS[key]}
            </button>
          ))}
        </nav>

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          {problem ? <Callout tone="alert">{problem}</Callout> : null}

          {stage === 'problem' ? (
            <div className="sheet space-y-5 p-6">
              <Field
                label="Title"
                required
                htmlFor="title"
                hint="A short, specific name. Others will search for this."
                error={errors.title?.message}
              >
                <Input id="title" autoFocus {...form.register('title')} />
              </Field>

              <Field
                label="The problem"
                required
                htmlFor="problem"
                hint="What technical question needs answering, and why does it matter?"
                error={errors.problem?.message}
              >
                <Textarea id="problem" rows={5} {...form.register('problem')} />
              </Field>

              <Field
                label="Desired outcome"
                htmlFor="desiredOutcome"
                hint="What does a good answer look like?"
                error={errors.desiredOutcome?.message}
              >
                <Textarea id="desiredOutcome" rows={3} {...form.register('desiredOutcome')} />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Decision type"
                  required
                  htmlFor="decisionTypeId"
                  error={errors.decisionTypeId?.message}
                >
                  <Select id="decisionTypeId" {...form.register('decisionTypeId')}>
                    <option value="">Choose a type</option>
                    {(reference.data?.types ?? []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Priority" htmlFor="priority">
                  <Select id="priority" {...form.register('priority')}>
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {humanise(priority)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Significance"
                required
                hint="This sets how much analysis is expected and who can decide it."
                error={errors.significance?.message}
              >
                <div className="space-y-1.5">
                  {DECISION_SIGNIFICANCES.map((level) => (
                    <label
                      key={level}
                      className={
                        significance === level
                          ? 'flex cursor-pointer items-start gap-2.5 border border-rule border-l-[3px] border-l-blueprint bg-blueprint-wash px-3 py-2.5'
                          : 'flex cursor-pointer items-start gap-2.5 border border-rule border-l-[3px] border-l-transparent px-3 py-2.5 hover:bg-wash'
                      }
                    >
                      <input
                        type="radio"
                        value={level}
                        className="mt-1 accent-blueprint"
                        {...form.register('significance')}
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">
                          {SIGNIFICANCE_LABELS[level]}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {SIGNIFICANCE_HINTS[level]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Required by" htmlFor="requiredBy" hint="When does this need an answer?">
                <Input id="requiredBy" type="date" {...form.register('requiredBy')} />
              </Field>

              <div className="flex justify-end border-t border-rule pt-4">
                <Button type="button" variant="secondary" onClick={() => setStage('ownership')}>
                  Next: ownership
                </Button>
              </div>
            </div>
          ) : null}

          {stage === 'ownership' ? (
            <div className="sheet space-y-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Decision owner"
                  htmlFor="ownerId"
                  hint="Accountable for driving this to an answer."
                >
                  <Select id="ownerId" {...form.register('ownerId')}>
                    <option value="">Choose an owner</option>
                    {(reference.data?.people ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="TDA authority"
                  htmlFor="authorityId"
                  hint="Who will make the formal decision."
                >
                  <Select id="authorityId" {...form.register('authorityId')}>
                    <option value="">Assign later</option>
                    {(reference.data?.authorities ?? []).map((authority) => (
                      <option key={authority.id} value={authority.userId}>
                        {authority.name}
                        {authority.title ? ` — ${authority.title}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Project" htmlFor="projectId">
                <Select id="projectId" {...form.register('projectId')}>
                  <option value="">Not project specific</option>
                  {(reference.data?.projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} · {project.code}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Teams affected">
                <Controller
                  control={form.control}
                  name="teamIds"
                  render={({ field }) => (
                    <CheckboxGroup
                      options={toOptions(reference.data?.teams)}
                      value={field.value ?? []}
                      onChange={field.onChange}
                      emptyMessage="No teams set up yet."
                    />
                  )}
                />
              </Field>

              <Field label="Contributors" hint="People who will help analyse this.">
                <Controller
                  control={form.control}
                  name="contributorIds"
                  render={({ field }) => (
                    <CheckboxGroup
                      options={toOptions(reference.data?.people, (p) => p.jobTitle ?? undefined)}
                      value={field.value ?? []}
                      onChange={field.onChange}
                    />
                  )}
                />
              </Field>

              <div className="flex justify-between border-t border-rule pt-4">
                <Button type="button" variant="ghost" onClick={() => setStage('problem')}>
                  Back
                </Button>
                <Button type="button" variant="secondary" onClick={() => setStage('context')}>
                  Next: context
                </Button>
              </div>
            </div>
          ) : null}

          {stage === 'context' ? (
            <div className="sheet space-y-5 p-6">
              <Field label="Background" htmlFor="background" hint="How did this come about?">
                <Textarea id="background" rows={4} {...form.register('background')} />
              </Field>

              <Field label="Scope" htmlFor="scope" hint="What is in, and explicitly out.">
                <Textarea id="scope" rows={3} {...form.register('scope')} />
              </Field>

              <Field label="Constraints" htmlFor="constraints">
                <Textarea id="constraints" rows={3} {...form.register('constraints')} />
              </Field>

              <Field label="Requirements" htmlFor="requirements">
                <Textarea id="requirements" rows={3} {...form.register('requirements')} />
              </Field>

              <Field label="Technologies involved">
                <Controller
                  control={form.control}
                  name="technologyIds"
                  render={({ field }) => (
                    <CheckboxGroup
                      columns={3}
                      options={toOptions(reference.data?.technologies, (t) => t.version ?? undefined)}
                      value={field.value ?? []}
                      onChange={field.onChange}
                      emptyMessage="No technologies in the catalogue yet."
                    />
                  )}
                />
              </Field>

              <Field
                label="Visibility"
                htmlFor="visibility"
                hint="Restricted decisions are only visible to those named on them."
              >
                <Select id="visibility" {...form.register('visibility')}>
                  {DECISION_VISIBILITIES.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {humanise(visibility)}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex justify-between border-t border-rule pt-4">
                <Button type="button" variant="ghost" onClick={() => setStage('ownership')}>
                  Back
                </Button>
                <Button type="submit" variant="primary" loading={mutation.isPending}>
                  Raise this decision
                </Button>
              </div>
            </div>
          ) : null}

          {stage !== 'context' ? (
            <p className="text-sm text-ink-muted">
              You can raise the decision from any step once the title, type and problem are filled
              in.{' '}
              <button
                type="submit"
                className="text-blueprint underline-offset-4 hover:underline"
                disabled={mutation.isPending}
              >
                Raise it now
              </button>
            </p>
          ) : null}
        </form>
      </PageBody>
    </>
  );
}

const STAGE_LABELS: Record<Stage, string> = {
  problem: '1. The problem',
  ownership: '2. Ownership',
  context: '3. Context',
};

const SIGNIFICANCE_HINTS: Record<string, string> = {
  routine: 'Local effect, easily reversed. Light analysis.',
  significant: 'Affects a team or product area. Alternatives expected.',
  major: 'Affects several teams or is costly to reverse. Full analysis and risks.',
  critical: 'Organisation-wide or very hard to undo. Everything documented.',
};
