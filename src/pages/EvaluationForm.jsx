import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  CATEGORIES,
  formatPeriod,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../lib/constants'
import Spinner from '../components/Spinner'

let tempId = 0
function makeEmptyRow(position) {
  return {
    id: `tmp-${tempId++}`,
    _new: true,
    position,
    category: CATEGORIES[0],
    name: '',
    target: '',
    measure_method: '',
    weight: 0,
    reference_doc: '',
    self_result: 0,
    self_explanation: '',
    manager_result: null,
    manager_note: '',
  }
}

// Hệ số kết quả = trọng số × kết quả / 100
function coeff(weight, result) {
  const w = Number(weight) || 0
  const r = Number(result) || 0
  return Math.round((w * r) / 100 * 100) / 100
}

export default function EvaluationForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { username, isManager, isAdmin } = useAuth()

  const [evaluation, setEvaluation] = useState(null)
  const [owner, setOwner] = useState(null)
  const [rows, setRows] = useState([])
  const [removedIds, setRemovedIds] = useState([])
  const [managerComment, setManagerComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isOwner = evaluation && evaluation.username === username
  const status = evaluation?.status
  // Nhân viên chỉ sửa khi phiếu đang là nháp
  const canEditSelf = isOwner && status === 'draft'
  // Quản lý/admin chấm khi phiếu đã gửi (hoặc đã chấm, muốn sửa lại)
  const canReview =
    !isOwner && (isManager || isAdmin) && (status === 'submitted' || status === 'reviewed')

  async function load() {
    setLoading(true)
    const { data: ev, error: evErr } = await supabase
      .from('evaluations')
      .select('*')
      .eq('id', id)
      .single()
    if (evErr) {
      setError('Không tải được phiếu: ' + evErr.message)
      setLoading(false)
      return
    }
    setEvaluation(ev)
    setManagerComment(ev.manager_comment || '')

    const [{ data: ownerData }, { data: objs }] = await Promise.all([
      supabase.from('kpi_users').select('*').eq('username', ev.username).maybeSingle(),
      supabase
        .from('objectives')
        .select('*')
        .eq('evaluation_id', id)
        .order('position', { ascending: true }),
    ])
    setOwner(ownerData)

    let loadedRows = objs || []
    // Khi quản lý mới vào chấm, mặc định lấy kết quả tự đánh giá làm điểm khởi đầu
    if (ev.status === 'submitted') {
      loadedRows = loadedRows.map((r) => ({
        ...r,
        manager_result: r.manager_result ?? r.self_result,
      }))
    }
    setRows(loadedRows)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ---- Tính toán tổng ----
  const totals = useMemo(() => {
    const totalWeight = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0)
    const selfTotal = rows.reduce((s, r) => s + coeff(r.weight, r.self_result), 0)
    const managerTotal = rows.reduce(
      (s, r) => s + coeff(r.weight, r.manager_result ?? 0),
      0
    )
    return {
      totalWeight: Math.round(totalWeight * 100) / 100,
      selfTotal: Math.round(selfTotal * 100) / 100,
      managerTotal: Math.round(managerTotal * 100) / 100,
    }
  }, [rows])

  function updateRow(rowId, field, value) {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r))
    )
  }

  function addRow() {
    setRows((prev) => [...prev, makeEmptyRow(prev.length + 1)])
  }

  function removeRow(rowId) {
    setRows((prev) => prev.filter((r) => r.id !== rowId))
    if (!String(rowId).startsWith('tmp-')) {
      setRemovedIds((prev) => [...prev, rowId])
    }
  }

  function toDb(r, index) {
    return {
      position: index + 1,
      category: r.category,
      name: r.name,
      target: r.target,
      measure_method: r.measure_method,
      weight: Number(r.weight) || 0,
      reference_doc: r.reference_doc,
      self_result: Number(r.self_result) || 0,
      self_explanation: r.self_explanation,
      manager_result: r.manager_result === null ? null : Number(r.manager_result),
      manager_note: r.manager_note,
    }
  }

  async function persistRows() {
    if (removedIds.length) {
      await supabase.from('objectives').delete().in('id', removedIds)
      setRemovedIds([])
    }
    const inserts = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const payload = toDb(r, i)
      if (r._new) {
        inserts.push({ ...payload, evaluation_id: id })
      } else {
        const { error } = await supabase
          .from('objectives')
          .update(payload)
          .eq('id', r.id)
        if (error) throw error
      }
    }
    if (inserts.length) {
      const { error } = await supabase.from('objectives').insert(inserts)
      if (error) throw error
    }
  }

  async function handleSave(newStatus) {
    setError('')
    setMessage('')

    if ((newStatus === 'submitted') && Math.abs(totals.totalWeight - 100) > 0.01) {
      setError(`Tổng trọng số phải bằng 100% (hiện tại ${totals.totalWeight}%).`)
      return
    }

    setSaving(true)
    try {
      await persistRows()

      const evalUpdate = {
        self_total: totals.selfTotal,
        manager_total: totals.managerTotal,
        manager_comment: managerComment,
      }
      if (newStatus) {
        evalUpdate.status = newStatus
        if (newStatus === 'submitted') evalUpdate.submitted_at = new Date().toISOString()
        if (newStatus === 'reviewed') evalUpdate.reviewed_at = new Date().toISOString()
        if (newStatus === 'approved') evalUpdate.approved_at = new Date().toISOString()
      }

      const { error: upErr } = await supabase
        .from('evaluations')
        .update(evalUpdate)
        .eq('id', id)
      if (upErr) throw upErr

      setMessage('Đã lưu thành công.')
      await load()
    } catch (e) {
      setError('Lỗi khi lưu: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />
  if (!evaluation) return <div className="text-red-600">{error || 'Không tìm thấy phiếu.'}</div>

  const readOnly = !canEditSelf && !canReview

  return (
    <div>
      {/* Tiêu đề */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-1 text-sm text-slate-500 hover:text-slate-700"
          >
            ← Quay lại
          </button>
          <h1 className="text-xl font-bold text-slate-800">
            Phiếu KPI — {formatPeriod(evaluation.period)}
          </h1>
          <p className="text-sm text-slate-500">
            Nhân viên: <span className="font-medium">{owner?.ho_va_ten || evaluation.username}</span>
            {owner?.mien ? ` · ${owner.mien}` : ''}
            {owner?.bu ? ` · ${owner.bu}` : ''}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

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

      {/* Bảng mục tiêu */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-slate-50 text-left align-bottom text-slate-600">
            <tr>
              <th className="px-2 py-2 font-medium">STT</th>
              <th className="px-2 py-2 font-medium">Nhóm</th>
              <th className="px-2 py-2 font-medium">Tên mục tiêu</th>
              <th className="px-2 py-2 font-medium">Mục tiêu cần đạt</th>
              <th className="px-2 py-2 font-medium">Cách thức đo</th>
              <th className="px-2 py-2 text-right font-medium">Trọng số %</th>
              <th className="px-2 py-2 font-medium">Tài liệu tham chiếu</th>
              <th className="px-2 py-2 text-right font-medium">KQ tự đánh giá %</th>
              <th className="px-2 py-2 text-right font-medium">Hệ số (tự)</th>
              <th className="px-2 py-2 font-medium">Diễn giải</th>
              {(canReview || status === 'reviewed' || status === 'approved') && (
                <>
                  <th className="px-2 py-2 text-right font-medium text-blue-700">
                    KQ quản lý %
                  </th>
                  <th className="px-2 py-2 text-right font-medium text-blue-700">
                    Hệ số (QL)
                  </th>
                </>
              )}
              {canEditSelf && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.id} className="align-top">
                <td className="px-2 py-2 text-slate-500">{i + 1}</td>
                <td className="px-2 py-2">
                  {canEditSelf ? (
                    <select
                      value={r.category || ''}
                      onChange={(e) => updateRow(r.id, 'category', e.target.value)}
                      className="w-28 rounded border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-700">{r.category}</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <CellText
                    value={r.name}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'name', v)}
                    width="w-32"
                  />
                </td>
                <td className="px-2 py-2">
                  <CellArea
                    value={r.target}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'target', v)}
                  />
                </td>
                <td className="px-2 py-2">
                  <CellArea
                    value={r.measure_method}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'measure_method', v)}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <CellNumber
                    value={r.weight}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'weight', v)}
                    suffix="%"
                  />
                </td>
                <td className="px-2 py-2">
                  <CellText
                    value={r.reference_doc}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'reference_doc', v)}
                    width="w-28"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <CellNumber
                    value={r.self_result}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'self_result', v)}
                    suffix="%"
                  />
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-700">
                  {coeff(r.weight, r.self_result)}
                </td>
                <td className="px-2 py-2">
                  <CellArea
                    value={r.self_explanation}
                    editable={canEditSelf}
                    onChange={(v) => updateRow(r.id, 'self_explanation', v)}
                  />
                </td>
                {(canReview || status === 'reviewed' || status === 'approved') && (
                  <>
                    <td className="px-2 py-2 text-right">
                      <CellNumber
                        value={r.manager_result ?? ''}
                        editable={canReview}
                        onChange={(v) => updateRow(r.id, 'manager_result', v)}
                        suffix="%"
                        highlight
                      />
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-blue-700">
                      {coeff(r.weight, r.manager_result ?? 0)}
                    </td>
                  </>
                )}
                {canEditSelf && (
                  <td className="px-2 py-2">
                    <button
                      onClick={() => removeRow(r.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Xoá dòng"
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={5}>
                Tổng
              </td>
              <td
                className={`px-2 py-2 text-right tabular-nums ${
                  Math.abs(totals.totalWeight - 100) > 0.01
                    ? 'text-red-600'
                    : 'text-slate-800'
                }`}
              >
                {totals.totalWeight}%
              </td>
              <td></td>
              <td></td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                {totals.selfTotal}
              </td>
              <td></td>
              {(canReview || status === 'reviewed' || status === 'approved') && (
                <>
                  <td></td>
                  <td className="px-2 py-2 text-right tabular-nums text-blue-700">
                    {totals.managerTotal}
                  </td>
                </>
              )}
              {canEditSelf && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {canEditSelf && (
        <button
          onClick={addRow}
          className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600"
        >
          + Thêm dòng mục tiêu
        </button>
      )}

      {/* Nhận xét của quản lý */}
      {(canReview || status === 'reviewed' || status === 'approved') && (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Nhận xét của quản lý
          </label>
          <textarea
            value={managerComment}
            onChange={(e) => setManagerComment(e.target.value)}
            disabled={!canReview}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            placeholder="Nhận xét chung về kết quả thực hiện KPI..."
          />
        </div>
      )}

      {/* Thanh hành động */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canEditSelf && (
          <>
            <button
              onClick={() => handleSave(null)}
              disabled={saving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {saving ? 'Đang lưu...' : 'Lưu nháp'}
            </button>
            <button
              onClick={() => handleSave('submitted')}
              disabled={saving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Gửi duyệt
            </button>
          </>
        )}
        {canReview && (
          <>
            <button
              onClick={() => handleSave('reviewed')}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Đang lưu...' : 'Lưu điểm chấm'}
            </button>
            <button
              onClick={() => handleSave('approved')}
              disabled={saving}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              Chốt kết quả
            </button>
          </>
        )}
        {readOnly && (
          <p className="text-sm text-slate-500">
            Phiếu đang ở trạng thái chỉ đọc.
          </p>
        )}
      </div>
    </div>
  )
}

// ---- Ô nhập dùng chung ----
function CellText({ value, editable, onChange, width = 'w-full' }) {
  if (!editable) return <span className="text-slate-700">{value || '—'}</span>
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded border border-slate-300 px-1.5 py-1 text-xs`}
    />
  )
}

function CellArea({ value, editable, onChange }) {
  if (!editable)
    return <span className="whitespace-pre-wrap text-slate-700">{value || '—'}</span>
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      className="w-40 rounded border border-slate-300 px-1.5 py-1 text-xs"
    />
  )
}

function CellNumber({ value, editable, onChange, suffix = '', highlight }) {
  if (!editable)
    return (
      <span className="tabular-nums text-slate-700">
        {value === '' || value === null ? '—' : `${value}${suffix}`}
      </span>
    )
  return (
    <input
      type="number"
      min="0"
      step="0.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-20 rounded border px-1.5 py-1 text-right text-xs ${
        highlight ? 'border-blue-300 bg-blue-50' : 'border-slate-300'
      }`}
    />
  )
}
