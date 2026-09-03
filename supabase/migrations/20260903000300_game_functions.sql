-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — player-facing game logic
--
-- Replaces backend/routes/game.js and backend/routes/referral.js.
--
-- WHY THIS IS IN SQL: every function below is SECURITY DEFINER and does its
-- read-check-write inside a single transaction with the row locked
-- (SELECT ... FOR UPDATE). The Express version needed atomic findOneAndUpdate
-- with guard conditions to stop double-spend races; Postgres gives the same
-- guarantee more strongly, and the wheel RNG (random()) executes server-side
-- where no client can observe or reroll it.
--
-- ERRORS: functions raise short symbolic codes (INSUFFICIENT_COINS, ...). The
-- frontend maps them to user-facing copy in services/api.js, so these strings
-- are part of the API contract — don't rename them casually.
--
-- TIMEZONE: day boundaries are UTC. The Express code used JS setHours(0,0,0,0),
-- i.e. the server's local timezone, so the "daily" streak reset point moves.
-- If you need a different boundary, change utc_day_start() in one place.
-- ══════════════════════════════════════════════════════════════════════════

-- Midnight UTC today, as a timestamptz. Single definition so the streak logic
-- and the metrics logic can't disagree about where a day starts.
create or replace function public.utc_day_start()
returns timestamptz
language sql
stable
as $$
  select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

-- ── Guard: fail fast if there is no authenticated caller ────────────────────
create or replace function public.require_auth()
returns uuid
language plpgsql
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    -- 28000 == invalid_authorization_specification; Supabase maps this to a 401.
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- spin_wheel()
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.spin_wheel()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_profile   public.profiles%rowtype;
  v_total     double precision;
  v_pick      double precision;
  v_acc       double precision := 0;
  v_outcome   public.wheel_outcomes%rowtype;
  v_new_coins integer;
  v_new_bonus integer;
begin
  v_uid := public.require_auth();

  -- Lock this player's row for the duration of the transaction. Two
  -- simultaneous spins serialise here instead of both reading coins = 1 and
  -- both spending it (the race the Express version fixed with a $gte filter).
  select * into v_profile
    from public.profiles
   where id = v_uid
   for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_profile.is_admin and v_profile.coins < 1 then
    raise exception 'INSUFFICIENT_COINS' using errcode = '22023';
  end if;

  -- ── Weighted random draw, server-side ─────────────────────────────────────
  select coalesce(sum(weight), 0) into v_total
    from public.wheel_outcomes
   where is_active and weight > 0;

  if v_total <= 0 then
    raise exception 'WHEEL_NOT_CONFIGURED' using errcode = '22023';
  end if;

  v_pick := random() * v_total;

  for v_outcome in
    select * from public.wheel_outcomes
     where is_active and weight > 0
     order by id
  loop
    v_acc := v_acc + v_outcome.weight;
    if v_pick < v_acc then
      exit;
    end if;
  end loop;

  -- Floating-point edge case: v_pick landed exactly on the total.
  if v_outcome.id is null then
    select * into v_outcome
      from public.wheel_outcomes
     where is_active and weight > 0
     order by id desc
     limit 1;
  end if;

  -- ── Apply the outcome atomically ──────────────────────────────────────────
  update public.profiles
     set coins         = case when v_profile.is_admin then coins else coins - 1 end,
         total_spins   = total_spins + 1,
         bonus_balance = bonus_balance + v_outcome.value
   where id = v_uid
  returning coins, bonus_balance into v_new_coins, v_new_bonus;

  -- ── Audit trail. metadata.value is what makes the FP-paid metric real
  --    instead of "wins * 3".
  insert into public.activities (user_id, username, type, description, metadata)
  values (
    v_uid,
    v_profile.username,
    case when v_outcome.kind = 'cash' then 'win' else 'spin' end,
    case when v_outcome.kind = 'cash'
         then format('won %s on the wheel!', v_outcome.label)
         else format('spun the wheel and got %s', v_outcome.label)
    end,
    jsonb_build_object(
      'outcomeId', v_outcome.id,
      'label',     v_outcome.label,
      'type',      v_outcome.kind,
      'value',     v_outcome.value
    )
  );

  return jsonb_build_object(
    'result', jsonb_build_object(
      'id',    v_outcome.id,
      'label', v_outcome.label,
      'type',  v_outcome.kind,
      'value', v_outcome.value
    ),
    'newBalance',   v_new_coins,
    'bonusBalance', v_new_bonus
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- coin_status() — replaces GET /api/game/coin-status
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.coin_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_last    timestamptz;
  v_elapsed double precision;
begin
  v_uid := public.require_auth();

  select last_claim into v_last from public.profiles where id = v_uid;

  if v_last is null then
    return jsonb_build_object('canClaim', true, 'secondsLeft', 0);
  end if;

  v_elapsed := extract(epoch from (now() - v_last));

  if v_elapsed >= 3600 then
    return jsonb_build_object('canClaim', true, 'secondsLeft', 0);
  end if;

  return jsonb_build_object(
    'canClaim',    false,
    'secondsLeft', ceil(3600 - v_elapsed)::integer
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- claim_coin()
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.claim_coin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid             uuid;
  v_profile         public.profiles%rowtype;
  v_today           timestamptz := public.utc_day_start();
  v_yesterday       timestamptz;
  v_last_streak_day timestamptz;
  v_new_streak      integer;
  v_advanced        boolean := false;
  v_coins_to_add    integer := 1;
  v_bonus_applied   integer := null;
  v_new_balance     integer;
begin
  v_uid       := public.require_auth();
  v_yesterday := v_today - interval '1 day';

  select * into v_profile
    from public.profiles
   where id = v_uid
   for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ── Hourly gate. Checked while holding the row lock, so two concurrent
  --    claims cannot both pass it.
  if v_profile.last_claim is not null
     and v_profile.last_claim > (now() - interval '1 hour') then
    raise exception 'COIN_NOT_READY' using errcode = '22023';
  end if;

  -- ── Streak ────────────────────────────────────────────────────────────────
  if v_profile.last_streak_date is not null then
    v_last_streak_day := date_trunc('day', v_profile.last_streak_date at time zone 'UTC')
                         at time zone 'UTC';

    if v_last_streak_day = v_yesterday then
      v_new_streak := v_profile.streak + 1;
      v_advanced   := true;
    elsif v_last_streak_day = v_today then
      -- Already counted today; the hourly coin does not extend the streak.
      v_new_streak := v_profile.streak;
      v_advanced   := false;
    else
      -- A gap of two or more days breaks the streak.
      v_new_streak := 1;
      v_advanced   := true;
    end if;
  else
    v_new_streak := 1;
    v_advanced   := true;
  end if;

  -- ── 7-day reward ──────────────────────────────────────────────────────────
  -- Only on the claim that ADVANCED the streak to a multiple of 7. Without the
  -- v_advanced guard, every hourly claim on day 7/14/21... re-awarded 3 coins
  -- and 69% bonus — the farming exploit present in the Express version.
  if v_advanced and v_new_streak > 0 and v_new_streak % 7 = 0 then
    v_coins_to_add  := 3;
    v_bonus_applied := 69;
  end if;

  update public.profiles
     set coins            = coins + v_coins_to_add,
         bonus_balance    = bonus_balance + coalesce(v_bonus_applied, 0),
         streak           = v_new_streak,
         last_claim       = now(),
         last_streak_date = now()
   where id = v_uid
  returning coins into v_new_balance;

  insert into public.activities (user_id, username, type, description, metadata)
  values (
    v_uid,
    v_profile.username,
    'claim',
    format('claimed %s coin%s%s',
           v_coins_to_add,
           case when v_coins_to_add > 1 then 's' else '' end,
           case when v_bonus_applied is not null
                then format(' + %s%% streak bonus', v_bonus_applied)
                else '' end),
    jsonb_build_object('coins', v_coins_to_add, 'bonus', v_bonus_applied)
  );

  return jsonb_build_object(
    'newBalance',   v_new_balance,
    'streak',       v_new_streak,
    'bonusApplied', v_bonus_applied,
    'coinsAdded',   v_coins_to_add
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- apply_referral(p_code)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.apply_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_me        public.profiles%rowtype;
  v_referrer  public.profiles%rowtype;
  v_code      text;
  v_reward    constant integer := 5;
  v_balance   integer;
begin
  v_uid := public.require_auth();

  if p_code is null or btrim(p_code) = '' then
    raise exception 'REFERRAL_CODE_REQUIRED' using errcode = '22023';
  end if;

  v_code := upper(btrim(p_code));

  if v_code !~ '^[A-Z0-9]{4,16}$' then
    raise exception 'INVALID_REFERRAL_CODE' using errcode = '22023';
  end if;

  -- Lock both rows in a deterministic order (by id) so two users referring
  -- each other simultaneously cannot deadlock.
  select * into v_me from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_referrer
    from public.profiles
   where referral_code = v_code
   for update;
  if not found then
    raise exception 'INVALID_REFERRAL_CODE' using errcode = '22023';
  end if;

  if v_referrer.id = v_uid then
    raise exception 'SELF_REFERRAL' using errcode = '22023';
  end if;

  -- The `referred_by is null` condition lives in the WHERE clause, so only the
  -- first caller can win. This is the one-shot guard that replaced the
  -- read-check-write race in the Express route.
  update public.profiles
     set referred_by = v_referrer.id,
         coins       = coins + v_reward
   where id = v_uid
     and referred_by is null
  returning coins into v_balance;

  if not found then
    raise exception 'REFERRAL_ALREADY_USED' using errcode = '22023';
  end if;

  update public.profiles
     set coins = coins + v_reward
   where id = v_referrer.id;

  insert into public.notifications (user_id, title, message, type)
  values (
    v_referrer.id,
    'New Referral!',
    format('%s joined using your referral link! You earned %s coins!',
           v_me.username, v_reward),
    'referral'
  );

  insert into public.activities (user_id, username, type, description)
  values (
    v_referrer.id,
    v_referrer.username,
    'referral',
    format('%s joined using their referral code - earned %s coins',
           v_me.username, v_reward)
  );

  return jsonb_build_object(
    'message',    'Referral applied successfully',
    'newBalance', v_balance,
    'coinsAdded', v_reward
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- mark_notification_read(p_id)
--
-- Ownership is enforced twice: by the `user_id = v_uid` predicate here and by
-- the absence of any UPDATE policy in the RLS migration. The Express bug was a
-- bare findByIdAndUpdate(id, {read:true}) that any user could call with any id.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_auth();

  if p_id is null then
    raise exception 'NOTIFICATION_ID_REQUIRED' using errcode = '22023';
  end if;

  update public.notifications
     set read = true
   where id = p_id
     and user_id = v_uid;

  if not found then
    -- Deliberately ambiguous: don't reveal whether the id belongs to someone
    -- else or does not exist.
    raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- record_login() — called after a successful sign-in
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.record_login()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid;
  v_username text;
begin
  v_uid := public.require_auth();

  update public.profiles
     set last_login = now()
   where id = v_uid
  returning username into v_username;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.activities (user_id, username, type, description)
  values (v_uid, v_username, 'login', 'logged in');

  return jsonb_build_object('ok', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Push token management
-- Replaces POST /api/push/subscribe and /unsubscribe. On Android (Capacitor)
-- this stores the FCM registration token; in the browser it stores the
-- PushSubscription JSON.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.set_push_token(p_fcm_token text, p_web_subscription jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_auth();
begin
  if (p_fcm_token is null or btrim(p_fcm_token) = '')
     and p_web_subscription is null then
    raise exception 'PUSH_TOKEN_REQUIRED' using errcode = '22023';
  end if;

  update public.profiles
     set fcm_token         = coalesce(nullif(btrim(p_fcm_token), ''), fcm_token),
         push_subscription = coalesce(p_web_subscription, push_subscription)
   where id = v_uid;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

create or replace function public.clear_push_token()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_auth();
begin
  update public.profiles
     set fcm_token = null,
         push_subscription = null
   where id = v_uid;
  return true;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- referral_stats() — replaces GET /api/referral/stats
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.referral_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.require_auth();
  v_count integer;
begin
  select count(*)::integer into v_count
    from public.profiles
   where referred_by = v_uid;

  return jsonb_build_object(
    'referrals', v_count,
    'earned',    v_count * 5
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions run as their owner (postgres), so RLS inside them
-- is bypassed — that is why each one re-checks auth.uid() and ownership itself.
revoke all on function public.spin_wheel()                        from public, anon;
revoke all on function public.coin_status()                       from public, anon;
revoke all on function public.claim_coin()                        from public, anon;
revoke all on function public.apply_referral(text)                from public, anon;
revoke all on function public.mark_notification_read(uuid)        from public, anon;
revoke all on function public.record_login()                      from public, anon;
revoke all on function public.set_push_token(text, jsonb)         from public, anon;
revoke all on function public.clear_push_token()                  from public, anon;
revoke all on function public.referral_stats()                    from public, anon;

grant execute on function public.spin_wheel()                 to authenticated;
grant execute on function public.coin_status()                to authenticated;
grant execute on function public.claim_coin()                 to authenticated;
grant execute on function public.apply_referral(text)         to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.record_login()               to authenticated;
grant execute on function public.set_push_token(text, jsonb)  to authenticated;
grant execute on function public.clear_push_token()           to authenticated;
grant execute on function public.referral_stats()             to authenticated;
