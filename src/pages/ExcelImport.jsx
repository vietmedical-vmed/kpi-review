import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  formatPeriod,
  gradeOf,
  normalizeName,
  STATUS_LABELS,
  STATUS_COLORS,
  GRADE_COLORS,
} from '../lib/constants'
import {
  buildStandardWorkbook,
  downloadBlob,
  parseStandardFile,
  standardFileName,
} from '../lib/excel'
import { defaultPeriod, isPeriodAllowed, loadPeriods } from '../lib/periods'
import Spinner from '../components/Spinner'

let fileSeq = 0
const STATUS_ORDER = ['draft', 'submitted', 'reviewed', 'approved']

export default function ExcelImport() {
  const { username, isAdmin, isManager } = useAuth()
  const fileRef = useRef(null)

  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [scopeUsers, setScopeUsers] = useState([])
  const [downloadUser, setDownloadUser] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [items, setItems] = useState([]) // các file đã đọc
  const [expanded, setExpanded] = useState(null)
  const [result, setResult] = useState(null)

  // Phạm vi được NHẬP: bản thân + cấp dưới trực tiếp (admin: tất cả)
  async function loadScopeUsers() {
    if (isAdmin) {
      const { data } = await supabase.from('kpi_users').select('*').order('ho_va_ten')
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
      .order('ho_va_ten')
    return data || []
  }

  useEffect(() => {
    async function init() {
      const [ps, users] = await Promise.all([loadPeriods(), loadScopeUsers()])
      setPeriods(ps)
      setPeriod(defaultPeriod(ps))
      setScopeUsers(users)
      setDownloadUser(username)
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const userByName = useMemo(() => {
    const m = new Map()
    for (const u of scopeUsers) {
      m.set(normalizeName(u.ho_va_ten), u)
      m.set(normalizeName(u.username), u)
    }
    return m
  }, [scopeUsers])
  const userMap = useMemo(() => new Map(scopeUsers.map((u) => [u.username, u])), [scopeUsers])

  /**
   * Xác định file thuộc nhân viên nào (leader có thể upload hộ cả đội, tên file tuỳ ý):
   *  1. Ô "NHÂN VIÊN" trong file — "Họ tên (username)" hoặc họ tên
   *  2. Tên file CHỨA đầy đủ họ tên / username của đúng 1 người trong phạm vi
   *  3. Phạm vi chỉ có 1 người
   * Không chắc chắn -> để trống cho người dùng chọn.
   */
  function resolvePerson(parsed) {
    const idText = (parsed.identity?.person || '').trim()
    if (idText) {
      const m = idText.match(/\(([^()]+)\)\s*$/)
      const un = m?.[1]?.trim().toLowerCase()
      const byUn = un && scopeUsers.find((u) => u.username.toLowerCase() === un)
      if (byUn) return { username: byUn.username, by: 'file' }
      const byName = userByName.get(normalizeName(idText.replace(/\([^()]*\)\s*$/, '')))
      if (byName) return { username: byName.username, by: 'file' }
      return {
        username: '',
        by: null,
        note: `Ô NHÂN VIÊN trong file ghi "${idText}" — không khớp ai trong phạm vi của bạn.`,
      }
    }
    const base = String(parsed.fileName || '').replace(/\.[^.]+$/, '')
    const fn = ` ${normalizeName(base.replace(/[_\-.,()]+/g, ' '))} `
    const tokens = new Set(base.toLowerCase().split(/[\s_\-,()]+/).filter(Boolean))
    let hits = scopeUsers.filter(
      (u) =>
        (u.ho_va_ten && fn.includes(` ${normalizeName(u.ho_va_ten)} `)) ||
        tokens.has(u.username.toLowerCase())
    )
    if (hits.length > 1) {
      // Ưu tiên tên dài nhất (vd "Nguyễn Văn An" thắng "Văn An")
      const len = (u) => normalizeName(u.ho_va_ten).length
      const max = Math.max(...hits.map(len))
      const top = hits.filter((u) => len(u) === max)
      if (top.length === 1) hits = top
    }
    if (hits.length === 1) return { username: hits[0].username, by: 'filename' }
    if (hits.length > 1)
      return { username: '', by: null, note: `Tên file khớp nhiều người (${hits.map((u) => u.ho_va_ten).join(', ')}).` }
    if (scopeUsers.length === 1) return { username: scopeUsers[0].username, by: 'single' }
    return { username: '', by: null }
  }
  const periodMap = useMemo(() => new Map(periods.map((p) => [p.period, p])), [periods])

  // ------------------------------------------------- TẢI MẪU CHUẨN
  async function exportFor(uname) {
    const u = userMap.get(uname)
    const { data: ev } = await supabase
      .from('evaluations')
      .select('*')
      .eq('username', uname)
      .eq('period', period)
      .maybeSingle()
    let objectives = []
    if (ev) {
      const { data: objs } = await supabase
        .from('objectives')
        .select('*')
        .eq('evaluation_id', ev.id)
        .order('position')
      objectives = objs || []
    }
    const blob = await buildStandardWorkbook({
      personName: u?.ho_va_ten || uname,
      username: uname,
      people: scopeUsers,
      period,
      objectives,
      registrationComment: ev?.registration_comment || '',
      managerComment: ev?.manager_comment || '',
    })
    downloadBlob(blob, standardFileName(u?.ho_va_ten || uname, period))
  }

  async function handleDownload(all = false) {
    setError('')
    setBusy(all ? 'download-all' : 'download')
    try {
      const list = all ? scopeUsers.map((u) => u.username) : [downloadUser]
      for (const un of list) {
        await exportFor(un)
        if (all) await new Promise((r) => setTimeout(r, 400)) // tránh trình duyệt chặn tải nhiều file
      }
    } catch (e) {
      setError('Không tạo được file: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  // ------------------------------------------------- ĐỌC FILE
  function defaultStatus(parsed, uname) {
    const self = uname === username
    if (!self && (isManager || isAdmin)) {
      if (parsed.hasManagerResults) return 'reviewed'
      if (parsed.hasSelfResults) return 'submitted'
    }
    return 'draft'
  }

  async function handleFiles(e) {
    const files = [...(e.target.files || [])]
    if (!files.length) return
    setError('')
    setResult(null)
    setBusy('parse')
    try {
      const parsedList = []
      for (const f of files) {
        const parsed = await parseStandardFile(f)
        const who = resolvePerson(parsed)
        const uname = who.username
        parsedList.push({
          id: ++fileSeq,
          parsed,
          username: uname,
          matchedBy: who.by,
          matchNote: who.note || '',
          period: parsed.period || period,
          targetStatus: parsed.fatal ? 'draft' : defaultStatus(parsed, uname),
        })
      }
      setItems((prev) => [...prev, ...parsedList])
    } catch (err) {
      setError('Không đọc được file: ' + (err.message || err))
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Lấy trạng thái phiếu hiện có cho các cặp (username, period) trong danh sách
  const [existing, setExisting] = useState({}) // key "user|period" -> evaluation
  useEffect(() => {
    const pairs = items.filter((it) => it.username && it.period)
    if (!pairs.length) return
    const byPeriod = {}
    for (const it of pairs) (byPeriod[it.period] ||= new Set()).add(it.username)
    ;(async () => {
      const next = {}
      for (const [p, set] of Object.entries(byPeriod)) {
        const { data } = await supabase
          .from('evaluations')
          .select('id, username, period, status')
          .eq('period', p)
          .in('username', [...set])
        for (const ev of data || []) next[`${ev.username}|${ev.period}`] = ev
      }
      setExisting(next)
      // Không tự hạ trạng thái phiếu đang có (vd Đã chấm -> Chờ duyệt) trừ khi người dùng tự chọn
      setItems((prev) => {
        let changed = false
        const out = prev.map((it) => {
          const ev = next[`${it.username}|${it.period}`]
          if (!ev || it.statusTouched || it.parsed.fatal) return it
          const cur = STATUS_ORDER.indexOf(it.targetStatus)
          const has = STATUS_ORDER.indexOf(ev.status)
          const self = it.username === username
          if (has > cur && ev.status !== 'approved' && !(self && !isAdmin)) {
            changed = true
            return { ...it, targetStatus: ev.status }
          }
          return it
        })
        return changed ? out : prev
      })
    })()
  }, [items])

  function updateItem(id, changes) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const next = { ...it, ...changes }
        if (changes.username !== undefined) {
          next.matchedBy = changes.username ? 'manual' : null
          next.matchNote = ''
          next.statusTouched = false
          if (!it.parsed.fatal) next.targetStatus = defaultStatus(it.parsed, changes.username)
        }
        return next
      })
    )
  }

  // Kiểm tra từng file -> danh sách lỗi chặn
  function blockers(it) {
    const out = []
    if (it.parsed.fatal) return [it.parsed.fatal]
    out.push(...it.parsed.errors)
    if (!it.username)
      out.push(
        `${it.matchNote ? it.matchNote + ' ' : 'Chưa xác định được nhân viên (ô NHÂN VIÊN trong file trống, tên file không chứa tên ai trong phạm vi). '}Hãy chọn nhân viên.`
      )
    if (!it.period) out.push('Chưa xác định kỳ đánh giá.')
    else if (!isPeriodAllowed(it.period)) out.push(`Kỳ ${formatPeriod(it.period)} nằm ngoài khoảng cho phép.`)
    else {
      const p = periodMap.get(it.period)
      if (p && !p.is_open && !isAdmin) out.push(`Kỳ ${formatPeriod(it.period)} đã bị khoá.`)
    }
    const dup = items.filter((x) => x.username && x.username === it.username && x.period === it.period)
    if (it.username && dup.length > 1 && dup[0].id !== it.id) out.push('Trùng nhân viên & kỳ với file khác phía trên.')
    const ev = existing[`${it.username}|${it.period}`]
    if (ev) {
      const self = it.username === username
      if (ev.status === 'approved' && !isAdmin) out.push('Phiếu đã Chốt — chỉ admin được ghi đè.')
      else if (self && !isAdmin && ev.status !== 'draft')
        out.push(`Phiếu của bạn đang "${STATUS_LABELS[ev.status]}" — chỉ nhập được khi còn Nháp.`)
    }
    return out
  }

  function allowedStatuses(it) {
    const self = it.username === username
    if (isAdmin) return STATUS_ORDER
    if (self) return it.parsed.hasSelfResults ? ['draft', 'submitted'] : ['draft']
    return STATUS_ORDER
  }

  const ready = items.filter((it) => blockers(it).length === 0)

  // ------------------------------------------------- ÁP DỤNG
  async function applyOne(it) {
    const p = it.parsed
    let { data: ev, error: findErr } = await supabase
      .from('evaluations')
      .select('*')
      .eq('username', it.username)
      .eq('period', it.period)
      .maybeSingle()
    if (findErr) throw findErr
    let created = false
    if (!ev) {
      const { data, error } = await supabase
        .from('evaluations')
        .insert({ username: it.username, period: it.period, status: 'draft' })
        .select()
        .single()
      if (error) throw new Error('không tạo được phiếu: ' + error.message)
      ev = data
      created = true
    }

    const { error: delErr } = await supabase.from('objectives').delete().eq('evaluation_id', ev.id)
    if (delErr) throw new Error('không xoá được dòng cũ: ' + delErr.message)

    const payload = p.objectives.map((o, i) => ({
      evaluation_id: ev.id,
      position: i + 1,
      category: o.category,
      name: o.name,
      target: o.target,
      measure_method: o.measure_method,
      weight: o.weight,
      reference_doc: o.reference_doc,
      self_result: o.self_result ?? 0,
      manager_result: o.manager_result,
    }))
    const { error: insErr } = await supabase.from('objectives').insert(payload)
    if (insErr) throw new Error('không ghi được mục tiêu: ' + insErr.message)

    const now = new Date().toISOString()
    const st = it.targetStatus
    const upd = {
      self_total: p.totals.self,
      manager_total: p.totals.manager,
      registration_comment: p.registrationComment || null,
      source_file: p.fileName,
      imported_at: now,
      imported_by: username,
      status: st,
    }
    if (p.managerComment) upd.manager_comment = p.managerComment
    const rank = STATUS_ORDER.indexOf(st)
    if (rank >= 1 && !ev.submitted_at) upd.submitted_at = now
    if (rank >= 2 && !ev.reviewed_at) upd.reviewed_at = now
    if (rank >= 3) upd.approved_at = ev.approved_at || now
    const { error: upErr } = await supabase.from('evaluations').update(upd).eq('id', ev.id)
    if (upErr) throw new Error('không cập nhật phiếu: ' + upErr.message)
    return { created, rows: payload.length }
  }

  async function handleApply() {
    setBusy('apply')
    setError('')
    const summary = { created: 0, updated: 0, rows: 0, failed: [] }
    const done = new Set()
    for (const it of ready) {
      const who = userMap.get(it.username)?.ho_va_ten || it.username
      try {
        const r = await applyOne(it)
        r.created ? summary.created++ : summary.updated++
        summary.rows += r.rows
        done.add(it.id)
      } catch (e) {
        summary.failed.push(`${who} (${it.parsed.fileName}): ${e.message || e}`)
      }
    }
    setItems((prev) => prev.filter((x) => !done.has(x.id)))
    setResult(summary)
    setBusy('')
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Nhập / Xuất Excel — mẫu chuẩn</h1>
        <p className="text-sm text-slate-500">
          Mẫu <b>"Đăng kí & đánh giá KPI tháng"</b> (2 sheet: Đăng ký đầu tháng · Đánh giá cuối tháng), mỗi
          file là phiếu của 1 người. Phạm vi nhập:{' '}
          <b>
            {isAdmin
              ? 'tất cả nhân viên'
              : scopeUsers.length > 1
                ? `bạn + ${scopeUsers.length - 1} nhân viên cấp dưới trực tiếp`
                : 'chỉ phiếu của bạn'}
          </b>
          .
        </p>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Bước 1 — tải mẫu */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-slate-800">1. Tải mẫu chuẩn</h2>
        <p className="mb-3 text-sm text-slate-500">
          File được điền sẵn dữ liệu đã có trên hệ thống (nếu có). Dòng 4 sheet "Đăng ký đầu tháng" có ô{' '}
          <b>NHÂN VIÊN</b> (chọn từ danh sách) và <b>KỲ ĐÁNH GIÁ</b> — hệ thống dựa vào 2 ô này để biết file của ai,
          nên leader có thể gom file cả đội (đặt tên file tuỳ ý) rồi upload một lần.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Kỳ đánh giá">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input">
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {formatPeriod(p.period)} {p.is_open ? '' : '(đã khoá)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nhân viên">
            <select value={downloadUser} onChange={(e) => setDownloadUser(e.target.value)} className="input min-w-[14rem]">
              {scopeUsers.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.ho_va_ten || u.username}
                  {u.username === username ? ' (tôi)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <button
            onClick={() => handleDownload(false)}
            disabled={!period || !!busy}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === 'download' ? 'Đang tạo...' : '⬇ Tải file'}
          </button>
          {scopeUsers.length > 1 && (
            <button
              onClick={() => handleDownload(true)}
              disabled={!period || !!busy}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === 'download-all' ? 'Đang tạo...' : `⬇ Tải cho cả đội (${scopeUsers.length} file)`}
            </button>
          )}
        </div>
      </section>

      {/* Bước 2 — upload */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold text-slate-800">2. Upload file đã điền (chọn được nhiều file)</h2>
        <p className="mb-3 text-sm text-slate-500">
          Hệ thống đọc cả 2 sheet: mục tiêu, trọng số, tài liệu tham chiếu, kết quả của N, kết quả của N+1, ý
          kiến/đánh giá của N+1. Kiểm tra và <b>hiển thị lỗi trước</b>, chỉ ghi khi bạn bấm Áp dụng. Dữ liệu trong file{' '}
          <b>thay thế toàn bộ</b> mục tiêu hiện có của phiếu.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          multiple
          onChange={handleFiles}
          disabled={busy === 'parse'}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        {busy === 'parse' && <p className="mt-2 text-sm text-slate-500">Đang đọc file...</p>}
      </section>

      {/* Bước 3 — xem trước */}
      {items.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              3. Xem trước — {items.length} file · <span className="text-green-700">{ready.length} hợp lệ</span>
              {items.length - ready.length > 0 && (
                <span className="text-red-600"> · {items.length - ready.length} có lỗi</span>
              )}
            </h2>
            <button onClick={() => setItems([])} className="text-sm text-slate-500 hover:text-slate-700">
              Xoá danh sách
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Nhân viên</th>
                  <th className="px-3 py-2 font-medium">Kỳ</th>
                  <th className="px-3 py-2 text-right font-medium">Mục tiêu</th>
                  <th className="px-3 py-2 text-right font-medium">KQ N</th>
                  <th className="px-3 py-2 text-right font-medium">KQ N+1</th>
                  <th className="px-3 py-2 text-right font-medium">Cuối cùng</th>
                  <th className="px-3 py-2 font-medium">Phiếu hiện tại</th>
                  <th className="px-3 py-2 font-medium">Sau khi nhập</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => {
                  const p = it.parsed
                  const errs = blockers(it)
                  const ev = existing[`${it.username}|${it.period}`]
                  const open = expanded === it.id
                  return (
                    <FileRows
                      key={it.id}
                      it={it}
                      p={p}
                      errs={errs}
                      ev={ev}
                      open={open}
                      scopeUsers={scopeUsers}
                      periods={periods}
                      allowed={allowedStatuses(it)}
                      onToggle={() => setExpanded(open ? null : it.id)}
                      onChange={(c) => updateItem(it.id, c)}
                      onRemove={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleApply}
              disabled={!ready.length || busy === 'apply'}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy === 'apply' ? 'Đang ghi...' : `✓ Áp dụng ${ready.length} file hợp lệ`}
            </button>
            {items.length > ready.length && (
              <span className="text-sm text-slate-500">File có lỗi sẽ được giữ lại để sửa, không ghi.</span>
            )}
          </div>
        </section>
      )}

      {result && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="mb-2 font-semibold text-green-800">Đã nhập xong</h2>
          <ul className="list-inside list-disc text-sm text-green-800">
            <li>Tạo mới {result.created} phiếu</li>
            <li>Cập nhật {result.updated} phiếu</li>
            <li>Tổng {result.rows} dòng mục tiêu</li>
          </ul>
          {result.failed.length > 0 && (
            <div className="mt-3 rounded-md bg-red-50 p-3">
              <p className="mb-1 text-sm font-semibold text-red-800">Lỗi:</p>
              <ul className="list-inside list-disc text-sm text-red-700">
                {result.failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
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

const MATCH_HINTS = {
  file: ['Theo ô NHÂN VIÊN trong file', 'text-green-700'],
  filename: ['Theo tên file — kiểm tra lại', 'text-amber-700'],
  single: ['Mặc định (chỉ 1 người) — kiểm tra lại', 'text-amber-700'],
  manual: ['Đã chọn tay', 'text-slate-500'],
}
function MatchHint({ by }) {
  if (!by) return null
  const [text, cls] = MATCH_HINTS[by]
  return <div className={`mt-0.5 text-xs ${cls}`}>{text}</div>
}

function pct(v) {
  return v === null || v === undefined ? '—' : `${v}%`
}

function FileRows({ it, p, errs, ev, open, scopeUsers, periods, allowed, onToggle, onChange, onRemove }) {
  const ok = errs.length === 0
  const grade = p.fatal || !p.hasSelfResults ? null : gradeOf(p.totals.final)
  return (
    <>
      <tr className={ok ? '' : 'bg-red-50/40'}>
        <td className="max-w-[16rem] px-3 py-2">
          <div className="truncate font-medium text-slate-800" title={p.fileName}>
            {ok ? '✓ ' : '⚠ '}
            {p.fileName}
          </div>
          {!p.fatal && (
            <div className="text-xs text-slate-500">
              {p.source === 'evaluation' ? 'Đánh giá cuối tháng' : 'Chỉ Đăng ký đầu tháng'}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <select
            value={it.username}
            onChange={(e) => onChange({ username: e.target.value })}
            className={`input max-w-[13rem] ${it.username ? '' : 'border-red-400'}`}
          >
            <option value="">— Chọn —</option>
            {scopeUsers.map((u) => (
              <option key={u.username} value={u.username}>
                {u.ho_va_ten || u.username}
              </option>
            ))}
          </select>
          <MatchHint by={it.matchedBy} />
        </td>
        <td className="px-3 py-2">
          <select value={it.period} onChange={(e) => onChange({ period: e.target.value })} className="input">
            {!periods.some((x) => x.period === it.period) && it.period && (
              <option value={it.period}>{formatPeriod(it.period)}</option>
            )}
            {periods.map((x) => (
              <option key={x.period} value={x.period}>
                {formatPeriod(x.period)}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal ? '—' : p.objectives.length}</td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal || !p.hasSelfResults ? '—' : pct(p.totals.self)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal || !p.hasManagerResults ? '—' : pct(p.totals.manager)}</td>
        <td className="px-3 py-2 text-right">
          {grade ? (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_COLORS[grade]}`}>
              {p.totals.final}% · {grade}
            </span>
          ) : (
            '—'
          )}
        </td>
        <td className="px-3 py-2">
          {ev ? (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[ev.status]}`}>
              {STATUS_LABELS[ev.status]}
            </span>
          ) : (
            <span className="text-xs text-slate-400">Tạo mới</span>
          )}
        </td>
        <td className="px-3 py-2">
          {!p.fatal && (
            <select
              value={it.targetStatus}
              onChange={(e) => onChange({ targetStatus: e.target.value, statusTouched: true })}
              className="input"
            >
              {allowed.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {!p.fatal && (
            <button onClick={onToggle} className="mr-2 text-xs text-brand-600 hover:underline">
              {open ? 'Ẩn' : 'Chi tiết'}
            </button>
          )}
          <button onClick={onRemove} className="text-slate-400 hover:text-red-600" title="Bỏ file">
            ✕
          </button>
        </td>
      </tr>
      {(errs.length > 0 || (p.warnings?.length > 0 && open)) && (
        <tr className={ok ? '' : 'bg-red-50/40'}>
          <td colSpan={10} className="px-3 pb-2">
            {errs.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-700">
                {errs.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {open &&
              p.warnings?.map((w, i) => (
                <div key={i} className="text-xs text-amber-700">
                  ⚠ {w}
                </div>
              ))}
          </td>
        </tr>
      )}
      {open && !p.fatal && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-3 py-3">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Tên mục tiêu</th>
                  <th className="py-1 pr-2">Mục tiêu cần đạt</th>
                  <th className="py-1 pr-2">Cách thức đo</th>
                  <th className="py-1 pr-2 text-right">Trọng số</th>
                  <th className="py-1 pr-2">Tài liệu</th>
                  <th className="py-1 pr-2 text-right">KQ N</th>
                  <th className="py-1 text-right">KQ N+1</th>
                </tr>
              </thead>
              <tbody className="align-top text-slate-700">
                {p.objectives.map((o, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">{o.name}</td>
                    <td className="whitespace-pre-wrap py-1 pr-2">{o.target}</td>
                    <td className="whitespace-pre-wrap py-1 pr-2">{o.measure_method}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{o.weight}%</td>
                    <td className="py-1 pr-2">{o.reference_doc}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{pct(o.self_result)}</td>
                    <td className="py-1 text-right tabular-nums">{pct(o.manager_result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(p.registrationComment || p.managerComment) && (
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                {p.registrationComment && (
                  <div>
                    <b>Ý kiến N+1 (đăng ký):</b> {p.registrationComment}
                  </div>
                )}
                {p.managerComment && (
                  <div>
                    <b>Đánh giá của N+1:</b> {p.managerComment}
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
