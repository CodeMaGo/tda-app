import { app, type HttpResponseInit } from '@azure/functions';
import { schema as s } from '@tda/db';
import { reportRequestSchema } from '@tda/shared';
import { audit } from '../core/audit.js';
import { withOrg } from '../core/context.js';
import { json, readBody } from '../core/http.js';
import { buildReport } from '../core/report.js';
import { renderReportHtml } from '../core/report-html.js';

/**
 * Latest TDA report (spec §49–56).
 *
 * One model, three renderings. The HTML is the canonical artefact — the PDF is
 * that same HTML through a renderer, so what is archived matches what was
 * reviewed on screen.
 */
app.http('reportGenerate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/tda',
  handler: withOrg({ permissions: ['report:generate'] }, async (ctx): Promise<HttpResponseInit> => {
    const request = await readBody(ctx.request, reportRequestSchema);
    const model = await buildReport(ctx, request);

    await ctx.tx.insert(s.generatedReports).values(
      ctx.scope.own({
        generatedByUserId: ctx.session.userId,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        format: request.format,
        parameters: request as unknown as Record<string, unknown>,
      }),
    );

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'report_generated',
      objectType: 'report',
      details: { period: `${request.periodStart}..${request.periodEnd}`, format: request.format },
    });

    if (request.format === 'csv') {
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tda-report-${request.periodEnd}.csv"`,
        },
        body: toCsv(model),
      };
    }

    const html = renderReportHtml(model);

    if (request.format === 'pdf') {
      const pdf = await renderPdf(html);
      if (pdf) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="tda-report-${request.periodEnd}.pdf"`,
          },
          body: pdf,
        };
      }
      // No renderer configured: hand back the print-ready HTML and let the
      // browser produce the PDF. Saying so beats returning a broken download.
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-TDA-Print-Fallback': 'true' },
        body: html,
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  }),
});

/** The structured model, for the on-screen report view. */
app.http('reportData', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/tda/data',
  handler: withOrg({ permissions: ['report:generate'] }, async (ctx) => {
    const request = await readBody(ctx.request, reportRequestSchema);
    return json(await buildReport(ctx, request));
  }),
});

/* ------------------------------------------------------------------ */

/**
 * HTML to PDF.
 *
 * Headless Chromium is too heavy for a consumption-plan Function, so rendering
 * is delegated to a small container (Azure Container Apps, or Cloudflare's
 * browser rendering API) named by PDF_RENDERER_URL. When it is not configured
 * the caller falls back to printing from the browser.
 */
async function renderPdf(html: string): Promise<Buffer | null> {
  const endpoint = process.env.PDF_RENDERER_URL;
  if (!endpoint) return null;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.PDF_RENDERER_TOKEN
        ? { Authorization: `Bearer ${process.env.PDF_RENDERER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      html,
      options: {
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
      },
    }),
  });

  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

function toCsv(model: Awaited<ReturnType<typeof buildReport>>): string {
  const rows: string[][] = [
    ['Reference', 'Title', 'Status', 'Type', 'Project', 'Owner', 'Authority', 'Required by', 'Decided', 'Open actions', 'Overdue actions'],
  ];

  for (const d of [...model.decisionsTaken, ...model.openDecisions]) {
    rows.push([
      d.reference,
      d.title,
      d.status,
      d.typeName ?? '',
      d.projectCode ?? '',
      d.ownerName ?? '',
      d.authorityName ?? '',
      d.requiredBy ?? '',
      d.decidedAt?.slice(0, 10) ?? '',
      String(d.openActionCount),
      String(d.overdueActionCount),
    ]);
  }

  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

function cell(value: string): string {
  // Guard against a leading =, +, - or @ being read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
