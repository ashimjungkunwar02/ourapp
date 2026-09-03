-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — Realtime
--
-- Replaces Socket.io (backend/server.js io.on('connection')) and therefore also
-- removes the socket-authentication surface entirely: there is no client-chosen
-- room to hijack, and RLS on live_events decides who receives what.
--
-- Clients subscribe with:
--   supabase.channel('live')
--     .on('postgres_changes',
--         { event: 'INSERT', schema: 'public', table: 'live_events' },
--         ({ newRow }) => { ... })
--     .subscribe()
-- ══════════════════════════════════════════════════════════════════════════

-- The publication always exists on a Supabase project, but create it defensively
-- so this migration also applies to a self-hosted or freshly-init'd database.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end
$$;

-- ADD TABLE errors if the table is already a member, so check first. Migrations
-- must be re-runnable without breaking.
do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname   = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'live_events'
  ) then
    alter publication supabase_realtime add table public.live_events;
  end if;
end
$$;

-- ── Housekeeping ────────────────────────────────────────────────────────────
-- live_events is an append-only broadcast log; it grows with every rain/bonus.
-- Keep 7 days. Schedule this with pg_cron (enable the extension in the
-- dashboard) or call it from a Supabase Edge Function on a timer:
--
--   select cron.schedule('prune-live-events', '0 4 * * *',
--                        $$select public.prune_live_events()$$);
create or replace function public.prune_live_events(p_keep_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.live_events
   where created_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 7), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_live_events(integer) from public, anon, authenticated;
-- Only the service role / a pg_cron job (which runs as postgres) may prune.
grant execute on function public.prune_live_events(integer) to service_role;
