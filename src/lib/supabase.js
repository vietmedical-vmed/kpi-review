import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const TOKEN_KEY = 'kpi_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY. Kiểm tra .env (local) hoặc GitHub Secrets (deploy).'
  )
}

// Gắn JWT tuỳ biến (do Edge Function login cấp) vào mọi request tới Supabase,
// để RLS nhận diện người dùng qua claim "username". Khi chưa đăng nhập thì
// supabase-js dùng anon key mặc định → RLS chặn truy cập.
function authFetch(input, init = {}) {
  const headers = new Headers(init.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // Toàn bộ bảng riêng của app KPI (evaluations, objectives, kpi_profiles,
  // kpi_periods, kpi_users) đã tách sang schema app_kpi. Đặt schema mặc định
  // ở đây để mọi .from(...) trỏ đúng app_kpi — không phải sửa từng lời gọi.
  // (Bảng dùng chung public.users chỉ được đọc gián tiếp qua view kpi_users,
  //  cũng đã nằm trong app_kpi, nên không có lời gọi nào cần schema public.)
  // Yêu cầu: "app_kpi" phải được thêm vào Settings → API → Exposed schemas.
  db: { schema: 'app_kpi' },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: authFetch },
})

// Giải mã payload JWT (không cần thư viện) để lấy username, exp
export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decodeURIComponent(escape(json)))
  } catch {
    return null
  }
}
