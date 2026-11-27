-- ════════════════════════════════════════════════════════════════════════
-- LUỒNG CHÍNH: NGƯỜI NHẬP UPLOAD → XEM TRƯỚC → NHẬP → N+1/ADMIN DUYỆT → XUẤT
--
-- 1. kpi_profiles.can_upload: admin cấp "quyền nhập" cho một vài user.
--    kpi_can_upload() = admin hoặc có can_upload.
-- 2. Trạng thái rút gọn còn 2 bước: 'submitted' (Chờ duyệt) và 'approved'
--    (Đã duyệt). Phiếu 'draft' / 'reviewed' cũ chuyển về 'submitted'.
-- 3. Phiếu do người nhập (imported_by) tạo, giao cho Người duyệt
--    (manager_username). Quyền:
--      xem : người nhập | người duyệt | quản lý mọi cấp trên người duyệt | admin
--      sửa : người nhập khi CHƯA duyệt (và còn quyền nhập)
--            | người duyệt | admin
--      duyệt / bỏ duyệt: người duyệt | admin
--    Phiếu gắn tài khoản cũ (username not null) giữ quyền như trước, thêm
--    người nhập, và chủ phiếu không sửa được khi đã duyệt.
-- 4. kpi_files: lưu FILE GỐC đã upload (base64) để xuất Excel đúng định dạng
--    và biểu mẫu của file đó, điền số liệu mới nhất.
--    evaluations.source_file_id + source_sheet trỏ tới file/sheet gốc.
--
-- Idempotent, 1 transaction. Rollback: cuối file.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Quyền nhập ───────────────────────────────────────────────────────
alter table app_kpi.kpi_profiles
  add column if not exists can_upload boolean not null default false;

create or replace function public.kpi_can_upload()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.kpi_is_admin() or exists (
    select 1 from app_kpi.kpi_profiles
    where username = public.current_username() and can_upload
  );
$$;
grant execute on function public.kpi_can_upload() to authenticated;

-- ─── 2) File gốc ─────────────────────────────────────────────────────────
create table if not exists app_kpi.kpi_files (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  size_bytes   integer,
  content_b64  text not null,
  uploaded_by  text not null default public.current_username(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_kpi_files_uploaded_by on app_kpi.kpi_files (uploaded_by);
grant select, insert, delete on app_kpi.kpi_files to authenticated;

alter table app_kpi.evaluations
  add column if not exists source_file_id uuid
    references app_kpi.kpi_files (id) on delete set null,
  add column if not exists source_sheet text;
create index if not exists idx_evaluations_source_file on app_kpi.evaluations (source_file_id);
create index if not exists idx_evaluations_imported_by on app_kpi.evaluations (imported_by);

-- ─── 3) Trạng thái rút gọn ───────────────────────────────────────────────
update app_kpi.evaluations set status = 'submitted' where status in ('draft', 'reviewed');

-- ─── 4) Hàm quyền mới (thêm người nhập + trạng thái) ─────────────────────
create or replace function public.kpi_can_view_eval(u text, m text, imp text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.kpi_is_admin()
    or (imp is not null and imp = public.current_username())
    or case
         when u is not null then u = public.current_username() or public.kpi_is_above(u)
         else m = public.current_username() or public.kpi_is_above(m)
       end;
$$;

create or replace function public.kpi_can_edit_eval(u text, m text, imp text, st text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.kpi_is_admin()
    -- Người duyệt: sửa + duyệt / bỏ duyệt
    or (u is null and m = public.current_username())
    or (u is not null and public.kpi_is_manager_of(u))
    -- Người nhập / chủ phiếu: chỉ khi chưa duyệt
    or (st <> 'approved' and (
          (imp is not null and imp = public.current_username() and public.kpi_can_upload())
          or (u is not null and u = public.current_username())));
$$;

grant execute on function public.kpi_can_view_eval(text, text, text) to authenticated;
grant execute on function public.kpi_can_edit_eval(text, text, text, text) to authenticated;

-- ─── 5) Policies evaluations ─────────────────────────────────────────────
drop policy if exists eval_select on app_kpi.evaluations;
create policy eval_select on app_kpi.evaluations
  for select to authenticated
  using (public.kpi_can_view_eval(username, manager_username, imported_by));

drop policy if exists eval_insert on app_kpi.evaluations;
create policy eval_insert on app_kpi.evaluations
  for insert to authenticated with check (
    public.kpi_can_edit_eval(username, manager_username, imported_by, status)
    and ((select public.kpi_is_admin())
         or not exists (select 1 from app_kpi.kpi_periods p
                        where p.period = evaluations.period and not p.is_open))
  );

-- USING xét dòng cũ (người nhập không sửa phiếu đã duyệt),
-- WITH CHECK xét dòng mới (người nhập không tự chuyển sang 'approved').
drop policy if exists eval_update on app_kpi.evaluations;
create policy eval_update on app_kpi.evaluations
  for update to authenticated
  using (public.kpi_can_edit_eval(username, manager_username, imported_by, status))
  with check (public.kpi_can_edit_eval(username, manager_username, imported_by, status));

drop policy if exists eval_delete on app_kpi.evaluations;
create policy eval_delete on app_kpi.evaluations
  for delete to authenticated using (
    (select public.kpi_is_admin())
    or (status <> 'approved' and (
          imported_by = (select public.current_username())
          or (username is null and manager_username = (select public.current_username()))
          or username = (select public.current_username())))
  );

-- ─── 6) Policies objectives ──────────────────────────────────────────────
drop policy if exists obj_select on app_kpi.objectives;
create policy obj_select on app_kpi.objectives
  for select to authenticated using (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_view_eval(e.username, e.manager_username, e.imported_by))
  );

drop policy if exists obj_write on app_kpi.objectives;
create policy obj_write on app_kpi.objectives
  for all to authenticated
  using (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_edit_eval(e.username, e.manager_username, e.imported_by, e.status))
  )
  with check (
    exists (select 1 from app_kpi.evaluations e
            where e.id = objectives.evaluation_id
              and public.kpi_can_edit_eval(e.username, e.manager_username, e.imported_by, e.status))
  );

-- ─── 7) Policies kpi_files ───────────────────────────────────────────────
alter table app_kpi.kpi_files enable row level security;

-- Xem: người upload, admin, hoặc ai xem được 1 phiếu lấy từ file này
-- (subquery chịu RLS của evaluations).
drop policy if exists file_select on app_kpi.kpi_files;
create policy file_select on app_kpi.kpi_files
  for select to authenticated using (
    uploaded_by = (select public.current_username())
    or (select public.kpi_is_admin())
    or exists (select 1 from app_kpi.evaluations e where e.source_file_id = kpi_files.id)
  );

drop policy if exists file_insert on app_kpi.kpi_files;
create policy file_insert on app_kpi.kpi_files
  for insert to authenticated with check (
    uploaded_by = (select public.current_username())
    and (select public.kpi_can_upload())
  );

drop policy if exists file_delete on app_kpi.kpi_files;
create policy file_delete on app_kpi.kpi_files
  for delete to authenticated using (
    uploaded_by = (select public.current_username())
    or (select public.kpi_is_admin())
  );

-- Hàm cũ 2 tham số không còn policy nào dùng
drop function if exists public.kpi_can_view_eval(text, text);
drop function if exists public.kpi_can_edit_eval(text, text);

commit;

-- ─── ROLLBACK (chạy tay nếu cần) ─────────────────────────────────────────
-- Tạo lại kpi_can_view_eval(text,text) / kpi_can_edit_eval(text,text) và
-- policy eval_* / obj_* theo migration 20261120030000, rồi:
-- begin;
-- drop policy if exists file_select on app_kpi.kpi_files;
-- drop policy if exists file_insert on app_kpi.kpi_files;
-- drop policy if exists file_delete on app_kpi.kpi_files;
-- drop function if exists public.kpi_can_view_eval(text, text, text);
-- drop function if exists public.kpi_can_edit_eval(text, text, text, text);
-- alter table app_kpi.evaluations drop column if exists source_file_id, drop column if exists source_sheet;
-- drop table if exists app_kpi.kpi_files;
-- drop function if exists public.kpi_can_upload();
-- alter table app_kpi.kpi_profiles drop column if exists can_upload;
-- commit;
-- (Trạng thái draft/reviewed đã gộp về submitted không khôi phục được.)
