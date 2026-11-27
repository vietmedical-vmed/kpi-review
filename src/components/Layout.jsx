import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function roleInfo(profile) {
  if (profile?.is_admin) return { label: 'Admin', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  if (profile?.is_manager) return { label: 'Manager', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
  return { label: 'Nhân viên', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
}

function initials(profile) {
  const src = (profile?.ho_va_ten || '').trim()
  if (!src) return 'KP'
  const parts = src.split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : src.slice(0, 2).toUpperCase()
}

function navClass({ isActive }) {
  return [
    'relative px-0.5 pb-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
    isActive
      ? 'border-brand-600 text-brand-600'
      : 'border-transparent text-slate-600 hover:text-slate-900',
  ].join(' ')
}

export default function Layout() {
  const { profile, isManager, isAdmin, canUpload, signOut } = useAuth()
  const navigate = useNavigate()
  const badge = roleInfo(profile)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-start justify-between pt-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand-500 text-white grid place-items-center font-bold text-sm shrink-0">
                {initials(profile)}
              </div>
              <div className="leading-tight">
                <div className="font-bold text-slate-900 text-base md:text-lg">ĐÁNH GIÁ KPI HÀNG THÁNG</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500">{profile?.ho_va_ten || 'Người dùng'}</span>
                  <span className={'px-1.5 py-0.5 rounded text-[10px] font-semibold border ' + badge.cls}>{badge.label}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-[9px] text-slate-400 italic text-right">
                Designed and developed by{' '}
                <span className="font-semibold text-slate-500 not-italic">Do Hoang Giang</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-1.5 text-xs text-white bg-brand-500 hover:bg-brand-600 px-2.5 py-1.5 rounded-md"
                >
                  <span>⟳</span>Reload
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 text-xs text-white bg-red-500 hover:bg-red-600 px-2.5 py-1.5 rounded-md"
                >
                  <span>⎋</span>Đăng xuất
                </button>
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-5 md:gap-6 mt-3 overflow-x-auto overflow-y-hidden">
            {canUpload && <NavLink to="/nhap" className={navClass}>1. Nhập KPI</NavLink>}
            <NavLink to="/phieu" className={navClass}>{canUpload ? '2. Phiếu & duyệt' : 'Phiếu & duyệt'}</NavLink>
            {isManager && <NavLink to="/bao-cao" className={navClass}>Báo cáo</NavLink>}
            {isAdmin && <NavLink to="/quan-tri" className={navClass}>Quản trị</NavLink>}
          </nav>
        </div>
      </header>
      <main className="w-full px-4 md:px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
