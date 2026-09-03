-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — admin logic
-- Replaces backend/routes/admin.js.
--
-- Every function starts with an explicit `is_admin()` check. RLS is bypassed
-- inside SECURITY DEFINER, so this check is the actual authorisation boundary —
-- it is not redundant with the policies.
--
-- NOT HERE: creating users and resetting passwords. Both require provisioning a
-- credential in Supabase Auth, which SQL cannot do. They live in
-- supabase/functions/admin-manage-user (an Edge Function holding the service
-- role key).
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_admin() then
    -- 42501 == insufficient_privilege; Supabase surfaces this as 403.
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ── private helpers (never granted to any role) ─────────────────────────────

-- Percentage change between two windows. Returns 0 when both are zero and 100
-- when growing from a zero baseline, so the UI never renders NaN/Infinity.
create or replace function public._growth_pct(p_current numeric, p_previous numeric)
returns numeric
language sql
immutable
as $$
  select case
           when coalesce(p_previous, 0) = 0 then (case when coalesce(p_current,0) > 0 then 100 else 0 end)
           else round(((p_current - p_previous) / p_previous) * 100, 1)
         end;
$$;

-- Daily bucket series for a chart. generate_series produces exactly `p_days`
-- buckets and the LEFT JOIN fills gaps with 0.
--
-- This is the native fix for the Express bug where buildChart always looped 7
-- times regardless of the requested range, silently discarding all data beyond
-- the first week when range=30d or range=all.
create or replace function public._daily_chart(p_types text[], p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select public.utc_day_start() - (p_days - 1) * interval '1 day' as since,
           public.utc_day_start()                                   as today
  ),
  days as (
    select generate_series(b.since, b.today, interval '1 day')::date as d
      from bounds b
  ),
  counts as (
    select (a.created_at at time zone 'UTC')::date as d,
           count(*)::integer                       as c
      from public.activities a
     where a.type = any (p_types)
       and a.created_at >= (select since from bounds)
     group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(counts.c, 0))
      order by days.d
    ),
    '[]'::jsonb
  )
  from days
  left join counts on counts.d = days.d;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_stats()
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := public.require_admin();
  v_total_users  integer;
  v_active_today integer;
  v_total_spins  bigint;
begin
  select count(*)::integer, coalesce(sum(total_spins), 0)::bigint
    into v_total_users, v_total_spins
    from public.profiles where is_admin = false;

  select count(*)::integer into v_active_today
    from public.profiles
   where is_admin = false
     and last_login >= now() - interval '1 day';

  return jsonb_build_object(
    'totalUsers',  v_total_users,
    'activeToday', v_active_today,
    'totalSpins',  v_total_spins
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_list_users() — passwords/push tokens are not selectable at all
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_list_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_admin();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t))
      from (
        select p.id,
               p.username,
               p.is_admin        as "isAdmin",
               p.coins,
               p.streak,
               p.referral_code   as "referralCode",
               p.referred_by     as "referredBy",
               p.total_spins     as "totalSpins",
               p.bonus_balance   as "bonusBalance",
               p.last_login      as "lastLogin",
               p.last_claim      as "lastClaim",
               p.created_at      as "createdAt",
               (select count(*)::integer from public.profiles r where r.referred_by = p.id) as referrals
          from public.profiles p
         where p.is_admin = false
         order by p.created_at desc
      ) t
  ), '[]'::jsonb);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_adjust_points(p_user_id, p_amount, p_type)
--
-- The Express endpoint accepted negative and NaN amounts, so an admin (or a
-- tampered request) could subtract coins by passing a negative "add". All three
-- conditions are enforced here, and the balance is mutated by a single atomic
-- UPDATE rather than read-modify-write.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_amount  numeric,
  p_type    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.require_admin();
  v_amount   integer;
  v_username text;
  v_balance  integer;
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED' using errcode = '22023';
  end if;

  if p_type is null or p_type not in ('add', 'deduct') then
    raise exception 'INVALID_ADJUSTMENT_TYPE' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;

  if p_amount <> trunc(p_amount) then
    raise exception 'AMOUNT_MUST_BE_INTEGER' using errcode = '22023';
  end if;

  if p_amount > 1000000 then
    raise exception 'AMOUNT_TOO_LARGE' using errcode = '22023';
  end if;

  v_amount := p_amount::integer;

  if p_type = 'add' then
    update public.profiles
       set coins = coins + v_amount
     where id = p_user_id
    returning username, coins into v_username, v_balance;
  else
    -- greatest() clamps at zero inside the same statement, so there is no
    -- window in which a concurrent read could observe a negative balance.
    update public.profiles
       set coins = greatest(0, coins - v_amount)
     where id = p_user_id
    returning username, coins into v_username, v_balance;
  end if;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.activities (user_id, username, type, description, metadata)
  values (
    v_admin,
    public.current_username(),
    'admin',
    format('%s %s coins %s %s',
           case when p_type = 'add' then 'added' else 'deducted' end,
           v_amount,
           case when p_type = 'add' then 'to' else 'from' end,
           v_username),
    jsonb_build_object('action', 'points', 'type', p_type,
                       'amount', v_amount, 'targetUser', p_user_id)
  );

  return jsonb_build_object('newBalance', v_balance);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_make_it_rain(p_amount)
--
-- Rejects NULL and out-of-range amounts at the database level. The Express
-- route's `amount < 1 || amount > 100` let NaN through, which then $inc'd every
-- user's balance by NaN and corrupted the whole collection.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_make_it_rain(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.require_admin();
  v_affected integer;
  v_notified integer;
begin
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'INVALID_RAIN_AMOUNT' using errcode = '22023';
  end if;

  update public.profiles
     set coins = coins + p_amount
   where is_admin = false;

  get diagnostics v_affected = row_count;

  -- Set-based fan-out: one statement instead of N inserts.
  insert into public.notifications (user_id, title, message, type)
  select p.id,
         'It''s Raining Coins!',
         format('Admin made it rain! You received %s free coin%s instantly!',
                p_amount, case when p_amount > 1 then 's' else '' end),
         'rain'
    from public.profiles p
   where p.is_admin = false;

  get diagnostics v_notified = row_count;

  -- Broadcast. Clients subscribed to live_events over Supabase Realtime receive
  -- this INSERT — this is the replacement for io.emit('rain_event').
  insert into public.live_events (kind, payload)
  values ('rain', jsonb_build_object('amount', p_amount));

  insert into public.activities (user_id, username, type, description, metadata)
  values (
    v_admin,
    public.current_username(),
    'rain',
    format('made it rain - distributed %s coins to %s users', p_amount, v_affected),
    jsonb_build_object('action', 'rain', 'amount', p_amount, 'usersAffected', v_affected)
  );

  return jsonb_build_object(
    'message',       'Rain started successfully',
    'usersAffected', v_affected,
    'notified',      v_notified,
    'coinsGiven',    p_amount
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_launch_bonus(...)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_launch_bonus(
  p_type        text,
  p_percentage  numeric,
  p_valid_hours numeric,
  p_message     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin     uuid := public.require_admin();
  v_message   text;
  v_expires   timestamptz;
  v_bonus_id  uuid;
  v_notified  integer := 0;
begin
  if p_type is null or p_type not in ('deposit', 'referral') then
    raise exception 'INVALID_BONUS_TYPE' using errcode = '22023';
  end if;

  if p_percentage is null or p_percentage < 1 or p_percentage > 500 then
    raise exception 'INVALID_BONUS_PERCENTAGE' using errcode = '22023';
  end if;

  if p_valid_hours is null or p_valid_hours <= 0 or p_valid_hours > 8760 then
    raise exception 'INVALID_BONUS_HOURS' using errcode = '22023';
  end if;

  if p_message is not null and char_length(p_message) > 500 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;

  -- Derive copy when the admin leaves it blank. The Mongoose schema required
  -- `message` while the route never validated or defaulted it, so a blank
  -- message failed validation and returned a raw 500.
  v_message := case
    when p_message is not null and btrim(p_message) <> '' then btrim(p_message)
    else format('%s%% %s bonus is live! Valid for %s hours only!',
                p_percentage, p_type, p_valid_hours)
  end;

  v_expires := now() + (p_valid_hours * interval '1 hour');

  insert into public.bonus_programs
    (type, percentage, message, valid_hours, expires_at, created_by)
  values
    (p_type, p_percentage, v_message, p_valid_hours, v_expires, v_admin)
  returning id into v_bonus_id;

  insert into public.notifications (user_id, title, message, type)
  select p.id,
         format('%s%% %s Bonus Activated!',
                p_percentage,
                case when p_type = 'deposit' then 'Deposit' else 'Referral' end),
         v_message,
         'bonus'
    from public.profiles p
   where p.is_admin = false;

  get diagnostics v_notified = row_count;

  update public.bonus_programs
     set users_notified = v_notified
   where id = v_bonus_id;

  insert into public.live_events (kind, payload)
  values ('bonus', jsonb_build_object(
    'type',       p_type,
    'percentage', p_percentage,
    'validHours', p_valid_hours,
    'message',    v_message,
    'expiresAt',  v_expires
  ));

  insert into public.activities (user_id, username, type, description, metadata)
  values (
    v_admin,
    public.current_username(),
    'bonus',
    format('launched %s%% %s bonus valid for %s hours', p_percentage, p_type, p_valid_hours),
    jsonb_build_object('action', 'bonus', 'bonusId', v_bonus_id,
                       'percentage', p_percentage, 'validHours', p_valid_hours)
  );

  return jsonb_build_object(
    'message',       'Bonus launched successfully',
    'bonusId',       v_bonus_id,
    'notifiedUsers', v_notified
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_activities(p_limit)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_activities(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.require_admin();
  v_limit integer;
begin
  -- Clamp so a caller cannot ask for the entire table.
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return coalesce((
    select jsonb_agg(row_to_json(t))
      from (
        select a.id,
               a.user_id     as "userId",
               a.username,
               a.type,
               a.description,
               a.metadata,
               a.created_at  as "createdAt"
          from public.activities a
         order by a.created_at desc
         limit v_limit
      ) t
  ), '[]'::jsonb);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_metrics(p_range)
--
-- Every figure is computed from the database. The Express version returned
-- hardcoded constants (userGrowth 5, activeGrowth 12, spinGrowth 8, fpGrowth 3,
-- bonusRate 85, retentionRate 72) and estimated totalFPPaid as wins * 3.
-- Anything that still cannot be measured exactly is listed in meta.estimated.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_metrics(p_range text default '7d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.require_admin();
  v_days   integer;
  v_since  timestamptz;
  v_prev   timestamptz;
  v_today  timestamptz := public.utc_day_start();

  v_total_users   integer;
  v_active_today  integer;
  v_total_spins   bigint;
  v_online_now    integer;
  v_spins_today   integer;
  v_claimed_today integer;
  v_wins_total    integer;

  v_users_cur  integer;  v_users_prev  integer;
  v_act_cur    integer;  v_act_prev    integer;
  v_spin_cur   integer;  v_spin_prev   integer;
  v_win_cur    integer;  v_win_prev    integer;

  v_bonus_outcomes integer;
  v_cash_outcomes  integer;

  v_fp_paid      numeric;
  v_fp_today     numeric;
  v_fp_measured  integer;

  v_cohort       integer;
  v_returned     integer;

  v_dau_chart    jsonb;
  v_spins_chart  jsonb;
  v_bonus_chart  jsonb;
  v_estimated    jsonb := '[]'::jsonb;
begin
  v_days  := case p_range when '30d' then 30 when 'all' then 90 else 7 end;
  v_since := v_today - (v_days - 1) * interval '1 day';
  v_prev  := v_since - v_days * interval '1 day';

  -- ── Headline counts ───────────────────────────────────────────────────────
  select count(*)::integer, coalesce(sum(total_spins), 0)::bigint
    into v_total_users, v_total_spins
    from public.profiles where is_admin = false;

  select count(*)::integer into v_active_today
    from public.profiles
   where is_admin = false and last_login >= now() - interval '1 day';

  -- "Online now": logged in within the last 5 minutes, matching the old
  -- definition. This is an approximation — there is no socket presence any more.
  select count(*)::integer into v_online_now
    from public.profiles
   where is_admin = false and last_login >= now() - interval '5 minutes';

  select count(*)::integer into v_spins_today
    from public.activities
   where type in ('spin', 'win') and created_at >= v_today;

  select count(*)::integer into v_claimed_today
    from public.activities
   where type = 'claim' and created_at >= v_today;

  select count(*)::integer into v_wins_total
    from public.activities where type = 'win';

  -- ── Current vs previous window, for growth percentages ────────────────────
  select count(*)::integer into v_users_cur
    from public.profiles where is_admin = false and created_at >= v_since;
  select count(*)::integer into v_users_prev
    from public.profiles
   where is_admin = false and created_at >= v_prev and created_at < v_since;

  select count(*)::integer into v_act_cur
    from public.activities
   where type in ('login', 'spin', 'claim') and created_at >= v_since;
  select count(*)::integer into v_act_prev
    from public.activities
   where type in ('login', 'spin', 'claim') and created_at >= v_prev and created_at < v_since;

  select count(*)::integer into v_spin_cur
    from public.activities
   where type in ('spin', 'win') and created_at >= v_since;
  select count(*)::integer into v_spin_prev
    from public.activities
   where type in ('spin', 'win') and created_at >= v_prev and created_at < v_since;

  select count(*)::integer into v_win_cur
    from public.activities where type = 'win' and created_at >= v_since;
  select count(*)::integer into v_win_prev
    from public.activities
   where type = 'win' and created_at >= v_prev and created_at < v_since;

  -- ── Outcome mix (bonus vs cash) ───────────────────────────────────────────
  select count(*)::integer into v_bonus_outcomes
    from public.activities where type = 'spin' and created_at >= v_since;
  select count(*)::integer into v_cash_outcomes
    from public.activities where type = 'win' and created_at >= v_since;

  -- ── Real FP payout, summed from the recorded outcome value ────────────────
  select coalesce(sum((metadata ->> 'value')::numeric), 0)::numeric,
         count(*)::integer
    into v_fp_paid, v_fp_measured
    from public.activities
   where type = 'win' and metadata ? 'value';

  select coalesce(sum((metadata ->> 'value')::numeric), 0)::numeric
    into v_fp_today
    from public.activities
   where type = 'win' and metadata ? 'value' and created_at >= v_today;

  if v_fp_measured < v_wins_total then
    v_estimated := v_estimated || to_jsonb(format(
      'totalFPPaid excludes %s win(s) recorded before outcome values were stored',
      v_wins_total - v_fp_measured));
  end if;

  -- ── Retention: of users old enough to have churned, how many came back? ───
  select count(*)::integer into v_cohort
    from public.profiles
   where is_admin = false and created_at < now() - interval '7 days';

  select count(*)::integer into v_returned
    from public.profiles
   where is_admin = false
     and created_at < now() - interval '7 days'
     and last_login >= now() - interval '7 days';

  -- ── Charts: one bucket per requested day ──────────────────────────────────
  v_dau_chart   := public._daily_chart(array['login','spin','claim'], v_days);
  v_spins_chart := public._daily_chart(array['spin','win'],           v_days);
  v_bonus_chart := public._daily_chart(array['bonus'],                v_days);

  v_estimated := v_estimated || to_jsonb(
    'onlineNow is inferred from last_login within 5 minutes; there is no socket presence'::text)
    || to_jsonb('fpChart is not backed by a per-day FP series'::text);

  return jsonb_build_object(
    'range',             p_range,
    'days',              v_days,
    'totalUsers',        v_total_users,
    'activeToday',       v_active_today,
    'totalSpins',        v_total_spins,
    'onlineNow',         v_online_now,
    'spinsToday',        v_spins_today,
    'coinsClaimedToday', v_claimed_today,
    'totalFPPaid',       v_fp_paid,
    'fpToday',           v_fp_today,
    'fpPayoutRate',      case when v_total_spins > 0
                              then round((v_wins_total::numeric / v_total_spins) * 100, 1)
                              else 0 end,
    'bonusRate',         case when (v_bonus_outcomes + v_cash_outcomes) > 0
                              then round((v_bonus_outcomes::numeric
                                          / (v_bonus_outcomes + v_cash_outcomes)) * 100, 1)
                              else 0 end,
    'retentionRate',     case when v_cohort > 0
                              then round((v_returned::numeric / v_cohort) * 100, 1)
                              else 0 end,
    'userGrowth',        public._growth_pct(v_users_cur, v_users_prev),
    'activeGrowth',      public._growth_pct(v_act_cur,   v_act_prev),
    'spinGrowth',        public._growth_pct(v_spin_cur,  v_spin_prev),
    'fpGrowth',          public._growth_pct(v_win_cur,   v_win_prev),
    'dauChart',          v_dau_chart,
    'spinsChart',        v_spins_chart,
    'bonusChart',        v_bonus_chart,
    'fpChart',           v_spins_chart,
    'meta',              jsonb_build_object(
      'range',       p_range,
      'days',        v_days,
      'generatedAt', now(),
      'estimated',   v_estimated
    )
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.require_admin()                                 from public, anon;
revoke all on function public._growth_pct(numeric, numeric)                    from public, anon, authenticated;
revoke all on function public._daily_chart(text[], integer)                    from public, anon, authenticated;
revoke all on function public.admin_stats()                                    from public, anon;
revoke all on function public.admin_list_users()                               from public, anon;
revoke all on function public.admin_adjust_points(uuid, numeric, text)         from public, anon;
revoke all on function public.admin_make_it_rain(integer)                      from public, anon;
revoke all on function public.admin_launch_bonus(text, numeric, numeric, text) from public, anon;
revoke all on function public.admin_activities(integer)                        from public, anon;
revoke all on function public.admin_metrics(text)                              from public, anon;

grant execute on function public.admin_stats()                                    to authenticated;
grant execute on function public.admin_list_users()                               to authenticated;
grant execute on function public.admin_adjust_points(uuid, numeric, text)         to authenticated;
grant execute on function public.admin_make_it_rain(integer)                      to authenticated;
grant execute on function public.admin_launch_bonus(text, numeric, numeric, text) to authenticated;
grant execute on function public.admin_activities(integer)                        to authenticated;
grant execute on function public.admin_metrics(text)                              to authenticated;
