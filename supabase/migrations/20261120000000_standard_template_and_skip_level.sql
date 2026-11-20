-- ════════════════════════════════════════════════════════════════════════
-- MẪU EXCEL CHUẨN + QUYỀN XEM CHO QUẢN LÝ CẤP TRÊN (skip-level)
--
-- 1) evaluations: thêm các trường của mẫu "Đăng kí & đánh giá KPI tháng"
--      registration_comment  — "Ý KIẾN CỦA N+1" ở sheet Đăng ký đầu tháng
--      source_file / imported_at / imported_by — dấu vết lần nhập Excel gần nhất
--      final_total (generated) — KẾT QUẢ CUỐI CÙNG = IF(N+1 = 0, N, N+1)
--                               đúng công thức C22 của mẫu.
-- 2) kpi_is_above(target): người đang đăng nhập là quản lý trực tiếp HOẶC
--    gián tiếp (mọi cấp) của target. Chỉ dùng cho quyền XEM (select) để
--    quản lý cấp trên có bức tranh toàn bộ cây tổ chức. Quyền SỬA/CHẤM vẫn
--    chỉ dành cho quản lý trực tiếp (kpi_is_manager_of) như cũ.
--
-- An toàn: chỉ THÊM cột/hàm, sửa 2 policy select. Idempotent, 1 transaction.
-- Rollback: xem cuối file.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Cột mới trên evaluations ─────────────────────────────────────────
alter table app_kpi.evaluations
  add column if not exists registration_comment text,
  add column if not exists source_file          text,
  add column if not exists imported_at          timestamptz,
  add column if not exists imported_by          text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_kpi' and table_name = 'evaluations'
      and column_name = 'final_total'
  ) then
    alter table app_kpi.evaluations
      add column final_total numeric(6, 2)
      generated always as (
        case when coalesce(manager_total, 0) = 0 then self_total
             else manager_total end
      ) stored;
  end if;
end $$;

-- ─── 2) Hàm kiểm tra quản lý mọi cấp (đệ quy, chặn vòng lặp bằng depth) ──
create or replace function public.kpi_is_above(target text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive chain as (
    select p.manager_username, 1 as depth
    from app_kpi.kpi_profiles p
    where p.username = target
    union all
    select p.manager_username, c.depth + 1
    from chain c
    join app_kpi.kpi_profiles p on p.username = c.manager_username
    where c.manager_username is not null and c.depth < 15
  )
  select exists (
    select 1 from chain
    where manager_username = public.current_username()
  );
$$;

grant execute on function public.kpi_is_above(text) to authenticated;

-- ─── 3) Policy SELECT: thêm quyền xem cho quản lý cấp trên ──────────────
drop policy if exists eval_select on app_kpi.evaluations;
create policy eval_select on app_kpi.evaluations
  for select to authenticated using (
    username = (select public.current_username())
    or public.kpi_is_above(username)
    or (select public.kpi_is_admin())
  );

drop policy if exists obj_select on app_kpi.objectives;
create policy obj_select on app_kpi.objectives
  for select to authenticated using (
    exists (
      select 1 from app_kpi.evaluations e
      where e.id = objectives.evaluation_id
        and (e.username = (select public.current_username())
             or public.kpi_is_above(e.username)
             or (select public.kpi_is_admin()))
    )
  );

commit;

-- ─── ROLLBACK (chạy tay nếu cần) ─────────────────────────────────────────
-- begin;
-- drop policy if exists eval_select on app_kpi.evaluations;
-- create policy eval_select on app_kpi.evaluations for select to authenticated using (
--   username = current_username() or kpi_is_manager_of(username) or kpi_is_admin());
-- drop policy if exists obj_select on app_kpi.objectives;
-- create policy obj_select on app_kpi.objectives for select to authenticated using (
--   exists (select 1 from app_kpi.evaluations e where e.id = objectives.evaluation_id
--     and (e.username = current_username() or kpi_is_manager_of(e.username) or kpi_is_admin())));
-- drop function if exists public.kpi_is_above(text);
-- alter table app_kpi.evaluations drop column if exists final_total,
--   drop column if exists registration_comment, drop column if exists source_file,
--   drop column if exists imported_at, drop column if exists imported_by;
-- commit;
