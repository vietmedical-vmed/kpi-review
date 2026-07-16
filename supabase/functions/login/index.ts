// Edge Function: đăng nhập KPI bằng tài khoản DÙNG CHUNG của DA project.
// Xác thực mật khẩu theo đúng scheme SHA-256 của DA, rồi cấp JWT (HS256, ký bằng
// JWT secret của project) có claim "username" để RLS nhận diện người dùng.
//
// Deploy:  supabase functions deploy login --no-verify-jwt
// Secrets: supabase secrets set KPI_JWT_SECRET=<JWT secret của project>
//   (SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY được Supabase cấp tự động)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// sha256 → chuỗi hex thường (khớp sha256Hex của DA)
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let username = ''
  let password = ''
  try {
    const body = await req.json()
    username = (body.username ?? '').trim()
    password = body.password ?? ''
  } catch {
    return json({ error: 'Body không hợp lệ' }, 400)
  }
  if (!username || !password) {
    return json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle()

  const fail = async () => {
    await delay(400) // chống dò mật khẩu (giống DA)
    return json({ error: 'Tài khoản hoặc mật khẩu không đúng' }, 401)
  }

  if (!user || !user.password_hash || user.active === false) return fail()

  // Khớp đúng logic DA: salt ? sha256(salt + ":" + pw) : sha256(pw)
  const toHash = user.salt ? `${user.salt}:${password}` : password
  const computed = await sha256Hex(toHash)
  if (computed !== user.password_hash) return fail()

  // ---- Cấp JWT tương thích Supabase (PostgREST verify HS256 bằng JWT secret) ----
  const secret = Deno.env.get('KPI_JWT_SECRET')
  if (!secret) return json({ error: 'Server thiếu KPI_JWT_SECRET' }, 500)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

  const token = await create(
    { alg: 'HS256', typ: 'JWT' },
    {
      role: 'authenticated',
      aud: 'authenticated',
      sub: user.username,
      username: user.username,
      iat: getNumericDate(0),
      exp: getNumericDate(60 * 60 * 12), // 12 giờ
    },
    key
  )

  return json({
    token,
    profile: {
      username: user.username,
      ho_va_ten: user.ho_va_ten ?? '',
      da_role: user.role ?? '',
      mien: user.mien ?? '',
      bu: user.bu ?? '',
    },
  })
})
