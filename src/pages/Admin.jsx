import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatPeriod, recentPeriods } from '../lib/constants'
import Spinner from '../components/Spinner'

export default function Admin() {
  const [tab, setTab] = useState('users')
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-slate-800">Quản trị hệ thống</h1>
      <div className="mb-6 flex gap-2 border-b border-slate-200">
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
          Nhân sự & phân quyền
        </TabButton>
        <TabButton active={tab === 'periods'} onClick={() => setTab('periods')}>
          Kỳ đánh giá
        </TabButton>
      </div>
      {tab === 'users' ? <UsersTab /> : <PeriodsTab />}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function UsersTab() {
  const [users, setUsers] = useState([]) // từ kpi_users
  const [profiles, setProfiles] = useState({}) // username -> kpi_profiles
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: us }, { data: kp }] = await Promise.all([
      supabase.from('kpi_users').select('*').order('ho_va_ten', { ascending: true }),
      supabase.from('kpi_profiles').select('*'),
    ])
    setUsers(us || [])
    const map = {}
    for (const p of kp || []) map[p.username] = p
    setProfiles(map)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function saveProfile(username, changes) {
    setSavingId(username)
    setMessage('')
    const current = profiles[username] || { username }
    const next = { ...current, ...changes, username }
    const { error } = await supabase
      .from('kpi_profiles')
      .upsert(next, { onConflict: 'username' })
    setSavingId(null)
    if (error) {
      setMessage('Lỗi: ' + error.message)
    } else {
      setProfiles((prev) => ({ ...prev, [username]: next }))
      setMessage('Đã cập nhật ' + username)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.username?.toLowerCase().includes(q) ||
        u.ho_va_ten?.toLowerCase().includes(q)
    )
  }, [users, search])

  if (loading) return <Spinner />

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Danh sách lấy từ bảng <code>users</code> dùng chung. Gán <b>quản lý trực tiếp</b> và
        <b> quyền admin KPI</b> cho từng người (lưu vào <code>kpi_profiles</code>, không đổi bảng users).
      </p>
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên hoặc username..."
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-xs text-slate-400">{filtered.length} người</span>
      </div>
      {message && (
        <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-3 font-medium">Họ tên</th>
              <th className="px-3 py-3 font-medium">Username</th>
              <th className="px-3 py-3 font-medium">Miền / BU</th>
              <th className="px-3 py-3 font-medium">Quản lý trực tiếp</th>
              <th className="px-3 py-3 text-center font-medium">Admin KPI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => {
              const p = profiles[u.username] || {}
              return (
                <tr
                  key={u.username}
                  className={savingId === u.username ? 'opacity-50' : ''}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {u.ho_va_ten || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{u.username}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {[u.mien, u.bu].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.manager_username || ''}
                      onChange={(e) =>
                        saveProfile(u.username, {
                          manager_username: e.target.value || null,
                        })
                      }
                      className="w-48 rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">— Không —</option>
                      {users
                        .filter((m) => m.username !== u.username)
                        .map((m) => (
                          <option key={m.username} value={m.username}>
                            {m.ho_va_ten || m.username}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!p.is_admin}
                      onChange={(e) =>
                        saveProfile(u.username, { is_admin: e.target.checked })
                      }
                      className="h-4 w-4"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PeriodsTab() {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [newPeriod, setNewPeriod] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('kpi_periods')
      .select('*')
      .order('period', { ascending: false })
    setPeriods(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addPeriod() {
    if (!newPeriod) return
    setMessage('')
    const { error } = await supabase
      .from('kpi_periods')
      .insert({ period: newPeriod, is_open: true })
    if (error) setMessage('Lỗi: ' + error.message)
    else {
      setNewPeriod('')
      load()
    }
  }

  async function toggleOpen(p) {
    const { error } = await supabase
      .from('kpi_periods')
      .update({ is_open: !p.is_open })
      .eq('period', p.period)
    if (!error)
      setPeriods((prev) =>
        prev.map((x) => (x.period === p.period ? { ...x, is_open: !x.is_open } : x))
      )
  }

  if (loading) return <Spinner />

  const existing = new Set(periods.map((p) => p.period))
  const suggestions = recentPeriods(12).filter((p) => !existing.has(p))

  return (
    <div>
      <div className="mb-4 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Thêm kỳ mới
          </label>
          <select
            value={newPeriod}
            onChange={(e) => setNewPeriod(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Chọn tháng...</option>
            {suggestions.map((p) => (
              <option key={p} value={p}>
                {formatPeriod(p)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={addPeriod}
          disabled={!newPeriod}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          + Thêm kỳ
        </button>
      </div>
      {message && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kỳ</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {periods.map((p) => (
              <tr key={p.period}>
                <td className="px-4 py-3 font-medium text-slate-800">
                  {formatPeriod(p.period)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.is_open
                        ? 'bg-green-100 text-green-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {p.is_open ? 'Đang mở' : 'Đã khoá'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleOpen(p)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {p.is_open ? 'Khoá kỳ' : 'Mở kỳ'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
