-- ════════════════════════════════════════════════════════════════════════
-- ADMIN CỦA DA = ADMIN KPI
--
-- kpi_is_admin() trước đây chỉ xét app_kpi.kpi_profiles.is_admin — hiện chưa ai
-- được bật nên không ai xem được Báo cáo quản lý / Quản trị. Bổ sung: user có
-- role = 'admin' trong bảng dùng chung shared.users cũng là admin KPI.
-- CREATE OR REPLACE giữ nguyên OID -> các RLS policy đang gọi hàm này giữ nguyên.
-- Rollback: chạy lại định nghĩa cũ ở cuối file.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.kpi_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from app_kpi.kpi_profiles
    where username = public.current_username() and is_admin
  ) or exists (
    select 1 from shared.users
    where username = public.current_username() and role = 'admin'
  );
$$;

-- ─── ROLLBACK (chạy tay nếu cần) ─────────────────────────────────────────
-- create or replace function public.kpi_is_admin()
-- returns boolean language sql security definer stable set search_path = public as $$
--   select exists (select 1 from app_kpi.kpi_profiles
--                  where username = public.current_username() and is_admin);
-- $$;
