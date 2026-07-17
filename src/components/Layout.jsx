import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function roleLabel(profile) {
  if (profile?.is_admin) return 'Quản trị'
  if (profile?.is_manager) return 'Quản lý'
  return 'Nhân viên'
}

function navClass({ isActive }) {
  return [
    'px-3 py-2 rounded-md text-sm font-medium transition',
    isActive
      ? 'bg-brand-600 text-white'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  ].join(' ')
}

export default function Layout() {
  const { profile, isManager, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-brand-700">KPI Review</span>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navClass}>
                Tổng quan
              </NavLink>
              <NavLink to="/danh-gia" className={navClass}>
                Phiếu của tôi
              </NavLink>
              <NavLink to="/excel" className={navClass}>
                Nhập Excel
              </NavLink>
              {isManager && (
                <NavLink to="/duyet" className={navClass}>
                  Duyệt KPI
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/quan-tri" className={navClass}>
                  Quản trị
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium text-slate-800">
                {profile?.ho_va_ten || 'Người dùng'}
              </div>
              <div className="text-xs text-slate-500">{roleLabel(profile)}</div>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
