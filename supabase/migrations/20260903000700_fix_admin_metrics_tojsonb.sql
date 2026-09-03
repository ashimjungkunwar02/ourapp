-- ══════════════════════════════════════════════════════════════════════════
-- PATCH: recreate admin_metrics() with the to_jsonb() polymorphic fix.
--
-- WHY THIS FILE EXISTS
-- 20260903000400_admin_functions.sql was already applied to live projects when
-- the bug was found, and `supabase db push` never re-runs an applied migration.
-- Editing that file alone would therefore fix fresh installs and leave existing
-- ones broken forever. A function body can only be changed by recreating the
-- function, so this migration does exactly that.
--
-- THE BUG
-- to_jsonb() is declared to_jsonb(anyelement) — polymorphic. Calling it with a
-- bare string literal leaves the argument type UNKNOWN, which a polymorphic
-- parameter cannot resolve, so every call raised:
--
--     ERROR: could not determine polymorphic type because input has type unknown
--
-- Two calls in admin_metrics did this while assembling the `meta.estimated`
-- array. The fix is a plain ::text cast on both literals.
--
-- The body below is byte-identical to the corrected definition in
-- 20260903000400_admin_functions.sql. If you ever change admin_metrics, change
-- it there too — migrations are append-only, so both copies must agree for a
-- fresh install and a patched install to behave the same.
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
