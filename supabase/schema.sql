-- =============================================================
--  SCHEMA — Ứng dụng đánh giá KPI hàng tháng
--
--  Toàn bộ bảng riêng của app nằm trong schema app_kpi (đã tách khỏi public
--  để tách bạch với các app khác trong cùng project). DÙNG CHUNG bảng
--  public.users sẵn có của DA project (login + khoá ngoại).
--  Đăng nhập qua Edge Function (verify sha256) → cấp JWT có claim "username".
--  Chạy toàn bộ file này trong Supabase: SQL Editor > New query
--
--  LƯU Ý: sau khi chạy, thêm "app_kpi" vào Settings → API → Exposed schemas
--  thì web (anon/authenticated) mới đọc được.
-- =============================================================

-- ---------- 0a. SCHEMA RIÊNG CHO APP ----------
create schema if not exists app_kpi;
grant usage on schema app_kpi to anon, authenticated, service_role;
alter default privileges in schema app_kpi
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema app_kpi
  grant usage, select on sequences to anon, authenticated, service_role;

-- ---------- 0b. ĐẢM BẢO users.username là UNIQUE/PK (bảng dùng chung) ----------
-- (Cần thiết để các bảng KPI tạo khoá ngoại trỏ tới username)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'users'
      and c.contype in ('p', 'u')
      and c.conkey = array[
        (select attnum from pg_attribute
          where attrelid = t.oid and attname = 'username')
      ]
  ) then
    alter table public.users
      add constraint users_username_key unique (username);
  end if;
end $$;

-- ---------- 1. BẢNG HỒ SƠ KPI (companion, không đụng bảng users) ----------
-- Lưu quan hệ quản lý trực tiếp + quyền admin cho riêng phần KPI
create table if not exists app_kpi.kpi_profiles (
  username          text primary key
                    references public.users (username) on delete cascade,
  manager_username  text references public.users (username) on delete set null,
  is_admin          boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------- 2. BẢNG KỲ ĐÁNH GIÁ ----------
create table if not exists app_kpi.kpi_periods (
  period      text primary key,          -- 'YYYY-MM'
  is_open     boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- 3. BẢNG PHIẾU ĐÁNH GIÁ ----------
create table if not exists app_kpi.evaluations (
  id              uuid primary key default gen_random_uuid(),
  username        text not null references public.users (username) on delete cascade,
  period          text not null references app_kpi.kpi_periods (period),
  status          text not null default 'draft'
                  check (status in ('draft', 'submitted', 'reviewed', 'approved')),
  self_total      numeric(6, 2) not null default 0,
  manager_total   numeric(6, 2) not null default 0,
  manager_comment text,
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (username, period)
);

-- ---------- 4. BẢNG DÒNG MỤC TIÊU KPI ----------
create table if not exists app_kpi.objectives (
  id                uuid primary key default gen_random_uuid(),
  evaluation_id     uuid not null references app_kpi.evaluations (id) on delete cascade,
  position          int not null default 1,
  category          text,
  name              text,
  target            text,
  measure_method    text,
  weight            numeric(5, 2) not null default 0,
  reference_doc     text,
  self_result       numeric(5, 2) not null default 0,
  self_explanation  text,
  manager_result    numeric(5, 2),
  manager_note      text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_objectives_eval on app_kpi.objectives (evaluation_id);
create index if not exists idx_evaluations_user on app_kpi.evaluations (username);
create index if not exists idx_evaluations_period on app_kpi.evaluations (period);
create index if not exists idx_kpi_profiles_mgr on app_kpi.kpi_profiles (manager_username);

-- ---------- 5. VIEW an toàn để đọc thông tin người dùng ----------
-- Chỉ lộ cột không nhạy cảm (KHÔNG có password_hash / salt).
-- View chạy quyền owner nên bỏ qua RLS (nếu có) trên bảng users.
create or replace view app_kpi.kpi_users as
  select username, ho_va_ten, role as da_role, mien, bu
  from public.users;

grant select on app_kpi.kpi_users to authenticated, anon;

-- =============================================================
--  HÀM HỖ TRỢ — nhận diện người dùng qua claim "username" trong JWT
--  (giữ ở schema public: dùng chung, ổn định OID cho RLS policy)
-- =============================================================
create or replace function public.current_username()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'username', '');
$$;

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
  );
$$;

create or replace function public.kpi_is_manager_of(target text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from app_kpi.kpi_profiles
    where username = target and manager_username = public.current_username()
  );
$$;

-- Tự cập nhật updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_eval_touch on app_kpi.evaluations;
create trigger trg_eval_touch
  before update on app_kpi.evaluations
  for each row execute function public.touch_updated_at();

-- =============================================================
--  ROW LEVEL SECURITY
-- =============================================================
alter table app_kpi.kpi_profiles enable row level security;
alter table app_kpi.kpi_periods  enable row level security;
alter table app_kpi.evaluations  enable row level security;
alter table app_kpi.objectives   enable row level security;

-- ---------- RLS: kpi_profiles ----------
-- Ai đăng nhập cũng xem được (để hiển thị quản lý, danh sách)
drop policy if exists kpi_profiles_select on app_kpi.kpi_profiles;
create policy kpi_profiles_select on app_kpi.kpi_profiles
  for select to authenticated using (true);

-- Chỉ admin được sửa quan hệ quản lý / quyền admin
drop policy if exists kpi_profiles_admin_write on app_kpi.kpi_profiles;
create policy kpi_profiles_admin_write on app_kpi.kpi_profiles
  for all to authenticated
  using (kpi_is_admin())
  with check (kpi_is_admin());

-- ---------- RLS: kpi_periods ----------
drop policy if exists periods_select on app_kpi.kpi_periods;
create policy periods_select on app_kpi.kpi_periods
  for select to authenticated using (true);

drop policy if exists periods_admin_all on app_kpi.kpi_periods;
create policy periods_admin_all on app_kpi.kpi_periods
  for all to authenticated
  using (kpi_is_admin())
  with check (kpi_is_admin());

-- ---------- RLS: evaluations ----------
drop policy if exists eval_select on app_kpi.evaluations;
create policy eval_select on app_kpi.evaluations
  for select to authenticated using (
    username = current_username()
    or kpi_is_manager_of(username)
    or kpi_is_admin()
  );

-- Tạo phiếu: cho chính mình, hoặc quản lý tạo cho cấp dưới (nhập Excel hàng loạt),
-- với điều kiện kỳ đang mở. Admin tạo được mọi trường hợp.
drop policy if exists eval_insert on app_kpi.evaluations;
create policy eval_insert on app_kpi.evaluations
  for insert to authenticated with check (
    ((username = current_username() or kpi_is_manager_of(username))
      and exists (select 1 from app_kpi.kpi_periods p
                  where p.period = evaluations.period and p.is_open))
    or kpi_is_admin()
  );

drop policy if exists eval_update on app_kpi.evaluations;
create policy eval_update on app_kpi.evaluations
  for update to authenticated
  using (
    username = current_username()
    or kpi_is_manager_of(username)
    or kpi_is_admin()
  )
  with check (
    username = current_username()
    or kpi_is_manager_of(username)
    or kpi_is_admin()
  );

drop policy if exists eval_delete on app_kpi.evaluations;
create policy eval_delete on app_kpi.evaluations
  for delete to authenticated using (
    (username = current_username() and status = 'draft')
    or kpi_is_admin()
  );

-- ---------- RLS: objectives (suy ra từ phiếu chứa nó) ----------
drop policy if exists obj_select on app_kpi.objectives;
create policy obj_select on app_kpi.objectives
  for select to authenticated using (
    exists (
      select 1 from app_kpi.evaluations e
      where e.id = objectives.evaluation_id
        and (e.username = current_username()
             or kpi_is_manager_of(e.username)
             or kpi_is_admin())
    )
  );

drop policy if exists obj_write on app_kpi.objectives;
create policy obj_write on app_kpi.objectives
  for all to authenticated
  using (
    exists (
      select 1 from app_kpi.evaluations e
      where e.id = objectives.evaluation_id
        and (e.username = current_username()
             or kpi_is_manager_of(e.username)
             or kpi_is_admin())
    )
  )
  with check (
    exists (
      select 1 from app_kpi.evaluations e
      where e.id = objectives.evaluation_id
        and (e.username = current_username()
             or kpi_is_manager_of(e.username)
             or kpi_is_admin())
    )
  );

-- =============================================================
--  KHỞI TẠO DỮ LIỆU
-- =============================================================
-- Tạo hồ sơ KPI cho toàn bộ user hiện có của DA
insert into app_kpi.kpi_profiles (username)
select username from public.users
on conflict (username) do nothing;

-- Mở kỳ tháng hiện tại
insert into app_kpi.kpi_periods (period, is_open, note)
values (to_char(now(), 'YYYY-MM'), true, 'Kỳ khởi tạo')
on conflict (period) do nothing;

-- ĐẶT ADMIN ĐẦU TIÊN: thay 'ten_dang_nhap_cua_ban' bằng username của bạn
-- update app_kpi.kpi_profiles set is_admin = true where username = 'ten_dang_nhap_cua_ban';
