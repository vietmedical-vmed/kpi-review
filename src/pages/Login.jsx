import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { username, signIn } = useAuth()
  const navigate = useNavigate()
  const [uname, setUname] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [remember, setRemember] = useState(true)

  if (username) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(uname, password)
    setLoading(false)
    if (error) {
      setError(error)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4" style={{ background: '#f0f2f5' }}>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <img src="/logo.png" alt="VietMedical" className="mx-auto mb-6 h-12" />
        <h1 className="mb-5 text-center text-lg font-bold uppercase">
          ĐÁNH GIÁ KPI HÀNG THÁNG
        </h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            required
            autoComplete="username"
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Tài khoản"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Mật khẩu"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Ghi nhớ đăng nhập trên thiết bị này
          </label>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
      <div className="mt-6 text-center text-[11px] text-slate-400">
        Designed and developed by Do Hoang Giang
      </div>
    </div>
  )
}
