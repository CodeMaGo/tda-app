/**
 * Azure Functions entry point.
 *
 * The v4 programming model registers handlers as a side effect of import, so
 * every route module must be listed here. Missing an import means a silently
 * absent endpoint, which is why they are grouped and commented.
 */
import { app } from '@azure/functions';

// Identity and tenancy
import './functions/session.js';
import './functions/platform.js';
import './functions/administration.js';

// The TDA process
import './functions/decisions.js';
import './functions/decision-workflow.js';
import './functions/attachments.js';
import './functions/actions.js';

// Reading the record
import './functions/search.js';
import './functions/dashboard.js';
import './functions/reports.js';

// Background work
import './functions/scheduled.js';

app.setup({ enableHttpStream: false });

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => ({
    status: 200,
    jsonBody: { status: 'ok', time: new Date().toISOString() },
  }),
});
