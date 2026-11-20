-- ════════════════════════════════════════════════════════════════════════
-- KỲ ĐÁNH GIÁ TỰ ĐỘNG — không cần admin tạo kỳ
--
-- 1) Trigger BEFORE INSERT trên evaluations: kiểm tra định dạng 'YYYY-MM' và
--    khoảng cho phép (lùi 24 tháng .. tiến 1 tháng so với hiện tại, giờ VN),
--    rồi tự thêm dòng kpi_periods (is_open = true) nếu chưa có.
--    SECURITY DEFINER để ghi được kpi_periods (RLS chỉ cho admin ghi).
-- 2) Policy eval_insert: đổi "kỳ phải tồn tại và đang mở" thành "kỳ KHÔNG bị
--    khoá". Lý do: dòng kỳ do trigger vừa thêm không hiển thị với snapshot của
--    chính câu INSERT khi kiểm tra WITH CHECK. Kỳ chưa có dòng = đang mở.
--    Khoá kỳ vẫn chặn tạo phiếu mới như cũ.
-- 3) Tạo sẵn kỳ tháng hiện tại.
--
-- Khoảng cho phép phải khớp src/lib/periods.js (PERIOD_BACK / PERIOD_AHEAD).
-- Idempotent, 1 transaction. Rollback: xem cuối file.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function app_kpi.kpi_autocreate_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur  date := date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date;
  per  date;
begin
  if new.period is null or new.period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Kỳ đánh giá không hợp lệ: "%" (định dạng YYYY-MM)', new.period;
  end if;
  per := to_date(new.period || '-01', 'YYYY-MM-DD');
  if per > cur + interval '1 month' or per < cur - interval '24 months' then
    raise exception 'Kỳ % nằm ngoài khoảng cho phép (24 tháng trước đến tháng sau)', new.period;
  end if;
  insert into app_kpi.kpi_periods (period, is_open, note)
  values (new.period, true, 'Tự tạo')
  on conflict (period) do nothing;
  return new;
end;
$$;

revoke all on function app_kpi.kpi_autocreate_period() from public, anon, authenticated;

drop trigger if exists trg_eval_autoperiod on app_kpi.evaluations;
create trigger trg_eval_autoperiod
  before insert on app_kpi.evaluations
  for each row execute function app_kpi.kpi_autocreate_period();

drop policy if exists eval_insert on app_kpi.evaluations;
create policy eval_insert on app_kpi.evaluations
  for insert to authenticated with check (
    ((username = (select public.current_username()) or public.kpi_is_manager_of(username))
      and not exists (select 1 from app_kpi.kpi_periods p
                      where p.period = evaluations.period and not p.is_open))
    or (select public.kpi_is_admin())
  );

insert into app_kpi.kpi_periods (period, is_open, note)
values (to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM'), true, 'Tự tạo')
on conflict (period) do nothing;

commit;

-- ─── ROLLBACK (chạy tay nếu cần) ─────────────────────────────────────────
-- begin;
-- drop trigger if exists trg_eval_autoperiod on app_kpi.evaluations;
-- drop function if exists app_kpi.kpi_autocreate_period();
-- drop policy if exists eval_insert on app_kpi.evaluations;
-- create policy eval_insert on app_kpi.evaluations for insert to authenticated with check (
--   ((username = current_username() or kpi_is_manager_of(username))
--     and exists (select 1 from app_kpi.kpi_periods p where p.period = evaluations.period and p.is_open))
--   or kpi_is_admin());
-- commit;
