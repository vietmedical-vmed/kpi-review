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
  parseWorkbookFile,
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
  const [noAccount, setNoAccount] = useState([]) // [{ key, name }] nhân viên không TK mình phụ trách
  const [fileNames, setFileNames] = useState(new Map()) // username -> tên trong file gần nhất
  const [downloadUser, setDownloadUser] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [items, setItems] = useState([]) // các file đã đọc
  const [expanded, setExpanded] = useState(null)
  const [result, setResult] = useState(null)
  const [skipNotes, setSkipNotes] = useState([]) // sheet ẩn bị bỏ qua khi đọc file cả đội
  const [autoLink, setAutoLink] = useState(false) // tự gắn tài khoản theo tên — mặc định tắt
  const [approver, setApprover] = useState('') // N+1 phụ trách phiếu không TK (admin chọn được người khác)

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

  // Nhân viên KHÔNG có tài khoản do mình phụ trách (đã từng nhập phiếu)
  async function loadNoAccount() {
    let q = supabase
      .from('evaluations')
      .select('employee_key, employee_name, manager_username, period')
      .is('username', null)
      .order('period', { ascending: false })
    if (!isAdmin) q = q.eq('manager_username', username)
    const { data } = await q
    const m = new Map()
    for (const e of data || []) if (!m.has(e.employee_key)) m.set(e.employee_key, { key: e.employee_key, name: e.employee_name })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }

  // Tên LẤY TỪ FILE gần nhất của nhân viên có tài khoản (username -> tên).
  // Tên hiển thị ưu tiên tên trong file, chỉ dùng tên hệ thống khi chưa từng nhập file.
  async function loadFileNames() {
    const { data } = await supabase
      .from('evaluations')
      .select('username, employee_name, period')
      .not('username', 'is', null)
      .not('employee_name', 'is', null)
      .order('period', { ascending: false })
    const m = new Map()
    for (const e of data || []) if (!m.has(e.username)) m.set(e.username, e.employee_name)
    return m
  }

  useEffect(() => {
    async function init() {
      const [ps, users, na, fn] = await Promise.all([loadPeriods(), loadScopeUsers(), loadNoAccount(), loadFileNames()])
      setPeriods(ps)
      setPeriod(defaultPeriod(ps))
      setScopeUsers(users)
      setNoAccount(na)
      setFileNames(fn)
      setDownloadUser(username)
      setApprover(username)
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
   * Tên nhân viên LẤY TỪ FILE (nhiều nhân viên không có tài khoản):
   *  - Ô "NHÂN VIÊN" trong file; trống thì lấy tên sheet / phần đầu tên file.
   *  - MẶC ĐỊNH KHÔNG gắn tài khoản: phiếu thuộc "Người duyệt (N+1)" chọn khi upload,
   *    N+1 + quản lý cấp trên N+1 xem, N+1 chấm/duyệt — không phụ thuộc sơ đồ tổ chức.
   *  - Bật "Tự gắn tài khoản": gắn khi khớp chắc chắn ("(username)" trong ô, hoặc họ
   *    tên trùng 1 tài khoản trong phạm vi). Phiếu có tài khoản thì quyền theo sơ đồ
   *    tổ chức, nhân viên tự đăng nhập được.
   */
  function resolvePerson(parsed, link = autoLink) {
    const idText = (parsed.identity?.person || '').trim()
    const fromCell = idText.replace(/\s*\([^()]*\)\s*$/, '').trim()
    const fnName = (parsed.personName || '').trim()
    const fnLooksLikeName =
      fnName && !/\d/.test(fnName) && !/kpi|danh gia|dang ky|dang ki|template|mau/.test(normalizeName(fnName))
    const name = fromCell || (fnLooksLikeName ? fnName : '')
    const nameFrom = fromCell ? 'file' : name ? (parsed.sheetName ? 'sheet' : 'filename') : null
    const m = idText.match(/\(([^()]+)\)\s*$/)
    const un = m?.[1]?.trim().toLowerCase()
    const byUn = un && scopeUsers.find((u) => u.username.toLowerCase() === un)
    const byName = name && userByName.get(normalizeName(name))
    const acc = link ? byUn || byName || null : null
    return { employeeName: name, nameFrom, username: acc?.username || '' }
  }
  const periodMap = useMemo(() => new Map(periods.map((p) => [p.period, p])), [periods])

  // ------------------------------------------------- TẢI MẪU CHUẨN
  // key: username, hoặc "name:<employee_key>" cho nhân viên không tài khoản
  async function exportFor(key) {
    const isNa = key.startsWith('name:')
    const naKey = isNa ? key.slice(5) : null
    const u = isNa ? null : userMap.get(key)
    const na = isNa ? noAccount.find((x) => x.key === naKey) : null
    let q = supabase.from('evaluations').select('*').eq('period', period)
    q = isNa ? q.is('username', null).eq('employee_key', naKey) : q.eq('username', key)
    if (isNa && !isAdmin) q = q.eq('manager_username', username)
    const { data: evs } = await q.limit(1)
    const ev = evs?.[0] || null
    const name = ev?.employee_name || na?.name || fileNames.get(key) || u?.ho_va_ten || key
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
      personName: name,
      username: isNa ? '' : key,
      people: [
        ...scopeUsers.map((x) => ({ ...x, ho_va_ten: fileNames.get(x.username) || x.ho_va_ten })),
        ...noAccount.map((x) => ({ username: '', ho_va_ten: x.name })),
      ],
      period,
      objectives,
      registrationComment: ev?.registration_comment || '',
      managerComment: ev?.manager_comment || '',
    })
    downloadBlob(blob, standardFileName(name, period))
  }

  async function handleDownload(all = false) {
    setError('')
    setBusy(all ? 'download-all' : 'download')
    try {
      const list = all
        ? [...scopeUsers.map((u) => u.username), ...noAccount.map((x) => `name:${x.key}`)]
        : [downloadUser]
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
    const self = !!uname && uname === username
    if (!self && (isManager || isAdmin || !uname)) {
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
      const notes = []
      for (const f of files) {
        // 1 file mẫu chuẩn -> 1 phiếu; file cả đội (mỗi sheet 1 người) -> nhiều phiếu
        const { entries, skippedHidden } = await parseWorkbookFile(f)
        if (skippedHidden.length) notes.push(`${f.name}: bỏ qua ${skippedHidden.length} sheet ẩn — ${skippedHidden.join(', ')}`)
        for (const parsed of entries) {
          const who = resolvePerson(parsed)
          const uname = who.username
          parsedList.push({
            id: ++fileSeq,
            parsed,
            username: uname,
            approver: approver || username,
            employeeName: who.employeeName,
            nameFrom: who.nameFrom,
            period: parsed.period || period,
            targetStatus: parsed.fatal ? 'draft' : defaultStatus(parsed, uname),
          })
        }
      }
      setItems((prev) => [...prev, ...parsedList])
      setSkipNotes(notes)
    } catch (err) {
      setError('Không đọc được file: ' + (err.message || err))
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Khoá nhận diện 1 dòng: tài khoản, hoặc tên chuẩn hoá + N+1 phụ trách (phiếu không tài khoản)
  const itemKey = (it) =>
    it.username
      ? it.username
      : it.employeeName
        ? `name:${normalizeName(it.employeeName)}@${it.approver || username}`
        : ''

  // Phiếu hiện có của 1 dòng. Admin: nếu N+1 chưa có phiếu của người này thì lấy phiếu
  // cùng tên/kỳ đang nằm ở N+1 khác (khi áp dụng sẽ chuyển sang N+1 mới).
  function existingOf(it, map = existing) {
    const exact = map[`${itemKey(it)}|${it.period}`]
    if (exact || it.username || !isAdmin || !it.employeeName) return exact
    return map[`name:${normalizeName(it.employeeName)}@*|${it.period}`]
  }

  // Lấy trạng thái phiếu hiện có cho các cặp (người, kỳ) trong danh sách
  const [existing, setExisting] = useState({}) // key "itemKey|period" -> evaluation
  useEffect(() => {
    const list = items.filter((it) => itemKey(it) && it.period)
    if (!list.length) return
    ;(async () => {
      const next = {}
      const byPeriod = {}
      for (const it of list) (byPeriod[it.period] ||= []).push(it)
      for (const [p, its] of Object.entries(byPeriod)) {
        const accs = [...new Set(its.filter((x) => x.username).map((x) => x.username))]
        const na = its.filter((x) => !x.username)
        const keys = [...new Set(na.map((x) => normalizeName(x.employeeName)))]
        const mgrs = [...new Set(na.map((x) => x.approver || username))]
        if (accs.length) {
          const { data } = await supabase
            .from('evaluations')
            .select('id, username, period, status')
            .eq('period', p)
            .in('username', accs)
          for (const ev of data || []) next[`${ev.username}|${p}`] = ev
        }
        if (keys.length) {
          let q = supabase
            .from('evaluations')
            .select('id, employee_key, manager_username, period, status')
            .eq('period', p)
            .is('username', null)
            .in('employee_key', keys)
          if (!isAdmin) q = q.in('manager_username', mgrs)
          const { data } = await q
          for (const ev of data || []) {
            next[`name:${ev.employee_key}@${ev.manager_username}|${p}`] = ev
            next[`name:${ev.employee_key}@*|${p}`] ||= ev
          }
        }
      }
      setExisting(next)
      // Không tự hạ trạng thái phiếu đang có (vd Đã chấm -> Chờ duyệt) trừ khi người dùng tự chọn
      setItems((prev) => {
        let changed = false
        const out = prev.map((it) => {
          const ev = existingOf(it, next)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  function updateItem(id, changes) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const next = { ...it, ...changes }
        if (changes.employeeName !== undefined) next.nameFrom = null
        if (changes.username !== undefined) {
          next.statusTouched = false
          next.linkTouched = true
          if (!it.parsed.fatal) next.targetStatus = defaultStatus(it.parsed, changes.username)
        }
        return next
      })
    )
  }

  // Bật/tắt tự gắn tài khoản: tính lại cho các dòng chưa chọn tay
  function toggleAutoLink(on) {
    setAutoLink(on)
    setItems((prev) =>
      prev.map((it) => {
        if (it.linkTouched || it.parsed.fatal) return it
        const un = resolvePerson(it.parsed, on).username
        if (un === it.username) return it
        return { ...it, username: un, statusTouched: false, targetStatus: defaultStatus(it.parsed, un) }
      })
    )
  }

  // Admin đổi Người duyệt chung: áp cho mọi dòng không tài khoản
  function changeApprover(un) {
    setApprover(un)
    setItems((prev) => prev.map((it) => ({ ...it, approver: un })))
  }

  // Kiểm tra từng file -> danh sách lỗi chặn
  function blockers(it) {
    const out = []
    if (it.parsed.fatal) return [it.parsed.fatal]
    out.push(...it.parsed.errors)
    if (!it.username && !it.employeeName?.trim())
      out.push('Chưa có tên nhân viên — điền ô NHÂN VIÊN trong file hoặc nhập tên ở cột Nhân viên.')
    if (!it.period) out.push('Chưa xác định kỳ đánh giá.')
    else if (!isPeriodAllowed(it.period)) out.push(`Kỳ ${formatPeriod(it.period)} nằm ngoài khoảng cho phép.`)
    else {
      const p = periodMap.get(it.period)
      if (p && !p.is_open && !isAdmin) out.push(`Kỳ ${formatPeriod(it.period)} đã bị khoá.`)
    }
    const k = itemKey(it)
    const dup = items.filter((x) => k && itemKey(x) === k && x.period === it.period)
    if (k && dup.length > 1 && dup[0].id !== it.id) out.push('Trùng nhân viên & kỳ với phiếu khác phía trên.')
    if (!it.username && !it.approver) out.push('Chưa chọn Người duyệt (N+1).')
    const ev = existingOf(it)
    if (ev) {
      const self = it.username === username
      if (ev.status === 'approved' && !isAdmin) out.push('Phiếu đã Chốt — chỉ admin được ghi đè.')
      else if (self && !isAdmin && ev.status !== 'draft')
        out.push(`Phiếu của bạn đang "${STATUS_LABELS[ev.status]}" — chỉ nhập được khi còn Nháp.`)
    }
    return out
  }

  function allowedStatuses(it) {
    const self = !!it.username && it.username === username
    if (isAdmin) return STATUS_ORDER
    if (self) return it.parsed.hasSelfResults ? ['draft', 'submitted'] : ['draft']
    return STATUS_ORDER
  }

  const ready = items.filter((it) => blockers(it).length === 0)

  // ------------------------------------------------- ÁP DỤNG
  async function applyOne(it) {
    const p = it.parsed
    const name = (it.employeeName || '').trim()
    const key = normalizeName(name)
    const mgr = isAdmin ? it.approver || username : username // chỉ admin được giao phiếu cho N+1 khác
    let find = supabase.from('evaluations').select('*').eq('period', it.period)
    find = it.username
      ? find.eq('username', it.username)
      : find.is('username', null).eq('employee_key', key).eq('manager_username', mgr)
    let { data: ev, error: findErr } = await find.maybeSingle()
    if (findErr) throw findErr
    let reassign = false
    if (!ev && !it.username && isAdmin) {
      // Admin: phiếu cùng tên/kỳ đang ở N+1 khác -> chuyển sang N+1 đã chọn
      const { data: other, error: e2 } = await supabase
        .from('evaluations')
        .select('*')
        .eq('period', it.period)
        .is('username', null)
        .eq('employee_key', key)
        .order('created_at')
        .limit(1)
      if (e2) throw e2
      if (other?.[0]) {
        ev = other[0]
        reassign = ev.manager_username !== mgr
      }
    }
    let created = false
    if (!ev) {
      const row = it.username
        ? { username: it.username, period: it.period, status: 'draft', employee_name: name || null }
        : { username: null, employee_name: name, employee_key: key, manager_username: mgr, period: it.period, status: 'draft' }
      const { data, error } = await supabase
        .from('evaluations')
        .insert(row)
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
      source_file: p.sheetName ? `${p.fileName} [${p.sheetName}]` : p.fileName,
      imported_at: now,
      imported_by: username,
      status: st,
    }
    if (name) upd.employee_name = name
    if (reassign) upd.manager_username = mgr
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
      const who = it.employeeName || fileNames.get(it.username) || userMap.get(it.username)?.ho_va_ten || it.username
      try {
        const r = await applyOne(it)
        r.created ? summary.created++ : summary.updated++
        summary.rows += r.rows
        done.add(it.id)
      } catch (e) {
        const src = it.parsed.sheetName ? `${it.parsed.fileName} › ${it.parsed.sheetName}` : it.parsed.fileName
        summary.failed.push(`${who} (${src}): ${e.message || e}`)
      }
    }
    setItems((prev) => prev.filter((x) => !done.has(x.id)))
    setNoAccount(await loadNoAccount())
    setFileNames(await loadFileNames())
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
          <b>NHÂN VIÊN</b> và <b>KỲ ĐÁNH GIÁ</b>. <b>Tên nhân viên lấy theo ô này</b> (chọn trong danh sách hoặc gõ tên
          người chưa có tài khoản) — leader gom file cả đội, đặt tên file tuỳ ý rồi upload một lần.
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
              <optgroup label="Có tài khoản">
                {scopeUsers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {fileNames.get(u.username) || u.ho_va_ten || u.username}
                    {u.username === username ? ' (tôi)' : ''}
                  </option>
                ))}
              </optgroup>
              {noAccount.length > 0 && (
                <optgroup label="Không có tài khoản">
                  {noAccount.map((x) => (
                    <option key={x.key} value={`name:${x.key}`}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <button
            onClick={() => handleDownload(false)}
            disabled={!period || !!busy}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === 'download' ? 'Đang tạo...' : '⬇ Tải file'}
          </button>
          {scopeUsers.length + noAccount.length > 1 && (
            <button
              onClick={() => handleDownload(true)}
              disabled={!period || !!busy}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === 'download-all' ? 'Đang tạo...' : `⬇ Tải cho cả đội (${scopeUsers.length + noAccount.length} file)`}
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
        <p className="mb-3 text-sm text-slate-500">
          Cũng nhận <b>file cả đội</b> (dạng file miền Bắc): mỗi sheet <i>"KPI 11 - Họ tên"</i> là phiếu của 1 người,
          tên nhân viên lấy từ tên sheet. Sheet tổng hợp / phụ lục và sheet ẩn được bỏ qua.
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-4 rounded-lg bg-slate-50 p-3">
          <Field label="Người duyệt (N+1) của các phiếu">
            {isAdmin ? (
              <select value={approver} onChange={(e) => changeApprover(e.target.value)} className="input min-w-[16rem]">
                {scopeUsers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.ho_va_ten || u.username} ({u.username}){u.username === username ? ' — tôi' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="py-2 text-sm font-medium text-slate-700">Bạn ({username})</div>
            )}
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={autoLink} onChange={(e) => toggleAutoLink(e.target.checked)} />
            Tự gắn tài khoản khi trùng họ tên
          </label>
          <p className="w-full text-xs text-slate-500">
            Mặc định phiếu <b>không gắn tài khoản</b>: Người duyệt (N+1) và quản lý cấp trên của N+1 xem được trong Báo cáo,
            N+1 chấm & duyệt. Chỉ gắn tài khoản (tự động hoặc chọn từng dòng) cho nhân viên cần tự đăng nhập — khi đó quyền
            xem/duyệt theo Sơ đồ tổ chức.
          </p>
        </div>
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
        {skipNotes.map((n, i) => (
          <p key={i} className="mt-2 text-xs text-amber-700">
            ⚠ {n}
          </p>
        ))}
      </section>

      {/* Bước 3 — xem trước */}
      {items.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              3. Xem trước — {items.length} phiếu · <span className="text-green-700">{ready.length} hợp lệ</span>
              {items.length - ready.length > 0 && (
                <span className="text-red-600"> · {items.length - ready.length} có lỗi</span>
              )}
            </h2>
            <button
              onClick={() => {
                setItems([])
                setSkipNotes([])
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
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
                  const ev = existingOf(it)
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
                      isAdmin={isAdmin}
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
              {busy === 'apply' ? 'Đang ghi...' : `✓ Áp dụng ${ready.length} phiếu hợp lệ`}
            </button>
            {items.length > ready.length && (
              <span className="text-sm text-slate-500">Phiếu có lỗi sẽ được giữ lại để sửa, không ghi.</span>
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

const NAME_HINTS = {
  file: ['Tên lấy từ ô NHÂN VIÊN trong file', 'text-green-700'],
  sheet: ['Tên lấy từ tên sheet', 'text-green-700'],
  filename: ['Tên lấy từ tên file — kiểm tra lại', 'text-amber-700'],
}
function NameHint({ from }) {
  if (!from) return null
  const [text, cls] = NAME_HINTS[from]
  return <div className={`mt-0.5 text-xs ${cls}`}>{text}</div>
}

function pct(v) {
  return v === null || v === undefined ? '—' : `${v}%`
}

function FileRows({ it, p, errs, ev, open, scopeUsers, isAdmin, periods, allowed, onToggle, onChange, onRemove }) {
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
          {p.sheetName && (
            <div className="truncate text-xs text-slate-600" title={p.sheetName}>
              Sheet: {p.sheetName}
            </div>
          )}
          {!p.fatal && (
            <div className="text-xs text-slate-500">
              {p.source === 'evaluation'
                ? 'Đánh giá cuối tháng'
                : p.source === 'sheet'
                  ? p.hasSelfResults || p.hasManagerResults
                    ? 'Có kết quả đánh giá'
                    : 'Chỉ đăng ký mục tiêu'
                  : 'Chỉ Đăng ký đầu tháng'}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <input
            value={it.employeeName || ''}
            onChange={(e) => onChange({ employeeName: e.target.value })}
            placeholder="Họ tên nhân viên"
            className={`input w-52 ${it.employeeName?.trim() || it.username ? '' : 'border-red-400'}`}
          />
          <NameHint from={it.nameFrom} />
          <select
            value={it.username}
            onChange={(e) => onChange({ username: e.target.value })}
            className="input mt-1 w-52 py-1 text-xs"
            title="Liên kết với tài khoản (nếu nhân viên có tài khoản)"
          >
            <option value="">Không có tài khoản</option>
            {scopeUsers.map((u) => (
              <option key={u.username} value={u.username}>
                TK: {u.username}
                {u.ho_va_ten ? ` (${u.ho_va_ten})` : ''}
              </option>
            ))}
          </select>
          {!it.username && isAdmin && (
            <select
              value={it.approver}
              onChange={(e) => onChange({ approver: e.target.value })}
              className="input mt-1 w-52 py-1 text-xs"
              title="Người duyệt (N+1) của phiếu này"
            >
              {scopeUsers.map((u) => (
                <option key={u.username} value={u.username}>
                  N+1: {u.ho_va_ten || u.username}
                </option>
              ))}
            </select>
          )}
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
