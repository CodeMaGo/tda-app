import {
  ACTION_STATUS_LABELS,
  DECISION_STATUS_LABELS,
  type ReportModel,
} from '@tda/shared';

/**
 * The governance report as a self-contained HTML document (spec §49–56).
 *
 * It is set as a printed document rather than a web page: serif body text,
 * repeating table headers across page breaks, a running footer, and A4 margins.
 * The same file is what the PDF renderer consumes, so screen and paper cannot
 * drift apart.
 */
export function renderReportHtml(model: ReportModel): string {
  const {
    organisation,
    period,
    generatedAt,
    generatedBy,
    summary,
    decisionsTaken,
    openDecisions,
    pendingDecisions,
    outstandingActions,
    risks,
    exceptions,
    analytics,
  } = model;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${esc(organisation.name)} — TDA decision report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root {
    --ink: #16222E; --muted: #5A6B7B; --rule: #D3DAE1; --wash: #EEF1F4;
    --blueprint: #1F5FA9; --alert: #A8322B; --warn: #B3711A; --good: #2E6B4F;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); background: #fff;
    font-family: 'IBM Plex Serif', Georgia, serif;
    font-size: 10.5pt; line-height: 1.55;
  }
  h1, h2, h3, th, .meta, .stat, nav { font-family: 'IBM Plex Sans', system-ui, sans-serif; }
  .ref { font-family: 'IBM Plex Mono', monospace; font-size: .92em; white-space: nowrap; }

  /* Cover -------------------------------------------------------- */
  .cover { min-height: 62vh; display: flex; flex-direction: column; justify-content: center;
           border-top: 4px solid var(--blueprint); padding-top: 28px; }
  .cover .org { font-family: 'IBM Plex Sans'; font-size: 13pt; font-weight: 600; letter-spacing: .01em; }
  .cover h1 { font-family: 'IBM Plex Serif'; font-size: 30pt; font-weight: 600;
              line-height: 1.12; margin: 10px 0 0; max-width: 22ch; }
  .cover .period { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--rule);
                   display: flex; gap: 44px; font-family: 'IBM Plex Sans'; font-size: 9.5pt; }
  .cover .period div span { display: block; color: var(--muted); margin-bottom: 2px; }
  .logo { max-height: 42px; margin-bottom: 22px; }

  section { page-break-before: always; padding-top: 4px; }
  section:first-of-type { page-break-before: avoid; }
  h2 { font-size: 14pt; font-weight: 600; margin: 0 0 4px;
       padding-bottom: 6px; border-bottom: 2px solid var(--ink); }
  h2 .count { float: right; font-weight: 400; color: var(--muted); font-size: 10pt; }
  h3 { font-size: 10.5pt; font-weight: 600; margin: 22px 0 6px; }
  p.lead { margin: 14px 0 18px; max-width: 74ch; }

  /* Figures ------------------------------------------------------ */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
           background: var(--rule); border: 1px solid var(--rule); margin: 18px 0 6px; }
  .stat { background: #fff; padding: 12px 14px; }
  .stat b { display: block; font-size: 20pt; font-weight: 600; line-height: 1.1; }
  .stat span { font-size: 8.5pt; color: var(--muted); }
  .stat.alert b { color: var(--alert); }

  /* Tables ------------------------------------------------------- */
  table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-size: 9.5pt; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8.5pt; font-weight: 600; color: var(--muted);
       padding: 7px 8px 6px; border-bottom: 1px solid var(--ink); }
  td { padding: 7px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #FAFBFC; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }

  /* A hairline carries status, instead of a field of coloured pills. */
  td.signal { border-left: 3px solid transparent; padding-left: 9px; }
  .s-alert { border-left-color: var(--alert) !important; }
  .s-warn  { border-left-color: var(--warn) !important; }
  .s-good  { border-left-color: var(--good) !important; }
  .s-open  { border-left-color: var(--blueprint) !important; }
  .overdue { color: var(--alert); font-weight: 600; }
  .muted { color: var(--muted); }

  .bars { margin-top: 8px; }
  .bar { display: grid; grid-template-columns: 16ch 1fr 4ch; gap: 10px;
         align-items: center; font-family: 'IBM Plex Sans'; font-size: 9pt; margin-bottom: 5px; }
  .bar i { display: block; height: 9px; background: var(--blueprint); }
  .bar u { text-decoration: none; text-align: right; color: var(--muted); }

  .empty { padding: 14px; background: var(--wash); color: var(--muted); font-size: 9.5pt; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }

  footer { position: fixed; bottom: -14mm; left: 0; right: 0;
           font-family: 'IBM Plex Sans'; font-size: 8pt; color: var(--muted);
           border-top: 1px solid var(--rule); padding-top: 5px; }
  @media screen {
    body { background: var(--wash); }
    .page { max-width: 210mm; margin: 24px auto; background: #fff;
            padding: 18mm 16mm; box-shadow: 0 1px 3px rgba(22,34,46,.14); }
    footer { position: static; margin-top: 28px; }
  }
  @media print { .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    ${organisation.logoUrl ? `<img class="logo" src="${esc(organisation.logoUrl)}" alt="">` : ''}
    <div class="org">${esc(organisation.name)}</div>
    <h1>Technical Decision Authority decision report</h1>
    <div class="period">
      <div><span>Reporting period</span>${date(period.start)} – ${date(period.end)}</div>
      <div><span>Generated</span>${date(generatedAt)}</div>
      <div><span>Prepared by</span>${esc(generatedBy)}</div>
    </div>
  </div>

  <section>
    <h2>Executive summary</h2>
    <p class="lead">${esc(narrative(summary))}</p>
    <div class="stats">
      ${stat(summary.raised, 'Raised in period')}
      ${stat(summary.completed, 'Completed')}
      ${stat(summary.open, 'Open')}
      ${stat(summary.pending, 'Pending')}
      ${stat(summary.approved, 'Approved')}
      ${stat(summary.approvedWithConditions, 'Approved with conditions')}
      ${stat(summary.rejected, 'Rejected')}
      ${stat(summary.deferred, 'Deferred')}
      ${stat(summary.outstandingActions, 'Outstanding actions')}
      ${stat(summary.overdueActions, 'Overdue actions', summary.overdueActions > 0)}
      ${stat(summary.overdueDecisions, 'Past required date', summary.overdueDecisions > 0)}
      ${stat(
        summary.averageDaysToDecision === null ? '—' : `${summary.averageDaysToDecision}d`,
        'Average time to decide',
      )}
    </div>
  </section>

  <section>
    <h2>Decisions taken<span class="count">${decisionsTaken.length}</span></h2>
    ${
      decisionsTaken.length === 0
        ? `<p class="empty">No decisions were formally recorded in this period.</p>`
        : `<table>
      <thead><tr>
        <th>Reference</th><th>Decision</th><th>Type</th><th>Project</th>
        <th>Decided</th><th>Outcome</th><th>Authority</th>
      </tr></thead>
      <tbody>${decisionsTaken
        .map(
          (d) => `<tr>
          <td class="signal ${outcomeClass(d.status)}"><span class="ref">${esc(d.reference)}</span></td>
          <td>${esc(d.title)}</td>
          <td>${esc(d.typeName ?? '—')}</td>
          <td>${esc(d.projectCode ?? '—')}</td>
          <td>${d.decidedAt ? date(d.decidedAt) : '—'}</td>
          <td>${esc(DECISION_STATUS_LABELS[d.status])}</td>
          <td>${esc(d.authorityName ?? '—')}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`
    }
  </section>

  <section>
    <h2>Open decisions<span class="count">${openDecisions.length}</span></h2>
    ${
      openDecisions.length === 0
        ? `<p class="empty">Nothing is currently open.</p>`
        : `<table>
      <thead><tr>
        <th>Reference</th><th>Decision</th><th>Owner</th><th>Status</th>
        <th>Priority</th><th>Required by</th><th>Authority</th><th class="num">Actions</th>
      </tr></thead>
      <tbody>${openDecisions
        .map((d) => {
          const late = isPast(d.requiredBy);
          return `<tr>
          <td class="signal ${late ? 's-alert' : 's-open'}"><span class="ref">${esc(d.reference)}</span></td>
          <td>${esc(d.title)}</td>
          <td>${esc(d.ownerName ?? '—')}</td>
          <td>${esc(DECISION_STATUS_LABELS[d.status])}</td>
          <td>${cap(d.priority)}</td>
          <td class="${late ? 'overdue' : ''}">${d.requiredBy ? date(d.requiredBy) : '—'}</td>
          <td>${esc(d.authorityName ?? '—')}</td>
          <td class="num">${d.openActionCount || '—'}</td>
        </tr>`;
        })
        .join('')}</tbody></table>`
    }
  </section>

  <section>
    <h2>Pending decisions<span class="count">${pendingDecisions.length}</span></h2>
    <p class="lead">The current decision backlog, grouped by what each decision is waiting on.</p>
    ${
      pendingDecisions.length === 0
        ? `<p class="empty">Nothing is waiting.</p>`
        : `<table>
      <thead><tr><th>Reference</th><th>Decision</th><th>Waiting on</th><th>Owner</th><th>Required by</th></tr></thead>
      <tbody>${pendingDecisions
        .map(
          (d) => `<tr>
          <td class="signal s-warn"><span class="ref">${esc(d.reference)}</span></td>
          <td>${esc(d.title)}</td>
          <td>${esc(d.waitingOn)}</td>
          <td>${esc(d.ownerName ?? '—')}</td>
          <td class="${isPast(d.requiredBy) ? 'overdue' : ''}">${d.requiredBy ? date(d.requiredBy) : '—'}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`
    }
  </section>

  <section>
    <h2>Outstanding actions<span class="count">${outstandingActions.length}</span></h2>
    ${
      outstandingActions.length === 0
        ? `<p class="empty">No actions are outstanding.</p>`
        : `<table>
      <thead><tr><th>Reference</th><th>Action</th><th>Decision</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>${outstandingActions
        .map(
          (a) => `<tr>
          <td class="signal ${a.isOverdue ? 's-alert' : 's-open'}"><span class="ref">${esc(a.reference)}</span></td>
          <td>${esc(a.description)}</td>
          <td><span class="ref">${esc(a.decisionReference ?? '—')}</span></td>
          <td>${esc(a.ownerName ?? a.ownerTeamName ?? 'Unassigned')}</td>
          <td class="${a.isOverdue ? 'overdue' : ''}">${a.dueDate ? date(a.dueDate) : '—'}${a.isOverdue ? ' · overdue' : ''}</td>
          <td>${esc(ACTION_STATUS_LABELS[a.status])}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`
    }
  </section>

  <section>
    <h2>Risks and exceptions</h2>

    <h3>High and critical technical risks</h3>
    ${
      risks.length === 0
        ? `<p class="empty">No high or critical risks are currently open.</p>`
        : `<table>
      <thead><tr><th>Decision</th><th>Risk</th><th>Rating</th><th>Residual</th><th>Mitigation</th><th>Owner</th></tr></thead>
      <tbody>${risks
        .map(
          (r) => `<tr>
          <td class="signal ${r.rating === 'critical' ? 's-alert' : 's-warn'}"><span class="ref">${esc(r.decisionReference)}</span></td>
          <td>${esc(r.summary)}</td>
          <td>${cap(r.rating)}</td>
          <td>${r.residualRating ? cap(r.residualRating) : '<span class="muted">Not assessed</span>'}</td>
          <td>${esc(r.mitigation ?? '—')}</td>
          <td>${esc(r.ownerName ?? '—')}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`
    }

    <h3>Technical exceptions and approved deviations</h3>
    ${
      exceptions.length === 0
        ? `<p class="empty">No technical exceptions are in force.</p>`
        : `<table>
      <thead><tr><th>Reference</th><th>Exception</th><th>Approved</th><th>Authority</th><th>Outstanding conditions</th><th>Next due</th></tr></thead>
      <tbody>${exceptions
        .map(
          (e) => `<tr>
          <td class="signal s-warn"><span class="ref">${esc(e.reference)}</span></td>
          <td>${esc(e.title)}</td>
          <td>${e.decidedAt ? date(e.decidedAt) : '—'}</td>
          <td>${esc(e.authorityName ?? '—')}</td>
          <td>${e.conditions.length === 0 ? '<span class="muted">None</span>' : esc(e.conditions.join('; '))}</td>
          <td class="${isPast(e.expiresOn) ? 'overdue' : ''}">${e.expiresOn ? date(e.expiresOn) : '—'}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`
    }
  </section>

  <section>
    <h2>Analytics</h2>
    <div class="columns">
      <div>${barChart('By decision type', analytics.byType)}${barChart('By outcome', analytics.byOutcome)}</div>
      <div>${barChart('By project', analytics.byProject)}${barChart('By authority', analytics.byAuthority)}</div>
    </div>
    ${barChart('By technology', analytics.byTechnology)}
  </section>

  <footer>
    ${esc(organisation.name)} · Technical Decision Authority report ·
    ${date(period.start)} – ${date(period.end)} ·
    Generated ${date(generatedAt)} by ${esc(generatedBy)}
  </footer>
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

function narrative(summary: ReportModel['summary']): string {
  const parts: string[] = [];
  parts.push(
    `${count(summary.raised, 'decision has', 'decisions have')} been raised during the reporting period.`,
  );
  if (summary.completed > 0) {
    const detail = [
      summary.approved > 0 ? `${summary.approved} approved` : null,
      summary.approvedWithConditions > 0
        ? `${summary.approvedWithConditions} approved with conditions`
        : null,
      summary.rejected > 0 ? `${summary.rejected} rejected` : null,
      summary.deferred > 0 ? `${summary.deferred} deferred` : null,
    ].filter(Boolean);
    parts.push(
      `${summary.completed} reached a formal outcome${detail.length > 0 ? ` — ${detail.join(', ')}` : ''}.`,
    );
  }
  if (summary.open > 0) {
    parts.push(`${summary.open} remain open, of which ${summary.pending} are awaiting someone.`);
  }
  if (summary.overdueDecisions > 0) {
    parts.push(
      `${count(summary.overdueDecisions, 'decision is', 'decisions are')} past the date they were required by.`,
    );
  }
  if (summary.outstandingActions > 0) {
    parts.push(
      `${count(summary.outstandingActions, 'implementation action is', 'implementation actions are')} outstanding${
        summary.overdueActions > 0 ? `, ${summary.overdueActions} of them overdue` : ''
      }.`,
    );
  }
  if (summary.averageDaysToDecision !== null) {
    parts.push(`Decisions took an average of ${summary.averageDaysToDecision} days to reach an outcome.`);
  }
  return parts.join(' ');
}

function barChart(title: string, rows: { label: string; count: number }[]): string {
  if (rows.length === 0) return '';
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<h3>${esc(title)}</h3><div class="bars">${rows
    .map(
      (r) => `<div class="bar">
      <span>${esc(truncate(r.label, 16))}</span>
      <i style="width:${Math.round((r.count / max) * 100)}%"></i>
      <u>${r.count}</u>
    </div>`,
    )
    .join('')}</div>`;
}

const stat = (value: number | string, label: string, alert = false) =>
  `<div class="stat${alert ? ' alert' : ''}"><b>${value}</b><span>${esc(label)}</span></div>`;

function outcomeClass(status: string): string {
  if (status === 'rejected') return 's-alert';
  if (status === 'approved_with_conditions') return 's-warn';
  if (status === 'superseded') return '';
  return 's-good';
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function isPast(value: string | null | undefined): boolean {
  return Boolean(value && value.slice(0, 10) < new Date().toISOString().slice(0, 10));
}

function date(value: string): string {
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const cap = (value: string) => esc(value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

const truncate = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
