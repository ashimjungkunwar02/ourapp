-- ══════════════════════════════════════════════════════════════════════════
-- Lisa Sweeps — seed data
--
-- The prize table used to be duplicated in two places that could drift:
--   backend/utils/wheelLogic.js   (authoritative, used for the actual draw)
--   frontend/src/utils/wheelConfig.js (display only, 24 segments)
-- It is now a single source of truth in Postgres. The frontend reads it via
-- get_wheel_outcomes() and builds its display wheel around it.
--
-- `weight` values are the ORIGINAL relative weights from wheelLogic.js. That
-- code normalised them to sum to 1 at load time (their raw sum is 0.9793);
-- spin_wheel() normalises at draw time, so the odds are identical.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.wheel_outcomes (id, label, kind, value, weight, is_active, display_order) values
  (1,  '$3 FP',      'cash',  3,   0.004,  true, 1),
  (2,  '$5 FP',      'cash',  5,   0.002,  true, 2),
  (3,  '$7 FP',      'cash',  7,   0.0002, true, 3),
  (4,  '$10 FP',     'cash',  10,  0.0001, true, 4),
  (5,  '20% Bonus',  'bonus', 20,  0.30,   true, 5),
  (6,  '15% Bonus',  'bonus', 15,  0.50,   true, 6),
  (7,  '25% Bonus',  'bonus', 25,  0.10,   true, 7),
  (8,  '30% Bonus',  'bonus', 30,  0.05,   true, 8),
  (9,  '40% Bonus',  'bonus', 40,  0.01,   true, 9),
  (10, '50% Bonus',  'bonus', 50,  0.007,  true, 10),
  (11, '69% Bonus',  'bonus', 69,  0.003,  true, 11),
  (12, '90% Bonus',  'bonus', 90,  0.002,  true, 12),
  (13, '100% Bonus', 'bonus', 100, 0.001,  true, 13)
on conflict (id) do nothing;

-- ── Public read accessor ────────────────────────────────────────────────────
-- The RLS policy already allows authenticated reads, but a function keeps the
-- column names stable for the client and lets us cache the shape.
create or replace function public.get_wheel_outcomes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_auth();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t))
      from (
        select w.id,
               w.label,
               w.kind          as type,
               w.value,
               w.weight,
               w.display_order as "displayOrder"
          from public.wheel_outcomes w
         where w.is_active
         order by w.display_order, w.id
      ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_wheel_outcomes() from public, anon;
grant execute on function public.get_wheel_outcomes() to authenticated;
