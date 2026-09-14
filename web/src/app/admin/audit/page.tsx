'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { Button, EmptyState, Input, Select, Skeleton } from '@/components/ui/controls';
import { Reference } from '@/components/ui/signals';
import { api } from '@/lib/api';
import { describeEvent, formatDateTime, humanise } from '@/lib/format';
import { useReferenceData } from '@/lib/reference-data';

interface AuditEvent {
  id: string;
  eventType: string;
  objectType: string;
  objectId: string | null;
  objectReference: string | null;
  userName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  occurredAt: string;
}

/**
 * The audit trail (spec §43). Append-only at the database level: the table
 * rejects UPDATE and DELETE outright, so what is shown here is what happened.
 */
export default function AuditPage() {
  return (
    <AppShell>
      <Audit />
    </AppShell>
  );
}

function Audit() {
  const reference = useReferenceData();
  const [userId, setUserId] = React.useState('');
  const [objectType, setObjectType] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [page, setPage] = React.useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', userId, objectType, from, page],
    queryFn: () =>
      api.get<{ items: AuditEvent[]; total: number }>('/audit', {
        userId: userId || undefined,
        objectType: objectType || undefined,
        from: from || undefined,
        page,
        pageSize: 50,
      }),
  });

  const items = data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every change to every decision, permanently. Entries cannot be edited or removed."
        actions={
          <>
            <Select aria-label="Person" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }}>
              <option value="">Everyone</option>
              {(reference.data?.people ?? []).map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </Select>
            <Select aria-label="Record type" value={objectType} onChange={(e) => { setObjectType(e.target.value); setPage(1); }}>
              <option value="">All records</option>
              <option value="decision">Decisions</option>
              <option value="action">Actions</option>
              <option value="attachment">Evidence</option>
              <option value="user">Users</option>
              <option value="organisation">Organisation</option>
            </Select>
            <Input
              type="date"
              aria-label="From date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            />
          </>
        }
      />

      <PageBody id="main">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : items.length === 0 ? (
          <EmptyState title="No matching entries" description="Try widening the date or clearing a filter." />
        ) : (
          <>
            <div className="sheet overflow-x-auto">
              <table className="record-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Record</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(event.occurredAt)}
                      </td>
                      <td className="text-ink">{describeEvent(event)}</td>
                      <td>
                        {event.objectType === 'decision' && event.objectId ? (
                          <Link href={`/decisions/detail?id=${event.objectId}`} className="text-blueprint hover:underline">
                            <Reference>{event.objectReference}</Reference>
                          </Link>
                        ) : (
                          <Reference>{event.objectReference ?? humanise(event.objectType)}</Reference>
                        )}
                      </td>
                      <td className="text-ink-muted">
                        {event.oldStatus || event.newStatus
                          ? `${humanise(event.oldStatus ?? 'none')} → ${humanise(event.newStatus ?? 'none')}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-ink-muted">Page {page} of {pageCount}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
