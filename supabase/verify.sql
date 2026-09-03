-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — post-deploy functional smoke test
--
-- Paste this WHOLE file into Supabase dashboard -> SQL Editor -> Run.
-- It ends with a PASS/FAIL table, then a one-line verdict.
--
-- WHY THIS EXISTS
-- The migrations were written without a Postgres to run them against. Static
-- checks can prove the SQL parses and that columns exist; only executing the
-- functions proves the GAME LOGIC is right — that a spin really costs a coin,
-- that an early claim is really refused, that a non-admin really gets 42501.
--
-- HOW IT AUTHENTICATES
-- Supabase's auth.uid() reads the `request.jwt.claims` GUC. This script sets
-- that directly and creates one throwaway auth.users row, so it exercises the
-- SECURITY DEFINER functions exactly as a logged-in player (and then an admin)
-- would — with no GoTrue password and no JWT signing.
--
-- WHAT IT DELIBERATELY DOES *NOT* DO
-- It never executes admin_make_it_rain() or admin_launch_bonus(). Both mutate
-- EVERY user's balance by design, so running them would hand real coins and a
-- real notification to your bootstrap admin and anyone else who has signed up.
-- Their admin-only gate is tested instead (which raises before any write).
-- If you want to see rain work end to end, do it from the admin panel in two
-- browser windows — that is check #7 in DEPLOYMENT.md §7.
--
-- SAFETY
-- The test user is `_smoketest` and is deleted at the end along with its
-- notifications and activities. No real player row is touched. Re-running is
-- safe, including after a failed run.
--
-- IF A CHECK FAILS
-- The `detail` column carries the actual Postgres error text. Send that line
-- back and it is usually enough to pinpoint the fix.
-- ══════════════════════════════════════════════════════════════════════════

create temp table if not exists _smoke (
  n       serial,
  area    text,
  check_  text,
  pass    boolean,
  detail  text
);
truncate _smoke;   -- clear results from any earlier run in this session

-- Result recorder. PL/pgSQL has no nested subprograms (that is PL/SQL), so this
-- lives in pg_temp and is dropped implicitly when the session ends. plpgsql, not
-- sql, so `_smoke` resolves at execution time against the session search_path.
create or replace function pg_temp.rec(
  p_area text, p_check text, p_pass boolean, p_detail text default ''
) returns void language plpgsql as $fn$
begin
  insert into _smoke (area, check_, pass, detail)
  values (p_area, p_check, p_pass, nullif(p_detail, ''));
exception when others then
  -- a bookkeeping failure must never abort the smoke test itself
  null;
end
$fn$;

do $do$
declare
  v_uid        uuid;
  v_username   text;
  v_refcode    text;
  v_spin       jsonb;
  v_obj        jsonb;
  v_before     int;
  v_after      int;
  v_spins_bef  int;
  v_spins_aft  int;
  v_fn_count   int;
  v_rls_count  int;
  v_pol_count  int;
  v_in_pub     boolean;
  v_wheel_n    int;
  v_weight_sum numeric;
  v_other_vis  bigint;
  v_chart_len  int;
  v_err        text;
  v_state      text;
  v_email      constant text := '_smoketest@auth.lisasweeps.internal';
begin

  -- ─────────────────────────────────────────────────────────────────────
  -- 1. Did the migrations land?
  -- ─────────────────────────────────────────────────────────────────────
  select count(*) into v_fn_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';
  perform pg_temp.rec('schema', 'public functions exist (expect ~29)', v_fn_count >= 25,
           v_fn_count || ' found');

  select count(*) into v_rls_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity and c.relkind = 'r';
  perform pg_temp.rec('schema', 'RLS enabled on all 6 tables', v_rls_count = 6,
           v_rls_count || ' of 6 have relrowsecurity = true');

  select count(*) into v_pol_count from pg_policies where schemaname = 'public';
  perform pg_temp.rec('schema', 'RLS policies exist', v_pol_count >= 7, v_pol_count || ' policies');

  select exists(
    select 1 from pg_publication p
      join pg_publication_tables t on t.pubname = p.pubname
     where p.pubname = 'supabase_realtime'
       and t.schemaname = 'public' and t.tablename = 'live_events'
  ) into v_in_pub;
  perform pg_temp.rec('realtime', 'live_events is in the supabase_realtime publication', v_in_pub,
           case when v_in_pub then ''
                else 'make-it-rain will never reach other browsers' end);

  select count(*), coalesce(sum(weight), 0)
    into v_wheel_n, v_weight_sum
    from public.wheel_outcomes where is_active;
  perform pg_temp.rec('seed', '13 active wheel outcomes', v_wheel_n = 13, v_wheel_n || ' rows');
  perform pg_temp.rec('seed', 'wheel weights sum > 0 (the draw normalises them)',
           v_weight_sum > 0, 'sum = ' || v_weight_sum);

  -- ─────────────────────────────────────────────────────────────────────
  -- 2. Throwaway user; the auth trigger must build the profile
  -- ─────────────────────────────────────────────────────────────────────
  delete from auth.users where email = v_email;   -- clear a previous failed run

  begin
    insert into auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', v_email, 'not-a-real-hash',
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"username":"_smoketest"}'::jsonb, now(), now())
    returning id into v_uid;

    perform pg_temp.rec('trigger', 'handle_new_user created the profile row',
             exists(select 1 from public.profiles where id = v_uid), '');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('trigger', 'insert test row into auth.users', false, v_err);
    perform pg_temp.rec('ABORT',   'cannot continue without a test user', false,
             'fix the auth.users insert first; every later check depends on it');
    return;
  end;

  -- Everything below runs as this user.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text,
                     true);

  select username, referral_code into v_username, v_refcode
    from public.profiles where id = v_uid;
  perform pg_temp.rec('trigger', 'username taken from user_metadata',
           v_username = '_smoketest', 'got ' || coalesce(v_username, '<null>'));
  perform pg_temp.rec('trigger', 'referral_code auto-assigned',
           v_refcode is not null and length(v_refcode) > 0, coalesce(v_refcode, '<null>'));

  -- ─────────────────────────────────────────────────────────────────────
  -- 3. Player RPCs
  -- ─────────────────────────────────────────────────────────────────────
  begin
    v_obj := public.coin_status();
    perform pg_temp.rec('game', 'coin_status returns canClaim + secondsLeft',
             jsonb_exists(v_obj, 'canClaim') and jsonb_exists(v_obj, 'secondsLeft'),
             v_obj::text);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('game', 'coin_status()', false, v_err);
  end;

  -- First claim on a brand-new account must succeed and credit exactly 1.
  begin
    select coins into v_before from public.profiles where id = v_uid;
    v_obj := public.claim_coin();
    select coins into v_after from public.profiles where id = v_uid;
    perform pg_temp.rec('game', 'claim_coin credits exactly 1 coin on the first claim',
             v_after = v_before + 1,
             format('coins %s -> %s; returned %s', v_before, v_after, v_obj::text));
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('game', 'claim_coin() first claim', false, v_err);
  end;

  -- An immediate second claim must be REFUSED, not silently credited.
  begin
    v_obj := public.claim_coin();
    perform pg_temp.rec('game', 'claim_coin refuses an early second claim', false,
             'expected an error, got ' || v_obj::text);
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    perform pg_temp.rec('game', 'claim_coin refuses an early second claim',
             v_err = 'COIN_NOT_READY', format('%s (sqlstate %s)', v_err, v_state));
  end;

  -- A ZERO balance must be refused: the 1-coin entry fee would otherwise drive
  -- coins negative, which the profiles CHECK constraint forbids anyway.
  --
  -- Note a balance of exactly 1 IS allowed to spin and ends at 0 — that is the
  -- intended rule (`coins < 1` raises), so an earlier version of this test that
  -- expected a refusal at balance 1 was the bug, not the function.
  update public.profiles set coins = 0 where id = v_uid;

  begin
    v_spin := public.spin_wheel();
    perform pg_temp.rec('game', 'spin_wheel refuses a zero balance', false,
             'expected an error, got ' || v_spin::text);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('game', 'spin_wheel refuses a zero balance',
             v_err = 'INSUFFICIENT_COINS', v_err);
  end;

  -- ...and the refusal must not have charged anything.
  perform pg_temp.rec('game', 'a refused spin does not charge the entry fee',
           (select coins from public.profiles where id = v_uid) = 0,
           'balance is ' || (select coins from public.profiles where id = v_uid));

  -- Fund the account the way an admin would, then spin for real.
  update public.profiles set coins = 50 where id = v_uid;

  begin
    select coins, total_spins into v_before, v_spins_bef
      from public.profiles where id = v_uid;
    v_spin := public.spin_wheel();
    select coins, total_spins into v_after, v_spins_aft
      from public.profiles where id = v_uid;

    perform pg_temp.rec('game', 'spin_wheel returns result + newBalance',
             jsonb_exists(v_spin, 'result') and jsonb_exists(v_spin, 'newBalance'),
             v_spin::text);
    perform pg_temp.rec('game', 'spin_wheel deducted the 1-coin entry fee',
             v_after = v_before - 1,
             format('coins %s -> %s, expected %s', v_before, v_after, v_before - 1));
    perform pg_temp.rec('game', 'spin_wheel incremented total_spins',
             v_spins_aft = v_spins_bef + 1,
             format('total_spins %s -> %s', v_spins_bef, v_spins_aft));
    perform pg_temp.rec('game', 'the drawn prize is a real wheel_outcomes row',
             exists(select 1 from public.wheel_outcomes w
                     where w.id = (v_spin -> 'result' ->> 'id')::int),
             coalesce(v_spin -> 'result' ->> 'label', '<none>'));
    perform pg_temp.rec('game', 'newBalance agrees with the stored balance',
             (v_spin ->> 'newBalance')::int = v_after,
             format('returned %s, stored %s', v_spin ->> 'newBalance', v_after));
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('game', 'spin_wheel() with a funded balance', false, v_err);
  end;

  -- ─────────────────────────────────────────────────────────────────────
  -- 4. Referral guards
  -- ─────────────────────────────────────────────────────────────────────
  begin
    v_obj := public.apply_referral(v_refcode);
    perform pg_temp.rec('referral', 'cannot use your own referral code', false,
             'expected an error, got ' || v_obj::text);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('referral', 'cannot use your own referral code',
             v_err = 'SELF_REFERRAL', v_err);
  end;

  begin
    v_obj := public.apply_referral('zzz-does-not-exist');
    perform pg_temp.rec('referral', 'rejects an unknown referral code', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('referral', 'rejects an unknown referral code',
             v_err = 'INVALID_REFERRAL_CODE', v_err);
  end;

  begin
    v_obj := public.apply_referral('');
    perform pg_temp.rec('referral', 'rejects an empty referral code', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('referral', 'rejects an empty referral code',
             v_err = 'REFERRAL_CODE_REQUIRED', v_err);
  end;

  -- ─────────────────────────────────────────────────────────────────────
  -- 5. Authorization boundary
  -- ─────────────────────────────────────────────────────────────────────
  begin
    perform public.admin_stats();
    perform pg_temp.rec('authz', 'non-admin refused by admin_stats', false,
             'expected ADMIN_REQUIRED — this would be a privilege escalation');
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    perform pg_temp.rec('authz', 'non-admin refused by admin_stats',
             v_err = 'ADMIN_REQUIRED' and v_state = '42501',
             format('%s (sqlstate %s)', v_err, v_state));
  end;

  -- RLS reads: as a plain authenticated user, nobody else's row is visible.
  -- Capture the count while the role is switched, then reset the role BEFORE
  -- recording, because the `authenticated` role cannot write to our temp table.
  begin
    execute 'set local role authenticated';
    select count(*) into v_other_vis from public.profiles where id <> v_uid;
    execute 'reset role';
    perform pg_temp.rec('authz', 'RLS hides every other user''s profile', v_other_vis = 0,
             v_other_vis || ' foreign rows visible');
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin execute 'reset role'; exception when others then null; end;
    perform pg_temp.rec('authz', 'RLS read check', false, v_err);
  end;

  -- Promote, then confirm the admin surface opens up.
  update public.profiles set is_admin = true where id = v_uid;

  begin
    v_obj := public.admin_stats();
    perform pg_temp.rec('admin', 'admin_stats works after promotion',
             jsonb_exists(v_obj, 'totalUsers'), v_obj::text);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'admin_stats()', false, v_err);
  end;

  begin
    v_obj := public.admin_metrics('7d');
    v_chart_len := jsonb_array_length(coalesce(v_obj -> 'dauChart', '[]'::jsonb));
    perform pg_temp.rec('admin', 'admin_metrics builds a 7-point daily chart', v_chart_len = 7,
             'dauChart length = ' || v_chart_len);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'admin_metrics(''7d'')', false, v_err);
  end;

  begin
    v_obj := public.admin_metrics('30d');
    v_chart_len := jsonb_array_length(coalesce(v_obj -> 'dauChart', '[]'::jsonb));
    perform pg_temp.rec('admin', 'admin_metrics honours the requested range (30d)',
             v_chart_len = 30, 'dauChart length = ' || v_chart_len);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'admin_metrics(''30d'')', false, v_err);
  end;

  begin
    v_obj := public.admin_list_users();
    perform pg_temp.rec('admin', 'admin_list_users leaks no password or token column',
             v_obj::text not ilike '%password%' and v_obj::text not ilike '%encrypted%',
             left(v_obj::text, 100));
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'admin_list_users()', false, v_err);
  end;

  -- Validation guards. Each raises BEFORE writing, so these are side-effect free.
  begin
    perform public.admin_adjust_points(v_uid, -5, 'add');
    perform pg_temp.rec('admin', 'adjust_points rejects a negative amount', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'adjust_points rejects a negative amount',
             v_err = 'AMOUNT_MUST_BE_POSITIVE', v_err);
  end;

  begin
    perform public.admin_adjust_points(v_uid, 1.5, 'add');
    perform pg_temp.rec('admin', 'adjust_points rejects a fractional amount', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'adjust_points rejects a fractional amount',
             v_err = 'AMOUNT_MUST_BE_INTEGER', v_err);
  end;

  begin
    perform public.admin_adjust_points(v_uid, 10, 'multiply');
    perform pg_temp.rec('admin', 'adjust_points rejects an unknown type', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'adjust_points rejects an unknown type',
             v_err = 'INVALID_ADJUSTMENT_TYPE', v_err);
  end;

  begin
    perform public.admin_make_it_rain(0);
    perform pg_temp.rec('admin', 'make_it_rain rejects a zero amount', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'make_it_rain rejects a zero amount',
             v_err = 'INVALID_RAIN_AMOUNT', v_err);
  end;

  begin
    perform public.admin_launch_bonus('nonsense', 10, 24, null);
    perform pg_temp.rec('admin', 'launch_bonus rejects an unknown type', false, 'expected an error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform pg_temp.rec('admin', 'launch_bonus rejects an unknown type',
             v_err = 'INVALID_BONUS_TYPE', v_err);
  end;

  -- ─────────────────────────────────────────────────────────────────────
  -- 6. Anonymous calls must be refused
  -- ─────────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '', true);

  begin
    perform public.spin_wheel();
    perform pg_temp.rec('authz', 'anonymous spin_wheel is refused', false,
             'expected NOT_AUTHENTICATED — critical');
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    perform pg_temp.rec('authz', 'anonymous spin_wheel is refused', v_state = '28000',
             format('%s (sqlstate %s)', v_err, v_state));
  end;

  begin
    perform public.coin_status();
    perform pg_temp.rec('authz', 'anonymous coin_status is refused', false, 'expected NOT_AUTHENTICATED');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.rec('authz', 'anonymous coin_status is refused', v_state = '28000',
             'sqlstate ' || v_state);
  end;

  -- ─────────────────────────────────────────────────────────────────────
  -- 7. Cleanup — remove every trace of the test user
  --
  -- activities.user_id is ON DELETE SET NULL (an audit trail should outlive the
  -- account), so the rows this test wrote would SURVIVE the cascade as orphans
  -- carrying username '_smoketest' and pollute the admin activity feed. Delete
  -- them explicitly, before the profile row goes away.
  -- ─────────────────────────────────────────────────────────────────────
  delete from public.activities where username = '_smoketest' or user_id = v_uid;
  delete from auth.users where id = v_uid;   -- cascades to profiles + notifications

  perform pg_temp.rec('cleanup', 'test activities removed from the admin feed',
           not exists(select 1 from public.activities
                       where username = '_smoketest' or user_id = v_uid), '');
  perform pg_temp.rec('cleanup', 'test user and profile deleted',
           not exists(select 1 from auth.users      where id = v_uid)
       and not exists(select 1 from public.profiles where id = v_uid), '');

exception when others then
  get stacked diagnostics v_err = message_text;
  begin
    insert into _smoke (area, check_, pass, detail)
    values ('FATAL', 'smoke test aborted', false, v_err);
  exception when others then null;
  end;
  begin
    execute 'reset role';
    delete from public.activities where username = '_smoketest';
    delete from auth.users where email = '_smoketest@auth.lisasweeps.internal';
  exception when others then null;
  end;
end
$do$;

-- ── Report ────────────────────────────────────────────────────────────────
select case when pass then 'PASS' else 'FAIL' end as result,
       area,
       check_                as "check",
       detail
  from _smoke
 order by n;

select count(*)                             as total,
       count(*) filter (where pass)         as passed,
       count(*) filter (where not pass)     as failed,
       case when count(*) filter (where not pass) = 0
            then 'ALL GREEN — safe to build the APK'
            else 'FAILURES ABOVE — send back the detail column'
       end                                  as verdict
  from _smoke;
