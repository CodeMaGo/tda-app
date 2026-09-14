# Technical Decision Authority

A multi-tenant platform for raising, reviewing and recording technical decisions — and for proving afterwards who decided what, on what evidence, and when.

---

## What this is

Organisations make technical decisions constantly, and then lose them. The reasoning lives in a chat thread, the alternatives that were rejected are forgotten, and two years later nobody can say why the database was chosen or who approved the exception. This platform makes the decision itself the record: the problem, the options, the assessment, the risks, the person who held the authority, and the conditions they attached.

It is built around a lifecycle — Identified, Defined, Analysed, Reviewed, Decided, Recorded, Communicated, Implemented, Closed — with an append-only audit trail underneath it.

---

## Stack

| Concern | Choice |
| --- | --- |
| Frontend | Next.js 15 (static export), React 19, TypeScript |
| UI | Tailwind CSS, Radix primitives, IBM Plex |
| Backend | Azure Functions v4 (Node 20, TypeScript) |
| Database | PostgreSQL via Supabase |
| ORM | Drizzle |
| Auth | Supabase Auth (JWT verified in the API) |
| Validation | Zod, shared between client and server |
| Forms | React Hook Form |
| Search | PostgreSQL full-text (`tsvector`, `pg_trgm`) |
| Files | Cloudflare R2, presigned direct upload |
| Email | Resend |
| Background jobs | Azure Functions timer triggers |
| Fonts | IBM Plex, self-hosted via `@fontsource` |
| Hosting | Azure Static Web Apps + Cloudflare |
| CI/CD | GitHub Actions |

---

## Layout

```
tda-platform/
├── packages/
│   ├── shared/     Domain types, permissions, Zod schemas — the contract
│   └── db/         Drizzle schema, migrations, RLS policies, seed data
├── api/            Azure Functions: all server logic
├── web/            Next.js client
└── .github/        CI and deployment
```

`packages/shared` is imported by both `api` and `web`, so the two sides cannot disagree about what a decision is. Changing an enum breaks the build on both ends at once, which is the point.

---

## Getting started

### 1. Prerequisites

- Node 20+
- A Supabase project (Postgres + Auth)
- A Cloudflare R2 bucket
- A Resend account
- Azure Functions Core Tools v4 (`npm i -g azure-functions-core-tools@4`)

### 2. Install

```bash
npm install
npm run build --workspace @tda/shared
npm run build --workspace @tda/db
```

### 3. Create the application database role

Supabase's `service_role` bypasses row-level security by design. Since RLS is one of the two isolation layers here, the API must not use it. Create a role that cannot bypass RLS:

```sql
create role tda_app with login password 'a-strong-password' nobypassrls;
grant usage on schema public to tda_app;
grant select, insert, update, delete on all tables in schema public to tda_app;
grant usage, select on all sequences in schema public to tda_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to tda_app;
alter default privileges in schema public
  grant usage, select on sequences to tda_app;
```

Use that role in `DATABASE_URL`.

Two connection strings, two roles. `tda_app` runs the application and nothing else: it cannot bypass RLS and holds no DDL rights, so it cannot run migrations. Migrations and seeding create schemas, triggers and RLS policies, and write across organisations, so they connect as an owning role — Supabase's `postgres` user, from Project Settings → Database. Keep them apart: an application that can rewrite its own schema is an application whose RLS boundary is advisory.

If either password contains characters that are reserved in URLs (`#`, `/`, `?`, `@`, `:`), percent-encode them — `#` becomes `%23`. An unencoded `#` silently truncates the connection string and surfaces as `Invalid URL`.

### 4. Environment

Copy `api/local.settings.json.example` to `api/local.settings.json` and fill it in:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string using the `tda_app` role |
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_JWT_SECRET` | Legacy HS256 projects only; new projects use JWKS |
| `SUPABASE_SERVICE_ROLE_KEY` | Creating auth users when inviting people |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Evidence storage |
| `RESEND_API_KEY`, `EMAIL_FROM` | Notifications |
| `APP_BASE_URL` | Used in email links |
| `PDF_RENDERER_URL` | Optional; see PDF rendering below |

Then `cp web/.env.local.example web/.env.local` and set the Supabase URL and anon key.

### 5. Migrate and seed

Both scripts read `MIGRATION_DATABASE_URL` from the environment. `api/local.settings.json` is read by the Azure Functions host alone — plain Node scripts never see it — so set the variable in your shell:

```bash
export MIGRATION_DATABASE_URL='postgresql://postgres:...@db.<project>.supabase.co:5432/postgres'
npm run db:migrate
npm run db:seed
```

```powershell
$env:MIGRATION_DATABASE_URL = 'postgresql://postgres:...@db.<project>.supabase.co:5432/postgres'
npm run db:migrate
npm run db:seed
```

The seed creates a worked example — *Acme Engineering Ltd* with seven people, two projects, a technology catalogue, and the decision `TDA-2026-0042` (Cloud Platform Selection) complete with three alternatives, a scored assessment matrix, risks, conditions and actions. It is the fastest way to see what a populated system looks like.

### 6. Run

```bash
npm run dev
```

The web app runs on `:3000` and the Functions host on `:7071`.

---

## Architecture notes

### Tenant isolation, twice

Isolation is enforced in two independent layers, because one layer is a single bug away from a data breach.

**Application layer.** Every query goes through `tenantScope()`, which injects the organisation predicate into `where` clauses and stamps `organisation_id` onto inserts. There is no code path that queries an organisation-owned table without it.

**Database layer.** Every such table has RLS enabled and forced, with a policy keyed on `current_organisation_id()`. Each request opens a transaction, sets `app.organisation_id` with `set_config(..., true)` so it is transaction-scoped, and does its work inside. If the application layer were bypassed entirely, Postgres would still return nothing.

The organisation itself is resolved from the caller's membership rows. The `x-tda-organisation` header only *selects between* organisations the caller already belongs to; sending an organisation you are not a member of is rejected outright.

Cross-tenant access returns **404, never 403**, so IDs cannot be probed for existence.

### Everything in one transaction

A workflow change and its audit record land together or not at all. There is no window in which a decision is approved but the approval is unrecorded.

### The audit trail is append-only

A trigger on `audit_events` rejects `UPDATE` and `DELETE`. Not by convention — by the database refusing.

### Approved decisions are locked

When a decision is approved, `locked_at` is set and a trigger blocks further edits to the recorded fields. Changing your mind means superseding it with a new decision, which preserves the chain.

### Evidence never passes through the API

Uploads are presigned PUTs straight to R2. Keys are always prefixed `org/<organisationId>/…` and validated before signing, so a crafted key cannot reach another tenant's files. Uploads are two-phase: an unconfirmed row is a harmless orphan that the nightly job clears, rather than a confirmed record pointing at a file that never arrived.

### Static export and routing

The web app is a pure static client (`output: 'export'`). This is the robust shape for Azure Static Web Apps, and it keeps all server logic in one place.

The trade-off is real and worth knowing:

- **No server components, no middleware, no SSR.** Auth gating is client-side; the API is the actual enforcement point. That is the correct place for it anyway, but it means a signed-out user briefly sees a loading shell rather than a server redirect.
- **Detail pages use query strings**, not dynamic segments — `/decisions/detail?id=<uuid>` rather than `/decisions/<uuid>`. Static export cannot pre-render unknown dynamic params. Any page reading a query param is wrapped in `<Suspense>`, which Next requires for `useSearchParams` during export.

If you would rather have SSR, this is the decision to revisit before building more screens. It means different hosting — Azure Container Apps or Vercel — and the Functions API would then largely fold into route handlers.

### PDF rendering

Headless Chromium is too heavy for a consumption-plan Function. Set `PDF_RENDERER_URL` to a small rendering service (Azure Container Apps running Puppeteer, or Cloudflare's browser rendering API) and the API will POST the report HTML to it.

Without it, the PDF endpoint returns the same print-ready HTML with an `X-TDA-Print-Fallback` header, and the client opens the browser's print dialogue. Degraded, but never broken.

### Background jobs

Four timer triggers: flagging overdue actions, reminding on actions due within a week, clearing abandoned uploads, and a Monday nudge to authorities with a queue. Each is written as a plain function body, so moving to Inngest when retries and fan-out matter is a wrapper change, not a rewrite.

---

## Design

The interface is deliberately not a SaaS card kit. It reads as an engineering record office.

- **The queue is the hero.** Dashboards open with what is waiting on *you*, not a wall of KPI tiles. Counts appear at the bottom, as context.
- **Status is a hairline, not a pill.** A three-pixel rule at the row edge plus a word. Four tones only, each with a fixed meaning: red needs attention, amber is waiting on someone, green is settled, blue is live work.
- **Fonts are self-hosted.** `next/font/google` downloads at build time, which makes every deploy depend on Google being reachable. `@fontsource` vendors the files into `node_modules` instead, so builds work offline and no third-party request happens on page load.
- **Three typefaces, three jobs.** Plex Sans runs the interface. Plex Serif sets the formal decision record and the report, so the record reads differently from the tooling around it. Plex Mono is reserved for references — `TDA-2026-0042` is data, and monospace says so.
- **Empty states name the next step** rather than apologising for having no data.

---

## Deployment

Set these GitHub secrets:

`AZURE_STATIC_WEB_APPS_API_TOKEN`, `MIGRATION_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

CI only runs migrations, so it takes `MIGRATION_DATABASE_URL` (the owning role) and not `DATABASE_URL`. The API's own `DATABASE_URL`, using `tda_app`, is set in the Azure portal alongside the other runtime settings.

Set the API's runtime settings in the Azure portal under the Static Web App's configuration.

Pushing to `main` runs migrations, then builds and deploys. Pull requests get a preview environment; closing one tears it down.

Point Cloudflare at the Static Web App hostname for DNS and WAF.

---

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Web and API together |
| `npm run typecheck` | Typecheck every workspace |
| `npm run build` | Build every workspace in order |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations and the hand-written SQL |
| `npm run db:seed` | Load the worked example |

---

## Where this is incomplete

Honest status, so nothing surprises you:

- **No tests yet.** The isolation guarantees in particular deserve them — a test that asserts a cross-tenant read returns 404 is worth more than any amount of review.
- **Alternatives and assessments are read-only in the UI.** The API supports full CRUD; the editing screens are not built.
- **Notification preferences** (spec §42) are stored but not yet configurable.
- **Malware scanning** for uploads is stubbed — `scan_status` moves straight to `clean` on confirm. Wire in a real scanner before production.
