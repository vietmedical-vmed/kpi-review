-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK cho 20260805000000_move_to_app_kpi.sql
-- Đưa 5 object KPI trở lại public và khôi phục 2 hàm về bản cũ.
-- Dùng khi web lỗi sau khi tách. Chạy XONG thì nhớ GỠ "app_kpi" khỏi
-- Exposed schemas và revert src/lib/supabase.js (bỏ db.schema).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) Chuyển bảng + view về public
do $$
declare r text;
begin
  foreach r in array array['kpi_profiles','kpi_periods','evaluations','objectives']
  loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app_kpi' and c.relname = r and c.relkind = 'r'
    ) then
      execute format('alter table app_kpi.%I set schema public', r);
    end if;
  end loop;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_kpi' and c.relname = 'kpi_users' and c.relkind = 'v'
  ) then
    execute 'alter view app_kpi.kpi_users set schema public';
  end if;
end $$;

-- 2) Khôi phục 2 hàm về tham chiếu public.kpi_profiles
create or replace function public.kpi_is_admin()
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (select 1 from public.kpi_profiles
                 where username = public.current_username() and is_admin);
$$;

create or replace function public.kpi_is_manager_of(target text)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (select 1 from public.kpi_profiles
                 where username = target and manager_username = public.current_username());
$$;

commit;

-- Xoá schema rỗng (chỉ chạy được khi app_kpi không còn object nào):
-- drop schema if exists app_kpi restrict;
