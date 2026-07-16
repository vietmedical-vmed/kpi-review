import { createContext, useContext, useEffect, useState } from 'react'
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getToken,
  setToken,
  clearToken,
  decodeJwt,
} from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [username, setUsername] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Lấy hồ sơ KPI (tên, vai trò, quyền) theo username
  async function loadProfile(uname) {
    if (!uname) {
      setProfile(null)
      return
    }
    const [{ data: userRow }, { data: kp }, { count: reportsCount }] =
      await Promise.all([
        supabase.from('kpi_users').select('*').eq('username', uname).maybeSingle(),
        supabase
          .from('kpi_profiles')
          .select('*')
          .eq('username', uname)
          .maybeSingle(),
        supabase
          .from('kpi_profiles')
          .select('username', { count: 'exact', head: true })
          .eq('manager_username', uname),
      ])

    const isAdmin = !!kp?.is_admin
    const isManager = isAdmin || (reportsCount || 0) > 0
    setProfile({
      username: uname,
      ho_va_ten: userRow?.ho_va_ten || uname,
      da_role: userRow?.da_role || '',
      mien: userRow?.mien || '',
      bu: userRow?.bu || '',
      manager_username: kp?.manager_username || null,
      is_admin: isAdmin,
      is_manager: isManager,
    })
  }

  // Khôi phục phiên từ token đã lưu (nếu còn hạn)
  useEffect(() => {
    async function restore() {
      const token = getToken()
      const claims = token ? decodeJwt(token) : null
      if (claims?.username && claims.exp * 1000 > Date.now()) {
        setUsername(claims.username)
        await loadProfile(claims.username)
      } else if (token) {
        clearToken()
      }
      setLoading(false)
    }
    restore()
  }, [])

  async function signIn(uname, password) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ username: uname.trim(), password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { error: data.error || 'Đăng nhập thất bại' }
    }
    setToken(data.token)
    setUsername(data.profile.username)
    await loadProfile(data.profile.username)
    return { error: null }
  }

  function signOut() {
    clearToken()
    setUsername(null)
    setProfile(null)
  }

  const value = {
    username,
    profile,
    loading,
    isAdmin: !!profile?.is_admin,
    isManager: !!profile?.is_manager,
    signIn,
    signOut,
    reloadProfile: () => loadProfile(username),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải nằm trong AuthProvider')
  return ctx
}
