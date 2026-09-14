'use client';

import type { DecisionStatus, Priority } from '@tda/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { useSession } from '@/components/session-provider';
import { Button, EmptyState, Skeleton } from '@/components/ui/controls';
import {
  DECISION_TONE,
  DecisionStatusLabel,
  DueDate,
  Reference,
  SignalCell,
  StatusLabel,
  priorityTone,
} from '@/components/ui/signals';
import { api } from '@/lib/api';
import { daysUntil, describeEvent, timeAgo } from '@/lib/format';

interface QueueDecision {
  id: string;
  reference: string;
  title: string;
  status: DecisionStatus;
  significance: 'routine' | 'significant' | 'major' | 'critical';
  priority: Priority;
  requiredBy: string | null;
  ownerName: string | null;
  projectCode: string | null;
}

interface QueueAction {
  id: string;
  reference: string;
  description: string;
  status: 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'cancelled';
  priority: Priority;
  dueDate: string | null;
  decisionReference: string | null;
  decisionId: string | null;
}

interface DashboardResponse {
  counts: Record<string, number>;
  queues: {
    awaitingMe: QueueDecision[];
    mine: QueueDecision[];
    needingInformation: QueueDecision[];
    myOpenActions: QueueAction[];
  };
  recent: {
    id: string;
    eventType: string;
    userName: string | null;
    objectReference: string | null;
    objectId: string | null;
    oldStatus: string | null;
    newStatus: string | null;
    occurredAt: string;
  }[];
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { session, can } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
  });

  const firstName = session?.name.split(' ')[0] ?? '';
  const awaiting = data?.queues.awaitingMe ?? [];
  const isAuthority = can('decision:decide');

  return (
    <>
      <PageHeader
        title={firstName ? `Good day, ${firstName}` : 'Dashboard'}
        description="What needs you, and what the organisation has decided."
        actions={
          can('decision:create') ? (
            <Button variant="primary" asChild>
              <Link href="/decisions/new">
                <Plus className="h-4 w-4" />
                Raise a decision
              </Link>
            </Button>
          ) : null
        }
      />

      <PageBody id="main">
        {isLoading ? <QueueSkeleton /> : null}

        {/* The hero is the queue. If something is waiting on this person, it is
            the first thing they see — before any counts. */}
        {!isLoading && isAuthority ? (
          <section className="mb-10">
            <div className="rule-heading mb-3">
              <h2 className="font-serif text-lg font-semibold">Awaiting your decision</h2>
              <span className="text-sm text-ink-muted">
                {awaiting.length === 0 ? 'Nothing right now' : `${awaiting.length} waiting`}
              </span>
            </div>

            {awaiting.length === 0 ? (
              <EmptyState
                title="Your review queue is clear"
                description="Decisions appear here the moment an owner submits them for your review."
              />
            ) : (
              <DecisionQueue decisions={awaiting} emphasis />
            )}
          </section>
        ) : null}

        {!isLoading && data ? (
          <>
            <section className="mb-10">
              <div className="rule-heading mb-3">
                <h2 className="font-serif text-lg font-semibold">Your open decisions</h2>
                <Link
                  href="/decisions?mine=true"
                  className="text-sm text-blueprint hover:underline"
                >
                  See all
                </Link>
              </div>
              {data.queues.mine.length === 0 ? (
                <EmptyState
                  title="You do not own any open decisions"
                  description="Raise one when a technical question needs a recorded answer."
                  action={
                    can('decision:create') ? (
                      <Button variant="secondary" asChild>
                        <Link href="/decisions/new">Raise a decision</Link>
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <DecisionQueue decisions={data.queues.mine} />
              )}
            </section>

            <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr]">
              <section>
                <div className="rule-heading mb-3">
                  <h2 className="font-serif text-lg font-semibold">Your actions</h2>
                  <Link href="/actions?mine=true" className="text-sm text-blueprint hover:underline">
                    See all
                  </Link>
                </div>
                {data.queues.myOpenActions.length === 0 ? (
                  <EmptyState title="No actions assigned to you" />
                ) : (
                  <ul className="sheet divide-y divide-rule">
                    {data.queues.myOpenActions.map((action) => (
                      <li key={action.id} className="flex items-start gap-3 px-4 py-3">
                        <span className="pt-0.5">
                          <Reference>{action.reference}</Reference>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink">{action.description}</span>
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {action.decisionReference ? `From ${action.decisionReference} · ` : ''}
                            <DueDate date={action.dueDate} daysLeft={daysUntil(action.dueDate)} />
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="rule-heading mb-3">
                  <h2 className="font-serif text-lg font-semibold">Recent activity</h2>
                </div>
                <ol className="sheet divide-y divide-rule">
                  {data.recent.slice(0, 10).map((event) => (
                    <li key={event.id} className="px-4 py-2.5 text-sm">
                      {event.objectId ? (
                        <Link
                          href={`/decisions/detail?id=${event.objectId}`}
                          className="text-ink hover:text-blueprint"
                        >
                          {describeEvent(event)}
                        </Link>
                      ) : (
                        <span className="text-ink">{describeEvent(event)}</span>
                      )}
                      <span className="ml-2 text-xs text-ink-faint">{timeAgo(event.occurredAt)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            {/* Counts come last: context for the queue above, not the headline. */}
            <section className="mt-10">
              <div className="rule-heading mb-3">
                <h2 className="font-serif text-lg font-semibold">Where things stand</h2>
              </div>
              <dl className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
                <Figure label="Open decisions" value={data.counts.openDecisions} />
                <Figure label="Pending information" value={data.counts.pendingInformation} />
                <Figure
                  label="Overdue actions"
                  value={data.counts.overdueActions}
                  alert={(data.counts.overdueActions ?? 0) > 0}
                />
                <Figure label="Decided this year" value={data.counts.decisionsThisYear} />
                {data.counts.users !== undefined ? (
                  <>
                    <Figure label="People" value={data.counts.users} />
                    <Figure label="Technologies" value={data.counts.technologies} />
                  </>
                ) : (
                  <>
                    <Figure label="Your contributions" value={data.counts.myContributions} />
                    <Figure label="Waiting on you" value={data.counts.pendingMyAction} />
                  </>
                )}
              </dl>
            </section>
          </>
        ) : null}
      </PageBody>
    </>
  );
}

function DecisionQueue({
  decisions,
  emphasis = false,
}: {
  decisions: QueueDecision[];
  emphasis?: boolean;
}) {
  return (
    <div className="sheet overflow-x-auto">
      <table className="record-table">
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Decision</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Owner</th>
            <th scope="col">Required by</th>
            <th scope="col" className="w-8" aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {decisions.map((decision) => (
            <tr key={decision.id}>
              <SignalCell tone={DECISION_TONE[decision.status]}>
                <Reference>{decision.reference}</Reference>
              </SignalCell>
              <td>
                <Link
                  href={`/decisions/detail?id=${decision.id}`}
                  className={emphasis ? 'font-medium text-ink hover:text-blueprint' : 'text-ink hover:text-blueprint'}
                >
                  {decision.title}
                </Link>
                {decision.projectCode ? (
                  <span className="ml-2 text-xs text-ink-muted">{decision.projectCode}</span>
                ) : null}
              </td>
              <td>
                <DecisionStatusLabel status={decision.status} />
              </td>
              <td>
                <StatusLabel tone={priorityTone(decision.priority)}>
                  {decision.priority[0]!.toUpperCase() + decision.priority.slice(1)}
                </StatusLabel>
              </td>
              <td className="text-ink-muted">{decision.ownerName ?? '—'}</td>
              <td>
                <DueDate date={decision.requiredBy} daysLeft={daysUntil(decision.requiredBy)} />
              </td>
              <td>
                <Link
                  href={`/decisions/detail?id=${decision.id}`}
                  className="text-ink-faint hover:text-blueprint"
                  aria-label={`Open ${decision.reference}`}
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Figure({ label, value, alert }: { label: string; value?: number; alert?: boolean }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dd
        className={`font-serif text-2xl font-semibold leading-none ${alert ? 'text-alert' : 'text-ink'}`}
      >
        {value ?? 0}
      </dd>
      <dt className="mt-1.5 text-xs text-ink-muted">{label}</dt>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-52" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
