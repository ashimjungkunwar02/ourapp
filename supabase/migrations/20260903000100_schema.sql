-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — schema
-- Replaces the Mongoose models (User, Activity, Notification, BonusProgram).
--
-- Design notes carried over from the Express/Mongo bug-fix pass:
--   * Passwords are NOT stored here. Supabase Auth owns credentials, so the
--     bcrypt hashing and the JWT signing/verification code are both gone.
--   * `username` is normalised to lower-case by a trigger, which fixes the
--     case-mismatch login bug at the database level rather than in app code.
--   * Every "type" column uses a CHECK constraint that includes 'rain' — the
--     enum omission that made admin rain silently drop notifications.
--   * Numeric columns that represent value carry CHECK constraints (>= 0), so
--     a NaN/negative write that used to corrupt balances now fails loudly.
--   * bonus_programs.message has a DEFAULT, not NOT NULL-without-default, so
--     launching a bonus without custom copy works.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per auth.users row. `id` IS the auth user id (no separate surrogate),
-- which is what lets RLS policies be written as `id = auth.uid()`.
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text not null,
  is_admin          boolean not null default false,
  coins             integer not null default 0,
  streak            integer not null default 0,
  last_claim        timestamptz,
  last_streak_date  timestamptz,
  last_login        timestamptz,
  referral_code     text not null,
  referred_by       uuid references public.profiles (id) on delete set null,
  total_spins       integer not null default 0,
  bonus_balance     integer not null default 0,
  -- Android/iOS push via FCM (Capacitor). Replaces the web-push subscription.
  fcm_token         text,
  -- Browser web-push subscription, kept for the PWA build.
  push_subscription jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Balances can never go negative. The Express version relied on application
  -- code (Math.max / $gte filters) to enforce this; the database enforces it now.
  constraint profiles_coins_non_negative       check (coins >= 0),
  constraint profiles_streak_non_negative      check (streak >= 0),
  constraint profiles_total_spins_non_negative check (total_spins >= 0),
  constraint profiles_bonus_non_negative       check (bonus_balance >= 0),
  -- A user cannot be their own referrer (previously checked in route code).
  constraint profiles_no_self_referral         check (referred_by is null or referred_by <> id)
);

-- Case-insensitive uniqueness without needing citext: the trigger lower-cases
-- on write, so a plain unique index on the stored value is sufficient.
create unique index if not exists profiles_username_key
  on public.profiles (username);
create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code);
create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by);
create index if not exists profiles_last_login_idx
  on public.profiles (last_login desc);
create index if not exists profiles_is_admin_idx
  on public.profiles (is_admin);

-- ── wheel_outcomes ──────────────────────────────────────────────────────────
-- The prize table was hardcoded in backend/utils/wheelLogic.js and duplicated
-- in frontend/src/utils/wheelConfig.js, so the two could drift. It is data now,
-- which also lets an admin retune probabilities without a deploy.
create table if not exists public.wheel_outcomes (
  id            integer primary key,
  label         text not null,
  -- 'cash' pays FP, 'bonus' adds a percentage. Matches the old `type` field.
  kind          text not null check (kind in ('cash', 'bonus')),
  value         integer not null check (value >= 0),
  -- Relative weight, NOT a probability. Normalised at spin time so an admin can
  -- change one row without rebalancing all the others to sum to 1.
  weight        double precision not null check (weight >= 0),
  is_active     boolean not null default true,
  display_order integer not null default 0
);

-- ── activities ──────────────────────────────────────────────────────────────
create table if not exists public.activities (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  username    text not null default 'unknown',
  type        text not null check (
    type in ('spin', 'claim', 'login', 'bonus', 'referral', 'win', 'rain', 'admin')
  ),
  description text not null default '',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activities_created_at_idx
  on public.activities (created_at desc);
create index if not exists activities_type_created_idx
  on public.activities (type, created_at desc);
create index if not exists activities_user_idx
  on public.activities (user_id, created_at desc);

-- ── notifications ───────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  message    text not null default '',
  type       text not null default 'system' check (
    type in ('bonus', 'referral', 'rain', 'system')
  ),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where (read = false);

-- ── bonus_programs ──────────────────────────────────────────────────────────
create table if not exists public.bonus_programs (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('deposit', 'referral')),
  percentage     numeric not null check (percentage >= 1 and percentage <= 500),
  -- Has a default on purpose: the Mongoose schema declared this `required`
  -- while the route never validated it, so a blank message 500'd the launch.
  message        text not null default '' check (char_length(message) <= 500),
  valid_hours    numeric not null check (valid_hours > 0),
  expires_at     timestamptz not null,
  created_by     uuid references public.profiles (id) on delete set null,
  is_active      boolean not null default true,
  users_notified integer not null default 0 check (users_notified >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists bonus_programs_active_idx
  on public.bonus_programs (is_active, expires_at desc);

-- ── live_events ─────────────────────────────────────────────────────────────
-- Replaces the Socket.io broadcasts ('rain_event', 'bonus_notification').
-- An admin action inserts a row; every client subscribed to this table via
-- Supabase Realtime receives it as a Postgres Changes INSERT.
--
-- This also removes the socket-authentication problem entirely: there is no
-- client-chosen room to hijack, and RLS decides who sees which rows.
create table if not exists public.live_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('rain', 'bonus')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists live_events_created_at_idx
  on public.live_events (created_at desc);

-- ── triggers ────────────────────────────────────────────────────────────────

-- Lower-case + trim usernames on every write. The login bug came from creating
-- accounts in one case and querying in another; normalising in the database
-- makes that impossible regardless of which client writes the row.
create or replace function public.tg_normalize_username()
returns trigger
language plpgsql
as $$
begin
  new.username := lower(btrim(new.username));
  if new.username = '' then
    raise exception 'USERNAME_REQUIRED' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_normalize_username on public.profiles;
create trigger profiles_normalize_username
  before insert or update of username on public.profiles
  for each row execute function public.tg_normalize_username();

-- Generate a unique 8-character alphanumeric referral code, retrying on the
-- (rare) collision. Mirrors the old `Math.random().toString(36).slice(2,10)`.
create or replace function public.tg_assign_referral_code()
returns trigger
language plpgsql
as $$
declare
  v_candidate text;
  v_attempt   integer := 0;
begin
  if new.referral_code is null or btrim(new.referral_code) = '' then
    loop
      v_attempt := v_attempt + 1;
      if v_attempt > 20 then
        raise exception 'REFERRAL_CODE_COLLISION' using errcode = '23505';
      end if;
      -- md5 gives hex; translate a-f onto G-L so the code spans 0-9A-L,
      -- then take 8 characters and upper-case them.
      v_candidate := upper(
        translate(substr(md5(random()::text || clock_timestamp()::text), 1, 8),
                  'abcdef', 'GHIJKL')
      );
      if not exists (select 1 from public.profiles p where p.referral_code = v_candidate) then
        new.referral_code := v_candidate;
        exit;
      end if;
    end loop;
  else
    new.referral_code := upper(btrim(new.referral_code));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_referral_code on public.profiles;
create trigger profiles_assign_referral_code
  before insert on public.profiles
  for each row execute function public.tg_assign_referral_code();

-- Keep updated_at honest.
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists bonus_programs_touch on public.bonus_programs;
create trigger bonus_programs_touch
  before update on public.bonus_programs
  for each row execute function public.tg_touch_updated_at();

-- Create the profile row automatically when someone signs up through Supabase
-- Auth. SECURITY DEFINER so it can write despite the deny-all insert policy
-- below; search_path is pinned to avoid a search-path injection.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(btrim(split_part(new.email, '@', 1)), ''),
    'player'
  );

  -- Email local-parts can collide across providers; disambiguate if needed.
  if exists (select 1 from public.profiles p where p.username = lower(v_username)) then
    v_username := v_username || substr(md5(new.id::text), 1, 4);
  end if;

  insert into public.profiles (id, username)
  values (new.id, v_username)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
