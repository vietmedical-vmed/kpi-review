-- ════════════════════════════════════════════════════════════════════════
-- PILOT TÁCH SCHEMA — chuyển toàn bộ bảng riêng của app KPI sang schema app_kpi
--
-- Vì sao: DB đang gộp nhiều app trong public. 5 object KPI dưới đây HOÀN TOÀN
-- cô lập (không app nào khác đọc/ghi) nên tách được an toàn tuyệt đối.
--
-- Giữ Ở LẠI public (dùng chung): users (login + FK), và các hàm helper
-- current_username / kpi_is_admin / kpi_is_manager_of / touch_updated_at
-- (giữ nguyên OID để RLS policy không phải tạo lại).
--
-- An toàn:
--   • FK trỏ public.users, RLS policy, trigger, index đều theo OID → tự đi
--     theo bảng khi ALTER ... SET SCHEMA, KHÔNG gãy.
--   • Dữ liệu KHÔNG bị đụng (chỉ đổi "địa chỉ" schema của bảng).
--   • Chạy trong 1 transaction: lỗi giữa chừng thì rollback sạch.
--   • Có guard idempotent: chạy lại nhiều lần vô hại.
--
-- Áp dụng: dán toàn bộ file vào SQL Editor (dashboard) và Run.
--          SAU ĐÓ: Settings → API → Exposed schemas → thêm "app_kpi" → Save.
--          RỒI: đổi src/lib/supabase.js (db.schema='app_kpi') và redeploy web.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Tạo schema + cấp USAGE ───────────────────────────────────────────
create schema if not exists app_kpi;
grant usage on schema app_kpi to anon, authenticated, service_role;

-- ─── 2) Chuyển 4 bảng sang app_kpi (idempotent, chỉ move nếu còn ở public)─
--     Grant trên bảng, RLS policy, trigger, FK, index đi theo bảng.
do $$
declare r text;
begin
  foreach r in array array['kpi_profiles','kpi_periods','evaluations','objectives']
  loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = r and c.relkind = 'r'
    ) then
      execute format('alter table public.%I set schema app_kpi', r);
      raise notice 'moved table public.% -> app_kpi.%', r, r;
    end if;
  end loop;
end $$;

-- ─── 3) Chuyển view kpi_users (đọc public.users — cross-schema, hợp lệ) ───
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'kpi_users' and c.relkind = 'v'
  ) then
    execute 'alter view public.kpi_users set schema app_kpi';
    raise notice 'moved view public.kpi_users -> app_kpi.kpi_users';
  end if;
end $$;

-- ─── 4) Sửa 2 hàm tham chiếu kpi_profiles → app_kpi.kpi_profiles ──────────
--     CREATE OR REPLACE giữ NGUYÊN OID → mọi RLS policy đang gọi 2 hàm này
--     tiếp tục hợp lệ, KHÔNG cần tạo lại policy.
create or replace function public.kpi_is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from app_kpi.kpi_profiles
    where username = public.current_username() and is_admin
  );
$$;

create or replace function public.kpi_is_manager_of(target text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from app_kpi.kpi_profiles
    where username = target and manager_username = public.current_username()
  );
$$;

-- ─── 5) Default privileges cho object TẠO MỚI sau này trong app_kpi ───────
alter default privileges in schema app_kpi
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema app_kpi
  grant usage, select on sequences to anon, authenticated, service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI CHẠY (chạy riêng từng SELECT, không nằm trong transaction)
-- ════════════════════════════════════════════════════════════════════════
-- (a) 5 object đã sang app_kpi, public sạch bảng kpi:
--   select n.nspname, c.relname, c.relkind
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where c.relname in ('kpi_profiles','kpi_periods','evaluations','objectives','kpi_users')
--   order by 1,2;
--
-- (b) RLS policy vẫn còn nguyên trên bảng đã move:
--   select schemaname, tablename, policyname from pg_policies
--   where schemaname='app_kpi' order by tablename, policyname;
--
-- (c) Hàm helper đọc đúng bảng mới (phải trả về true/false, không lỗi):
--   select public.kpi_is_admin();
--
-- (d) Đếm dữ liệu còn nguyên:
--   select (select count(*) from app_kpi.evaluations)  as evals,
--          (select count(*) from app_kpi.objectives)   as objs,
--          (select count(*) from app_kpi.kpi_profiles) as profiles,
--          (select count(*) from app_kpi.kpi_periods)  as periods;
