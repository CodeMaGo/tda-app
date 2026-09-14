'use client';

import type { ActionStatus, Priority } from '@tda/shared';
import { ACTION_STATUSES, ACTION_STATUS_LABELS } from '@tda/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { useSession } from '@/components/session-provider';
import { Button, EmptyState, Select, Skeleton } from '@/components/ui/controls';
import {
  ACTION_TONE,
  ActionStatusLabel,
  DueDate,
  Reference,
  SignalCell,
  StatusLabel,
  priorityTone,
} from '@/components/ui/signals';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { daysUntil, humanise } from '@/lib/format';

interface ActionRow {
  id: string;
  reference: string;
  description: string;
  status: ActionStatus;
  priority: Priority;
  dueDate: string | null;
  completedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerTeamName: string | null;
  decisionId: string | null;
  decisionReference: string | null;
  decisionTitle: string | null;
  fromCondition: boolean;
}

export default function ActionsPage() {
  return (
    <AppShell>
      <React.Suspense fallback={<PageBody><Skeleton className="h-96 w-full" /></PageBody>}>
        <Actions />
      </React.Suspense>
    </AppShell>
  );
}

function Actions() {
  const params = useSearchParams();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const [scope, setScope] = React.useState(params.get('mine') === 'true' ? 'mine' : 'all');
  const [status, setStatus] = React.useState('open');

  const { data, isLoading } = useQuery({
    queryKey: ['actions', scope, status],
    queryFn: () =>
      api.get<{ items: ActionRow[] }>('/actions', {
        ownerId: scope === 'mine' ? session?.userId : undefined,
        statuses:
          status === 'open'
            ? ['not_started', 'in_progress', 'blocked']
            : status === 'all'
              ? undefined
              : [status],
      }),
  });

  const items = data?.items ?? [];
  const overdue = items.filter((a) => daysUntil(a.dueDate) !== null && daysUntil(a.dueDate)! < 0);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['actions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <>
      <PageHeader
        title="Actions"
        description="Implementation work arising from decisions, including conditions attached to approvals."
        actions={
          <>
            <Select
              aria-label="Whose actions"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="all">Everyone</option>
              <option value="mine">Mine</option>
            </Select>
            <Select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="open">Open</option>
              <option value="all">All</option>
              {ACTION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ACTION_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <PageBody id="main">
        {overdue.length > 0 ? (
          <p className="mb-4 border border-rule border-l-[3px] border-l-alert bg-alert-wash px-4 py-2.5 text-sm text-ink">
            {overdue.length} action{overdue.length === 1 ? ' is' : 's are'} past the due date.
          </p>
        ) : null}

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : items.length === 0 ? (
          <EmptyState
            title={scope === 'mine' ? 'Nothing is assigned to you' : 'No actions match'}
            description="Actions are created when a decision is approved with conditions, or added by hand during implementation."
          />
        ) : (
          <div className="sheet overflow-x-auto">
            <table className="record-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Action</th>
                  <th scope="col">From</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((action) => (
                  <tr key={action.id}>
                    <SignalCell
                      tone={
                        daysUntil(action.dueDate) !== null &&
                        daysUntil(action.dueDate)! < 0 &&
                        action.status !== 'complete'
                          ? 'alert'
                          : ACTION_TONE[action.status]
                      }
                    >
                      <Reference>{action.reference}</Reference>
                    </SignalCell>
                    <td>
                      <span className="text-ink">{action.description}</span>
                      {action.fromCondition ? (
                        <span className="mt-0.5 block text-xs text-warn">
                          Condition of approval
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {action.decisionId ? (
                        <Link
                          href={`/decisions/detail?id=${action.decisionId}`}
                          className="text-blueprint hover:underline"
                        >
                          <Reference>{action.decisionReference}</Reference>
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="text-ink-muted">
                      {action.ownerName ?? action.ownerTeamName ?? 'Unassigned'}
                    </td>
                    <td>
                      <StatusLabel tone={priorityTone(action.priority)}>
                        {humanise(action.priority)}
                      </StatusLabel>
                    </td>
                    <td>
                      <DueDate date={action.dueDate} daysLeft={daysUntil(action.dueDate)} />
                    </td>
                    <td>
                      <StatusCell action={action} canEdit={action.ownerId === session?.userId} onChange={invalidate} />
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

/**
 * The owner updates status inline. Anyone else sees it read-only — progress is
 * reported by the person doing the work, not assumed by onlookers.
 */
function StatusCell({
  action,
  canEdit,
  onChange,
}: {
  action: ActionRow;
  canEdit: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (status: ActionStatus) => api.patch(`/actions/${action.id}`, { status }),
    onSuccess: (_result, status) => {
      toast.confirm(
        status === 'complete' ? `${action.reference} completed` : `${action.reference} updated`,
      );
      onChange();
    },
    onError: (error) =>
      toast.problem('Could not update', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (!canEdit) return <ActionStatusLabel status={action.status} />;

  return (
    <Select
      aria-label={`Status of ${action.reference}`}
      className="h-8 text-xs"
      value={action.status}
      disabled={mutation.isPending}
      onChange={(event) => mutation.mutate(event.target.value as ActionStatus)}
    >
      {ACTION_STATUSES.map((status) => (
        <option key={status} value={status}>
          {ACTION_STATUS_LABELS[status]}
        </option>
      ))}
    </Select>
  );
}
