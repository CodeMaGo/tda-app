-- ============================================================================
-- TDA Platform — database rules that live below the application.
--
-- Run after `drizzle-kit` migrations. Everything here is idempotent.
--
-- Three concerns:
--   1. Full-text search (spec §38, §63)
--   2. An audit trail that the application cannot rewrite (spec §43)
--   3. Row Level Security as a second, independent tenant boundary (spec §7)
-- ============================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ----------------------------------------------------------------------------
-- 1. Search
-- ----------------------------------------------------------------------------

-- Weighted search vector. Title and reference rank highest, then the framing of
-- the problem, then the reasoning, then free text from comments (denormalised
-- into search_body by the trigger below).
alter table decisions add column if not exists search_body text;

create or replace function decisions_build_search_vector()
returns trigger language plpgsql as $$
begin
  new.search_vector :=
      setweight(to_tsvector('english', coalesce(new.reference, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.problem, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.desired_outcome, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.background, '')), 'C')
    || setweight(to_tsvector('english', coalesce(new.recommendation, '')), 'C')
    || setweight(to_tsvector('english', coalesce(new.recommendation_rationale, '')), 'C')
    || setweight(to_tsvector('english', coalesce(new.decision_text, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.decision_rationale, '')), 'B')
    || setweight(to_tsvector('english', array_to_string(coalesce(new.tags, '{}'), ' ')), 'B')
    || setweight(to_tsvector('english', coalesce(new.search_body, '')), 'D');
  return new;
end;
$$;

drop trigger if exists decisions_search_vector_trigger on decisions;
create trigger decisions_search_vector_trigger
  before insert or update on decisions
  for each row execute function decisions_build_search_vector();

-- Comments and technology names are searchable through the parent decision.
-- Rather than a join at query time, they are folded into search_body.
create or replace function decisions_refresh_search_body(target_decision uuid)
returns void language plpgsql as $$
begin
  update decisions d
     set search_body = (
       select concat_ws(' ',
         (select string_agg(c.body, ' ') from comments c
           where c.decision_id = d.id and c.retracted_at is null),
         (select string_agg(t.name || ' ' || coalesce(t.version, ''), ' ')
            from decision_technologies dt
            join technologies t on t.id = dt.technology_id
           where dt.decision_id = d.id),
         (select string_agg(a.name || ' ' || coalesce(a.description, ''), ' ')
            from alternatives a where a.decision_id = d.id)
       )
     )
   where d.id = target_decision;
end;
$$;

create or replace function decisions_touch_search_body()
returns trigger language plpgsql as $$
declare target uuid;
begin
  target := coalesce(new.decision_id, old.decision_id);
  perform decisions_refresh_search_body(target);
  return coalesce(new, old);
end;
$$;

drop trigger if exists comments_search_sync on comments;
create trigger comments_search_sync
  after insert or update or delete on comments
  for each row execute function decisions_touch_search_body();

drop trigger if exists decision_technologies_search_sync on decision_technologies;
create trigger decision_technologies_search_sync
  after insert or delete on decision_technologies
  for each row execute function decisions_touch_search_body();

drop trigger if exists alternatives_search_sync on alternatives;
create trigger alternatives_search_sync
  after insert or update or delete on alternatives
  for each row execute function decisions_touch_search_body();

-- ----------------------------------------------------------------------------
-- 2. Immutable audit trail
-- ----------------------------------------------------------------------------

create or replace function reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function reject_mutation();

-- Approved decisions cannot be silently edited (spec §65.10). Once `locked_at`
-- is set, only workflow columns may change; content changes must go through
-- Supersede.
create or replace function decisions_guard_locked()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null then
    if (new.title, new.problem, new.background, new.desired_outcome, new.scope,
        new.constraints, new.requirements, new.decision_text, new.decision_rationale)
       is distinct from
       (old.title, old.problem, old.background, old.desired_outcome, old.scope,
        old.constraints, old.requirements, old.decision_text, old.decision_rationale)
    then
      raise exception 'Decision % is locked. Supersede it to record a change.', old.reference
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists decisions_locked_guard on decisions;
create trigger decisions_locked_guard
  before update on decisions
  for each row execute function decisions_guard_locked();

-- Keep updated_at honest.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organisations','users','memberships','teams','projects','technologies',
    'decisions','decision_types','decision_criteria','alternatives','assessments',
    'risks','comments','attachments','actions','information_requests','saved_searches'
  ] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Row Level Security
--
-- The Azure Functions API connects as `tda_app` and sets
--   set_config('app.organisation_id', <org>, true)
--   set_config('app.user_id', <user>, true)
-- inside each transaction. Even if a query forgets its WHERE clause, the
-- database will not return another organisation's rows.
--
-- Supabase's `service_role` bypasses RLS by design, so the API role below is a
-- distinct, non-bypassing role. Create it once:
--
--   create role tda_app login password '...' noinherit;
--   grant usage on schema public to tda_app;
--   grant select, insert, update, delete on all tables in schema public to tda_app;
--   revoke update, delete on audit_events from tda_app;
-- ----------------------------------------------------------------------------

create or replace function current_organisation_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.organisation_id', true), '')::uuid;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'memberships','membership_roles','invitations','teams','team_members',
    'projects','project_members','project_teams','technologies',
    'decision_types','decision_criteria','risk_categories',
    'tda_authorities','authority_projects','authority_decision_types',
    'decisions','decision_contributors','decision_teams','decision_technologies',
    'decision_relationships','decision_conditions','decision_versions',
    'alternatives','assessments','risks','comments','information_requests',
    'attachments','actions','notifications','saved_searches','generated_reports',
    'audit_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (organisation_id = current_organisation_id())
        with check (organisation_id = current_organisation_id())
    $f$, t);
  end loop;
end;
$$;

-- Organisations: a member sees only their own organisation row. Platform
-- administration runs on a separate connection that is exempt.
alter table organisations enable row level security;
alter table organisations force row level security;
drop policy if exists tenant_isolation on organisations;
create policy tenant_isolation on organisations
  using (id = current_organisation_id())
  with check (id = current_organisation_id());

-- Users are global (one person, many organisations), so the policy restricts
-- visibility to people who share an organisation with the caller.
alter table users enable row level security;
alter table users force row level security;
drop policy if exists shared_organisation on users;
create policy shared_organisation on users
  using (
    exists (
      select 1 from memberships m
       where m.user_id = users.id
         and m.organisation_id = current_organisation_id()
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Reporting helpers
-- ----------------------------------------------------------------------------

create or replace view decision_action_counts as
  select
    a.decision_id,
    a.organisation_id,
    count(*) filter (where a.status in ('not_started','in_progress','blocked')) as open_actions,
    count(*) filter (
      where a.status in ('not_started','in_progress','blocked')
        and a.due_date is not null
        and a.due_date < current_date
    ) as overdue_actions
  from actions a
  where a.decision_id is not null
  group by a.decision_id, a.organisation_id;
