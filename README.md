# Ứng dụng đánh giá KPI hàng tháng

Web app đánh giá KPI cho team 20–30 người. Nhân viên **tự chấm** → quản lý **duyệt & chốt điểm**.

- **Frontend:** React + Vite + Tailwind (web tĩnh)
- **Backend/DB:** Supabase (Postgres + RLS + Edge Functions)
- **Hosting:** GitHub Pages (miễn phí)
- **Đăng nhập:** DÙNG CHUNG bảng `users` sẵn có của **DA project** (username + mật khẩu)

---

## Kiến trúc & luồng đánh giá

```
1. Nhập KPI   (người được cấp quyền nhập / admin)
   upload file Excel cho 1 hoặc nhiều người → xem trước (tên lấy từ file hoặc nhập tay,
   kỳ, người duyệt, số liệu, lỗi) → Xác nhận nhập → phiếu "Chờ duyệt"
   Người nhập còn sửa được tới khi phiếu được duyệt.
2. Phiếu & duyệt   (người duyệt N+1 / admin)
   xem, điều chỉnh thông tin → Duyệt (khoá phiếu) · Bỏ duyệt để mở lại
3. Xuất Excel
   ghi số liệu mới nhất vào CHÍNH file đã upload (giữ định dạng, công thức, sheet phụ);
   phiếu không có file gốc xuất theo mẫu chuẩn "Đăng kí & đánh giá KPI tháng"
```

Phiếu **không gắn tài khoản** nhân viên: nhận diện bằng họ tên (chuẩn hoá) + kỳ + người duyệt.
Quyền nhập cấp ở **Quản trị → Nhân sự & phân quyền → Quyền nhập** (`kpi_profiles.can_upload`).
Migration: `supabase/migrations/20261127000000_upload_review_flow.sql` (chạy trước khi deploy frontend).

**Đăng nhập dùng chung tài khoản DA:**

```
Login (username + password)
  → Edge Function `login`: xác thực password_hash + salt bằng SHA-256 (đúng scheme DA)
  → cấp JWT (ký HS256 bằng JWT secret của project) có claim "username"
  → App gắn JWT vào mọi request → RLS nhận diện người dùng qua "username"
```

- App KPI **không tạo bảng user riêng** — dùng bảng `users` của DA cho họ tên + thông tin.
- Bảng phụ `kpi_profiles` lưu **quản lý trực tiếp** và **quyền admin KPI** (không đụng bảng `users`).
- App KPI **chỉ đọc** để xác thực, **không đổi mật khẩu** — không ghi vào `users`.

---

## Bước 1 — Chạy schema trong Supabase (cùng project với DA)

1. Mở project Supabase (chính là project chứa bảng `users` của DA).
2. **SQL Editor → New query**, dán toàn bộ [`supabase/schema.sql`](supabase/schema.sql) rồi **Run**.
   Lệnh này tạo bảng KPI, hàm phân quyền, RLS, view `kpi_users` an toàn, và tạo sẵn
   `kpi_profiles` cho mọi user hiện có.
3. **Đặt admin đầu tiên** — chạy (thay bằng username của bạn):
   ```sql
   update public.kpi_profiles set is_admin = true where username = 'username_cua_ban';
   ```

> Không cần tạo tài khoản mới: mọi người đăng nhập bằng **đúng username + mật khẩu DA**.

---

## Bước 2 — Deploy Edge Function `login`

Cần [Supabase CLI](https://supabase.com/docs/guides/cli). Trong thư mục dự án:

```bash
supabase login
supabase link --project-ref <project-ref>     # ref trong Project Settings > General

# Đặt JWT secret của project cho hàm (Project Settings > API > JWT Secret)
supabase secrets set KPI_JWT_SECRET="<JWT secret của project>"

# Deploy, TẮT verify_jwt vì người dùng chưa đăng nhập khi gọi hàm này
supabase functions deploy login --no-verify-jwt
```

> `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` được Supabase tự cấp cho hàm — không cần set.
> Hàm chỉ dùng service role để **đọc** `users` khi xác thực mật khẩu.

---

## Bước 3 — Chạy thử ở máy local

```bash
npm install

# Tạo .env từ mẫu rồi điền URL + anon key (Project Settings > API)
cp .env.example .env      # Windows PowerShell: copy .env.example .env

npm run dev
```

Mở http://localhost:5173, đăng nhập bằng **username + mật khẩu DA**.

Với admin, vào **Quản trị** để:
- **Nhân sự & phân quyền**: gán quản lý trực tiếp cho từng người, bật **Admin KPI**.
- **Sơ đồ tổ chức**: chọn 1 quản lý → **tick nhiều cấp dưới cùng lúc** (có tìm kiếm, lọc theo
  Miền, chặn vòng lặp phân cấp). Cách nhanh nhất khi set up đầu kỳ.
- **Kỳ đánh giá**: mở/khoá theo tháng.

> Quan hệ quản lý lưu ở `kpi_profiles.manager_username` (trỏ từ nhân viên **lên** quản lý).
> Ai có ít nhất 1 cấp dưới sẽ tự động có quyền duyệt KPI của những người đó.
> Gán nhanh bằng SQL:
> ```sql
> update public.kpi_profiles set manager_username = 'username_quan_ly'
> where username in ('nv1','nv2','nv3');
> ```

---

## Bước 4 — Đưa code lên GitHub

```bash
git init
git add .
git commit -m "KPI review app"
git branch -M main
git remote add origin https://github.com/<tài-khoản>/kpi-review.git
git push -u origin main
```

---

## Bước 5 — Cấu hình & bật GitHub Pages

1. **Settings → Secrets and variables → Actions → New repository secret**, thêm:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. **Settings → Pages → Source = GitHub Actions**.
3. Push lên `main` → workflow [`deploy.yml`](.github/workflows/deploy.yml) tự build & deploy tới:
   `https://<tài-khoản>.github.io/kpi-review/`

---

## Nhập KPI từ Excel

Trang **1. Nhập KPI** nhận 2 dạng file (chọn được nhiều file, kéo thả được):

- **Mẫu chuẩn** "Đăng kí & đánh giá KPI tháng": 2 sheet Đăng ký đầu tháng / Đánh giá cuối tháng, 1 người/file.
- **File cả đội**: mỗi sheet `KPI 11 - Họ tên` là 1 người; sheet tổng hợp / phụ lục / sheet ẩn bị bỏ qua.

Tên nhân viên: ô NHÂN VIÊN trong file > tên sheet > tên file; sửa tay được, có gợi ý tên đã có
trong hệ thống khi gõ gần giống. Kiểm tra trước khi nhập: tổng trọng số = 100%, số trong 0–100%,
trùng người/kỳ, kỳ bị khoá, phiếu đã duyệt (chặn ghi đè). File gốc được lưu (`kpi_files`, ≤ 8 MB)
để xuất lại đúng biểu mẫu.

---

## Cấu trúc thư mục

```
src/
  lib/          supabase.js (client + gắn JWT), constants.js (nhóm KPI, trạng thái, kỳ)
                excel.js (tạo/đọc template Excel + kiểm tra dữ liệu)
  context/      AuthContext.jsx (đăng nhập qua Edge Function, JWT, vai trò)
                exportKpi.js (xuất Excel theo file gốc), people.js (danh sách người duyệt)
  components/   Layout, ProtectedRoute, Spinner, ui (Field, badge, chọn người duyệt)
  pages/        Login, ImportKpi (1. nhập), KpiList + EvaluationDetail (2. phiếu & duyệt),
                TeamInsights (báo cáo), Admin
supabase/
  schema.sql            bảng KPI + RLS + view kpi_users (dùng chung users của DA)
  functions/login/      Edge Function xác thực mật khẩu (SHA-256 giống DA) + cấp JWT
  config.toml           tắt verify_jwt cho hàm login
.github/workflows/
  deploy.yml    CI/CD lên GitHub Pages
```

---

## Ghi chú kỹ thuật & bảo mật

- **Dùng chung `users`:** App KPI chỉ đọc `users` để xác thực và hiển thị tên. Việc quản lý
  tài khoản/mật khẩu vẫn hoàn toàn thuộc DA.
- **Băm mật khẩu:** Edge Function mirror đúng scheme DA — `salt` có thì hash
  `sha256(salt + ":" + password)`, không có thì `sha256(password)`. Cột `salt` giữ nguyên,
  không cần backfill.
- **JWT:** ký bằng JWT secret của project để PostgREST tin tưởng; RLS đọc claim `username`.
  Token hết hạn sau 12 giờ, hết hạn thì đăng nhập lại.
- **RLS:** nhân viên chỉ thấy phiếu của mình; quản lý thấy phiếu của người mình quản lý
  trực tiếp; admin thấy tất cả. Không dùng `service_role` ở frontend.
