-- ════════════════════════════════════════════════════════════════════════
-- PHIẾU KPI CHO NHÂN VIÊN KHÔNG CÓ TÀI KHOẢN
--
-- Nhiều nhân viên không được cấp tài khoản DA; leader upload file Excel hộ.
-- Tên nhân viên lấy từ FILE (ô NHÂN VIÊN / tên file), không bắt buộc khớp
-- shared.users.
--
-- evaluations:
--   username          -> cho phép NULL (phiếu không gắn tài khoản)
--   employee_name     -> họ tên lấy từ file (lưu cho mọi phiếu nhập Excel)
--   employee_key      -> họ tên chuẩn hoá (bỏ dấu, thường) để nhận lại người cũ
--   manager_username  -> N+1 phụ trách phiếu không tài khoản (= người upload)
--   CHECK: có username, HOẶC có employee_key + manager_username
--   UNIQUE (employee_key, manager_username, period) cho phiếu không tài khoản
--
-- Quyền (gom vào 2 hàm để evaluations/objectives dùng chung):
--   kpi_can_view_eval(username, manager_username)
--     có TK : chính mình | quản lý mọi cấp phía trên | admin      (như cũ)
--     không : N+1 phụ trách | quản lý mọi cấp trên N+1 đó | admin
--   kpi_can_edit_eval(username, manager_username)
--     có TK : chính mình | quản lý trực tiếp | admin                (như cũ)
--     không : N+1 phụ trách | admin
--
-- Idempotent, 1 transaction. Rollback: cuối file.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table app_kpi.evaluations alter column username drop not null;

alter table app_kpi.evaluations
  add column if not exists employee_name    text,
  add column if not exists employee_key     text,
  add column if not exists manager_username text
    references shared.users (username) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'evaluations_identity_chk'
                   and conrelid = 'app_kpi.evaluations'::regclass) then
    alter table app_kpi.evaluations
      add constraint evaluations_identity_chk
      check (username is not null
             or (employee_key is not null and manager_username is not null));
  end if;
end $$;

create unique index if not exists uq_eval_noaccount_period
  on app_kpi.evaluations (employee_key, manager_username, period)
  where username is null;

create index if not exists idx_evaluations_manager
  on app_kpi.evaluations (manager_username);

-- ─── Hàm quyền ───────────────────────────────────────────────────────────
create or replace function public.kpi_can_view_eval(u text, m text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when u is not null then
      u = public.current_username() or public.kpi_is_above(u) or public.kpi_is_admin()
    else
      m = public.current_username() or public.kpi_is_above(m) or public.kpi_is_admin()
  end;
$$;

create or replace function public.kpi_can_edit_eval(u text, m text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when u is not null then
      u = public.current_username() or public.kpi_is_manager_of(u) or public.kpi_is_admin()
    else
      m = public.current_username() or public.kpi_is_admin()
  end;
$$;

grant execute on function public.kpi_can_view_eval(text, text) to authenticated;
grant execute on function public.kpi_can_edit_eval(text, text) to authenticated;

-- ─── Policies evaluations ────────────────────────────────────────────────
drop policy if exists eval_select on app_kpi.evaluations;
create policy eval_select on app_kpi.evaluations
  for select to authenticated
  using (public.kpi_can_view_eval(username, manager_username));

drop policy if exists eval_insert on app_kpi.evaluations;
create policy eval_insert on app_kpi.evaluations
  for insert to authenticated with check (
    (select public.kpi_is_admin())
    or (public.kpi_can_edit_eval(username, manager_username)
        and not exists (select 1 from app_kpi.kpi_periods p
                        where p.period = evaluations.period and not p.is_open))
  );

drop policy if exists eval_update on app_kpi.evaluations;
create policy eval_update on app_kpi.evaluations
  for update to authenticated
  using (public.kpi_can_edit_eval(username, manager_username))
  with check (public.kpi_can_edit_eval(username, manager_username));

drop policy if exists eval_delete on app_kpi.evaluations;
create policy eval_delete on app_kpi.evaluations
  for delete to authenticated using (
    (select public.kpi_is_admin())
    or (status = 'draft' and (
          username = (select public.current_username())
          or (username is null and manager_username = (select public.current_username()))))
  );

-- ─── Policies objectives ─────────────────────────────────────────────────
drop policy if exists obj_select on app_kpi.objectives;
create policy obj_select on app_kpi.objectives
  for select to authenticated using (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_view_eval(e.username, e.manager_username))
  );

drop policy if exists obj_write on app_kpi.objectives;
create policy obj_write on app_kpi.objectives
  for all to authenticated
  using (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_edit_eval(e.username, e.manager_username))
  )
  with check (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_edit_eval(e.username, e.manager_username))
  );

commit;

-- ─── ROLLBACK (chạy tay nếu cần; phải xoá phiếu không tài khoản trước) ───
-- begin;
-- delete from app_kpi.evaluations where username is null;
-- (tạo lại policy eval_* / obj_* theo migration 20261120000000 + 20261120010000)
-- drop function if exists public.kpi_can_view_eval(text, text);
-- drop function if exists public.kpi_can_edit_eval(text, text);
-- drop index if exists app_kpi.uq_eval_noaccount_period;
-- drop index if exists app_kpi.idx_evaluations_manager;
-- alter table app_kpi.evaluations drop constraint if exists evaluations_identity_chk,
--   drop column if exists employee_name, drop column if exists employee_key,
--   drop column if exists manager_username;
-- alter table app_kpi.evaluations alter column username set not null;
-- commit;
