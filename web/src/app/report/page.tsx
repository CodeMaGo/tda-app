'use client';

import type { ReportModel } from '@tda/shared';
import { useMutation } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';
import * as React from 'react';
import { AppShell, PageBody, PageHeader } from '@/components/app-shell';
import { Button, Callout, Field, Input, Skeleton } from '@/components/ui/controls';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * The report screen (spec §49–57).
 *
 * The on-screen view and the printed document are built from the same model:
 * the browser renders it from JSON, and print or PDF fetches the server-rendered
 * HTML. Figures cannot disagree between the screen and the paper.
 */
export default function ReportPage() {
  return (
    <AppShell>
      <Report />
    </AppShell>
  );
}

function Report() {
  const toast = useToast();
  const [period, setPeriod] = React.useState(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  });
  const [model, setModel] = React.useState<ReportModel | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      api.post<ReportModel>('/reports/tda/data', {
        periodStart: period.start,
        periodEnd: period.end,
        format: 'html',
        projectIds: [],
        decisionTypeIds: [],
      }),
    onSuccess: setModel,
    onError: (error) =>
      toast.problem(
        'Report could not be built',
        error instanceof ApiError ? error.message : 'Try again.',
      ),
  });

  const exportAs = useMutation({
    mutationFn: async (format: 'pdf' | 'csv' | 'html') => {
      const response = await api.raw('/reports/tda', {
        method: 'POST',
        body: { periodStart: period.start, periodEnd: period.end, format, projectIds: [], decisionTypeIds: [] },
      });

      if (format === 'pdf' && response.headers.get('X-TDA-Print-Fallback') === 'true') {
        // No PDF renderer is configured, so hand the print-ready document to the
        // browser and let it produce the file.
        const html = await response.text();
        const printWindow = window.open('', '_blank');
        printWindow?.document.write(html);
        printWindow?.document.close();
        printWindow?.addEventListener('load', () => printWindow.print());
        return 'printed' as const;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tda-report-${period.end}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      return 'downloaded' as const;
    },
    onError: (error) =>
      toast.problem('Export failed', error instanceof ApiError ? error.message : 'Try again.'),
  });

  React.useEffect(() => {
    generate.mutate();
    // Generate once on arrival with the default three-month window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="Latest TDA report"
        description="Built fresh from the register every time. Nothing here is cached."
        actions={
          <>
            <Button
              variant="secondary"
              loading={exportAs.isPending && exportAs.variables === 'csv'}
              onClick={() => exportAs.mutate('csv')}
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="secondary"
              loading={exportAs.isPending && exportAs.variables === 'pdf'}
              onClick={() => exportAs.mutate('pdf')}
            >
              <FileText className="h-4 w-4" />
              PDF
            </Button>
            <Button variant="primary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </>
        }
      />

      <PageBody id="main">
        <div className="no-print sheet mb-6 flex flex-wrap items-end gap-4 p-4">
          <Field label="From" htmlFor="from" className="w-44">
            <Input
              id="from"
              type="date"
              value={period.start}
              onChange={(event) => setPeriod((p) => ({ ...p, start: event.target.value }))}
            />
          </Field>
          <Field label="To" htmlFor="to" className="w-44">
            <Input
              id="to"
              type="date"
              value={period.end}
              onChange={(event) => setPeriod((p) => ({ ...p, end: event.target.value }))}
            />
          </Field>
          <Button variant="secondary" loading={generate.isPending} onClick={() => generate.mutate()}>
            Rebuild
          </Button>
        </div>

        {generate.isPending && !model ? <Skeleton className="h-96 w-full" /> : null}

        {model ? (
          <article className="sheet p-8 lg:p-10">
            <header className="border-t-[3px] border-blueprint pb-6 pt-5">
              <p className="text-sm font-semibold text-ink">{model.organisation.name}</p>
              <h2 className="mt-1 font-serif text-3xl font-semibold leading-tight text-ink">
                Technical Decision Authority decision report
              </h2>
              <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-2 border-t border-rule pt-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">Reporting period</dt>
                  <dd>
                    {formatDate(model.period.start)} – {formatDate(model.period.end)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Generated</dt>
                  <dd>{formatDate(model.generatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Prepared by</dt>
                  <dd>{model.generatedBy}</dd>
                </div>
              </dl>
            </header>

            <Section title="Executive summary">
              <p className="max-w-prose font-serif leading-relaxed text-ink">
                {narrative(model.summary)}
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
                <Figure label="Raised" value={model.summary.raised} />
                <Figure label="Completed" value={model.summary.completed} />
                <Figure label="Open" value={model.summary.open} />
                <Figure label="Pending" value={model.summary.pending} />
                <Figure label="Approved" value={model.summary.approved} />
                <Figure
                  label="With conditions"
                  value={model.summary.approvedWithConditions}
                />
                <Figure label="Rejected" value={model.summary.rejected} />
                <Figure label="Deferred" value={model.summary.deferred} />
                <Figure label="Outstanding actions" value={model.summary.outstandingActions} />
                <Figure
                  label="Overdue actions"
                  value={model.summary.overdueActions}
                  alert={model.summary.overdueActions > 0}
                />
                <Figure
                  label="Past required date"
                  value={model.summary.overdueDecisions}
                  alert={model.summary.overdueDecisions > 0}
                />
                <Figure
                  label="Avg days to decide"
                  value={model.summary.averageDaysToDecision ?? '—'}
                />
              </dl>
            </Section>

            <Section title="Decisions taken" count={model.decisionsTaken.length}>
              <SimpleTable
                headers={['Reference', 'Decision', 'Type', 'Project', 'Decided', 'Authority']}
                rows={model.decisionsTaken.map((d) => [
                  d.reference,
                  d.title,
                  d.typeName ?? '—',
                  d.projectCode ?? '—',
                  formatDate(d.decidedAt),
                  d.authorityName ?? '—',
                ])}
                empty="No decisions were formally recorded in this period."
              />
            </Section>

            <Section title="Open decisions" count={model.openDecisions.length}>
              <SimpleTable
                headers={['Reference', 'Decision', 'Owner', 'Required by', 'Authority']}
                rows={model.openDecisions.map((d) => [
                  d.reference,
                  d.title,
                  d.ownerName ?? '—',
                  formatDate(d.requiredBy),
                  d.authorityName ?? '—',
                ])}
                empty="Nothing is currently open."
              />
            </Section>

            <Section title="Outstanding actions" count={model.outstandingActions.length}>
              <SimpleTable
                headers={['Reference', 'Action', 'Decision', 'Owner', 'Due']}
                rows={model.outstandingActions.map((a) => [
                  a.reference,
                  a.description,
                  a.decisionReference ?? '—',
                  a.ownerName ?? a.ownerTeamName ?? 'Unassigned',
                  formatDate(a.dueDate),
                ])}
                empty="No actions are outstanding."
              />
            </Section>

            <Section title="Risks and exceptions">
              <h4 className="mb-2 mt-4 text-sm font-semibold">High and critical risks</h4>
              <SimpleTable
                headers={['Decision', 'Risk', 'Rating', 'Mitigation', 'Owner']}
                rows={model.risks.map((r) => [
                  r.decisionReference,
                  r.summary,
                  r.rating,
                  r.mitigation ?? '—',
                  r.ownerName ?? '—',
                ])}
                empty="No high or critical risks are currently open."
              />

              <h4 className="mb-2 mt-6 text-sm font-semibold">Technical exceptions in force</h4>
              <SimpleTable
                headers={['Reference', 'Exception', 'Approved', 'Outstanding conditions']}
                rows={model.exceptions.map((e) => [
                  e.reference,
                  e.title,
                  formatDate(e.decidedAt),
                  e.conditions.length === 0 ? 'None' : e.conditions.join('; '),
                ])}
                empty="No technical exceptions are in force."
              />
            </Section>

            <Section title="Analytics">
              <div className="grid gap-8 sm:grid-cols-2">
                <Bars title="By decision type" rows={model.analytics.byType} />
                <Bars title="By outcome" rows={model.analytics.byOutcome} />
                <Bars title="By project" rows={model.analytics.byProject} />
                <Bars title="By authority" rows={model.analytics.byAuthority} />
              </div>
            </Section>
          </article>
        ) : null}

        {!generate.isPending && !model ? (
          <Callout tone="alert">The report could not be built for that period.</Callout>
        ) : null}
      </PageBody>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 break-inside-avoid">
      <div className="rule-heading mb-4">
        <h3 className="font-serif text-lg font-semibold">{title}</h3>
        {count !== undefined ? <span className="text-sm text-ink-muted">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  alert,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div className="bg-paper px-4 py-3">
      <dd
        className={`font-serif text-2xl font-semibold leading-none ${alert ? 'text-alert' : 'text-ink'}`}
      >
        {value}
      </dd>
      <dt className="mt-1.5 text-xs text-ink-muted">{label}</dt>
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="bg-wash px-4 py-3 text-sm text-ink-muted">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="record-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cellIndex === 0 ? 'font-mono text-xs' : ''}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-ink">{title}</h4>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[10rem_1fr_2rem] items-center gap-3 text-sm">
            <span className="truncate text-ink-muted">{row.label}</span>
            <span className="h-2.5 bg-rule">
              <span
                className="block h-2.5 bg-blueprint"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="text-right text-ink-muted">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function narrative(summary: ReportModel['summary']): string {
  const parts = [
    `${summary.raised} decision${summary.raised === 1 ? ' has' : 's have'} been raised during the reporting period.`,
  ];
  if (summary.completed > 0) parts.push(`${summary.completed} reached a formal outcome.`);
  if (summary.open > 0) {
    parts.push(`${summary.open} remain open, of which ${summary.pending} are awaiting someone.`);
  }
  if (summary.overdueActions > 0) {
    parts.push(`${summary.overdueActions} implementation action${summary.overdueActions === 1 ? ' is' : 's are'} overdue.`);
  }
  if (summary.averageDaysToDecision !== null) {
    parts.push(`Decisions took an average of ${summary.averageDaysToDecision} days to reach an outcome.`);
  }
  return parts.join(' ');
}
