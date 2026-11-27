// DANH SÁCH PHIẾU — 1 màn hình chung cho người nhập, người duyệt, admin.
// RLS chỉ trả phiếu người dùng được xem (mình nhập, mình duyệt, cấp dưới, admin: tất cả).
//  • Người nhập: theo dõi trạng thái, mở phiếu để sửa khi còn Chờ duyệt.
//  • Người duyệt / admin: mở phiếu để điều chỉnh rồi duyệt, hoặc duyệt nhiều phiếu.
//  • Xuất Excel theo dữ liệu mới nhất, đúng biểu mẫu file đã upload.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  displayName,
  evalPermissions,
  finalScore,
  formatPeriod,
  gradeOf,
  hasResult,
  isApproved,
} from '../lib/constants'
import { loadPeriods } from '../lib/periods'
import { loadPeople, userLabel } from '../lib/people'
import { exportEvaluations } from '../lib/exportKpi'
import { Alert, Field, GradeBadge, StatusBadge, pct } from '../components/ui'
import Spinner from '../components/Spinner'

export default function KpiList() {
  const { username, isAdmin, canUpload } = useAuth()
  const navigate = useNavigate()

  const [periods, setPeriods] = useState([])
  const [people, setPeople] = useState(null)
  const [period, setPeriod] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('') // '' | pending | approved
  const [role, setRole] = useState('') // '' | mine | approve
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [ps, pp] = await Promise.all([loadPeriods(12), loadPeople()])
      setPeriods(ps)
      setPeople(pp)
    })()
  }, [])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('evaluations')
      .select('*')
      .order('period', { ascending: false })
      .order('employee_name')
    if (period) q = q.eq('period', period)
    const { data, error: err } = await q
    if (err) setError('Không tải được danh sách: ' + err.message)
    setRows(data || [])
    setSelected(new Set())
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const managerOf = useMemo(
    () => new Map((people?.profiles || []).map((p) => [p.username, p.manager_username])),
    [people]
  )

  const enriched = useMemo(() => {
    if (!people) return []
    return rows.map((ev) => {
      const perm = evalPermissions(ev, {
        username,
        isAdmin,
        canUpload,
        directManager: ev.username ? managerOf.get(ev.username) : null,
      })
      const approverUn = ev.username ? managerOf.get(ev.username) : ev.manager_username
      const fin = hasResult(ev) ? finalScore(ev) : null
      return {
        ev,
        perm,
        name: displayName(ev, people.userMap.get(ev.username)),
        approver: userLabel(people.userMap, approverUn) || '—',
        approverUn,
        uploader: userLabel(people.userMap, ev.imported_by) || '—',
        final: fin,
        grade: fin === null ? null : gradeOf(fin),
      }
    })
  }, [rows, people, username, isAdmin, canUpload, managerOf])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(
      (r) =>
        (!status || (status === 'approved') === isApproved(r.ev)) &&
        (!role || (role === 'mine' ? r.ev.imported_by === username : r.approverUn === username)) &&
        (!q || r.name.toLowerCase().includes(q) || r.approver.toLowerCase().includes(q))
    )
  }, [enriched, status, role, search, username])

  const counts = useMemo(() => {
    const pending = enriched.filter((r) => !isApproved(r.ev))
    return {
      toApprove: pending.filter((r) => r.approverUn === username).length,
      pending: pending.length,
      approved: enriched.length - pending.length,
      mine: enriched.filter((r) => r.ev.imported_by === username).length,
    }
  }, [enriched, username])

  const selRows = filtered.filter((r) => selected.has(r.ev.id))
  const exportTargets = selRows.length ? selRows : filtered
  const approvable = selRows.filter((r) => r.perm.approve && !isApproved(r.ev))

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.ev.id))
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filtered.map((r) => r.ev.id)))
  }

  async function handleExport() {
    setBusy('export')
    setError('')
    setMessage('')
    try {
      const res = await exportEvaluations(exportTargets.map((r) => r.ev))
      const fb = res.fallback.length
        ? ` ${res.fallback.length} phiếu xuất theo mẫu chuẩn vì: ${res.fallback.map((f) => `${f.name} (${f.reason})`).join('; ')}.`
        : ''
      setMessage(`Đã xuất ${res.files} file.${fb}`)
    } catch (e) {
      setError('Không xuất được file: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleApproveSelected() {
    if (!approvable.length) return
    if (!window.confirm(`Duyệt ${approvable.length} phiếu đã chọn? Sau khi duyệt, người nhập không sửa được nữa.`)) return
    setBusy('approve')
    setError('')
    const { error: err } = await supabase
      .from('evaluations')
      .update({ status: 'approved', approved_at: new Date().toISOString(), reviewed_at: new Date().toISOString() })
      .in('id', approvable.map((r) => r.ev.id))
    setBusy('')
    if (err) setError('Không duyệt được: ' + err.message)
    else {
      setMessage(`Đã duyệt ${approvable.length} phiếu.`)
      load()
    }
  }

  if (!people) return <Spinner />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Phiếu KPI</h1>
          <p className="text-sm text-slate-500">
            Nhập file → <b>Chờ duyệt</b> (người nhập còn sửa được) → người duyệt điều chỉnh & <b>Duyệt</b> → xuất Excel
            theo biểu mẫu gốc.
          </p>
        </div>
        {canUpload && (
          <Link to="/nhap" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + Nhập KPI từ Excel
          </Link>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Cần tôi duyệt" value={counts.toApprove} active={role === 'approve' && status === 'pending'} onClick={() => { setRole('approve'); setStatus('pending') }} />
        <Tile label="Chờ duyệt" value={counts.pending} active={!role && status === 'pending'} onClick={() => { setRole(''); setStatus('pending') }} />
        <Tile label="Đã duyệt" value={counts.approved} active={!role && status === 'approved'} onClick={() => { setRole(''); setStatus('approved') }} />
        <Tile label="Tôi đã nhập" value={counts.mine} active={role === 'mine' && !status} onClick={() => { setRole('mine'); setStatus('') }} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="Kỳ">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input">
            <option value="">Tất cả kỳ</option>
            {periods.map((p) => (
              <option key={p.period} value={p.period}>
                {formatPeriod(p.period)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trạng thái">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
            <option value="">Tất cả</option>
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
          </select>
        </Field>
        <Field label="Phiếu">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
            <option value="">Tất cả phiếu tôi xem được</option>
            <option value="mine">Tôi đã nhập</option>
            <option value="approve">Tôi là người duyệt</option>
          </select>
        </Field>
        <Field label="Tìm">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên nhân viên / người duyệt" className="input w-56" />
        </Field>
        <div className="ml-auto flex flex-wrap gap-2">
          {approvable.length > 0 && (
            <button
              onClick={handleApproveSelected}
              disabled={!!busy}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {busy === 'approve' ? 'Đang duyệt...' : `✓ Duyệt ${approvable.length} phiếu`}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={!!busy || !exportTargets.length}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === 'export' ? 'Đang xuất...' : `⬇ Xuất Excel (${selRows.length ? `${selRows.length} đã chọn` : `${filtered.length} phiếu`})`}
          </button>
        </div>
      </div>

      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th className="px-3 py-3 font-medium">Nhân viên</th>
                <th className="px-3 py-3 font-medium">Kỳ</th>
                <th className="px-3 py-3 font-medium">Người duyệt</th>
                <th className="px-3 py-3 font-medium">Trạng thái</th>
                <th className="px-3 py-3 text-right font-medium">KQ N</th>
                <th className="px-3 py-3 text-right font-medium">KQ N+1</th>
                <th className="px-3 py-3 font-medium">Cuối cùng</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    Không có phiếu nào.{canUpload ? ' Bấm "Nhập KPI từ Excel" để bắt đầu.' : ''}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const ev = r.ev
                const needMe = !isApproved(ev) && r.perm.approve
                return (
                  <tr key={ev.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(ev.id)} onChange={() => toggle(ev.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        Nhập bởi {r.uploader}
                        {ev.imported_at ? ` · ${new Date(ev.imported_at).toLocaleDateString('vi-VN')}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatPeriod(ev.period)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.approver}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={ev.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(Number(ev.self_total) || null)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(Number(ev.manager_total) || null)}</td>
                    <td className="px-3 py-2">
                      <GradeBadge grade={r.grade} score={r.final} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => navigate(`/phieu/${ev.id}`)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          needMe
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {needMe ? 'Xem & duyệt' : r.perm.edit ? 'Sửa' : 'Xem'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left transition ${
        active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-300'
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
    </button>
  )
}
