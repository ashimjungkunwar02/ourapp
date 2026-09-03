-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — Row Level Security
--
-- Replaces backend/middleware/authMiddleware.js (protect / adminOnly) and the
-- per-route ownership checks.
--
-- STRATEGY: clients may READ what they own (or everything, if admin), but may
-- not WRITE directly to any table. Every mutation goes through a SECURITY
-- DEFINER function in the next migrations, which validates, locks the row and
-- writes the audit trail. That matters because:
--
--   * `coins`, `bonus_balance` and `total_spins` are value-bearing. A permissive
--     UPDATE policy would let a player set coins = 999999 with one request.
--   * `notifications.read` was the horizontal-privilege bug in the Express app
--     (findByIdAndUpdate with no owner check). Denying UPDATE and exposing
--     mark_notification_read(id) makes that class of bug unrepresentable.
--   * The spin RNG must never be callable from a client-side write path.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.profiles        enable row level security;
alter table public.activities      enable row level security;
alter table public.notifications   enable row level security;
alter table public.bonus_programs  enable row level security;
alter table public.wheel_outcomes  enable row level security;
alter table public.live_events     enable row level security;

-- ── helpers ─────────────────────────────────────────────────────────────────

-- SECURITY DEFINER + a pinned search_path are both required here:
--   * definer, because reading profiles from inside a policy on profiles would
--     otherwise recurse into the same policy;
--   * pinned search_path, because a definer function that resolves objects via
--     a caller-controllable search_path is an injection vector.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.current_username()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.username from public.profiles p where p.id = auth.uid()),
    'unknown'
  );
$$;

-- Revoke execute from PUBLIC on the definer helpers and grant only what's used.
-- `anon` gets nothing: every helper assumes an authenticated caller.
revoke all on function public.is_admin()         from public;
revoke all on function public.current_username() from public;
grant  execute on function public.is_admin()         to authenticated;
grant  execute on function public.current_username() to authenticated;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

-- Admins may promote/demote other admins and nothing else; everything else is
-- an RPC. Note there is deliberately NO insert/update/delete policy for regular
-- users, so a direct write is rejected even for your own row.
drop policy if exists "profiles: admin may toggle admin flag" on public.profiles;
create policy "profiles: admin may toggle admin flag"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin() and is_admin);

-- ── activities ──────────────────────────────────────────────────────────────
drop policy if exists "activities: read own or admin" on public.activities;
create policy "activities: read own or admin"
  on public.activities for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert policy: activities are written by the RPCs only, so a client cannot
-- forge an audit record (or a fake 'win' that inflates FP-paid metrics).

-- ── notifications ───────────────────────────────────────────────────────────
drop policy if exists "notifications: read own or admin" on public.notifications;
create policy "notifications: read own or admin"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Marking read goes through mark_notification_read(id); no direct UPDATE.

-- ── bonus_programs ──────────────────────────────────────────────────────────
-- Readable by every signed-in player (the app shows active bonuses); writable
-- only through admin_launch_bonus().
drop policy if exists "bonus_programs: authenticated read" on public.bonus_programs;
create policy "bonus_programs: authenticated read"
  on public.bonus_programs for select
  to authenticated
  using (true);

-- ── wheel_outcomes ──────────────────────────────────────────────────────────
-- The client needs the prize list to draw the wheel, so it is readable. It must
-- NOT be writable: changing your own odds is the whole point of server-side RNG.
drop policy if exists "wheel_outcomes: authenticated read" on public.wheel_outcomes;
create policy "wheel_outcomes: authenticated read"
  on public.wheel_outcomes for select
  to authenticated
  using (true);

-- ── live_events ─────────────────────────────────────────────────────────────
-- Everyone signed in receives rain/bonus broadcasts; only the admin RPCs write.
drop policy if exists "live_events: authenticated read" on public.live_events;
create policy "live_events: authenticated read"
  on public.live_events for select
  to authenticated
  using (true);
