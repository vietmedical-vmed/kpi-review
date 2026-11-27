// CHI TIẾT PHIẾU — xem, điều chỉnh, duyệt, xuất Excel.
//  • Người nhập: sửa mọi thông tin khi phiếu còn "Chờ duyệt".
//  • Người duyệt (N+1) / admin: điều chỉnh rồi "Duyệt"; "Bỏ duyệt" để mở lại.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  displayName,
  evalPermissions,
  formatPeriod,
  gradeOf,
  isApproved,
  normalizeName,
  PASS_THRESHOLD,
  round2,
} from '../lib/constants'
import { loadPeople, userLabel } from '../lib/people'
import { exportEvaluations } from '../lib/exportKpi'
import { Alert, ApproverSelect, GradeBadge, StatusBadge } from '../components/ui'
import Spinner from '../components/Spinner'

let tempId = 0
const emptyRow = () => ({
  id: `tmp-${tempId++}`,
  _new: true,
  category: 'Khác',
  name: '',
  target: '',
  measure_method: '',
  weight: '',
  reference_doc: '',
  self_result: '',
  manager_result: '',
})

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const coeff = (w, r) => round2(((Number(w) || 0) * (Number(r) || 0)) / 100)

export default function EvaluationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { username, isAdmin, canUpload } = useAuth()

  const [ev, setEv] = useState(null)
  const [people, setPeople] = useState(null)
  const [directManager, setDirectManager] = useState(null)
  const [rows, setRows] = useState([])
  const [removed, setRemoved] = useState([])
  const [form, setForm] = useState({ employee_name: '', manager_username: '', registration_comment: '', manager_comment: '' })
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase.from('evaluations').select('*').eq('id', id).maybeSingle()
    if (err || !data) {
      setError(err ? 'Không tải được phiếu: ' + err.message : 'Không tìm thấy phiếu hoặc bạn không có quyền xem.')
      setLoading(false)
      return
    }
    const [{ data: objs }, pp, { data: kp }] = await Promise.all([
      supabase.from('objectives').select('*').eq('evaluation_id', id).order('position'),
      people ? Promise.resolve(people) : loadPeople(),
      supabase.from('kpi_profiles').select('manager_username').eq('username', data.username || '__none__').maybeSingle(),
    ])
    setEv(data)
    setPeople(pp)
    setDirectManager(kp?.manager_username || null)
    setRows(objs || [])
    setRemoved([])
    setForm({
      employee_name: data.employee_name || '',
      manager_username: data.manager_username || '',
      registration_comment: data.registration_comment || '',
      manager_comment: data.manager_comment || '',
    })
    setDirty(false)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const perm = evalPermissions(ev, { username, isAdmin, canUpload, directManager })
  const approved = isApproved(ev)
  const canEdit = perm.edit && !approved // phiếu đã duyệt phải "Bỏ duyệt" mới sửa
  const canChangeApprover = canEdit && !ev?.username && (isAdmin || perm.isUploader)

  const totals = useMemo(() => {
    const weight = round2(rows.reduce((s, r) => s + (Number(r.weight) || 0), 0))
    const self = round2(rows.reduce((s, r) => s + coeff(r.weight, r.self_result), 0))
    const manager = round2(rows.reduce((s, r) => s + coeff(r.weight, r.manager_result), 0))
    const final = manager === 0 ? self : manager
    const hasAny = self > 0 || manager > 0
    return { weight, self, manager, final, grade: hasAny ? gradeOf(final) : null }
  }, [rows])
  const weightOk = Math.abs(totals.weight - 100) <= 0.01

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
  }
  function updateRow(rowId, k, v) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [k]: v } : r)))
    setDirty(true)
  }
  function removeRow(rowId) {
    setRows((prev) => prev.filter((r) => r.id !== rowId))
    if (!String(rowId).startsWith('tmp-')) setRemoved((prev) => [...prev, rowId])
    setDirty(true)
  }

  function validate() {
    if (!ev.username && !form.employee_name.trim()) return 'Chưa có tên nhân viên.'
    if (!rows.length) return 'Phiếu chưa có mục tiêu nào.'
    if (rows.some((r) => !String(r.name || '').trim())) return 'Có dòng chưa nhập Tên mục tiêu.'
    for (const r of rows)
      for (const [k, label] of [['weight', 'Trọng số'], ['self_result', 'KQ của N'], ['manager_result', 'KQ của N+1']]) {
        const v = num(r[k])
        if (v !== null && (Number.isNaN(v) || v < 0 || v > 100)) return `${label} phải trong 0–100%.`
      }
    if (!weightOk) return `Tổng trọng số phải bằng 100% (đang ${totals.weight}%).`
    return null
  }

  async function persist(extra = {}) {
    if (removed.length) {
      const { error: e } = await supabase.from('objectives').delete().in('id', removed)
      if (e) throw e
    }
    const inserts = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const payload = {
        position: i + 1,
        category: r.category || 'Khác',
        name: r.name,
        target: r.target,
        measure_method: r.measure_method,
        weight: num(r.weight) ?? 0,
        reference_doc: r.reference_doc,
        self_result: num(r.self_result) ?? 0,
        manager_result: num(r.manager_result),
      }
      if (r._new) inserts.push({ ...payload, evaluation_id: id })
      else {
        const { error: e } = await supabase.from('objectives').update(payload).eq('id', r.id)
        if (e) throw e
      }
    }
    if (inserts.length) {
      const { error: e } = await supabase.from('objectives').insert(inserts)
      if (e) throw e
    }
    const upd = {
      self_total: totals.self,
      manager_total: totals.manager,
      registration_comment: form.registration_comment || null,
      manager_comment: form.manager_comment || null,
      ...extra,
    }
    if (!ev.username) {
      const name = form.employee_name.trim()
      upd.employee_name = name
      upd.employee_key = normalizeName(name)
      if (canChangeApprover && form.manager_username) upd.manager_username = form.manager_username
    }
    const { error: e } = await supabase.from('evaluations').update(upd).eq('id', id)
    if (e) throw e
  }

  async function run(kind, fn, okMsg) {
    setBusy(kind)
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(okMsg)
      await load()
    } catch (e) {
      const msg = e.message || String(e)
      setError(
        /duplicate|uq_eval/i.test(msg)
          ? 'Đã có phiếu khác cùng tên nhân viên, kỳ và người duyệt.'
          : 'Không lưu được: ' + msg
      )
    } finally {
      setBusy('')
    }
  }

  function handleSave() {
    const why = validate()
    if (why) return setError(why)
    run('save', () => persist(), 'Đã lưu thay đổi.')
  }

  function handleApprove() {
    const why = validate()
    if (why) return setError(why)
    if (!window.confirm('Duyệt phiếu này? Sau khi duyệt, người nhập không sửa được nữa.')) return
    const now = new Date().toISOString()
    run('approve', () => persist({ status: 'approved', approved_at: now, reviewed_at: now }), 'Đã duyệt phiếu.')
  }

  function handleUnapprove() {
    run(
      'unapprove',
      async () => {
        const { error: e } = await supabase.from('evaluations').update({ status: 'submitted', approved_at: null }).eq('id', id)
        if (e) throw e
      },
      'Đã bỏ duyệt — phiếu trở lại Chờ duyệt.'
    )
  }

  async function handleExport() {
    if (dirty && !window.confirm('Có thay đổi chưa lưu — file xuất sẽ dùng dữ liệu đã lưu. Tiếp tục?')) return
    setBusy('export')
    setError('')
    try {
      const res = await exportEvaluations([ev])
      setMessage(
        res.fallback.length
          ? `Đã xuất theo mẫu chuẩn (${res.fallback[0].reason}).`
          : ev.source_file_id
            ? 'Đã xuất theo file gốc với số liệu mới nhất.'
            : 'Đã xuất theo mẫu chuẩn (phiếu chưa có file gốc).'
      )
    } catch (e) {
      setError('Không xuất được file: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleDelete() {
    if (!window.confirm('Xoá phiếu này? Không khôi phục được.')) return
    setBusy('delete')
    const { error: e } = await supabase.from('evaluations').delete().eq('id', id)
    setBusy('')
    if (e) setError('Không xoá được: ' + e.message)
    else navigate('/phieu')
  }

  if (loading && !ev) return <Spinner />
  if (!ev) return <Alert>{error}</Alert>

  const name = displayName(ev, people?.userMap.get(ev.username))
  const approverUn = ev.username ? directManager : ev.manager_username

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/phieu')} className="mb-1 text-sm text-slate-500 hover:text-slate-700">
            ← Danh sách phiếu
          </button>
          <h1 className="text-xl font-bold text-slate-800">
            {name} — {formatPeriod(ev.period)}
          </h1>
          <p className="text-sm text-slate-500">
            Người duyệt: <b>{userLabel(people.userMap, approverUn) || '—'}</b>
            {ev.imported_by && <> · Nhập bởi {userLabel(people.userMap, ev.imported_by)}</>}
            {ev.imported_at && <> · {new Date(ev.imported_at).toLocaleString('vi-VN')}</>}
            {ev.source_file && <> · File: {ev.source_file}</>}
          </p>
        </div>
        <div className="text-right">
          <StatusBadge status={ev.status} />
          {approved && ev.approved_at && (
            <div className="mt-1 text-xs text-slate-500">Duyệt lúc {new Date(ev.approved_at).toLocaleString('vi-VN')}</div>
          )}
        </div>
      </div>

      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>
      {approved && (
        <Alert kind="info">
          Phiếu đã duyệt nên bị khoá.{perm.approve ? ' Bấm "Bỏ duyệt" nếu cần điều chỉnh lại.' : ''}
        </Alert>
      )}

      {canEdit && !ev.username && (
        <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Họ tên nhân viên</label>
            <input value={form.employee_name} onChange={(e) => setField('employee_name', e.target.value)} className="input w-64" />
          </div>
          {canChangeApprover && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Người duyệt (N+1)</label>
              <ApproverSelect
                value={form.manager_username}
                onChange={(v) => setField('manager_username', v)}
                users={people.users}
                managerSet={people.managerSet}
                me={username}
                className="input min-w-[16rem]"
              />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="bg-slate-50 text-left align-bottom text-slate-600">
            <tr>
              <th className="px-2 py-2 font-medium">STT</th>
              <th className="min-w-[11rem] px-2 py-2 font-medium">Tên mục tiêu</th>
              <th className="min-w-[17rem] px-2 py-2 font-medium">Mục tiêu cần đạt</th>
              <th className="min-w-[17rem] px-2 py-2 font-medium">Cách thức đo</th>
              <th className="px-2 py-2 text-right font-medium">Trọng số %</th>
              <th className="min-w-[11rem] px-2 py-2 font-medium">Tài liệu tham chiếu</th>
              <th className="px-2 py-2 text-right font-medium">KQ của N %</th>
              <th className="px-2 py-2 text-right font-medium">Hệ số N</th>
              <th className="px-2 py-2 text-right font-medium text-blue-700">KQ của N+1 %</th>
              <th className="px-2 py-2 text-right font-medium text-blue-700">Hệ số N+1</th>
              {canEdit && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.id} className="align-top">
                <td className="px-2 py-2 text-slate-500">{i + 1}</td>
                <td className="px-2 py-2">
                  <Cell value={r.name} edit={canEdit} onChange={(v) => updateRow(r.id, 'name', v)} />
                </td>
                <td className="px-2 py-2">
                  <Cell value={r.target} edit={canEdit} onChange={(v) => updateRow(r.id, 'target', v)} />
                </td>
                <td className="px-2 py-2">
                  <Cell value={r.measure_method} edit={canEdit} onChange={(v) => updateRow(r.id, 'measure_method', v)} />
                </td>
                <td className="px-2 py-2 text-right">
                  <NumCell value={r.weight} edit={canEdit} onChange={(v) => updateRow(r.id, 'weight', v)} />
                </td>
                <td className="px-2 py-2">
                  <Cell value={r.reference_doc} edit={canEdit} onChange={(v) => updateRow(r.id, 'reference_doc', v)} />
                </td>
                <td className="px-2 py-2 text-right">
                  <NumCell value={r.self_result} edit={canEdit} onChange={(v) => updateRow(r.id, 'self_result', v)} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-700">{coeff(r.weight, r.self_result)}</td>
                <td className="px-2 py-2 text-right">
                  <NumCell value={r.manager_result} edit={canEdit} onChange={(v) => updateRow(r.id, 'manager_result', v)} blue />
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-blue-700">{coeff(r.weight, r.manager_result)}</td>
                {canEdit && (
                  <td className="px-2 py-2">
                    <button onClick={() => removeRow(r.id)} className="text-slate-400 hover:text-red-600" title="Xoá dòng">
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={4}>
                Tổng
              </td>
              <td className={`px-2 py-2 text-right tabular-nums ${weightOk ? 'text-slate-800' : 'text-red-600'}`}>{totals.weight}%</td>
              <td colSpan={2}></td>
              <td className="px-2 py-2 text-right tabular-nums">{totals.self}%</td>
              <td></td>
              <td className="px-2 py-2 text-right tabular-nums text-blue-700">{totals.manager}%</td>
              {canEdit && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {canEdit && (
        <button
          onClick={() => {
            setRows((prev) => [...prev, emptyRow()])
            setDirty(true)
          }}
          className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600"
        >
          + Thêm mục tiêu
        </button>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Kết quả của N" value={`${totals.self}%`} />
        <Tile label="Kết quả của N+1" value={totals.manager ? `${totals.manager}%` : '—'} sub={totals.manager ? null : 'Chưa có → lấy KQ của N'} />
        <Tile label="Kết quả cuối cùng" value={`${totals.final}%`} strong />
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Xếp loại (ngưỡng {PASS_THRESHOLD}%)</div>
          <div className="mt-1">
            <GradeBadge grade={totals.grade} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Comment label="Ý kiến của N+1 khi đăng ký" value={form.registration_comment} edit={canEdit} onChange={(v) => setField('registration_comment', v)} />
        <Comment label="Đánh giá của N+1" value={form.manager_comment} edit={canEdit} onChange={(v) => setField('manager_comment', v)} />
      </div>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={!!busy || !dirty}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'save' ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        )}
        {perm.approve && !approved && (
          <button
            onClick={handleApprove}
            disabled={!!busy}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy === 'approve' ? 'Đang duyệt...' : dirty ? '✓ Lưu & duyệt' : '✓ Duyệt'}
          </button>
        )}
        {perm.approve && approved && (
          <button
            onClick={handleUnapprove}
            disabled={!!busy}
            className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
          >
            {busy === 'unapprove' ? 'Đang xử lý...' : 'Bỏ duyệt'}
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={!!busy}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === 'export' ? 'Đang xuất...' : '⬇ Xuất Excel'}
        </button>
        {perm.remove && (
          <button onClick={handleDelete} disabled={!!busy} className="ml-auto text-sm text-red-600 hover:underline disabled:opacity-60">
            Xoá phiếu
          </button>
        )}
        {dirty && <span className="text-xs text-amber-700">Có thay đổi chưa lưu</span>}
      </div>
    </div>
  )
}

function Tile({ label, value, sub, strong }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? 'text-xl font-bold text-slate-900' : 'text-lg font-semibold text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

function Comment({ label, value, edit, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!edit}
        rows={3}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
      />
    </div>
  )
}

// Ô chữ hiển thị HẾT nội dung: chỉ đọc -> xuống dòng đầy đủ; sửa được -> textarea tự
// giãn chiều cao theo nội dung (không bị cắt, không cần cuộn trong ô).
function Cell({ value, edit, onChange }) {
  if (!edit) return <div className="whitespace-pre-wrap break-words text-slate-700">{value || '—'}</div>
  return <AutoTextarea value={value || ''} onChange={onChange} />
}

function AutoTextarea({ value, onChange }) {
  const ref = useRef(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }
  useLayoutEffect(fit, [value])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full resize-none overflow-hidden rounded border border-slate-300 px-1.5 py-1 text-xs leading-5"
    />
  )
}

function NumCell({ value, edit, onChange, blue }) {
  const empty = value === '' || value === null || value === undefined
  if (!edit) return <span className="tabular-nums text-slate-700">{empty ? '—' : `${value}%`}</span>
  return (
    <input
      type="number"
      min="0"
      max="100"
      step="0.5"
      value={empty ? '' : value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-20 rounded border px-1.5 py-1 text-right text-xs ${blue ? 'border-blue-300 bg-blue-50' : 'border-slate-300'}`}
    />
  )
}
