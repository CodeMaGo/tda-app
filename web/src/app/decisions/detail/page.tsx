'use client';

import type { DecisionStatus, RiskLevel } from '@tda/shared';
import { DECISION_STATUS_LABELS } from '@tda/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Send, Upload } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { DecisionPanel } from '@/components/decision/decision-panel';
import { useSession } from '@/components/session-provider';
import { Button, Callout, EmptyState, Skeleton, Textarea } from '@/components/ui/controls';
import {
  DECISION_TONE,
  DecisionStatusLabel,
  DueDate,
  Reference,
  SignificanceGauge,
  StatusLabel,
  riskTone,
} from '@/components/ui/signals';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, downloadEvidence, uploadEvidence } from '@/lib/api';
import { daysUntil, describeEvent, formatBytes, formatDateTime, humanise, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function DecisionDetailPage() {
  return (
    <AppShell>
      <React.Suspense fallback={<PageBody><Skeleton className="h-96 w-full" /></PageBody>}>
        <DecisionDetail />
      </React.Suspense>
    </AppShell>
  );
}

interface DecisionDetailResponse {
  decision: {
    id: string;
    reference: string;
    title: string;
    status: DecisionStatus;
    significance: 'routine' | 'significant' | 'major' | 'critical';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    version: string;
    problem: string | null;
    background: string | null;
    desiredOutcome: string | null;
    scope: string | null;
    constraints: string | null;
    requirements: string | null;
    recommendation: string | null;
    recommendationRationale: string | null;
    decisionText: string | null;
    decisionRationale: string | null;
    effectiveDate: string | null;
    decidedAt: string | null;
    requiredBy: string | null;
    lockedAt: string | null;
    ownerId: string | null;
    authorityId: string | null;
  };
  type: { name: string } | null;
  project: { name: string; code: string } | null;
  owner: { id: string; name: string } | null;
  authority: { id: string; name: string } | null;
  contributors: { userId: string; name: string; role: string }[];
  teams: { id: string; name: string }[];
  technologies: { id: string; name: string; version: string | null; status: string }[];
  alternatives: {
    id: string;
    name: string;
    description: string | null;
    advantages: string | null;
    disadvantages: string | null;
    risks: string | null;
    cost: string | null;
    technicalImplications: string | null;
    recommendation: string | null;
  }[];
  scores: { alternativeId: string; name: string; weightedScore: number; coverage: number }[];
  risks: {
    id: string;
    summary: string;
    description: string | null;
    probability: RiskLevel;
    impact: RiskLevel;
    rating: RiskLevel;
    residualRating: RiskLevel | null;
    mitigation: string | null;
    ownerName: string | null;
    status: string;
  }[];
  comments: {
    id: string;
    body: string;
    kind: string;
    createdAt: string;
    userName: string;
    retractedAt: string | null;
  }[];
  attachments: {
    id: string;
    filename: string;
    description: string | null;
    version: string;
    sizeBytes: number;
    uploadedBy: string;
    createdAt: string;
  }[];
  actions: {
    id: string;
    reference: string;
    description: string;
    status: string;
    dueDate: string | null;
    ownerName: string | null;
    ownerTeamName: string | null;
  }[];
  conditions: { id: string; description: string; dueDate: string | null; satisfiedAt: string | null }[];
  relationships: {
    id: string;
    type: string;
    targetId: string;
    targetReference: string;
    targetTitle: string;
  }[];
  informationRequests: {
    id: string;
    request: string;
    response: string | null;
    requestedBy: string;
    assignedToUserId: string;
    respondedAt: string | null;
    dueDate: string | null;
  }[];
  history: {
    id: string;
    eventType: string;
    userName: string | null;
    objectReference: string | null;
    oldStatus: string | null;
    newStatus: string | null;
    occurredAt: string;
  }[];
}

function DecisionDetail() {
  const id = useSearchParams().get('id');
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['decision', id],
    queryFn: () => api.get<DecisionDetailResponse>(`/decisions/${id}`),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['decision', id] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  if (!id) {
    return (
      <PageBody>
        <EmptyState title="No decision selected" description="Open a decision from the register." />
      </PageBody>
    );
  }

  if (isLoading) {
    return (
      <PageBody>
        <Skeleton className="h-10 w-96" />
        <Skeleton className="mt-6 h-96 w-full" />
      </PageBody>
    );
  }

  if (error || !data) {
    return (
      <PageBody>
        <Callout tone="alert" title="That decision could not be opened">
          {error instanceof ApiError
            ? error.message
            : 'It may have been withdrawn, or you may not have access to it.'}
        </Callout>
      </PageBody>
    );
  }

  const { decision } = data;
  const isAuthority = decision.authorityId === session?.userId && can('decision:decide');
  const isOwner = decision.ownerId === session?.userId;
  const openRequest = data.informationRequests.find(
    (request) => !request.respondedAt && request.assignedToUserId === session?.userId,
  );

  return (
    <>
      <PageHeader
        title={decision.title}
        actions={
          <>
            {isOwner && ['draft', 'under_analysis'].includes(decision.status) ? (
              <SubmitButton decisionId={decision.id} onDone={invalidate} />
            ) : null}
            <Button variant="secondary" onClick={() => window.print()}>
              Print record
            </Button>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Reference size="md">{decision.reference}</Reference>
          <DecisionStatusLabel status={decision.status} />
          <SignificanceGauge significance={decision.significance} />
          <span className="text-ink-muted">
            Required by <DueDate date={decision.requiredBy} daysLeft={daysUntil(decision.requiredBy)} />
          </span>
          <span className="text-ink-muted">Version {decision.version}</span>
        </div>
      </PageHeader>

      <PageBody id="main">
        {decision.lockedAt ? (
          <Callout tone="info" title="This decision is on the record">
            The content is frozen as it stood when the decision was made. To change it, supersede it
            with a new decision.
          </Callout>
        ) : null}

        {openRequest ? (
          <div className="mt-4">
            <RespondToRequest
              decisionId={decision.id}
              request={openRequest}
              onDone={invalidate}
            />
          </div>
        ) : null}

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 space-y-9">
            {/* The formal record, set in serif so it reads as a document. */}
            {decision.decisionText ? (
              <section>
                <div className="rule-heading mb-3">
                  <h2 className="font-serif text-lg font-semibold">The decision</h2>
                  <span className="text-sm text-ink-muted">
                    {decision.decidedAt ? formatDateTime(decision.decidedAt) : ''}
                  </span>
                </div>
                <div className="sheet border-l-[3px] border-l-good p-5">
                  <p className="font-serif text-lg leading-relaxed text-ink">
                    {decision.decisionText}
                  </p>
                  {decision.decisionRationale ? (
                    <>
                      <h3 className="mb-1 mt-5 text-sm font-semibold text-ink">Rationale</h3>
                      <Prose text={decision.decisionRationale} />
                    </>
                  ) : null}
                  <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-rule pt-4 text-sm sm:grid-cols-3">
                    <Detail label="Authority">{data.authority?.name ?? '—'}</Detail>
                    <Detail label="Effective from">{decision.effectiveDate ?? '—'}</Detail>
                    <Detail label="Outcome">{DECISION_STATUS_LABELS[decision.status]}</Detail>
                  </dl>
                </div>
              </section>
            ) : null}

            {data.conditions.length > 0 ? (
              <section>
                <div className="rule-heading mb-3">
                  <h2 className="font-serif text-lg font-semibold">Conditions</h2>
                </div>
                <ul className="sheet divide-y divide-rule">
                  {data.conditions.map((condition) => (
                    <li key={condition.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                      <StatusLabel tone={condition.satisfiedAt ? 'good' : 'warn'}>
                        {condition.satisfiedAt ? 'Met' : 'Outstanding'}
                      </StatusLabel>
                      <span className="flex-1 text-ink">{condition.description}</span>
                      <span className="text-xs text-ink-muted">{condition.dueDate ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <div className="rule-heading mb-3">
                <h2 className="font-serif text-lg font-semibold">Context</h2>
              </div>
              <div className="sheet space-y-5 p-5">
                <Section title="Problem">{decision.problem}</Section>
                <Section title="Desired outcome">{decision.desiredOutcome}</Section>
                <Section title="Background">{decision.background}</Section>
                <Section title="Scope">{decision.scope}</Section>
                <Section title="Constraints">{decision.constraints}</Section>
                <Section title="Requirements">{decision.requirements}</Section>
              </div>
            </section>

            <section>
              <div className="rule-heading mb-3">
                <h2 className="font-serif text-lg font-semibold">Alternatives considered</h2>
                <span className="text-sm text-ink-muted">{data.alternatives.length}</span>
              </div>
              {data.alternatives.length === 0 ? (
                <EmptyState
                  title="No alternatives recorded"
                  description="A decision is easier to defend when the options that were rejected are on the record too."
                />
              ) : (
                <div className="space-y-3">
                  {data.alternatives.map((alternative) => {
                    const score = data.scores.find((s) => s.alternativeId === alternative.id);
                    const recommended = decision.recommendation?.includes(alternative.name);
                    return (
                      <article
                        key={alternative.id}
                        className={cn(
                          'sheet p-5',
                          recommended && 'border-l-[3px] border-l-blueprint',
                        )}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <h3 className="font-serif text-base font-semibold text-ink">
                            {alternative.name}
                            {recommended ? (
                              <span className="ml-2 text-xs font-medium text-blueprint">
                                Recommended
                              </span>
                            ) : null}
                          </h3>
                          {score && score.coverage > 0 ? (
                            <span className="text-sm text-ink-muted">
                              Weighted score{' '}
                              <span className="font-medium text-ink">{score.weightedScore}</span>
                              {score.coverage < 1 ? (
                                <span className="ml-1 text-xs">
                                  ({Math.round(score.coverage * 100)}% assessed)
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                        {alternative.description ? (
                          <p className="mt-2 text-sm text-ink">{alternative.description}</p>
                        ) : null}
                        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                          <Section title="Advantages" compact>{alternative.advantages}</Section>
                          <Section title="Disadvantages" compact>{alternative.disadvantages}</Section>
                          <Section title="Cost" compact>{alternative.cost}</Section>
                          <Section title="Technical implications" compact>
                            {alternative.technicalImplications}
                          </Section>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {decision.recommendation ? (
              <section>
                <div className="rule-heading mb-3">
                  <h2 className="font-serif text-lg font-semibold">Recommendation</h2>
                  <span className="text-sm text-ink-muted">from {data.owner?.name ?? 'the owner'}</span>
                </div>
                <div className="sheet border-l-[3px] border-l-blueprint p-5">
                  <p className="font-serif text-base font-semibold text-ink">
                    {decision.recommendation}
                  </p>
                  {decision.recommendationRationale ? (
                    <div className="mt-2">
                      <Prose text={decision.recommendationRationale} />
                    </div>
                  ) : null}
                  <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-muted">
                    A recommendation is advice from the decision owner. The formal decision is made
                    by the TDA authority.
                  </p>
                </div>
              </section>
            ) : null}

            <section>
              <div className="rule-heading mb-3">
                <h2 className="font-serif text-lg font-semibold">Technical risks</h2>
                <span className="text-sm text-ink-muted">{data.risks.length}</span>
              </div>
              {data.risks.length === 0 ? (
                <EmptyState title="No risks recorded" />
              ) : (
                <div className="sheet overflow-x-auto">
                  <table className="record-table">
                    <thead>
                      <tr>
                        <th>Risk</th>
                        <th>Rating</th>
                        <th>Residual</th>
                        <th>Mitigation</th>
                        <th>Owner</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.risks.map((risk) => (
                        <tr key={risk.id}>
                          <td className="signal border-l-transparent">
                            <span className="font-medium text-ink">{risk.summary}</span>
                            {risk.description ? (
                              <span className="mt-0.5 block text-xs text-ink-muted">
                                {risk.description}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <StatusLabel tone={riskTone(risk.rating)}>
                              {humanise(risk.rating)}
                            </StatusLabel>
                          </td>
                          <td className="text-ink-muted">
                            {risk.residualRating ? humanise(risk.residualRating) : 'Not assessed'}
                          </td>
                          <td className="max-w-xs text-ink-muted">{risk.mitigation ?? '—'}</td>
                          <td className="text-ink-muted">{risk.ownerName ?? '—'}</td>
                          <td className="text-ink-muted">{humanise(risk.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <EvidenceSection
              decisionId={decision.id}
              attachments={data.attachments}
              canUpload={can('decision:upload_evidence') && !decision.lockedAt}
              onChange={invalidate}
            />

            <CollaborationSection
              decisionId={decision.id}
              comments={data.comments}
              requests={data.informationRequests}
              canComment={can('decision:comment')}
              onChange={invalidate}
            />
          </div>

          {/* Aside: who is accountable, what happens next, and the audit trail. */}
          <aside className="space-y-8">
            {isAuthority && ['under_tda_review', 'escalated'].includes(decision.status) ? (
              <DecisionPanel decision={decision} detail={data} onDecided={invalidate} />
            ) : null}

            <section>
              <h2 className="rule-heading mb-3 font-serif text-base font-semibold">Accountability</h2>
              <dl className="sheet divide-y divide-rule text-sm">
                <Row label="Decision owner">{data.owner?.name ?? 'Not assigned'}</Row>
                <Row label="TDA authority">{data.authority?.name ?? 'Not nominated'}</Row>
                <Row label="Type">{data.type?.name ?? '—'}</Row>
                <Row label="Project">
                  {data.project ? `${data.project.name} · ${data.project.code}` : '—'}
                </Row>
                <Row label="Teams">
                  {data.teams.length > 0 ? data.teams.map((t) => t.name).join(', ') : '—'}
                </Row>
                <Row label="Contributors">
                  {data.contributors.length > 0
                    ? data.contributors.map((c) => c.name).join(', ')
                    : '—'}
                </Row>
              </dl>
            </section>

            {data.technologies.length > 0 ? (
              <section>
                <h2 className="rule-heading mb-3 font-serif text-base font-semibold">Technologies</h2>
                <ul className="sheet divide-y divide-rule text-sm">
                  {data.technologies.map((technology) => (
                    <li key={technology.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink">
                        {technology.name}
                        {technology.version ? (
                          <span className="ml-1.5 text-xs text-ink-muted">{technology.version}</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-ink-muted">{humanise(technology.status)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.actions.length > 0 ? (
              <section>
                <h2 className="rule-heading mb-3 font-serif text-base font-semibold">Actions</h2>
                <ul className="sheet divide-y divide-rule text-sm">
                  {data.actions.map((action) => (
                    <li key={action.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <Reference>{action.reference}</Reference>
                        <span className="text-xs text-ink-muted">{humanise(action.status)}</span>
                      </div>
                      <p className="mt-1 text-ink">{action.description}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {action.ownerName ?? action.ownerTeamName ?? 'Unassigned'} ·{' '}
                        <DueDate date={action.dueDate} daysLeft={daysUntil(action.dueDate)} />
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.relationships.length > 0 ? (
              <section>
                <h2 className="rule-heading mb-3 font-serif text-base font-semibold">
                  Related decisions
                </h2>
                <ul className="sheet divide-y divide-rule text-sm">
                  {data.relationships.map((relationship) => (
                    <li key={relationship.id} className="px-4 py-2.5">
                      <span className="block text-xs text-ink-muted">
                        {humanise(relationship.type)}
                      </span>
                      <Link
                        href={`/decisions/detail?id=${relationship.targetId}`}
                        className="text-blueprint hover:underline"
                      >
                        <Reference>{relationship.targetReference}</Reference>{' '}
                        <span className="text-ink">{relationship.targetTitle}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h2 className="rule-heading mb-3 font-serif text-base font-semibold">History</h2>
              <ol className="sheet divide-y divide-rule text-sm">
                {data.history.map((event) => (
                  <li key={event.id} className="px-4 py-2.5">
                    <p className="text-ink">{describeEvent(event)}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatDateTime(event.occurredAt)} · {timeAgo(event.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
  compact,
}: {
  title: string;
  children: string | null | undefined;
  compact?: boolean;
}) {
  if (!children) return null;
  return (
    <div>
      <h3 className={cn('mb-1 font-semibold text-ink', compact ? 'text-xs' : 'text-sm')}>{title}</h3>
      <Prose text={children} />
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="max-w-prose space-y-2 font-serif text-[0.95rem] leading-relaxed text-ink">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function SubmitButton({ decisionId, onDone }: { decisionId: string; onDone: () => void }) {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/submit`, {}),
    onSuccess: () => {
      toast.confirm('Submitted for review', 'The TDA authority has been notified.');
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError && Array.isArray((error.details as { problems?: string[] })?.problems)) {
        const problems = (error.details as { problems: string[] }).problems;
        toast.problem('Not ready for review yet', problems.join('. '));
        return;
      }
      toast.problem(
        'Could not submit',
        error instanceof ApiError ? error.message : 'Try again.',
      );
    },
  });

  return (
    <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
      <Send className="h-4 w-4" />
      Submit for review
    </Button>
  );
}

function RespondToRequest({
  decisionId,
  request,
  onDone,
}: {
  decisionId: string;
  request: { id: string; request: string; requestedBy: string; dueDate: string | null };
  onDone: () => void;
}) {
  const toast = useToast();
  const [response, setResponse] = React.useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/decisions/${decisionId}/information/${request.id}`, {
        response,
        returnToReview: true,
      }),
    onSuccess: () => {
      toast.confirm('Answer recorded', 'The decision has gone back for review.');
      setResponse('');
      onDone();
    },
    onError: (error) =>
      toast.problem('Could not send', error instanceof ApiError ? error.message : 'Try again.'),
  });

  return (
    <div className="sheet border-l-[3px] border-l-warn p-5">
      <h2 className="font-serif text-base font-semibold text-ink">
        {request.requestedBy} needs more information
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink">{request.request}</p>
      {request.dueDate ? (
        <p className="mt-1 text-xs text-ink-muted">Requested by {request.dueDate}</p>
      ) : null}
      <Textarea
        className="mt-4"
        value={response}
        onChange={(event) => setResponse(event.target.value)}
        placeholder="Your answer…"
        aria-label="Your answer"
      />
      <Button
        className="mt-3"
        variant="primary"
        disabled={response.trim().length === 0}
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Send answer
      </Button>
    </div>
  );
}

function EvidenceSection({
  decisionId,
  attachments,
  canUpload,
  onChange,
}: {
  decisionId: string;
  attachments: DecisionDetailResponse['attachments'];
  canUpload: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadEvidence({ decisionId, file });
      }
      toast.confirm(files.length === 1 ? 'Evidence uploaded' : `${files.length} files uploaded`);
      onChange();
    } catch (error) {
      toast.problem(
        'Upload failed',
        error instanceof Error ? error.message : 'Check the file type and size, then try again.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section>
      <div className="rule-heading mb-3">
        <h2 className="font-serif text-lg font-semibold">Evidence</h2>
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => void handleFiles(event.target.files)}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Add evidence
            </Button>
          </>
        ) : null}
      </div>

      {attachments.length === 0 ? (
        <EmptyState
          title="No evidence attached"
          description="Attach the analysis, assessments and results that the recommendation rests on."
        />
      ) : (
        <ul className="sheet divide-y divide-rule">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 px-4 py-3">
              <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{attachment.filename}</p>
                <p className="text-xs text-ink-muted">
                  v{attachment.version} · {formatBytes(attachment.sizeBytes)} ·{' '}
                  {attachment.uploadedBy} · {formatDateTime(attachment.createdAt)}
                </p>
                {attachment.description ? (
                  <p className="mt-0.5 text-xs text-ink-muted">{attachment.description}</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void downloadEvidence(attachment.id)}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CollaborationSection({
  decisionId,
  comments,
  requests,
  canComment,
  onChange,
}: {
  decisionId: string;
  comments: DecisionDetailResponse['comments'];
  requests: DecisionDetailResponse['informationRequests'];
  canComment: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = React.useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/comments`, { body, kind: 'comment' }),
    onSuccess: () => {
      setBody('');
      onChange();
    },
    onError: (error) =>
      toast.problem('Comment not saved', error instanceof ApiError ? error.message : 'Try again.'),
  });

  const answered = requests.filter((request) => request.respondedAt);

  return (
    <section>
      <div className="rule-heading mb-3">
        <h2 className="font-serif text-lg font-semibold">Discussion</h2>
        <span className="text-sm text-ink-muted">{comments.length}</span>
      </div>

      {answered.length > 0 ? (
        <div className="mb-4 space-y-3">
          {answered.map((request) => (
            <div key={request.id} className="sheet border-l-[3px] border-l-rule p-4 text-sm">
              <p className="text-xs text-ink-muted">{request.requestedBy} asked</p>
              <p className="mt-1 text-ink">{request.request}</p>
              <p className="mt-3 border-t border-rule pt-3 text-xs text-ink-muted">Answered</p>
              <p className="mt-1 text-ink">{request.response}</p>
            </div>
          ))}
        </div>
      ) : null}

      {comments.length === 0 ? (
        <EmptyState title="No comments yet" description="Ask a question or record an observation." />
      ) : (
        <ol className="sheet divide-y divide-rule">
          {comments.map((comment) => (
            <li key={comment.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-ink">
                  {comment.userName}
                  {comment.kind !== 'comment' ? (
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {humanise(comment.kind)}
                    </span>
                  ) : null}
                </p>
                <span className="text-xs text-ink-faint">{timeAgo(comment.createdAt)}</span>
              </div>
              {comment.retractedAt ? (
                <p className="mt-1 text-sm italic text-ink-muted">
                  This comment was retracted. It remains in the audit trail.
                </p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{comment.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {canComment ? (
        <div className="mt-4">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a comment or question…"
            aria-label="Add a comment"
            rows={3}
          />
          <Button
            className="mt-2"
            variant="secondary"
            disabled={body.trim().length === 0}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Post comment
          </Button>
        </div>
      ) : null}
    </section>
  );
}
