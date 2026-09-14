'use client';

import type { DecisionStatus, DecisionSignificance, Priority, RiskLevel } from '@tda/shared';
import {
  DECISION_SIGNIFICANCES,
  DECISION_STATUSES,
  DECISION_STATUS_LABELS,
  PRIORITIES,
  SIGNIFICANCE_LABELS,
} from '@tda/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { useSession } from '@/components/session-provider';
import {
  Button,
  CheckboxGroup,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/controls';
import {
  DECISION_TONE,
  DecisionStatusLabel,
  DueDate,
  Reference,
  SignalCell,
  SignificanceGauge,
  StatusLabel,
  riskTone,
} from '@/components/ui/signals';
import { api } from '@/lib/api';
import { daysUntil, formatDate, humanise } from '@/lib/format';
import { toOptions, useReferenceData } from '@/lib/reference-data';

interface SearchResult {
  items: {
    id: string;
    reference: string;
    title: string;
    status: DecisionStatus;
    significance: DecisionSignificance;
    priority: Priority;
    requiredBy: string | null;
    decidedAt: string | null;
    createdAt: string;
    typeName: string | null;
    projectName: string | null;
    projectCode: string | null;
    ownerName: string | null;
    authorityName: string | null;
    openActionCount: number;
    overdueActionCount: number;
    highestRiskRating: RiskLevel | null;
  }[];
  page: number;
  pageSize: number;
  total: number;
}

interface Filters {
  text: string;
  statuses: string[];
  significances: string[];
  priorities: string[];
  ownerIds: string[];
  authorityIds: string[];
  projectIds: string[];
  typeIds: string[];
  technologyIds: string[];
  requiredTo: string;
  hasOverdueActions: boolean;
  sort: string;
  direction: string;
}

const EMPTY: Filters = {
  text: '',
  statuses: [],
  significances: [],
  priorities: [],
  ownerIds: [],
  authorityIds: [],
  projectIds: [],
  typeIds: [],
  technologyIds: [],
  requiredTo: '',
  hasOverdueActions: false,
  sort: 'created_at',
  direction: 'desc',
};

export default function DecisionsPage() {
  return (
    <AppShell>
      <React.Suspense fallback={<PageBody><Skeleton className="h-96 w-full" /></PageBody>}>
        <DecisionRegister />
      </React.Suspense>
    </AppShell>
  );
}

function DecisionRegister() {
  const { session, can } = useSession();
  const params = useSearchParams();
  const reference = useReferenceData();

  const [filters, setFilters] = React.useState<Filters>(() => ({
    ...EMPTY,
    // Arriving from "your open decisions" on the dashboard should keep that meaning.
    ownerIds: params.get('mine') === 'true' && session ? [session.userId] : [],
    statuses: params.get('status') ? [params.get('status')!] : [],
  }));
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);

  // The text box updates as you type; the query waits until you stop.
  const [textInput, setTextInput] = React.useState(filters.text);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, text: textInput }));
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [textInput]);

  const query = useQuery({
    queryKey: ['decisions', filters, page],
    queryFn: () =>
      api.get<SearchResult>('/decisions', {
        text: filters.text || undefined,
        statuses: filters.statuses,
        significances: filters.significances,
        priorities: filters.priorities,
        ownerIds: filters.ownerIds,
        authorityIds: filters.authorityIds,
        projectIds: filters.projectIds,
        typeIds: filters.typeIds,
        technologyIds: filters.technologyIds,
        requiredTo: filters.requiredTo || undefined,
        hasOverdueActions: filters.hasOverdueActions || undefined,
        sort: filters.sort,
        direction: filters.direction,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const activeCount =
    filters.statuses.length +
    filters.significances.length +
    filters.priorities.length +
    filters.ownerIds.length +
    filters.authorityIds.length +
    filters.projectIds.length +
    filters.typeIds.length +
    filters.technologyIds.length +
    (filters.requiredTo ? 1 : 0) +
    (filters.hasOverdueActions ? 1 : 0);

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <PageHeader
        title="Decision register"
        description="Every technical decision this organisation has raised, in one place."
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
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="Search titles, problems, decisions and discussion…"
              aria-label="Search decisions"
              className="pl-9"
            />
          </div>
          <Button
            variant={showFilters || activeCount > 0 ? 'primary' : 'secondary'}
            onClick={() => setShowFilters((open) => !open)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
          {activeCount > 0 ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({ ...EMPTY, text: filters.text });
                setPage(1);
              }}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
          <Select
            className="w-auto"
            aria-label="Sort by"
            value={`${filters.sort}:${filters.direction}`}
            onChange={(event) => {
              const [sort, direction] = event.target.value.split(':');
              setFilters((current) => ({ ...current, sort: sort!, direction: direction! }));
            }}
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="required_by:asc">Required soonest</option>
            <option value="priority:desc">Highest priority</option>
            <option value="decided_at:desc">Recently decided</option>
            <option value="reference:asc">By reference</option>
            {filters.text ? <option value="relevance:desc">Best match</option> : null}
          </Select>
        </div>

        {showFilters ? (
          <div className="sheet mb-5 grid gap-6 p-5 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Status">
              <CheckboxGroup
                columns={1}
                value={filters.statuses}
                onChange={(value) => update('statuses', value)}
                options={DECISION_STATUSES.map((status) => ({
                  value: status,
                  label: DECISION_STATUS_LABELS[status],
                }))}
              />
            </Field>
            <div className="space-y-6">
              <Field label="Significance">
                <CheckboxGroup
                  columns={1}
                  value={filters.significances}
                  onChange={(value) => update('significances', value)}
                  options={DECISION_SIGNIFICANCES.map((level) => ({
                    value: level,
                    label: SIGNIFICANCE_LABELS[level],
                  }))}
                />
              </Field>
              <Field label="Priority">
                <CheckboxGroup
                  columns={2}
                  value={filters.priorities}
                  onChange={(value) => update('priorities', value)}
                  options={PRIORITIES.map((priority) => ({
                    value: priority,
                    label: humanise(priority),
                  }))}
                />
              </Field>
            </div>
            <div className="space-y-6">
              <Field label="Project">
                <CheckboxGroup
                  columns={1}
                  value={filters.projectIds}
                  onChange={(value) => update('projectIds', value)}
                  options={toOptions(reference.data?.projects, (p) => p.code)}
                  emptyMessage="No projects set up yet."
                />
              </Field>
              <Field label="Decision type">
                <CheckboxGroup
                  columns={1}
                  value={filters.typeIds}
                  onChange={(value) => update('typeIds', value)}
                  options={toOptions(reference.data?.types)}
                />
              </Field>
            </div>
            <Field label="Owner">
              <CheckboxGroup
                columns={1}
                value={filters.ownerIds}
                onChange={(value) => update('ownerIds', value)}
                options={toOptions(reference.data?.people)}
              />
            </Field>
            <Field label="TDA authority">
              <CheckboxGroup
                columns={1}
                value={filters.authorityIds}
                onChange={(value) => update('authorityIds', value)}
                options={(reference.data?.authorities ?? []).map((authority) => ({
                  value: authority.userId,
                  label: authority.name,
                  hint: authority.title ?? undefined,
                }))}
              />
            </Field>
            <div className="space-y-5">
              <Field label="Required before" htmlFor="required-to">
                <Input
                  id="required-to"
                  type="date"
                  value={filters.requiredTo}
                  onChange={(event) => update('requiredTo', event.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-blueprint"
                  checked={filters.hasOverdueActions}
                  onChange={(event) => update('hasOverdueActions', event.target.checked)}
                />
                Only decisions with overdue actions
              </label>
            </div>
          </div>
        ) : null}

        <p className="mb-2 text-sm text-ink-muted" aria-live="polite">
          {query.isLoading
            ? 'Searching…'
            : total === 0
              ? 'No matches'
              : `${total} decision${total === 1 ? '' : 's'}`}
        </p>

        {query.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : total === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try removing a filter, or search for a reference such as TDA-2026-0042."
            action={
              activeCount > 0 ? (
                <Button variant="secondary" onClick={() => setFilters({ ...EMPTY })}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="sheet overflow-x-auto">
              <table className="record-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Status</th>
                    <th scope="col">Significance</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Authority</th>
                    <th scope="col">Required by</th>
                    <th scope="col">Risk</th>
                    <th scope="col" className="text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data!.items.map((decision) => (
                    <tr key={decision.id}>
                      <SignalCell tone={DECISION_TONE[decision.status]}>
                        <Reference>{decision.reference}</Reference>
                      </SignalCell>
                      <td>
                        <Link
                          href={`/decisions/detail?id=${decision.id}`}
                          className="font-medium text-ink hover:text-blueprint"
                        >
                          {decision.title}
                        </Link>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {[decision.typeName, decision.projectCode].filter(Boolean).join(' · ') ||
                            'No type'}
                        </span>
                      </td>
                      <td>
                        <DecisionStatusLabel status={decision.status} />
                        {decision.decidedAt ? (
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {formatDate(decision.decidedAt)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <SignificanceGauge significance={decision.significance} />
                      </td>
                      <td className="text-ink-muted">{decision.ownerName ?? '—'}</td>
                      <td className="text-ink-muted">{decision.authorityName ?? '—'}</td>
                      <td>
                        <DueDate
                          date={decision.requiredBy}
                          daysLeft={daysUntil(decision.requiredBy)}
                        />
                      </td>
                      <td>
                        {decision.highestRiskRating ? (
                          <StatusLabel tone={riskTone(decision.highestRiskRating)}>
                            {humanise(decision.highestRiskRating)}
                          </StatusLabel>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {decision.openActionCount === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <span
                            className={
                              decision.overdueActionCount > 0 ? 'font-medium text-alert' : 'text-ink'
                            }
                          >
                            {decision.openActionCount}
                            {decision.overdueActionCount > 0
                              ? ` · ${decision.overdueActionCount} late`
                              : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-ink-muted">
                  Page {page} of {pageCount}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => p + 1)}
                  >
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
