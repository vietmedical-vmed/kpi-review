// Đọc & tạo file Excel theo MẪU CHUẨN "Đăng kí & đánh giá KPI tháng".
//
// Mẫu gồm 2 sheet, mỗi file là phiếu của 1 người:
//   • "Đăng ký đầu tháng"  : STT | TÊN MỤC TIÊU | CÁCH THỨC ĐO | TRỌNG SỐ | MỤC TIÊU CẦN ĐẠT
//                            + "Ý KIẾN CỦA N+1"
//   • "Đánh giá cuối tháng": STT | TÊN MỤC TIÊU | MỤC TIÊU CẦN ĐẠT | CÁCH THỨC ĐO | TRỌNG SỐ |
//                            TÀI LIỆU THAM CHIẾU | KQ CỦA N | HỆ SỐ N | KQ CỦA N+1 | HỆ SỐ N+1
//                            + KẾT QUẢ CỦA N / N+1, ĐÁNH GIÁ CỦA N+1, KẾT QUẢ CUỐI CÙNG, XẾP LOẠI
// Tên file: "<Họ và tên>_ Đăng kí & đánh giá KPI tháng_<YYYY-MM>.xlsx"
// Dòng 4 sheet Đăng ký: ô "NHÂN VIÊN" (dropdown "Họ tên (username)") + ô "KỲ ĐÁNH GIÁ".
// Khi đọc, ô trong file được ưu tiên hơn tên file (leader upload hộ cả đội,
// tên file có thể tuỳ ý).
// Ngoài mẫu chuẩn, parser còn đọc "file cả đội" (dạng file miền Bắc): mỗi sheet
// "KPI 11 - <Họ tên>" là phiếu 1 người, tên nhân viên lấy từ tên sheet.
//
// Parser đọc theo TIÊU ĐỀ CỘT (không phụ thuộc vị trí cố định), nhận số dạng
// tỷ lệ (0.9 / ô định dạng %) lẫn dạng số (90) và quy về thang 0–100.
// exceljs được nạp động để không làm nặng bundle chính.
import {
  CATEGORIES,
  PASS_THRESHOLD,
  formatPeriod,
  normalizeName,
  round2,
  STATUS_LABELS,
} from './constants'

export const MAX_ROWS_PER_USER = 20
const MIN_TEMPLATE_ROWS = 10

const SHEET_REG = 'Đăng ký đầu tháng'
const SHEET_EVAL = 'Đánh giá cuối tháng'

export function standardFileName(personName, period) {
  const safe = String(personName || 'Nhan vien').replace(/[\\/:*?"<>|]/g, '').trim()
  return `${safe}_ Đăng kí & đánh giá KPI tháng_${period}.xlsx`
}

async function loadExcelJS() {
  return (await import('exceljs')).default
}

// ================================================================ ĐỌC Ô
function rawValue(cellValue) {
  if (cellValue === null || cellValue === undefined) return null
  if (typeof cellValue === 'object' && !(cellValue instanceof Date)) {
    if (cellValue.result !== undefined) return cellValue.result
    if (cellValue.formula !== undefined || cellValue.sharedFormula !== undefined) return null
    if (cellValue.richText) return cellValue.richText.map((t) => t.text).join('')
    if (cellValue.text !== undefined) return cellValue.text
    if (cellValue.error) return null
  }
  return cellValue
}

export function cellText(cell) {
  const v = rawValue(cell?.value)
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).replace(/\r\n/g, '\n').trim()
}

/**
 * Đọc ô phần trăm về thang 0–100.
 *   - Ô định dạng % (lưu 0.9)  -> 90
 *   - Số <= 1 (mẫu chuẩn nhập theo tỷ lệ) -> ×100
 *   - Số > 1 (người nhập 90)   -> 90
 *   - Chuỗi "90%", "90", "0,9" -> 90
 * Trả null nếu trống, NaN nếu không phải số.
 */
export function cellPercent(cell) {
  const v = rawValue(cell?.value)
  if (v === null || v === undefined || v === '') return null
  const fmt = String(cell?.numFmt || '')
  if (typeof v === 'number') {
    if (fmt.includes('%') || Math.abs(v) <= 1) return round2(v * 100)
    return round2(v)
  }
  const s = String(v).trim()
  if (s === '') return null
  const hasPct = s.includes('%')
  const n = Number(s.replace('%', '').replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return NaN
  if (hasPct) return round2(n)
  return Math.abs(n) <= 1 ? round2(n * 100) : round2(n)
}

const PLACEHOLDER = /^\[?\s*điền text\s*\]?$/i
function cleanComment(s) {
  const t = String(s || '').trim()
  return PLACEHOLDER.test(t) ? '' : t
}

// ================================================================ TÊN FILE
export function parsePeriodText(text) {
  const s = String(text || '')
  let m = s.match(/(20\d{2})\s*[-_./]\s*(0?[1-9]|1[0-2])(?!\d)/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`
  m = s.match(/(?<!\d)(0?[1-9]|1[0-2])\s*[-_./]\s*(20\d{2})/) // "10/2026", "Tháng 10/2026"
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`
  return null
}

export function parseFileName(fileName) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)\s*$/, '') // "… (1)" khi tải trùng tên
  let period = null
  const re = /(20\d{2})[-_.\s]?(0?[1-9]|1[0-2])(?!\d)/g
  let m
  while ((m = re.exec(base))) period = `${m[1]}-${String(m[2]).padStart(2, '0')}`
  const personName = base.split('_')[0].trim()
  return { personName, period }
}

// ================================================================ SHEET
function findSheet(wb, key) {
  const want = normalizeName(key)
  return wb.worksheets.find((ws) => normalizeName(ws.name).includes(want)) || null
}

// Map tiêu đề -> trường. Thứ tự quan trọng: "n+1" phải kiểm tra trước "n".
function headerField(text) {
  const h = normalizeName(text)
  if (!h) return null
  if (h === 'stt') return 'stt'
  if (h.includes('he so')) return null
  if (h.includes('ten muc tieu')) return 'name'
  if (h.includes('muc tieu can dat')) return 'target'
  if (h.includes('cach thuc do')) return 'measure_method'
  if (h.includes('trong so')) return 'weight'
  if (h.includes('tai lieu')) return 'reference_doc'
  if (h.includes('n+1') && h.includes('ket qua')) return 'manager_result'
  if (h.includes('ket qua') && /cua n\b/.test(h)) return 'self_result'
  return null
}

// Tìm dòng tiêu đề (có STT + TÊN MỤC TIÊU) trong 20 dòng đầu
function findHeader(ws) {
  for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
    const found = {}
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const f = headerField(cellText(cell))
      if (f && !found[f]) found[f] = c
    })
    if (found.stt && found.name) return { headerRow: r, cols: found }
  }
  return null
}

// Dòng "TỔNG ..." kết thúc bảng mục tiêu (0 nếu không có)
function findTotalRow(ws, headerRow) {
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    if (normalizeName(cellText(ws.getRow(r).getCell(1))).startsWith('tong')) return r
  }
  return 0
}

function readSheet(ws) {
  if (!ws) return null
  const h = findHeader(ws)
  if (!h) return { headerFound: false, rows: [], comments: {} }
  const { headerRow, cols } = h

  const rows = []
  const comments = {}
  let r = headerRow + 1
  for (; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const first = normalizeName(cellText(row.getCell(1)))
    if (first.startsWith('tong')) break
    const get = (k) => (cols[k] ? row.getCell(cols[k]) : null)
    const item = {
      excelRow: r,
      name: cellText(get('name')),
      target: cellText(get('target')),
      measure_method: cellText(get('measure_method')),
      reference_doc: cellText(get('reference_doc')),
      weight: cellPercent(get('weight')),
      self_result: cols.self_result ? cellPercent(get('self_result')) : null,
      manager_result: cols.manager_result ? cellPercent(get('manager_result')) : null,
    }
    const empty =
      !item.name && !item.target && !item.measure_method && !item.reference_doc &&
      item.weight === null && item.self_result === null && item.manager_result === null
    if (!empty) rows.push(item)
  }

  // Phần tổng hợp phía dưới: nhãn ở cột A, giá trị ở ô có dữ liệu đầu tiên bên phải
  for (; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const label = normalizeName(cellText(row.getCell(1)))
    if (!label) continue
    let value = ''
    for (let c = 2; c <= Math.max(row.cellCount, 4); c++) {
      const cell = row.getCell(c)
      // Ô phụ của vùng merge chứa nhãn (vd A19:B19) trả về chính nhãn -> bỏ qua
      if (cell.isMerged && cell.master.address !== cell.address && cell.master.col === 1) continue
      const t = cellText(cell)
      if (t) {
        value = t
        break
      }
    }
    if (label.startsWith('y kien cua n+1')) comments.registration = cleanComment(value)
    else if (label.startsWith('danh gia cua n+1')) comments.manager = cleanComment(value)
  }

  return { headerFound: true, cols, rows, comments }
}

// Đọc ô nhận diện ở các dòng đầu: "NHÂN VIÊN" | <giá trị>, "KỲ ĐÁNH GIÁ" | <giá trị>.
// Cũng hiểu dạng 1 ô gộp "Nhân viên: X · Kỳ: Tháng 10/2026" (file tải từ bản cũ).
function readIdentity(ws) {
  const out = { person: '', period: null, personCell: null }
  if (!ws) return out
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    const row = ws.getRow(r)
    const lastCol = Math.max(row.cellCount, 6)
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      if (cell.isMerged && cell.master.address !== cell.address) continue
      const text = cellText(cell)
      if (!text) continue
      const norm = normalizeName(text)
      const isPerson = /^(nhan vien|ho va ten|ho ten|ma nv)/.test(norm)
      const isPeriod = /^(ky danh gia|ky\b)/.test(norm)
      if (!isPerson && !isPeriod) continue
      // Dạng "Nhân viên: X · Kỳ: Y" trong cùng 1 ô
      const inline = text.match(/nh[âa]n vi[êe]n\s*:\s*([^·|\n]+)/i)
      if (inline && inline[1].trim()) out.person ||= inline[1].trim()
      const inlineP = text.match(/k[ỳy][^:]*:\s*(.+)$/i)
      if (inlineP) out.period ||= parsePeriodText(inlineP[1])
      if (text.includes(':') && (inline || inlineP)) continue
      // Dạng nhãn | giá trị: lấy ô có dữ liệu kế tiếp bên phải
      for (let k = c + 1; k <= lastCol; k++) {
        const vc = row.getCell(k)
        if (vc.isMerged && vc.master.address === cell.address) continue
        const v = cellText(vc)
        if (!v) continue
        if (PLACEHOLDER.test(v) || /^\[.*\]$/.test(v)) break
        if (isPerson) {
          if (!out.person) out.personCell = vc.address
          out.person ||= v
        } else out.period ||= parsePeriodText(v)
        break
      }
    }
  }
  return out
}

function mapCategory(name) {
  const n = normalizeName(name)
  const hit = CATEGORIES.find((c) => normalizeName(c) === n)
  return hit || 'Khác'
}

// Tên sheet dạng "KPI 11 - Họ tên", "KPI11-Họ tên", " KPI 11- Họ tên" -> "Họ tên"
export function personFromSheetName(sheetName) {
  return String(sheetName || '')
    .replace(/^\s*kpi\s*(th[aá]ng\s*)?(t\s*)?\d{0,2}\s*[-–—:._]*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const READ_FAIL = 'Không đọc được file. Hãy lưu lại dưới dạng .xlsx (không phải .xls/.csv) rồi thử lại.'

/**
 * Đọc 1 file upload. Không kiểm tra quyền/trạng thái (trang gọi lo). Hỗ trợ 2 dạng:
 *  1. Mẫu chuẩn: sheet "Đăng ký đầu tháng" + "Đánh giá cuối tháng", 1 file = 1 người.
 *  2. File cả đội (dạng file miền Bắc): mỗi sheet "KPI 11 - <Họ tên>" là phiếu của
 *     1 người, cột giống sheet Đánh giá. Tên nhân viên lấy từ tên sheet. Sheet không
 *     có bảng mục tiêu (Tổng hợp, Mục tiêu công nợ...) bị bỏ qua; sheet ẩn bị bỏ qua
 *     và trả về trong skippedHidden.
 *
 * Trả { entries, skippedHidden }. Mỗi entry là { fileName, fatal } nếu không đọc được,
 * hoặc { fileName, sheetName, personName, identity, period, source, objectives,
 *   registrationComment, managerComment, hasSelfResults, hasManagerResults,
 *   errors, warnings, totals }.
 */
export async function parseWorkbookFile(file) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    return { entries: [{ fileName: file.name, fatal: READ_FAIL }], skippedHidden: [] }
  }

  const { personName, period: fnPeriod } = parseFileName(file.name)
  const filePeriod = fnPeriod || parsePeriodText(file.name) // "KPI_thang_11_2026_..." -> 2026-11

  // 1. Mẫu chuẩn
  const regWs = findSheet(wb, SHEET_REG)
  const evWs = findSheet(wb, SHEET_EVAL)
  if (regWs || evWs) {
    return { entries: [parseStandardSheets(file.name, personName, filePeriod, regWs, evWs)], skippedHidden: [] }
  }

  // 2. File cả đội: mỗi sheet có bảng mục tiêu là 1 người
  const entries = []
  const skippedHidden = []
  for (const ws of wb.worksheets) {
    const sh = readSheet(ws)
    if (!sh.headerFound || !sh.rows.length) continue
    const sheetName = ws.name.trim()
    if (ws.state && ws.state !== 'visible') {
      skippedHidden.push(sheetName)
      continue
    }
    const identity = readIdentity(ws)
    entries.push(
      buildParsed({
        fileName: file.name,
        sheetName,
        personName: personFromSheetName(ws.name),
        identity,
        period: identity.period || filePeriod,
        reg: null,
        ev: sh,
        team: true,
      })
    )
  }
  if (!entries.length) {
    const hidden = skippedHidden.length ? ` (${skippedHidden.length} sheet ẩn đã bị bỏ qua)` : ''
    entries.push({
      fileName: file.name,
      personName,
      period: filePeriod,
      fatal:
        `Không thấy sheet "${SHEET_REG}" / "${SHEET_EVAL}" theo mẫu chuẩn, cũng không thấy sheet nào có ` +
        `bảng mục tiêu (dòng tiêu đề STT / TÊN MỤC TIÊU)${hidden}.`,
    })
  }
  return { entries, skippedHidden }
}

function parseStandardSheets(fileName, personName, filePeriod, regWs, evWs) {
  const reg = readSheet(regWs)
  const ev = readSheet(evWs)
  const idReg = readIdentity(regWs)
  const idEv = readIdentity(evWs)
  const identity = {
    person: idReg.person || idEv.person || '',
    period: idReg.period || idEv.period || null,
  }
  const period = identity.period || filePeriod

  if (!reg?.headerFound && !ev?.headerFound) {
    return {
      fileName,
      personName,
      identity,
      period,
      fatal: `Không thấy sheet "${SHEET_REG}" hoặc "${SHEET_EVAL}" đúng mẫu (thiếu dòng tiêu đề STT / TÊN MỤC TIÊU).`,
    }
  }
  return buildParsed({ fileName, sheetName: '', personName, identity, period, reg, ev, team: false })
}

function buildParsed({ fileName, sheetName, personName, identity, period, reg, ev, team }) {
  const errors = []
  const warnings = []

  let src
  let source
  if (team) {
    src = ev
    source = 'sheet'
  } else {
    // Ưu tiên sheet Đánh giá cuối tháng (đầy đủ nhất); trống thì dùng sheet Đăng ký
    const useEval = ev?.headerFound && ev.rows.some((x) => x.weight !== null || x.name)
    src = useEval ? ev : reg
    source = useEval ? 'evaluation' : 'registration'
    if (useEval && reg?.headerFound && reg.rows.length && reg.rows.length !== ev.rows.length) {
      warnings.push(
        `Sheet "${SHEET_REG}" có ${reg.rows.length} mục tiêu, sheet "${SHEET_EVAL}" có ${ev.rows.length} — dùng số liệu sheet Đánh giá.`
      )
    }
    if (!useEval) warnings.push(`Sheet "${SHEET_EVAL}" trống — chỉ nhập phần Đăng ký đầu tháng (chưa có kết quả).`)
  }
  const label = { evaluation: 'Đánh giá', registration: 'Đăng ký', sheet: 'Sheet' }[source]

  const objectives = src.rows.map((r) => {
    const where = `${label} dòng ${r.excelRow}`
    if (!r.name) errors.push(`${where}: thiếu Tên mục tiêu.`)
    if (!r.target && !r.measure_method) warnings.push(`${where}: chưa có Mục tiêu cần đạt / Cách thức đo.`)
    if (r.weight === null) errors.push(`${where}: thiếu Trọng số.`)
    else if (Number.isNaN(r.weight)) errors.push(`${where}: Trọng số không phải số.`)
    else if (r.weight <= 0 || r.weight > 100) errors.push(`${where}: Trọng số phải trong 0–100% (đang ${r.weight}%).`)
    for (const [k, label] of [['self_result', 'Kết quả của N'], ['manager_result', 'Kết quả của N+1']]) {
      const v = r[k]
      if (v === null) continue
      if (Number.isNaN(v)) errors.push(`${where}: ${label} không phải số.`)
      else if (v < 0 || v > 100) errors.push(`${where}: ${label} phải trong 0–100% (đang ${v}%).`)
    }
    return {
      category: mapCategory(r.name),
      name: r.name,
      target: r.target,
      measure_method: r.measure_method,
      reference_doc: r.reference_doc,
      weight: Number.isFinite(r.weight) ? r.weight : 0,
      self_result: Number.isFinite(r.self_result) ? r.self_result : null,
      manager_result: Number.isFinite(r.manager_result) ? r.manager_result : null,
    }
  })

  if (!objectives.length) errors.push('File chưa có dòng mục tiêu nào.')
  if (objectives.length > MAX_ROWS_PER_USER)
    errors.push(`Có ${objectives.length} mục tiêu, vượt tối đa ${MAX_ROWS_PER_USER}.`)

  const totals = computeTotals(objectives)
  if (objectives.length && Math.abs(totals.weight - 100) > 0.01)
    errors.push(`Tổng trọng số = ${totals.weight}%, phải bằng 100%.`)

  const hasSelfResults = objectives.some((o) => o.self_result !== null)
  const hasManagerResults = objectives.some((o) => o.manager_result !== null)
  if (team && !hasSelfResults && !hasManagerResults)
    warnings.push('Chưa có kết quả đánh giá — chỉ nhập phần đăng ký mục tiêu.')

  return {
    fatal: null,
    fileName,
    sheetName,
    personName,
    identity,
    period,
    source,
    objectives,
    registrationComment: reg?.comments?.registration || '',
    managerComment: ev?.comments?.manager || '',
    hasSelfResults,
    hasManagerResults,
    totals,
    errors,
    warnings,
  }
}

export function computeTotals(objectives) {
  let weight = 0
  let self = 0
  let manager = 0
  for (const o of objectives) {
    const w = Number(o.weight) || 0
    weight += w
    self += (w * (Number(o.self_result) || 0)) / 100
    manager += (w * (Number(o.manager_result) || 0)) / 100
  }
  const selfT = round2(self)
  const managerT = round2(manager)
  const final = managerT === 0 ? selfT : managerT
  return { weight: round2(weight), self: selfT, manager: managerT, final }
}

// ================================================================ TẠO FILE MẪU CHUẨN
const C = {
  title: 'FF17365D',
  header: 'FF1F4E78',
  input: 'FFFFF2CC',
  calc: 'FFEAF0F6',
  label: 'FFF3F6F9',
  ink: 'FF243447',
  calcInk: 'FF1F4E78',
  white: 'FFFFFFFF',
  note: 'FF7F6000',
}
const thin = { style: 'thin', color: { argb: 'FFB7C4D4' } }
const BORDER = { top: thin, left: thin, bottom: thin, right: thin }
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

function styleTitle(ws, row, lastCol, text) {
  ws.mergeCells(row, 1, row, lastCol)
  const c = ws.getCell(row, 1)
  c.value = text
  c.fill = fill(C.title)
  c.font = { bold: true, size: 13, color: { argb: C.white } }
  c.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(row).height = 24
}

function styleNote(ws, row, lastCol, text) {
  ws.mergeCells(row, 1, row, lastCol)
  const c = ws.getCell(row, 1)
  c.value = text
  c.font = { italic: true, size: 10, color: { argb: C.note } }
  c.alignment = { wrapText: true, vertical: 'middle' }
  ws.getRow(row).height = 21
}

function styleHeader(cell, text) {
  cell.value = text
  cell.fill = fill(C.header)
  cell.font = { bold: true, color: { argb: C.white } }
  cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
  cell.border = BORDER
}

function styleInput(cell, { pct = false, center = false } = {}) {
  cell.fill = fill(C.input)
  cell.font = { color: { argb: C.ink } }
  cell.alignment = { wrapText: true, vertical: 'top', horizontal: center || pct ? 'center' : 'left' }
  cell.border = BORDER
  if (pct) cell.numFmt = '0%'
}

function styleCalc(cell, numFmt = '0%') {
  cell.fill = fill(C.calc)
  cell.font = { color: { argb: C.calcInk } }
  cell.alignment = { vertical: 'top', horizontal: 'center' }
  cell.border = BORDER
  cell.numFmt = numFmt
}

function styleTotal(cell, numFmt) {
  cell.fill = fill(C.title)
  cell.font = { bold: true, color: { argb: C.white } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  if (numFmt) cell.numFmt = numFmt
}

function styleLabel(cell) {
  cell.fill = fill(C.label)
  cell.font = { color: { argb: C.ink } }
  cell.alignment = { vertical: 'middle', wrapText: true }
  cell.border = BORDER
}

const pctValidation = (title) => ({
  type: 'decimal',
  operator: 'between',
  allowBlank: true,
  formulae: [0, 1],
  showErrorMessage: true,
  errorStyle: 'stop',
  errorTitle: title,
  error: 'Nhập tỷ lệ từ 0% đến 100% (vd: 90%).',
})

const frac = (v) => (v === null || v === undefined || v === '' ? null : round2(v) / 100)

/**
 * Tạo file mẫu chuẩn cho 1 người, điền sẵn dữ liệu nếu có.
 * objectives: [{ name, target, measure_method, weight, reference_doc, self_result, manager_result }]
 */
export function personLabel(u) {
  if (!u) return ''
  // Nhân viên không có tài khoản: chỉ họ tên
  if (!u.username) return u.ho_va_ten || ''
  return u.ho_va_ten ? `${u.ho_va_ten} (${u.username})` : u.username
}

export async function buildStandardWorkbook({
  personName,
  username = '',
  people = [], // [{ username, ho_va_ten }] — nguồn dropdown chọn nhân viên
  period,
  objectives = [],
  registrationComment = '',
  managerComment = '',
}) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KPI Review'
  wb.created = new Date()

  const n = Math.min(Math.max(objectives.length, MIN_TEMPLATE_ROWS), MAX_ROWS_PER_USER)
  const first = 6
  const last = first + n - 1
  const totalRow = last + 1
  const sumTitle = totalRow + 2
  const pass = PASS_THRESHOLD / 100

  // ---------------- Sheet 1: Đăng ký đầu tháng
  const r1 = wb.addWorksheet(SHEET_REG, { views: [{ state: 'frozen', ySplit: 5 }] })
  ;[5.4, 25, 32.7, 23.7, 35.3].forEach((w, i) => (r1.getColumn(i + 1).width = w))
  styleTitle(r1, 1, 5, 'PHIẾU ĐĂNG KÝ KPI ĐẦU THÁNG')
  styleNote(r1, 2, 5, 'Hướng dẫn: Nhập thông tin mục tiêu, trọng số tại các ô nền vàng. Các ô nền xanh được tính tự động.')
  styleNote(r1, 3, 5, 'Lưu ý: Tổng trọng số các mục tiêu cần bằng 100%, nhập theo tỷ lệ từ 0% đến 100%.')
  // Dòng nhận diện: NHÂN VIÊN | <Họ tên (username)> | KỲ ĐÁNH GIÁ | <YYYY-MM>
  r1.mergeCells(4, 1, 4, 2)
  r1.getCell(4, 1).value = 'NHÂN VIÊN'
  styleLabel(r1.getCell(4, 1))
  r1.getCell(4, 1).font = { bold: true, color: { argb: C.ink } }
  const who = r1.getCell(4, 3)
  who.value =
    username || personName ? personLabel({ username, ho_va_ten: personName }) : '[Chọn hoặc gõ tên nhân viên]'
  styleInput(who)
  who.font = { bold: true, color: { argb: C.ink } }
  r1.getCell(4, 4).value = 'KỲ ĐÁNH GIÁ'
  styleLabel(r1.getCell(4, 4))
  r1.getCell(4, 4).font = { bold: true, color: { argb: C.ink } }
  const per = r1.getCell(4, 5)
  per.value = period
  per.numFmt = '@'
  styleInput(per)
  per.font = { bold: true, color: { argb: C.ink } }
  r1.getRow(4).height = 20
  if (people.length) {
    const ref = wb.addWorksheet('_DanhSach')
    people.forEach((u, i) => (ref.getCell(i + 1, 1).value = personLabel(u)))
    ref.state = 'veryHidden'
    who.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`=_DanhSach!$A$1:$A$${people.length}`],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'Nhân viên',
      error: 'Tên chưa có trong danh sách. Bấm Yes để giữ (nhân viên chưa có tài khoản).',
    }
  }
  ;['STT', 'TÊN MỤC TIÊU', 'CÁCH THỨC ĐO', 'TRỌNG SỐ', 'MỤC TIÊU CẦN ĐẠT'].forEach((h, i) =>
    styleHeader(r1.getCell(5, i + 1), h)
  )
  for (let i = 0; i < n; i++) {
    const r = first + i
    const o = objectives[i] || {}
    const stt = r1.getCell(r, 1)
    stt.value = i + 1
    styleLabel(stt)
    stt.alignment = { horizontal: 'center', vertical: 'top' }
    const cells = [
      [2, o.name || null, {}],
      [3, o.measure_method || null, {}],
      [4, frac(o.weight), { pct: true }],
      [5, o.target || null, {}],
    ]
    for (const [c, v, opt] of cells) {
      const cell = r1.getCell(r, c)
      cell.value = v
      styleInput(cell, opt)
    }
    r1.getCell(r, 4).dataValidation = pctValidation('Trọng số không hợp lệ')
  }
  r1.mergeCells(totalRow, 1, totalRow, 3)
  styleTotal(r1.getCell(totalRow, 1))
  r1.getCell(totalRow, 1).value = 'TỔNG TRỌNG SỐ'
  r1.getCell(totalRow, 4).value = { formula: `SUM(D${first}:D${last})` }
  styleTotal(r1.getCell(totalRow, 4), '0%')
  r1.mergeCells(sumTitle, 1, sumTitle, 3)
  r1.getCell(sumTitle, 1).value = 'TỔNG HỢP'
  styleTotal(r1.getCell(sumTitle, 1))
  r1.mergeCells(sumTitle + 1, 1, sumTitle + 1, 2)
  r1.getCell(sumTitle + 1, 1).value = 'Ý KIẾN CỦA N+1 (nếu có)'
  styleLabel(r1.getCell(sumTitle + 1, 1))
  r1.mergeCells(sumTitle + 1, 3, sumTitle + 1, 5)
  r1.getCell(sumTitle + 1, 3).value = registrationComment || '[Điền text]'
  styleInput(r1.getCell(sumTitle + 1, 3))
  r1.getRow(sumTitle + 1).height = 36

  // ---------------- Sheet 2: Đánh giá cuối tháng
  const r2 = wb.addWorksheet(SHEET_EVAL, { views: [{ state: 'frozen', ySplit: 5 }] })
  ;[5.4, 22, 27, 24.2, 13, 18.6, 11.3, 10.2, 11.3, 10.2].forEach((w, i) => (r2.getColumn(i + 1).width = w))
  styleTitle(r2, 1, 10, 'PHIẾU ĐÁNH GIÁ KPI CUỐI THÁNG')
  styleNote(r2, 2, 10, 'Hướng dẫn: Nhập thông tin mục tiêu, trọng số và kết quả đánh giá tại các ô nền vàng. Các ô nền xanh/xám được tính tự động.')
  styleNote(r2, 3, 10, 'Lưu ý: Tổng trọng số các mục tiêu cần bằng 100%. Kết quả đánh giá nhập theo tỷ lệ từ 0% đến 100%.')
  styleNote(r2, 4, 10, `Nhân viên: ${personName || ''} · Kỳ: ${formatPeriod(period)} — Nếu N+1 không điền kết quả từng mục tiêu, KẾT QUẢ CUỐI CÙNG lấy kết quả của N.`)
  ;[
    'STT', 'TÊN MỤC TIÊU', 'MỤC TIÊU CẦN ĐẠT', 'CÁCH THỨC ĐO', 'TRỌNG SỐ', 'TÀI LIỆU THAM CHIẾU',
    'KẾT QUẢ ĐÁNH GIÁ CỦA N', 'HỆ SỐ KẾT QUẢ CỦA N', 'KẾT QUẢ ĐÁNH GIÁ CỦA N+1', 'HỆ SỐ KẾT QUẢ CỦA N+1',
  ].forEach((h, i) => styleHeader(r2.getCell(5, i + 1), h))
  r2.getRow(5).height = 34
  for (let i = 0; i < n; i++) {
    const r = first + i
    const o = objectives[i] || {}
    const stt = r2.getCell(r, 1)
    stt.value = i + 1
    styleLabel(stt)
    stt.alignment = { horizontal: 'center', vertical: 'top' }
    const cells = [
      [2, o.name || null, {}],
      [3, o.target || null, {}],
      [4, o.measure_method || null, {}],
      [5, frac(o.weight), { pct: true }],
      [6, o.reference_doc || null, {}],
      [7, frac(o.self_result), { pct: true }],
      [9, frac(o.manager_result), { pct: true }],
    ]
    for (const [c, v, opt] of cells) {
      const cell = r2.getCell(r, c)
      cell.value = v
      styleInput(cell, opt)
    }
    r2.getCell(r, 5).dataValidation = pctValidation('Trọng số không hợp lệ')
    r2.getCell(r, 7).dataValidation = pctValidation('Kết quả không hợp lệ')
    r2.getCell(r, 9).dataValidation = pctValidation('Kết quả không hợp lệ')
    r2.getCell(r, 8).value = { formula: `G${r}*E${r}` }
    styleCalc(r2.getCell(r, 8))
    r2.getCell(r, 10).value = { formula: `I${r}*E${r}` }
    styleCalc(r2.getCell(r, 10))
  }
  r2.mergeCells(totalRow, 1, totalRow, 4)
  r2.getCell(totalRow, 1).value = 'TỔNG TRỌNG SỐ / KẾT QUẢ'
  styleTotal(r2.getCell(totalRow, 1))
  for (const [c, f, fmt] of [
    [5, `SUM(E${first}:E${last})`, '0%'],
    [8, `SUM(H${first}:H${last})`, '0.0%'],
    [10, `SUM(J${first}:J${last})`, '0.0%'],
  ]) {
    r2.getCell(totalRow, c).value = { formula: f }
    styleTotal(r2.getCell(totalRow, c), fmt)
  }
  r2.mergeCells(sumTitle, 1, sumTitle, 3)
  r2.getCell(sumTitle, 1).value = 'TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ'
  styleTotal(r2.getCell(sumTitle, 1))
  const s = sumTitle + 1
  const summary = [
    ['KẾT QUẢ CỦA N', { formula: `H${totalRow}` }, 'calc', '0.0%'],
    ['KẾT QUẢ CỦA N+1', { formula: `J${totalRow}` }, 'calc', '0.0%'],
    ['ĐÁNH GIÁ CỦA N+1', managerComment || '[Điền text]', 'input'],
    ['KẾT QUẢ CUỐI CÙNG', { formula: `IF(C${s + 1}=0,C${s},C${s + 1})` }, 'calc', '0.0%'],
    [
      'XẾP LOẠI KẾT QUẢ',
      { formula: `IF(C${s + 3}<${pass},"KHÔNG ĐẠT","ĐẠT")` },
      'calc',
      'General',
    ],
  ]
  summary.forEach(([label, value, kind, fmt], i) => {
    const r = s + i
    r2.mergeCells(r, 1, r, 2)
    r2.getCell(r, 1).value = label
    styleLabel(r2.getCell(r, 1))
    const cell = r2.getCell(r, 3)
    cell.value = value
    if (kind === 'calc') {
      styleCalc(cell, fmt)
      if (label.startsWith('KẾT QUẢ CUỐI') || label.startsWith('XẾP LOẠI')) cell.font = { bold: true, color: { argb: C.calcInk } }
    } else {
      r2.mergeCells(r, 3, r, 10)
      styleInput(cell)
      r2.getRow(r).height = 36
    }
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ================================================================ XUẤT THEO FILE GỐC
// Ghi số liệu mới nhất trên hệ thống vào CHÍNH file đã upload (giữ nguyên định
// dạng, biểu mẫu, công thức, sheet phụ). Cột được nhận diện lại theo tiêu đề
// như lúc đọc, nên file có thứ tự cột khác nhau vẫn ghi đúng chỗ.

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const TEXT_FIELDS = ['name', 'target', 'measure_method', 'reference_doc']
const PCT_FIELDS = ['weight', 'self_result', 'manager_result']

// Cột % lưu dạng tỷ lệ (0.9) hay dạng số (90)? Xét định dạng ô và giá trị hiện có.
function columnIsFraction(ws, col, from, to) {
  for (let r = from; r <= to; r++) {
    const cell = ws.getRow(r).getCell(col)
    if (String(cell.numFmt || '').includes('%')) return true
    const v = rawValue(cell.value)
    if (typeof v === 'number' && Math.abs(v) > 1) return false
  }
  return true // mặc định theo mẫu chuẩn: tỷ lệ
}

function writeCell(cell, value) {
  if (cell.isMerged && cell.master.address !== cell.address) return
  cell.value = value
}

// Ô giá trị của 1 nhãn ở cột A (bỏ qua phần merge của chính nhãn)
function labelValueCell(row) {
  for (let c = 2; c <= Math.max(row.cellCount, 4); c++) {
    const cell = row.getCell(c)
    if (cell.isMerged && cell.master.col === 1) continue
    return cell.isMerged ? cell.master : cell
  }
  return null
}

function writeComment(ws, fromRow, labelPrefix, value) {
  if (!value) return
  for (let r = fromRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    if (!normalizeName(cellText(row.getCell(1))).startsWith(labelPrefix)) continue
    const cell = labelValueCell(row)
    if (cell) cell.value = value
    return
  }
}

/**
 * Ghi danh sách mục tiêu vào 1 sheet theo cột tiêu đề.
 * Trả null nếu thành công, hoặc chuỗi lý do nếu không ghi được.
 */
function fillSheet(ws, objectives, { registrationComment, managerComment } = {}) {
  const h = findHeader(ws)
  if (!h) return `sheet "${ws.name}" không còn dòng tiêu đề STT / TÊN MỤC TIÊU`
  const { headerRow, cols } = h
  const first = headerRow + 1
  const totalRow = findTotalRow(ws, headerRow)
  const capacity = totalRow ? totalRow - first : Infinity
  if (objectives.length > capacity)
    return `sheet "${ws.name}" chỉ có ${capacity} dòng mục tiêu, phiếu có ${objectives.length}`

  // Dòng dữ liệu cuối hiện có (để xoá phần thừa khi phiếu ít mục tiêu hơn)
  const limit = totalRow ? totalRow - 1 : ws.rowCount
  let lastData = headerRow
  for (let r = first; r <= limit; r++) {
    const row = ws.getRow(r)
    if ([...TEXT_FIELDS, ...PCT_FIELDS].some((k) => cols[k] && cellText(row.getCell(cols[k])))) lastData = r
  }
  const fraction = {}
  for (const k of PCT_FIELDS) if (cols[k]) fraction[k] = columnIsFraction(ws, cols[k], first, Math.max(lastData, first))
  const hasSelf = objectives.some((o) => Number(o.self_result) > 0)
  const hasMgr = objectives.some((o) => o.manager_result !== null && o.manager_result !== undefined)

  const end = Math.max(lastData, first + objectives.length - 1)
  for (let r = first, i = 0; r <= end; r++, i++) {
    const row = ws.getRow(r)
    const o = objectives[i]
    const set = (k, v) => cols[k] && writeCell(row.getCell(cols[k]), v)
    if (!o) {
      for (const k of [...TEXT_FIELDS, ...PCT_FIELDS]) set(k, null)
      if (!totalRow) set('stt', null)
      continue
    }
    if (cols.stt) {
      const c = row.getCell(cols.stt)
      const v = rawValue(c.value)
      if (v === null || v === undefined || v === '' || typeof v === 'number') writeCell(c, i + 1)
    }
    for (const k of TEXT_FIELDS) set(k, o[k] || null)
    for (const k of PCT_FIELDS) {
      let v = o[k]
      if ((k === 'self_result' && !hasSelf) || (k === 'manager_result' && !hasMgr)) v = null
      if (v === null || v === undefined || v === '') set(k, null)
      else set(k, fraction[k] ? Math.round(Number(v) * 100) / 10000 : round2(v))
    }
  }

  const after = totalRow || end + 1
  writeComment(ws, after, 'y kien cua n+1', registrationComment)
  writeComment(ws, after, 'danh gia cua n+1', managerComment)
  return null
}

/**
 * Điền số liệu mới nhất vào file gốc.
 * entries: [{ key, sheet, employeeName, objectives, registrationComment, managerComment }]
 *   sheet rỗng = file mẫu chuẩn (2 sheet Đăng ký / Đánh giá), ngược lại = tên sheet trong file cả đội.
 * Trả { blob, failed: [{ key, reason }] } — entry failed cần xuất bằng mẫu chuẩn thay thế.
 */
export async function fillOriginalWorkbook(base64, entries) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(base64ToBytes(base64))
  const failed = []
  for (const e of entries) {
    const reasons = []
    if (!e.sheet) {
      const regWs = findSheet(wb, SHEET_REG)
      const evWs = findSheet(wb, SHEET_EVAL)
      if (!regWs && !evWs) reasons.push('file không còn sheet mẫu chuẩn')
      if (regWs) {
        const why = fillSheet(regWs, e.objectives, { registrationComment: e.registrationComment })
        if (why) reasons.push(why)
        const id = readIdentity(regWs)
        if (id.personCell && e.employeeName) regWs.getCell(id.personCell).value = e.employeeName
      }
      if (evWs) {
        const why = fillSheet(evWs, e.objectives, { managerComment: e.managerComment })
        if (why) reasons.push(why)
      }
    } else {
      const ws = wb.worksheets.find((w) => w.name.trim() === e.sheet.trim())
      if (!ws) reasons.push(`không thấy sheet "${e.sheet}"`)
      else {
        const why = fillSheet(ws, e.objectives, {
          registrationComment: e.registrationComment,
          managerComment: e.managerComment,
        })
        if (why) reasons.push(why)
      }
    }
    if (reasons.length) failed.push({ key: e.key, reason: reasons.join('; ') })
  }
  // Công thức (hệ số, tổng, KQ cuối cùng, sheet tổng hợp) tự tính lại khi mở file
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true }
  const buffer = await wb.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    failed,
  }
}

// ================================================================ XUẤT TỔNG HỢP ĐỘI
/**
 * people: [{ username, ho_va_ten, mien, bu, manager, evaluation, objectives }]
 */
export async function buildTeamSummary({ period, people }) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KPI Review'

  const ws = wb.addWorksheet('Tổng hợp', { views: [{ state: 'frozen', ySplit: 3 }] })
  const heads = [
    ['STT', 6], ['Username', 16], ['Họ và tên', 24], ['Miền', 10], ['BU', 12], ['Quản lý trực tiếp', 22],
    ['Trạng thái', 12], ['Số mục tiêu', 10], ['KQ của N', 11], ['KQ của N+1', 11], ['Chênh lệch (N+1 − N)', 13],
    ['KQ cuối cùng', 12], ['Xếp loại', 12], ['Đánh giá của N+1', 40],
  ]
  ws.mergeCells(1, 1, 1, heads.length)
  ws.getCell(1, 1).value = `TỔNG HỢP KẾT QUẢ KPI — ${formatPeriod(period).toUpperCase()}`
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: C.white } }
  ws.getCell(1, 1).fill = fill(C.title)
  ws.getRow(1).height = 24
  heads.forEach(([h, w], i) => {
    styleHeader(ws.getCell(3, i + 1), h)
    ws.getColumn(i + 1).width = w
  })
  ws.getRow(3).height = 32
  people.forEach((p, i) => {
    const e = p.evaluation
    const r = 4 + i
    const self = e ? Number(e.self_total) / 100 : null
    const mgr = e && Number(e.manager_total) ? Number(e.manager_total) / 100 : null
    const fin = e ? (mgr ?? self) : null
    const vals = [
      i + 1, p.username || '(không TK)', p.ho_va_ten, p.mien || '', p.bu || '', p.manager || '',
      e ? STATUS_LABELS[e.status] : 'Chưa có phiếu',
      p.objectives?.length || 0,
      self, mgr, mgr !== null && self !== null ? mgr - self : null, fin,
      e && e.status !== 'draft' ? (fin * 100 >= PASS_THRESHOLD ? 'ĐẠT' : 'KHÔNG ĐẠT') : '',
      e?.manager_comment || '',
    ]
    vals.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1)
      cell.value = v
      cell.border = BORDER
      if (c >= 8 && c <= 11) cell.numFmt = '0.0%'
    })
    ws.getCell(r, 14).alignment = { wrapText: true, vertical: 'top' }
  })
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + people.length, column: heads.length } }

  const d = wb.addWorksheet('Chi tiết mục tiêu', { views: [{ state: 'frozen', ySplit: 1 }] })
  const dh = [
    ['Username', 16], ['Họ và tên', 24], ['STT', 6], ['Tên mục tiêu', 18], ['Mục tiêu cần đạt', 40],
    ['Cách thức đo', 34], ['Trọng số', 10], ['Tài liệu tham chiếu', 22], ['KQ của N', 10], ['KQ của N+1', 10],
  ]
  dh.forEach(([h, w], i) => {
    styleHeader(d.getCell(1, i + 1), h)
    d.getColumn(i + 1).width = w
  })
  let r = 2
  for (const p of people) {
    ;(p.objectives || []).forEach((o, i) => {
      const vals = [
        p.username || '(không TK)', p.ho_va_ten, i + 1, o.name || o.category, o.target, o.measure_method,
        frac(o.weight), o.reference_doc, frac(o.self_result), frac(o.manager_result),
      ]
      vals.forEach((v, c) => {
        const cell = d.getCell(r, c + 1)
        cell.value = v ?? null
        cell.border = BORDER
        cell.alignment = { wrapText: true, vertical: 'top' }
        if (c === 6 || c >= 8) cell.numFmt = '0%'
      })
      r++
    })
  }
  if (r > 2) d.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: dh.length } }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
