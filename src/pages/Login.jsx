import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1px solid #dadde1', borderRadius: 6,
  fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 10,
}

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5', padding: 16 }}>
      <form onSubmit={handleSubmit} style={{
        background: '#fff', borderRadius: 8,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.1)',
        border: '1px solid #dadde1', padding: 24, width: '100%', maxWidth: 360, boxSizing: 'border-box',
      }}>
        <img src="/logo.png" alt="VietMedical" style={{ height: 48, display: 'block', margin: '0 auto 24px' }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 20px', textAlign: 'center', textTransform: 'uppercase' }}>
          ĐÁNH GIÁ KPI HÀNG THÁNG
        </h2>
        <input
          type="text" required autoComplete="username" autoFocus
          value={uname} onChange={(e) => setUname(e.target.value)}
          placeholder="Tài khoản" style={inputStyle}
        />
        <input
          type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu" style={{ ...inputStyle, marginBottom: 0 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#65676b', cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Ghi nhớ đăng nhập trên thiết bị này
        </label>
        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#fa383e', display: 'flex', alignItems: 'center', gap: 6 }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={loading} style={{
          width: '100%', marginTop: 16, background: '#1877f2', color: '#fff',
          padding: '8px 12px', borderRadius: 6, fontSize: 15, fontWeight: 700,
          border: 'none', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: '#8a8d91' }}>
        Designed and developed by Do Hoang Giang
      </div>
    </div>
  )
}
