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
        <TabButton active={tab === 'org'} onClick={() => setTab('org')}>
          Sơ đồ tổ chức
        </TabButton>
        <TabButton active={tab === 'periods'} onClick={() => setTab('periods')}>
          Kỳ đánh giá
        </TabButton>
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'org' && <OrgTab />}
      {tab === 'periods' && <PeriodsTab />}
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

// Chọn 1 quản lý -> tick nhiều cấp dưới cùng lúc
function OrgTab() {
  const [users, setUsers] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [manager, setManager] = useState('')
  const [checked, setChecked] = useState(new Set())
  const [search, setSearch] = useState('')
  const [filterMien, setFilterMien] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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
    return map
  }

  useEffect(() => {
    load()
  }, [])

  // Khi đổi quản lý: tick sẵn những người đang thuộc quản lý đó
  useEffect(() => {
    if (!manager) {
      setChecked(new Set())
      return
    }
    const current = Object.values(profiles)
      .filter((p) => p.manager_username === manager)
      .map((p) => p.username)
    setChecked(new Set(current))
    setMessage('')
    setError('')
  }, [manager, profiles])

  const original = useMemo(
    () =>
      new Set(
        Object.values(profiles)
          .filter((p) => p.manager_username === manager)
          .map((p) => p.username)
      ),
    [profiles, manager]
  )

  // Đi ngược lên cây quản lý: gán manager cho user có tạo vòng lặp không?
  function wouldCycle(user, mgr) {
    let cur = mgr
    const seen = new Set()
    while (cur) {
      if (cur === user) return true
      if (seen.has(cur)) return false
      seen.add(cur)
      cur = profiles[cur]?.manager_username || null
    }
    return false
  }

  const mienList = useMemo(
    () => [...new Set(users.map((u) => u.mien).filter(Boolean))].sort(),
    [users]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users
      .filter((u) => u.username !== manager) // không thể là cấp dưới của chính mình
      .filter((u) => (filterMien ? u.mien === filterMien : true))
      .filter(
        (u) =>
          !q ||
          u.username?.toLowerCase().includes(q) ||
          u.ho_va_ten?.toLowerCase().includes(q)
      )
  }, [users, manager, search, filterMien])

  function toggle(uname) {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(uname) ? next.delete(uname) : next.add(uname)
      return next
    })
  }

  function toggleAllVisible(on) {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const u of visible) {
        if (on) {
          if (!wouldCycle(u.username, manager)) next.add(u.username)
        } else next.delete(u.username)
      }
      return next
    })
  }

  const toAdd = [...checked].filter((u) => !original.has(u))
  const toRemove = [...original].filter((u) => !checked.has(u))
  const changeCount = toAdd.length + toRemove.length

  async function handleSave() {
    setError('')
    setMessage('')

    const cyclic = toAdd.filter((u) => wouldCycle(u, manager))
    if (cyclic.length) {
      setError(
        `Không thể gán ${cyclic.join(', ')} làm cấp dưới vì sẽ tạo vòng lặp phân cấp (quản lý của chính người này đang nằm dưới họ).`
      )
      return
    }

    setSaving(true)
    // Giữ nguyên các cột khác (vd is_admin) khi upsert
    const rows = [
      ...toAdd.map((u) => ({
        ...(profiles[u] || {}),
        username: u,
        manager_username: manager,
      })),
      ...toRemove.map((u) => ({
        ...(profiles[u] || {}),
        username: u,
        manager_username: null,
      })),
    ]
    const { error: upErr } = await supabase
      .from('kpi_profiles')
      .upsert(rows, { onConflict: 'username' })
    setSaving(false)

    if (upErr) {
      setError('Lỗi khi lưu: ' + upErr.message)
      return
    }
    setMessage(
      `Đã cập nhật: thêm ${toAdd.length} cấp dưới, bỏ ${toRemove.length}.`
    )
    await load()
  }

  if (loading) return <Spinner />

  const nameOf = (u) => users.find((x) => x.username === u)?.ho_va_ten || u

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Chọn một <b>quản lý</b>, rồi tick những người làm <b>cấp dưới trực tiếp</b>. Bỏ tick để
        gỡ. Người có ít nhất 1 cấp dưới sẽ tự động có quyền duyệt KPI của họ.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Quản lý</label>
          <select
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Chọn quản lý —</option>
            {users.map((u) => (
              <option key={u.username} value={u.username}>
                {u.ho_va_ten || u.username} ({u.username})
              </option>
            ))}
          </select>
        </div>
        {manager && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Tìm kiếm</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tên hoặc username..."
                className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Miền</label>
              <select
                value={filterMien}
                onChange={(e) => setFilterMien(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Tất cả</option>
                {mienList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {!manager ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-slate-400">
          Chọn một quản lý ở trên để bắt đầu gán cấp dưới.
        </div>
      ) : (
        <>
          {message && (
            <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <b>{checked.size}</b> người được chọn làm cấp dưới của{' '}
              <b>{nameOf(manager)}</b>
              {changeCount > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {changeCount} thay đổi chưa lưu
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => toggleAllVisible(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Chọn hết ({visible.length})
              </button>
              <button
                onClick={() => toggleAllVisible(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Bỏ chọn hết
              </button>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 font-medium">Họ tên</th>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Miền / BU</th>
                  <th className="px-3 py-2 font-medium">Quản lý hiện tại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((u) => {
                  const p = profiles[u.username] || {}
                  const isChecked = checked.has(u.username)
                  const cyc = wouldCycle(u.username, manager)
                  const otherMgr =
                    p.manager_username && p.manager_username !== manager
                      ? p.manager_username
                      : null
                  return (
                    <tr
                      key={u.username}
                      className={`${isChecked ? 'bg-brand-50' : ''} ${cyc ? 'opacity-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={cyc}
                          onChange={() => toggle(u.username)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {u.ho_va_ten || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{u.username}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {[u.mien, u.bu].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {cyc ? (
                          <span className="text-xs text-red-600">
                            Không thể chọn (vòng lặp phân cấp)
                          </span>
                        ) : p.manager_username === manager ? (
                          <span className="text-xs text-green-700">Đang là cấp dưới</span>
                        ) : otherMgr ? (
                          <span className="text-xs text-amber-700">
                            {nameOf(otherMgr)}
                            {isChecked && ' → sẽ chuyển sang quản lý này'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Chưa có</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || changeCount === 0}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : `Lưu thay đổi${changeCount ? ` (${changeCount})` : ''}`}
            </button>
            {changeCount > 0 && (
              <span className="text-xs text-slate-500">
                Thêm {toAdd.length} · Bỏ {toRemove.length}
              </span>
            )}
          </div>
        </>
      )}
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
