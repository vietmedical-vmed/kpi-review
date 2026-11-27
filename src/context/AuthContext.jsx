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
    const [{ data: userRow }, { data: kp }, { count: reportsCount }, { count: noAccCount }] =
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
        // Phiếu nhân viên không có tài khoản do mình nhập hộ (mình là N+1)
        supabase
          .from('evaluations')
          .select('id', { count: 'exact', head: true })
          .is('username', null)
          .eq('manager_username', uname),
      ])

    // Admin KPI: bật cờ trong kpi_profiles HOẶC là admin của DA (khớp kpi_is_admin() ở DB)
    const isAdmin = !!kp?.is_admin || userRow?.da_role === 'admin'
    const isManager = isAdmin || (reportsCount || 0) > 0 || (noAccCount || 0) > 0
    // Quyền nhập KPI từ Excel: admin cấp cho một vài user (kpi_profiles.can_upload)
    const canUpload = isAdmin || !!kp?.can_upload
    setProfile({
      username: uname,
      ho_va_ten: userRow?.ho_va_ten || uname,
      da_role: userRow?.da_role || '',
      mien: userRow?.mien || '',
      bu: userRow?.bu || '',
      manager_username: kp?.manager_username || null,
      is_admin: isAdmin,
      is_manager: isManager,
      can_upload: canUpload,
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
    canUpload: !!profile?.can_upload,
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
