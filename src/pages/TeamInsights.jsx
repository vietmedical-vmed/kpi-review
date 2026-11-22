// Báo cáo cho cấp quản lý: tổng quan đội, tiến độ quy trình, phân bố kết quả,
// so sánh theo Miền/BU/Quản lý, chênh lệch N vs N+1, xu hướng 6 kỳ, bảng chi tiết.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  formatPeriod,
  currentPeriod,
  shiftPeriod,
  finalScore,
  gradeOf,
  personKey,
  round2,
  PASS_THRESHOLD,
  STATUS_LABELS,
  STATUS_COLORS,
  GRADE_COLORS,
} from '../lib/constants'
import { buildTeamSummary, downloadBlob } from '../lib/excel'
import Spinner from '../components/Spinner'
import { loadPeriods } from '../lib/periods'

const TREND_MONTHS = 6

// Bảng màu (palette tham chiếu dataviz) — xanh tuần tự, đỏ/xanh phân kỳ
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281']
const POS = '#2a78d6'
const NEG = '#e34948'
const CRITICAL = '#d03b3b'
const STAGES = [
  { key: 'none', label: 'Chưa có phiếu', color: '#d6d5d0' },
  { key: 'draft', label: STATUS_LABELS.draft, color: '#b7d3f6' },
  { key: 'submitted', label: STATUS_LABELS.submitted, color: '#6da7ec' },
  { key: 'reviewed', label: STATUS_LABELS.reviewed, color: '#2a78d6' },
  { key: 'approved', label: STATUS_LABELS.approved, color: '#184f95' },
]
const BINS = [
  { label: '< 70%', lo: -Infinity, hi: 70 },
  { label: '70–80%', lo: 70, hi: 80 },
  { label: '80–90%', lo: 80, hi: 90 },
  { label: '90–95%', lo: 90, hi: 95 },
  { label: '95–100%', lo: 95, hi: Infinity },
]

function avg(list) {
  return list.length ? round2(list.reduce((s, x) => s + x, 0) / list.length) : null
}

function seqColor(score) {
  // 60% -> nhạt nhất, 100% -> đậm nhất
  const t = Math.max(0, Math.min(1, (score - 60) / 40))
  return SEQ[Math.round(t * (SEQ.length - 1))]
}

// ------------------------------------------------------------ Tooltip
function useTooltip() {
  const [tip, setTip] = useState(null)
  const bind = (content) => ({
    onMouseMove: (e) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
  })
  const node = tip ? (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
      style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: tip.y + 14 }}
    >
      {tip.content}
    </div>
  ) : null
  return [bind, node]
}

export default function TeamInsights() {
  const { username, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [bindTip, tipNode] = useTooltip()

  const [loading, setLoading] = useState(true)
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [profiles, setProfiles] = useState([])
  const [users, setUsers] = useState([])
  const [evals, setEvals] = useState([])
  const [objectives, setObjectives] = useState([])

  const [scope, setScope] = useState('tree') // tree | direct
  const [mien, setMien] = useState('')
  const [bu, setBu] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('manager')
  const [sort, setSort] = useState({ key: 'final', dir: 'desc' })
  const [exporting, setExporting] = useState(false)

  // ---------- tải danh mục người + kỳ
  useEffect(() => {
    ;(async () => {
      const [ps, { data: kp }, { data: us }] = await Promise.all([
        loadPeriods(12),
        supabase.from('kpi_profiles').select('username, manager_username'),
        supabase.from('kpi_users').select('username, ho_va_ten, mien, bu').order('ho_va_ten'),
      ])
      setPeriods(ps || [])
      const cur = currentPeriod()
      // Mặc định: kỳ gần nhất đã qua (đánh giá cuối tháng) nếu có, không thì kỳ mới nhất
      const list = (ps || []).map((p) => p.period)
      setPeriod(list.find((p) => p < cur) || list[0] || cur)
      setProfiles(kp || [])
      setUsers(us || [])
    })()
  }, [])

  const userMap = useMemo(() => new Map(users.map((u) => [u.username, u])), [users])
  const managerOf = useMemo(() => new Map(profiles.map((p) => [p.username, p.manager_username])), [profiles])

  // ---------- phạm vi nhân sự
  const scopeNames = useMemo(() => {
    if (!profiles.length) return []
    if (isAdmin && scope === 'tree') return users.map((u) => u.username).filter((u) => u !== username)
    const children = new Map()
    for (const p of profiles) {
      if (!p.manager_username) continue
      if (!children.has(p.manager_username)) children.set(p.manager_username, [])
      children.get(p.manager_username).push(p.username)
    }
    if (scope === 'direct') return children.get(username) || []
    const out = []
    const seen = new Set([username])
    const queue = [...(children.get(username) || [])]
    while (queue.length) {
      const u = queue.shift()
      if (seen.has(u)) continue
      seen.add(u)
      out.push(u)
      queue.push(...(children.get(u) || []))
    }
    return out
  }, [profiles, users, scope, username, isAdmin])

  // ---------- tải phiếu 6 kỳ + mục tiêu kỳ đang xem
  useEffect(() => {
    if (!period || !profiles.length) return
    ;(async () => {
      setLoading(true)
      const from = shiftPeriod(period, -(TREND_MONTHS - 1))
      const all = []
      // chia lô để URL không quá dài
      for (let i = 0; i < scopeNames.length; i += 150) {
        const { data } = await supabase
          .from('evaluations')
          .select('*')
          .in('username', scopeNames.slice(i, i + 150))
          .gte('period', from)
          .lte('period', period)
        all.push(...(data || []))
      }
      // Nhân viên KHÔNG có tài khoản: theo N+1 phụ trách (manager_username)
      let na = supabase
        .from('evaluations')
        .select('*')
        .is('username', null)
        .gte('period', from)
        .lte('period', period)
      if (!(isAdmin && scope === 'tree')) {
        const mgrs = scope === 'direct' ? [username] : [username, ...scopeNames]
        na = na.in('manager_username', mgrs.slice(0, 300))
      }
      const { data: naData } = await na
      all.push(...(naData || []))
      setEvals(all)
      const ids = all.filter((e) => e.period === period).map((e) => e.id)
      const objs = []
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase
          .from('objectives')
          .select('*')
          .in('evaluation_id', ids.slice(i, i + 150))
          .order('position')
        objs.push(...(data || []))
      }
      setObjectives(objs)
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, scopeNames, profiles.length])

  // ---------- dữ liệu từng người cho kỳ đang xem
  const people = useMemo(() => {
    const evBy = new Map()
    for (const e of evals) evBy.set(`${personKey(e)}|${e.period}`, e)
    // Tên mới nhất LẤY TỪ FILE của mỗi người (cả người có tài khoản) — ưu tiên hơn tên hệ thống
    const naPeople = new Map()
    const fileName = new Map()
    for (const e of [...evals].sort((a, b) => b.period.localeCompare(a.period))) {
      const k = personKey(e)
      if (e.employee_name && !fileName.has(k)) fileName.set(k, e.employee_name)
      if (e.username) continue
      if (!naPeople.has(k)) naPeople.set(k, { name: e.employee_name, manager: e.manager_username })
    }
    const objBy = new Map()
    for (const o of objectives) {
      if (!objBy.has(o.evaluation_id)) objBy.set(o.evaluation_id, [])
      objBy.get(o.evaluation_id).push(o)
    }
    const prev = shiftPeriod(period || currentPeriod(), -1)
    const keys = [...scopeNames, ...naPeople.keys()]
    return keys.map((key) => {
      const na = naPeople.get(key)
      const un = na ? '' : key
      const u = na ? { ho_va_ten: na.name } : userMap.get(un) || { username: un }
      const ev = evBy.get(`${key}|${period}`) || null
      const pe = evBy.get(`${key}|${prev}`) || null
      const done = ev && ev.status !== 'draft'
      const fin = done ? finalScore(ev) : null
      const reviewed = ev && (ev.status === 'reviewed' || ev.status === 'approved') && Number(ev.manager_total) > 0
      const mgrName = na ? na.manager : managerOf.get(un)
      return {
        key,
        username: un,
        noAccount: !!na,
        // Tên lấy từ file Excel (kỳ đang xem, rồi kỳ gần nhất); chỉ dùng tên hệ thống khi chưa từng nhập file
        ho_va_ten: ev?.employee_name || fileName.get(key) || u.ho_va_ten || un,
        mien: u.mien || '',
        bu: u.bu || '',
        managerUsername: mgrName || '',
        manager: userMap.get(mgrName)?.ho_va_ten || mgrName || '',
        evaluation: ev,
        stage: ev ? ev.status : 'none',
        objectives: ev ? objBy.get(ev.id) || [] : [],
        self: done ? Number(ev.self_total) : null,
        mgr: reviewed ? Number(ev.manager_total) : null,
        gap: reviewed ? round2(Number(ev.manager_total) - Number(ev.self_total)) : null,
        final: fin,
        grade: done ? gradeOf(fin) : null,
        prevFinal: pe && pe.status !== 'draft' ? finalScore(pe) : null,
      }
    })
  }, [scopeNames, userMap, managerOf, evals, objectives, period])

  const mienOptions = useMemo(() => [...new Set(people.map((p) => p.mien).filter(Boolean))].sort(), [people])
  const buOptions = useMemo(() => [...new Set(people.map((p) => p.bu).filter(Boolean))].sort(), [people])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people.filter(
      (p) =>
        (!mien || p.mien === mien) &&
        (!bu || p.bu === bu) &&
        (!q || p.ho_va_ten.toLowerCase().includes(q) || p.username.toLowerCase().includes(q))
    )
  }, [people, mien, bu, search])

  // ---------- chỉ số tổng
  const kpis = useMemo(() => {
    const n = filtered.length
    const submitted = filtered.filter((p) => p.final !== null)
    const pending = filtered.filter((p) => p.stage === 'submitted').length
    const pass = submitted.filter((p) => p.grade === 'ĐẠT').length
    const prevScores = filtered.map((p) => p.prevFinal).filter((x) => x !== null)
    return {
      n,
      submitted: submitted.length,
      pending,
      avgFinal: avg(submitted.map((p) => p.final)),
      prevAvg: avg(prevScores),
      pass,
      passRate: submitted.length ? Math.round((pass / submitted.length) * 100) : null,
    }
  }, [filtered])

  const stageCounts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s.key, []]))
    for (const p of filtered) c[p.stage].push(p)
    return c
  }, [filtered])

  const bins = useMemo(
    () =>
      BINS.map((b) => ({
        ...b,
        people: filtered.filter((p) => p.final !== null && p.final >= b.lo && p.final < b.hi),
      })),
    [filtered]
  )

  const groups = useMemo(() => {
    const keyOf = (p) => (groupBy === 'mien' ? p.mien : groupBy === 'bu' ? p.bu : p.manager) || '(Chưa gán)'
    const m = new Map()
    for (const p of filtered) {
      const k = keyOf(p)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(p)
    }
    return [...m.entries()]
      .map(([k, list]) => {
        const done = list.filter((p) => p.final !== null)
        return {
          key: k,
          n: list.length,
          done: done.length,
          avg: avg(done.map((p) => p.final)),
          pass: done.filter((p) => p.grade === 'ĐẠT').length,
        }
      })
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  }, [filtered, groupBy])

  const gaps = useMemo(
    () => filtered.filter((p) => p.gap !== null && p.gap !== 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)),
    [filtered]
  )

  const categoryStats = useMemo(() => {
    const evIds = new Set(filtered.filter((p) => p.evaluation).map((p) => p.evaluation.id))
    const m = new Map()
    for (const o of objectives) {
      if (!evIds.has(o.evaluation_id)) continue
      const k = o.category || 'Khác'
      if (!m.has(k)) m.set(k, { key: k, count: 0, weight: 0, selfW: 0, mgrW: 0, mgrWeight: 0 })
      const s = m.get(k)
      const w = Number(o.weight) || 0
      s.count++
      s.weight += w
      s.selfW += w * (Number(o.self_result) || 0)
      if (o.manager_result !== null && o.manager_result !== undefined) {
        s.mgrW += w * Number(o.manager_result)
        s.mgrWeight += w
      }
    }
    const totalW = [...m.values()].reduce((s, x) => s + x.weight, 0) || 1
    return [...m.values()]
      .map((s) => ({
        ...s,
        share: round2((s.weight / totalW) * 100),
        selfAvg: s.weight ? round2(s.selfW / s.weight) : null,
        mgrAvg: s.mgrWeight ? round2(s.mgrW / s.mgrWeight) : null,
      }))
      .sort((a, b) => b.weight - a.weight)
  }, [objectives, filtered])

  const trendPeriods = useMemo(
    () => (period ? Array.from({ length: TREND_MONTHS }, (_, i) => shiftPeriod(period, i - (TREND_MONTHS - 1))) : []),
    [period]
  )
  const trend = useMemo(() => {
    const evBy = new Map()
    for (const e of evals) evBy.set(`${personKey(e)}|${e.period}`, e)
    const rows = filtered.map((p) => ({
      ...p,
      cells: trendPeriods.map((tp) => {
        const e = evBy.get(`${p.key}|${tp}`)
        return e && e.status !== 'draft' ? { score: finalScore(e), id: e.id, status: e.status } : null
      }),
    }))
    const avgRow = trendPeriods.map((_, i) => avg(rows.map((r) => r.cells[i]?.score).filter((x) => x !== undefined && x !== null)))
    return { rows, avgRow }
  }, [filtered, evals, trendPeriods])

  const tableRows = useMemo(() => {
    const list = statusFilter ? filtered.filter((p) => p.stage === statusFilter) : filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (p) => {
      const v = p[sort.key]
      return v === null || v === undefined || v === '' ? null : v
    }
    return [...list].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return (typeof va === 'string' ? va.localeCompare(vb, 'vi') : va - vb) * dir
    })
  }, [filtered, statusFilter, sort])

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await buildTeamSummary({ period, people: tableRows })
      downloadBlob(blob, `Tong hop KPI doi_${period}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ho_va_ten' ? 'asc' : 'desc' }))
  }

  if (!period) return <Spinner />

  const maxBin = Math.max(1, ...bins.map((b) => b.people.length))
  const maxGap = Math.max(5, ...gaps.map((g) => Math.abs(g.gap)))
  const delta = kpis.avgFinal !== null && kpis.prevAvg !== null ? round2(kpis.avgFinal - kpis.prevAvg) : null

  return (
    <div>
      {tipNode}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Báo cáo quản lý</h1>
          <p className="text-sm text-slate-500">
            Kết quả KPI {formatPeriod(period)} của {scope === 'direct' ? 'cấp dưới trực tiếp' : isAdmin ? 'toàn công ty' : 'toàn bộ cây quản lý'} ·
            Ngưỡng ĐẠT {PASS_THRESHOLD}% · KQ cuối cùng = KQ của N+1 (nếu đã chấm), ngược lại KQ của N
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {exporting ? 'Đang xuất...' : '⬇ Xuất Excel tổng hợp'}
        </button>
      </div>

      {/* Bộ lọc — 1 hàng phía trên toàn bộ biểu đồ */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="Kỳ">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input">
            {periods.map((p) => (
              <option key={p.period} value={p.period}>
                {formatPeriod(p.period)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phạm vi">
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="input">
            <option value="tree">{isAdmin ? 'Toàn công ty' : 'Toàn bộ cấp dưới'}</option>
            <option value="direct">Cấp dưới trực tiếp</option>
          </select>
        </Field>
        <Field label="Miền">
          <select value={mien} onChange={(e) => setMien(e.target.value)} className="input">
            <option value="">Tất cả</option>
            {mienOptions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="BU">
          <select value={bu} onChange={(e) => setBu(e.target.value)} className="input">
            <option value="">Tất cả</option>
            {buOptions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Tìm nhân viên">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên / username" className="input w-48" />
        </Field>
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Không có nhân viên nào trong phạm vi / bộ lọc này.
        </div>
      ) : (
        <>
          {/* Thẻ chỉ số */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Nhân sự trong phạm vi" value={kpis.n} />
            <Tile
              label="Đã nộp kết quả"
              value={`${kpis.submitted}/${kpis.n}`}
              sub={`${Math.round((kpis.submitted / kpis.n) * 100)}% hoàn thành`}
            />
            <Tile label="Chờ duyệt" value={kpis.pending} sub="Đã gửi, N+1 chưa chấm — bấm để lọc" onClick={() => setStatusFilter('submitted')} />
            <Tile
              label="Điểm TB cuối cùng"
              value={kpis.avgFinal === null ? '—' : `${kpis.avgFinal}%`}
              sub={delta === null ? 'Chưa có kỳ trước để so' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} điểm so với kỳ trước`}
            />
            <Tile
              label="Tỷ lệ ĐẠT"
              value={kpis.passRate === null ? '—' : `${kpis.passRate}%`}
              sub={`${kpis.pass} ĐẠT · ${kpis.submitted - kpis.pass} KHÔNG ĐẠT`}
            />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Tiến độ quy trình */}
            <Card title="Tiến độ quy trình" sub="Số người theo trạng thái phiếu — bấm để lọc bảng chi tiết">
              <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded">
                {STAGES.map((s) => {
                  const c = stageCounts[s.key].length
                  if (!c) return null
                  return (
                    <button
                      key={s.key}
                      onClick={() => setStatusFilter(statusFilter === s.key ? '' : s.key)}
                      className="h-full transition-opacity hover:opacity-80"
                      style={{ width: `${(c / filtered.length) * 100}%`, background: s.color, outline: statusFilter === s.key ? '2px solid #0b0b0b' : 'none', outlineOffset: -2 }}
                      {...bindTip(
                        <>
                          <div className="font-semibold">
                            {s.label}: {c} người
                          </div>
                          <div className="mt-1 text-slate-500">{stageCounts[s.key].slice(0, 12).map((p) => p.ho_va_ten).join(', ')}{c > 12 ? '…' : ''}</div>
                        </>
                      )}
                    />
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {STAGES.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                    {s.label} <b className="tabular-nums text-slate-800">{stageCounts[s.key].length}</b>
                  </span>
                ))}
              </div>
            </Card>

            {/* Phân bố kết quả */}
            <Card title="Phân bố kết quả cuối cùng" sub={`Số người theo khoảng điểm · ${kpis.submitted} người đã có kết quả`}>
              <div className="flex h-36 items-end gap-3 border-b border-slate-200 px-1">
                {bins.map((b, i) => {
                  const c = b.people.length
                  return (
                    <div key={b.label} className="relative flex h-full flex-1 flex-col items-center justify-end">
                      {i === 3 && (
                        <div className="absolute -left-[7px] bottom-0 top-0 border-l border-dashed border-slate-400">
                          <span className="absolute -top-1 left-1 whitespace-nowrap text-[10px] text-slate-500">Ngưỡng ĐẠT {PASS_THRESHOLD}%</span>
                        </div>
                      )}
                      <span className="mb-1 text-xs font-semibold tabular-nums text-slate-700">{c || ''}</span>
                      <div
                        className="w-full max-w-[56px] rounded-t"
                        style={{ height: `${(c / maxBin) * 80}%`, minHeight: c ? 4 : 0, background: POS }}
                        {...bindTip(
                          <>
                            <div className="font-semibold">
                              {b.label}: {c} người
                            </div>
                            {c > 0 && <div className="mt-1 text-slate-500">{b.people.map((p) => `${p.ho_va_ten} (${p.final}%)`).join(', ')}</div>}
                          </>
                        )}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="mt-1 flex gap-3 px-1">
                {bins.map((b) => (
                  <div key={b.label} className="flex-1 text-center text-[11px] text-slate-500">
                    {b.label}
                  </div>
                ))}
              </div>
            </Card>

            {/* So sánh theo nhóm */}
            <Card
              title="So sánh theo nhóm"
              sub="Điểm TB cuối cùng và tỷ lệ ĐẠT của từng nhóm"
              right={
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="input py-1 text-xs">
                  <option value="manager">Theo quản lý trực tiếp</option>
                  <option value="mien">Theo Miền</option>
                  <option value="bu">Theo BU</option>
                </select>
              }
            >
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="pb-2 font-medium">Nhóm</th>
                    <th className="pb-2 text-right font-medium">Đã nộp</th>
                    <th className="w-[40%] pb-2 pl-3 font-medium">Điểm TB</th>
                    <th className="pb-2 text-right font-medium">ĐẠT</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-800">{g.key}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">
                        {g.done}/{g.n}
                      </td>
                      <td className="py-1.5 pl-3">
                        {g.avg === null ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <div className="flex items-center gap-2" {...bindTip(`${g.key}: TB ${g.avg}% (${g.done} người có kết quả)`)}>
                            <div className="h-2.5 flex-1 rounded bg-slate-100">
                              <div className="h-full rounded" style={{ width: `${Math.min(100, g.avg)}%`, background: POS }} />
                            </div>
                            <span className="w-12 text-right text-xs font-semibold tabular-nums text-slate-800">{g.avg}%</span>
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-xs tabular-nums text-slate-700">
                        {g.done ? `${Math.round((g.pass / g.done) * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Chênh lệch N vs N+1 */}
            <Card title="Chênh lệch: N+1 chấm so với tự đánh giá" sub="Điểm N+1 − điểm N (chỉ phiếu N+1 đã chấm). Âm = nhân viên tự đánh giá cao hơn quản lý">
              {gaps.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">Chưa có phiếu nào N+1 chấm khác tự đánh giá.</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                  {gaps.slice(0, 15).map((g) => {
                    const w = (Math.abs(g.gap) / maxGap) * 50
                    return (
                      <div key={g.key} className="flex items-center gap-2 text-xs" {...bindTip(`${g.ho_va_ten}: N ${g.self}% → N+1 ${g.mgr}% (${g.gap > 0 ? '+' : ''}${g.gap})`)}>
                        <span className="w-36 truncate text-slate-700">{g.ho_va_ten}</span>
                        <div className="relative h-3 flex-1">
                          <div className="absolute bottom-0 left-1/2 top-0 w-px bg-slate-300" />
                          <div
                            className="absolute top-0 h-full"
                            style={{
                              background: g.gap > 0 ? POS : NEG,
                              width: `${w}%`,
                              left: g.gap > 0 ? '50%' : `${50 - w}%`,
                              borderRadius: g.gap > 0 ? '0 4px 4px 0' : '4px 0 0 4px',
                            }}
                          />
                        </div>
                        <span className="w-12 text-right font-semibold tabular-nums text-slate-800">
                          {g.gap > 0 ? '+' : ''}
                          {g.gap}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NEG }} /> N+1 chấm thấp hơn
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: POS }} /> N+1 chấm cao hơn
                </span>
              </div>
            </Card>
          </div>

          {/* Cơ cấu mục tiêu */}
          {categoryStats.length > 0 && (
            <Card title="Cơ cấu mục tiêu theo nhóm" sub="Tỷ trọng trọng số và mức hoàn thành bình quân (có trọng số) của từng nhóm mục tiêu" className="mb-5">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="pb-2 font-medium">Nhóm mục tiêu</th>
                    <th className="pb-2 text-right font-medium">Số mục tiêu</th>
                    <th className="w-1/3 pb-2 pl-3 font-medium">Tỷ trọng</th>
                    <th className="pb-2 text-right font-medium">TB KQ của N</th>
                    <th className="pb-2 text-right font-medium">TB KQ của N+1</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryStats.map((c) => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className="py-1.5 text-slate-800">{c.key}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">{c.count}</td>
                      <td className="py-1.5 pl-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 rounded bg-slate-100">
                            <div className="h-full rounded" style={{ width: `${c.share}%`, background: POS }} />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums text-slate-700">{c.share}%</span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700">{c.selfAvg === null ? '—' : `${c.selfAvg}%`}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700">{c.mgrAvg === null ? '—' : `${c.mgrAvg}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Xu hướng 6 kỳ */}
          <Card
            title={`Xu hướng ${TREND_MONTHS} kỳ gần nhất`}
            sub="Kết quả cuối cùng theo từng kỳ — màu đậm hơn = điểm cao hơn; dấu ● đỏ = dưới ngưỡng ĐẠT. Bấm ô để mở phiếu."
            className="mb-5"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="px-2 py-1 text-left font-medium">Nhân viên</th>
                    {trendPeriods.map((tp) => (
                      <th key={tp} className={`px-2 py-1 font-medium ${tp === period ? 'text-slate-900' : ''}`}>
                        {tp.slice(5)}/{tp.slice(2, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-1 font-semibold text-slate-800">Trung bình đội</td>
                    {trend.avgRow.map((v, i) => (
                      <td key={i} className="px-2 py-1 text-center font-semibold tabular-nums text-slate-800">
                        {v === null ? '—' : `${v}%`}
                      </td>
                    ))}
                  </tr>
                  {trend.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="max-w-[12rem] truncate px-2 py-1 text-slate-700">{r.ho_va_ten}</td>
                      {r.cells.map((c, i) =>
                        c ? (
                          <td
                            key={i}
                            onClick={() => navigate(`/danh-gia/${c.id}`)}
                            className="cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-center tabular-nums"
                            style={{ background: seqColor(c.score), color: c.score >= 85 ? '#fff' : '#0b0b0b' }}
                            {...bindTip(`${r.ho_va_ten} · ${formatPeriod(trendPeriods[i])}: ${c.score}% — ${gradeOf(c.score)} (${STATUS_LABELS[c.status]})`)}
                          >
                            {c.score < PASS_THRESHOLD && (
                              <span
                                className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                                style={{ background: CRITICAL, boxShadow: '0 0 0 1.5px #fff' }}
                              />
                            )}
                            {c.score}
                          </td>
                        ) : (
                          <td key={i} className="rounded bg-slate-50 px-2 py-1.5 text-center text-slate-300">
                            ·
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Bảng chi tiết */}
          <Card
            title="Chi tiết từng nhân viên"
            sub={statusFilter ? `Đang lọc: ${STAGES.find((s) => s.key === statusFilter)?.label}` : 'Bấm tiêu đề cột để sắp xếp'}
            right={
              statusFilter && (
                <button onClick={() => setStatusFilter('')} className="text-xs text-brand-600 hover:underline">
                  Bỏ lọc trạng thái
                </button>
              )
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr>
                    <Th k="ho_va_ten" sort={sort} onSort={toggleSort}>Nhân viên</Th>
                    <Th k="mien" sort={sort} onSort={toggleSort}>Miền / BU</Th>
                    <Th k="manager" sort={sort} onSort={toggleSort}>QL trực tiếp</Th>
                    <Th k="stage" sort={sort} onSort={toggleSort}>Trạng thái</Th>
                    <Th k="self" sort={sort} onSort={toggleSort} right>KQ N</Th>
                    <Th k="mgr" sort={sort} onSort={toggleSort} right>KQ N+1</Th>
                    <Th k="gap" sort={sort} onSort={toggleSort} right>Chênh lệch</Th>
                    <Th k="final" sort={sort} onSort={toggleSort} right>Cuối cùng</Th>
                    <Th k="grade" sort={sort} onSort={toggleSort}>Xếp loại</Th>
                    <Th k="prevFinal" sort={sort} onSort={toggleSort} right>Kỳ trước</Th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableRows.map((p) => {
                    const d = p.final !== null && p.prevFinal !== null ? round2(p.final - p.prevFinal) : null
                    return (
                      <tr key={p.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{p.ho_va_ten}</div>
                          <div className="text-xs text-slate-400">
                            {p.noAccount ? 'Không có tài khoản' : p.username} · {p.objectives.length} mục tiêu
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{[p.mien, p.bu].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{p.manager || '—'}</td>
                        <td className="px-3 py-2">
                          {p.evaluation ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[p.stage]}`}>{STATUS_LABELS[p.stage]}</span>
                          ) : (
                            <span className="text-xs text-slate-400">Chưa có phiếu</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.self === null ? '—' : `${p.self}%`}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.mgr === null ? '—' : `${p.mgr}%`}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {p.gap === null ? '—' : `${p.gap > 0 ? '+' : ''}${p.gap}`}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{p.final === null ? '—' : `${p.final}%`}</td>
                        <td className="px-3 py-2">
                          {p.grade && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_COLORS[p.grade]}`}>
                              {p.grade === 'ĐẠT' ? '✓' : '✕'} {p.grade}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">
                          {p.prevFinal === null ? '—' : `${p.prevFinal}%`}
                          {d !== null && d !== 0 && (
                            <div className="text-slate-500">
                              {d > 0 ? '▲' : '▼'} {Math.abs(d)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {p.evaluation && (
                            <button
                              onClick={() => navigate(`/danh-gia/${p.evaluation.id}`)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              {p.stage === 'submitted' && p.managerUsername === username ? 'Chấm điểm' : 'Xem'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}

function Tile({ label, value, sub, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick} className={`rounded-xl border border-slate-200 bg-white p-4 text-left ${onClick ? 'hover:border-brand-300' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Comp>
  )
}

function Card({ title, sub, right, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Th({ k, sort, onSort, right, children }) {
  const active = sort.key === k
  return (
    <th className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-slate-900 ${right ? 'text-right' : ''}`} onClick={() => onSort(k)}>
      {children}
      {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
