// NHẬP KPI — bước 1 của luồng chính (chỉ người được cấp quyền nhập + admin).
//   1. Chọn file (1 người/file theo mẫu chuẩn, hoặc file cả đội mỗi sheet 1 người).
//   2. Xem trước: tên lấy từ file (sửa tay được, có gợi ý khi gõ sai), kỳ, người
//      duyệt, số liệu, lỗi. Phiếu KHÔNG gắn tài khoản.
//   3. Xác nhận -> ghi vào hệ thống ở trạng thái "Chờ duyệt", lưu kèm file gốc để
//      xuất lại đúng biểu mẫu. Người nhập còn sửa được tới khi N+1/admin duyệt.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPeriod, gradeOf, normalizeName, isApproved, evalPermissions } from '../lib/constants'
import {
  buildStandardWorkbook,
  downloadBlob,
  fileToBase64,
  parseWorkbookFile,
  standardFileName,
} from '../lib/excel'
import { defaultPeriod, isPeriodAllowed, loadPeriods } from '../lib/periods'
import { editDistance, loadPeople, userLabel } from '../lib/people'
import { Alert, ApproverSelect, Field, GradeBadge, StatusBadge, pct } from '../components/ui'
import Spinner from '../components/Spinner'

const MAX_STORE_BYTES = 8 * 1024 * 1024 // file lớn hơn không lưu bản gốc (xuất theo mẫu chuẩn)
const LAST_APPROVER = 'kpi_last_approver'
let seq = 0

// Tên nhân viên lấy từ file: ô NHÂN VIÊN > tên sheet > phần đầu tên file
function nameFromFile(parsed) {
  const cell = (parsed.identity?.person || '').replace(/\s*\([^()]*\)\s*$/, '').trim()
  if (cell) return { name: cell, from: 'Ô NHÂN VIÊN trong file' }
  const fn = (parsed.personName || '').trim()
  const looksLikeName =
    fn && !/\d/.test(fn) && !/kpi|danh gia|dang ky|dang ki|template|mau/.test(normalizeName(fn))
  if (looksLikeName) return { name: fn, from: parsed.sheetName ? 'Tên sheet' : 'Tên file' }
  return { name: '', from: null }
}

export default function ImportKpi() {
  const { username, isAdmin, canUpload, profile } = useAuth()
  const fileRef = useRef(null)
  const filesRef = useRef(new Map()) // fileKey -> File

  const [loading, setLoading] = useState(true)
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [people, setPeople] = useState({ users: [], userMap: new Map(), managerSet: new Set() })
  const [approver, setApprover] = useState('')
  const [known, setKnown] = useState(new Map()) // employee_key -> { name, period }
  const [items, setItems] = useState([])
  const [existing, setExisting] = useState({}) // "key|period" -> [evaluation]
  const [expanded, setExpanded] = useState(null)
  const [notes, setNotes] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function loadKnown() {
    const { data } = await supabase
      .from('evaluations')
      .select('employee_key, employee_name, period')
      .is('username', null)
      .order('period', { ascending: false })
    const m = new Map()
    for (const e of data || []) if (e.employee_key && !m.has(e.employee_key)) m.set(e.employee_key, { name: e.employee_name, period: e.period })
    return m
  }

  useEffect(() => {
    ;(async () => {
      const [ps, pp, kn] = await Promise.all([loadPeriods(), loadPeople(), loadKnown()])
      setPeriods(ps)
      setPeriod(defaultPeriod(ps))
      setPeople(pp)
      setKnown(kn)
      const last = localStorage.getItem(LAST_APPROVER)
      setApprover(
        (last && pp.userMap.has(last) && last) || profile?.manager_username || (pp.managerSet.has(username) ? username : '')
      )
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const periodMap = useMemo(() => new Map(periods.map((p) => [p.period, p])), [periods])
  const knownList = useMemo(() => [...known.entries()].map(([key, v]) => ({ key, ...v })), [known])

  // ------------------------------------------------- ĐỌC FILE
  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => /\.xlsx$/i.test(f.name))
    if (!files.length) return
    setError('')
    setResult(null)
    setBusy('parse')
    try {
      const added = []
      const nn = []
      for (const f of files) {
        const fileKey = `f${++seq}`
        filesRef.current.set(fileKey, f)
        const { entries, skippedHidden } = await parseWorkbookFile(f)
        if (skippedHidden.length) nn.push(`${f.name}: bỏ qua ${skippedHidden.length} sheet ẩn — ${skippedHidden.join(', ')}`)
        for (const parsed of entries) {
          const who = nameFromFile(parsed)
          added.push({
            id: ++seq,
            fileKey,
            parsed,
            employeeName: who.name,
            nameFrom: who.from,
            period: parsed.period || period,
            approver,
          })
        }
      }
      setItems((prev) => [...prev, ...added])
      setNotes(nn)
    } catch (err) {
      setError('Không đọc được file: ' + (err.message || err))
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Phiếu đã có trên hệ thống cho các cặp (tên, kỳ) trong danh sách
  useEffect(() => {
    const list = items.filter((it) => it.employeeName?.trim() && it.period)
    if (!list.length) return
    let cancelled = false
    ;(async () => {
      const next = {}
      const byPeriod = {}
      for (const it of list) (byPeriod[it.period] ||= new Set()).add(normalizeName(it.employeeName))
      for (const [p, keys] of Object.entries(byPeriod)) {
        const { data } = await supabase
          .from('evaluations')
          .select('id, employee_key, employee_name, manager_username, imported_by, username, period, status')
          .eq('period', p)
          .is('username', null)
          .in('employee_key', [...keys])
        for (const ev of data || []) (next[`${ev.employee_key}|${p}`] ||= []).push(ev)
      }
      if (!cancelled) setExisting(next)
    })()
    return () => {
      cancelled = true
    }
  }, [items])

  // Phiếu hiện có sẽ bị cập nhật: ưu tiên phiếu cùng người duyệt
  function existingOf(it, map = existing) {
    const list = map[`${normalizeName(it.employeeName)}|${it.period}`] || []
    return list.find((e) => e.manager_username === it.approver) || list[0] || null
  }

  function updateItem(id, changes) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }

  function changeApprover(un) {
    setApprover(un)
    setItems((prev) => prev.map((it) => ({ ...it, approver: un })))
  }

  // Kiểm tra tên: đã có trong hệ thống, hay gợi ý tên gần giống
  function nameCheck(it) {
    const key = normalizeName(it.employeeName)
    if (!key) return null
    const hit = known.get(key)
    if (hit) return { ok: true, text: `Đã có trong hệ thống (gần nhất ${formatPeriod(hit.period)})` }
    const near = knownList
      .map((k) => ({ ...k, d: editDistance(key, k.key) }))
      .filter((k) => k.d > 0 && k.d <= Math.max(2, Math.floor(key.length / 8)))
      .sort((a, b) => a.d - b.d)[0]
    return { ok: false, text: 'Nhân viên mới', suggest: near?.name }
  }

  function blockers(it) {
    const p = it.parsed
    if (p.fatal) return [p.fatal]
    const out = [...p.errors]
    if (!it.employeeName?.trim()) out.push('Chưa có tên nhân viên — điền ô NHÂN VIÊN trong file hoặc nhập tay.')
    if (!it.approver) out.push('Chưa chọn Người duyệt (N+1).')
    if (!it.period) out.push('Chưa xác định kỳ đánh giá.')
    else if (!isPeriodAllowed(it.period)) out.push(`Kỳ ${formatPeriod(it.period)} nằm ngoài khoảng cho phép.`)
    else if (periodMap.get(it.period)?.is_open === false && !isAdmin) out.push(`Kỳ ${formatPeriod(it.period)} đã bị khoá.`)
    const k = normalizeName(it.employeeName)
    if (k) {
      const dup = items.filter((x) => normalizeName(x.employeeName) === k && x.period === it.period)
      if (dup.length > 1 && dup[0].id !== it.id) out.push('Trùng nhân viên & kỳ với dòng phía trên.')
    }
    const ev = existingOf(it)
    if (ev) {
      const perm = evalPermissions(ev, { username, isAdmin, canUpload })
      if (isApproved(ev)) out.push('Phiếu kỳ này đã được duyệt — người duyệt cần "Bỏ duyệt" trước khi nhập lại.')
      else if (!perm.edit) out.push(`Phiếu kỳ này do ${ev.imported_by || 'người khác'} nhập — bạn không có quyền ghi đè.`)
    }
    return out
  }

  const ready = items.filter((it) => blockers(it).length === 0)

  // ------------------------------------------------- XÁC NHẬN NHẬP
  async function storeFile(fileKey, cache) {
    if (cache.has(fileKey)) return cache.get(fileKey)
    const f = filesRef.current.get(fileKey)
    let id = null
    if (f && f.size <= MAX_STORE_BYTES) {
      const { data, error } = await supabase
        .from('kpi_files')
        .insert({ file_name: f.name, size_bytes: f.size, content_b64: await fileToBase64(f), uploaded_by: username })
        .select('id')
        .single()
      if (error) throw new Error('không lưu được file gốc: ' + error.message)
      id = data.id
    }
    cache.set(fileKey, id)
    return id
  }

  async function applyOne(it, fileCache, oldFiles) {
    const p = it.parsed
    const name = it.employeeName.trim()
    const key = normalizeName(name)
    const { data: found, error: findErr } = await supabase
      .from('evaluations')
      .select('*')
      .eq('period', it.period)
      .is('username', null)
      .eq('employee_key', key)
    if (findErr) throw findErr
    let ev = (found || []).find((e) => e.manager_username === it.approver) || found?.[0] || null
    if (ev && isApproved(ev)) throw new Error('phiếu đã được duyệt')

    const fileId = await storeFile(it.fileKey, fileCache)
    const now = new Date().toISOString()
    let created = false
    if (!ev) {
      const { data, error } = await supabase
        .from('evaluations')
        .insert({
          username: null,
          employee_name: name,
          employee_key: key,
          manager_username: it.approver,
          period: it.period,
          status: 'submitted',
          imported_by: username,
        })
        .select()
        .single()
      if (error) throw new Error('không tạo được phiếu: ' + error.message)
      ev = data
      created = true
    } else if (ev.source_file_id) oldFiles.add(ev.source_file_id)

    const { error: delErr } = await supabase.from('objectives').delete().eq('evaluation_id', ev.id)
    if (delErr) throw new Error('không xoá được mục tiêu cũ: ' + delErr.message)
    const rows = p.objectives.map((o, i) => ({
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
    const { error: insErr } = await supabase.from('objectives').insert(rows)
    if (insErr) throw new Error('không ghi được mục tiêu: ' + insErr.message)

    const { error: upErr } = await supabase
      .from('evaluations')
      .update({
        employee_name: name,
        employee_key: key,
        manager_username: it.approver,
        status: 'submitted',
        self_total: p.totals.self,
        manager_total: p.totals.manager,
        registration_comment: p.registrationComment || null,
        manager_comment: p.managerComment || ev.manager_comment || null,
        source_file: p.sheetName ? `${p.fileName} [${p.sheetName}]` : p.fileName,
        source_file_id: fileId,
        source_sheet: p.sheetName || null,
        imported_at: now,
        imported_by: username,
        submitted_at: ev.submitted_at || now,
      })
      .eq('id', ev.id)
    if (upErr) throw new Error('không cập nhật được phiếu: ' + upErr.message)
    return { created, rows: rows.length }
  }

  async function handleApply() {
    setBusy('apply')
    setError('')
    const summary = { created: 0, updated: 0, rows: 0, failed: [] }
    const done = new Set()
    const fileCache = new Map()
    const oldFiles = new Set()
    for (const it of ready) {
      try {
        const r = await applyOne(it, fileCache, oldFiles)
        r.created ? summary.created++ : summary.updated++
        summary.rows += r.rows
        done.add(it.id)
      } catch (e) {
        const src = it.parsed.sheetName ? `${it.parsed.fileName} › ${it.parsed.sheetName}` : it.parsed.fileName
        summary.failed.push(`${it.employeeName} (${src}): ${e.message || e}`)
      }
    }
    // Dọn file gốc cũ không còn phiếu nào dùng (RLS chỉ cho xoá file của mình)
    for (const fid of oldFiles) {
      const { count } = await supabase
        .from('evaluations')
        .select('id', { count: 'exact', head: true })
        .eq('source_file_id', fid)
      if (!count) await supabase.from('kpi_files').delete().eq('id', fid)
    }
    if (approver) localStorage.setItem(LAST_APPROVER, approver)
    setItems((prev) => prev.filter((x) => !done.has(x.id)))
    setKnown(await loadKnown())
    setResult(summary)
    setBusy('')
  }

  async function downloadTemplate() {
    const blob = await buildStandardWorkbook({ personName: '', period })
    downloadBlob(blob, standardFileName('Mau', period))
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Nhập KPI từ file Excel</h1>
          <p className="text-sm text-slate-500">
            Chọn file → kiểm tra tên & số liệu ở bảng xem trước → <b>Xác nhận nhập</b>. Phiếu vào trạng thái{' '}
            <b>Chờ duyệt</b>, bạn vẫn sửa được cho tới khi người duyệt duyệt.
          </p>
        </div>
        <button onClick={downloadTemplate} className="text-sm text-brand-600 hover:underline">
          ⬇ Tải mẫu trống
        </button>
      </div>

      <Alert>{error}</Alert>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <Field label="Người duyệt (N+1) — áp cho các file chọn tiếp theo">
            <ApproverSelect
              value={approver}
              onChange={changeApprover}
              users={people.users}
              managerSet={people.managerSet}
              me={username}
              className="input min-w-[18rem]"
            />
          </Field>
          <Field label="Kỳ mặc định (khi file không ghi kỳ)">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input">
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {formatPeriod(p.period)} {p.is_open ? '' : '(đã khoá)'}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            handleFiles(e.dataTransfer.files)
          }}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-400 hover:bg-brand-50/30"
        >
          <span className="text-sm font-medium text-slate-700">
            {busy === 'parse' ? 'Đang đọc file...' : 'Kéo thả hoặc bấm để chọn file .xlsx (chọn được nhiều file)'}
          </span>
          <span className="mt-1 text-xs text-slate-500">
            Mẫu chuẩn "Đăng kí & đánh giá KPI tháng" (1 người/file) hoặc file cả đội (mỗi sheet "KPI 11 - Họ tên" là 1
            người).
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            disabled={busy === 'parse'}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
        {notes.map((n, i) => (
          <p key={i} className="mt-2 text-xs text-amber-700">
            ⚠ {n}
          </p>
        ))}
      </section>

      {items.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              Xem trước — {items.length} phiếu · <span className="text-green-700">{ready.length} hợp lệ</span>
              {items.length > ready.length && <span className="text-red-600"> · {items.length - ready.length} cần sửa</span>}
            </h2>
            <button onClick={() => setItems([])} className="text-sm text-slate-500 hover:text-slate-700">
              Xoá danh sách
            </button>
          </div>

          <datalist id="known-names">
            {knownList.map((k) => (
              <option key={k.key} value={k.name} />
            ))}
          </datalist>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Nguồn</th>
                  <th className="px-3 py-2 font-medium">Nhân viên</th>
                  <th className="px-3 py-2 font-medium">Kỳ</th>
                  <th className="px-3 py-2 font-medium">Người duyệt</th>
                  <th className="px-3 py-2 text-right font-medium">Mục tiêu</th>
                  <th className="px-3 py-2 text-right font-medium">KQ N</th>
                  <th className="px-3 py-2 text-right font-medium">KQ N+1</th>
                  <th className="px-3 py-2 font-medium">Cuối cùng</th>
                  <th className="px-3 py-2 font-medium">Trên hệ thống</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <PreviewRows
                    key={it.id}
                    it={it}
                    errs={blockers(it)}
                    ev={existingOf(it)}
                    check={nameCheck(it)}
                    open={expanded === it.id}
                    periods={periods}
                    people={people}
                    me={username}
                    onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
                    onChange={(c) => updateItem(it.id, c)}
                    onRemove={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleApply}
              disabled={!ready.length || busy === 'apply'}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy === 'apply' ? 'Đang nhập...' : `✓ Xác nhận nhập ${ready.length} phiếu`}
            </button>
            {items.length > ready.length && (
              <span className="text-sm text-slate-500">Dòng có lỗi được giữ lại để sửa, không nhập.</span>
            )}
          </div>
        </section>
      )}

      {result && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="mb-2 font-semibold text-green-800">Đã nhập xong</h2>
          <p className="text-sm text-green-800">
            Tạo mới {result.created} · cập nhật {result.updated} phiếu · {result.rows} dòng mục tiêu.{' '}
            <Link to="/phieu" className="font-medium underline">
              Xem danh sách phiếu →
            </Link>
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-3 list-inside list-disc rounded-md bg-red-50 p-3 text-sm text-red-700">
              {result.failed.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function PreviewRows({ it, errs, ev, check, open, periods, people, me, onToggle, onChange, onRemove }) {
  const p = it.parsed
  const ok = errs.length === 0
  const hasResult = !p.fatal && (p.hasSelfResults || p.hasManagerResults)
  const grade = hasResult ? gradeOf(p.totals.final) : null
  return (
    <>
      <tr className={ok ? 'align-top' : 'bg-red-50/40 align-top'}>
        <td className="max-w-[15rem] px-3 py-2">
          <div className="truncate font-medium text-slate-800" title={p.fileName}>
            {ok ? '✓ ' : '⚠ '}
            {p.fileName}
          </div>
          {p.sheetName && <div className="truncate text-xs text-slate-600">Sheet: {p.sheetName}</div>}
        </td>
        <td className="px-3 py-2">
          <input
            value={it.employeeName}
            list="known-names"
            onChange={(e) => onChange({ employeeName: e.target.value, nameFrom: 'Nhập tay' })}
            placeholder="Họ tên nhân viên"
            className={`input w-56 ${it.employeeName.trim() ? '' : 'border-red-400'}`}
          />
          {it.nameFrom && <div className="mt-0.5 text-[11px] text-slate-500">Nguồn: {it.nameFrom}</div>}
          {check && (
            <div className={`text-[11px] ${check.ok ? 'text-green-700' : 'text-amber-700'}`}>
              {check.ok ? '✓ ' : '• '}
              {check.text}
              {check.suggest && (
                <>
                  {' '}— có phải{' '}
                  <button
                    onClick={() => onChange({ employeeName: check.suggest, nameFrom: 'Gợi ý từ hệ thống' })}
                    className="font-medium underline"
                  >
                    {check.suggest}
                  </button>
                  ?
                </>
              )}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <select value={it.period} onChange={(e) => onChange({ period: e.target.value })} className="input">
            {it.period && !periods.some((x) => x.period === it.period) && (
              <option value={it.period}>{formatPeriod(it.period)}</option>
            )}
            {periods.map((x) => (
              <option key={x.period} value={x.period}>
                {formatPeriod(x.period)}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2">
          <ApproverSelect
            value={it.approver}
            onChange={(v) => onChange({ approver: v })}
            users={people.users}
            managerSet={people.managerSet}
            me={me}
            className={`input w-52 text-xs ${it.approver ? '' : 'border-red-400'}`}
          />
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal ? '—' : p.objectives.length}</td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal || !p.hasSelfResults ? '—' : pct(p.totals.self)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{p.fatal || !p.hasManagerResults ? '—' : pct(p.totals.manager)}</td>
        <td className="px-3 py-2">{grade ? <GradeBadge grade={grade} score={p.totals.final} /> : <span className="text-xs text-slate-400">Chưa có KQ</span>}</td>
        <td className="px-3 py-2">
          {ev ? (
            <div>
              <StatusBadge status={ev.status} />
              <div className="mt-0.5 text-[11px] text-slate-500">
                {isApproved(ev) ? 'Đã khoá' : 'Sẽ cập nhật'}
                {ev.manager_username !== it.approver ? ` · đang ở ${userLabel(people.userMap, ev.manager_username)}` : ''}
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-500">Tạo mới</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {!p.fatal && (
            <button onClick={onToggle} className="mr-2 text-xs text-brand-600 hover:underline">
              {open ? 'Ẩn' : 'Chi tiết'}
            </button>
          )}
          <button onClick={onRemove} className="text-slate-400 hover:text-red-600" title="Bỏ dòng này">
            ✕
          </button>
        </td>
      </tr>
      {(errs.length > 0 || (open && p.warnings?.length > 0)) && (
        <tr className={ok ? '' : 'bg-red-50/40'}>
          <td colSpan={10} className="px-3 pb-2">
            {errs.map((e, i) => (
              <div key={i} className="text-xs text-red-700">
                • {e}
              </div>
            ))}
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
