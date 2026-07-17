import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  formatPeriod,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../lib/constants'
import {
  buildTemplate,
  downloadBlob,
  parseTemplate,
  validateRows,
} from '../lib/excel'
import Spinner from '../components/Spinner'

export default function ExcelImport() {
  const { username, isAdmin } = useAuth()
  const fileRef = useRef(null)

  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [scopeUsers, setScopeUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)

  // Danh sách người mình được phép nhập: bản thân + cấp dưới (+ tất cả nếu admin)
  async function loadScopeUsers() {
    if (isAdmin) {
      const { data } = await supabase
        .from('kpi_users')
        .select('*')
        .order('ho_va_ten', { ascending: true })
      return data || []
    }
    const { data: reports } = await supabase
      .from('kpi_profiles')
      .select('username')
      .eq('manager_username', username)
    const names = [username, ...(reports || []).map((r) => r.username)]
    const { data } = await supabase
      .from('kpi_users')
      .select('*')
      .in('username', names)
      .order('ho_va_ten', { ascending: true })
    return data || []
  }

  useEffect(() => {
    async function init() {
      const [{ data: ps }, users] = await Promise.all([
        supabase.from('kpi_periods').select('*').order('period', { ascending: false }),
        loadScopeUsers(),
      ])
      setPeriods(ps || [])
      setPeriod((ps || []).find((p) => p.is_open)?.period || ps?.[0]?.period || '')
      setScopeUsers(users)
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------- TẢI TEMPLATE
  async function handleDownload() {
    setError('')
    setBusy('download')
    try {
      const names = scopeUsers.map((u) => u.username)
      const { data: evals } = await supabase
        .from('evaluations')
        .select('id, username')
        .eq('period', period)
        .in('username', names)

      let rows = []
      if (evals?.length) {
        const { data: objs } = await supabase
          .from('objectives')
          .select('*')
          .in('evaluation_id', evals.map((e) => e.id))
          .order('position', { ascending: true })

        const evalUser = {}
        for (const e of evals) evalUser[e.id] = e.username
        const nameMap = {}
        for (const u of scopeUsers) nameMap[u.username] = u.ho_va_ten

        rows = (objs || []).map((o) => ({
          username: evalUser[o.evaluation_id],
          ho_va_ten: nameMap[evalUser[o.evaluation_id]] || '',
          category: o.category,
          name: o.name,
          target: o.target,
          measure_method: o.measure_method,
          weight: o.weight,
          reference_doc: o.reference_doc,
          self_result: o.self_result,
          self_explanation: o.self_explanation,
        }))
        // Gom theo từng người cho dễ nhìn
        rows.sort((a, b) => (a.username || '').localeCompare(b.username || ''))
      }

      const blob = await buildTemplate({ period, users: scopeUsers, rows })
      downloadBlob(blob, `KPI_${period}_template.xlsx`)
    } catch (e) {
      setError('Không tạo được template: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  // ------------------------------------------------- ĐỌC & KIỂM TRA FILE
  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setResult(null)
    setPreview(null)
    setBusy('parse')
    try {
      const parsed = await parseTemplate(file)
      if (parsed.fatal) {
        setError(parsed.fatal)
        return
      }

      const allowed = new Map(scopeUsers.map((u) => [u.username, u]))
      const { errors, byUser } = validateRows(parsed.rows, allowed)

      // Kiểm tra trạng thái phiếu hiện tại của từng người
      const names = [...byUser.keys()]
      let statusMap = {}
      if (names.length) {
        const { data: evals } = await supabase
          .from('evaluations')
          .select('username, status')
          .eq('period', parsed.period)
          .in('username', names)
        for (const e of evals || []) statusMap[e.username] = e.status
      }

      const blocked = []
      for (const u of names) {
        const st = statusMap[u]
        if (st && st !== 'draft') {
          blocked.push(
            `${u}: phiếu đang ở trạng thái "${STATUS_LABELS[st]}" — chỉ nhập được khi phiếu là Nháp.`
          )
        }
      }

      setPreview({
        period: parsed.period,
        byUser,
        statusMap,
        errors: [...errors, ...blocked],
      })
    } catch (e) {
      setError('Không đọc được file: ' + (e.message || e))
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ------------------------------------------------- ÁP DỤNG
  async function handleApply() {
    if (!preview || preview.errors.length) return
    setBusy('apply')
    setError('')
    const summary = { created: 0, updated: 0, rows: 0, failed: [] }

    try {
      for (const [uname, list] of preview.byUser) {
        // Tìm phiếu, chưa có thì tạo Nháp
        let { data: ev } = await supabase
          .from('evaluations')
          .select('*')
          .eq('username', uname)
          .eq('period', preview.period)
          .maybeSingle()

        if (!ev) {
          const { data: created, error: insErr } = await supabase
            .from('evaluations')
            .insert({ username: uname, period: preview.period, status: 'draft' })
            .select()
            .single()
          if (insErr) {
            summary.failed.push(`${uname}: không tạo được phiếu (${insErr.message})`)
            continue
          }
          ev = created
          summary.created++
        } else {
          if (ev.status !== 'draft') {
            summary.failed.push(`${uname}: phiếu không ở trạng thái Nháp, đã bỏ qua.`)
            continue
          }
          summary.updated++
        }

        // Thay thế toàn bộ dòng mục tiêu
        const { error: delErr } = await supabase
          .from('objectives')
          .delete()
          .eq('evaluation_id', ev.id)
        if (delErr) {
          summary.failed.push(`${uname}: không xoá được dòng cũ (${delErr.message})`)
          continue
        }

        const payload = list.map((r, i) => ({
          evaluation_id: ev.id,
          position: i + 1,
          category: r.category,
          name: r.name,
          target: r.target,
          measure_method: r.measure_method,
          weight: r.weight,
          reference_doc: r.reference_doc,
          self_result: r.self_result || 0,
          self_explanation: r.self_explanation,
        }))
        const { error: insObjErr } = await supabase.from('objectives').insert(payload)
        if (insObjErr) {
          summary.failed.push(`${uname}: không ghi được dòng mới (${insObjErr.message})`)
          continue
        }
        summary.rows += payload.length

        const selfTotal =
          Math.round(
            list.reduce((s, r) => s + ((r.weight || 0) * (r.self_result || 0)) / 100, 0) * 100
          ) / 100
        await supabase
          .from('evaluations')
          .update({ self_total: selfTotal })
          .eq('id', ev.id)
      }

      setResult(summary)
      setPreview(null)
    } catch (e) {
      setError('Lỗi khi áp dụng: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  if (loading) return <Spinner />

  const periodOpen = periods.find((p) => p.period === period)?.is_open

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Nhập / Xuất Excel</h1>
        <p className="text-sm text-slate-500">
          Tải template, điền KPI hàng loạt trong Excel rồi upload lại. Phạm vi:{' '}
          <b>
            {isAdmin
              ? 'tất cả nhân viên'
              : scopeUsers.length > 1
                ? `bạn + ${scopeUsers.length - 1} nhân viên cấp dưới`
                : 'chỉ phiếu của bạn'}
          </b>
          .
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Bước 1 — tải template */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-slate-800">1. Tải template</h2>
        <p className="mb-3 text-sm text-slate-500">
          File đã cài sẵn danh sách người, dropdown nhóm mục tiêu, ràng buộc số và sheet
          "KiemTra" để soát tổng trọng số.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Kỳ đánh giá</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {formatPeriod(p.period)} {p.is_open ? '' : '(đã khoá)'}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleDownload}
            disabled={!period || busy === 'download'}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === 'download' ? 'Đang tạo...' : '⬇ Tải template Excel'}
          </button>
        </div>
      </div>

      {/* Bước 2 — upload */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-slate-800">2. Upload file đã điền</h2>
        <p className="mb-3 text-sm text-slate-500">
          Hệ thống sẽ kiểm tra và <b>hiển thị lỗi trước</b>, chỉ ghi vào phiếu khi bạn xác nhận.
          Dữ liệu trong file sẽ <b>thay thế toàn bộ</b> dòng mục tiêu hiện có.
        </p>
        {!periodOpen && (
          <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Kỳ {formatPeriod(period)} đang khoá — không nhập được. Nhờ admin mở kỳ.
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          onChange={handleFile}
          disabled={busy === 'parse'}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        {busy === 'parse' && <p className="mt-2 text-sm text-slate-500">Đang đọc file...</p>}
      </div>

      {/* Bước 3 — xem trước */}
      {preview && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-slate-800">
            3. Xem trước — kỳ {formatPeriod(preview.period)}
          </h2>

          {preview.errors.length > 0 ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-sm font-semibold text-red-800">
                Có {preview.errors.length} lỗi — hãy sửa trong Excel rồi upload lại:
              </p>
              <ul className="max-h-64 list-inside list-disc space-y-1 overflow-y-auto text-sm text-red-700">
                {preview.errors.map((er, i) => (
                  <li key={i}>{er}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              ✓ Dữ liệu hợp lệ. Kiểm tra bảng dưới rồi bấm "Áp dụng".
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Họ tên</th>
                  <th className="px-3 py-2 text-right font-medium">Số dòng</th>
                  <th className="px-3 py-2 text-right font-medium">Tổng trọng số</th>
                  <th className="px-3 py-2 font-medium">Phiếu hiện tại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...preview.byUser].map(([uname, list]) => {
                  const total =
                    Math.round(list.reduce((s, r) => s + (Number(r.weight) || 0), 0) * 100) / 100
                  const st = preview.statusMap[uname]
                  const u = scopeUsers.find((x) => x.username === uname)
                  return (
                    <tr key={uname}>
                      <td className="px-3 py-2 font-medium text-slate-800">{uname}</td>
                      <td className="px-3 py-2 text-slate-600">{u?.ho_va_ten || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{list.length}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          Math.abs(total - 100) > 0.01 ? 'text-red-600' : 'text-slate-800'
                        }`}
                      >
                        {total}
                      </td>
                      <td className="px-3 py-2">
                        {st ? (
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[st]}`}
                          >
                            {STATUS_LABELS[st]}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Sẽ tạo phiếu Nháp mới</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleApply}
              disabled={preview.errors.length > 0 || busy === 'apply' || !periodOpen}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy === 'apply' ? 'Đang ghi...' : '✓ Áp dụng vào phiếu'}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {/* Kết quả */}
      {result && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="mb-2 font-semibold text-green-800">Đã nhập xong</h2>
          <ul className="list-inside list-disc text-sm text-green-800">
            <li>Tạo mới {result.created} phiếu</li>
            <li>Cập nhật {result.updated} phiếu</li>
            <li>Tổng {result.rows} dòng mục tiêu</li>
          </ul>
          {result.failed.length > 0 && (
            <div className="mt-3 rounded-md bg-red-50 p-3">
              <p className="mb-1 text-sm font-semibold text-red-800">Bỏ qua:</p>
              <ul className="list-inside list-disc text-sm text-red-700">
                {result.failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
