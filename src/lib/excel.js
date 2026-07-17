// Tạo & đọc template Excel nhập KPI hàng loạt.
// exceljs được nạp động (dynamic import) để không làm nặng bundle chính.
import { CATEGORIES, formatPeriod } from './constants'

export const TEMPLATE_VERSION = 1
export const APP_MARKER = 'KPI_REVIEW_TEMPLATE'

export const MAX_ROWS_PER_USER = 20
export const MAX_TOTAL_ROWS = 800

// Vị trí cố định để đọc lại file
const HEADER_ROW = 3
const FIRST_DATA_ROW = 4

const COLUMNS = [
  { key: 'username', header: 'Username', width: 18 },
  { key: 'ho_va_ten', header: 'Họ tên (tham khảo)', width: 22 },
  { key: 'category', header: 'Nhóm', width: 14 },
  { key: 'name', header: 'Tên mục tiêu', width: 20 },
  { key: 'target', header: 'Mục tiêu cần đạt', width: 34 },
  { key: 'measure_method', header: 'Cách thức đo', width: 30 },
  { key: 'weight', header: 'Trọng số (nhập số, vd: 40)', width: 16 },
  { key: 'reference_doc', header: 'Tài liệu tham chiếu', width: 20 },
  { key: 'self_result', header: 'Kết quả đạt được (nhập số 0-100)', width: 18 },
  { key: 'coeff', header: 'Hệ số kết quả (tự tính)', width: 16 },
  { key: 'self_explanation', header: 'Diễn giải chi tiết', width: 30 },
]

const COL = {} // key -> chỉ số cột (1-based)
COLUMNS.forEach((c, i) => (COL[c.key] = i + 1))

function colLetter(idx) {
  let s = ''
  while (idx > 0) {
    const m = (idx - 1) % 26
    s = String.fromCharCode(65 + m) + s
    idx = Math.floor((idx - 1) / 26)
  }
  return s
}

// ---------------------------------------------------------------- TẠO TEMPLATE
export async function buildTemplate({ period, users, rows }) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KPI Review'
  wb.created = new Date()

  const dataRowCount = Math.max(rows.length + 20, 60) // chừa dòng trống để nhập thêm
  const lastDataRow = FIRST_DATA_ROW + dataRowCount - 1

  // ---------- Sheet danh mục (nguồn cho dropdown) ----------
  const ref = wb.addWorksheet('_DanhMuc')
  ref.getCell('A1').value = 'Nhóm'
  CATEGORIES.forEach((c, i) => (ref.getCell(`A${i + 2}`).value = c))
  ref.getCell('B1').value = 'Username'
  ref.getCell('C1').value = 'Họ tên'
  users.forEach((u, i) => {
    ref.getCell(`B${i + 2}`).value = u.username
    ref.getCell(`C${i + 2}`).value = u.ho_va_ten || ''
  })
  ref.state = 'veryHidden'

  // ---------- Sheet metadata (chống nộp nhầm / template cũ) ----------
  const meta = wb.addWorksheet('_meta')
  meta.getCell('A1').value = 'marker'
  meta.getCell('B1').value = APP_MARKER
  meta.getCell('A2').value = 'version'
  meta.getCell('B2').value = TEMPLATE_VERSION
  meta.getCell('A3').value = 'period'
  meta.getCell('B3').value = period
  meta.getCell('A4').value = 'generated_at'
  meta.getCell('B4').value = new Date().toISOString()
  meta.state = 'veryHidden'

  // ---------- Sheet nhập liệu chính ----------
  const ws = wb.addWorksheet('KPI', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
  })

  ws.mergeCells(1, 1, 1, COLUMNS.length)
  const title = ws.getCell(1, 1)
  title.value = `PHIẾU KPI ${formatPeriod(period).toUpperCase()} — điền các dòng mục tiêu bên dưới`
  title.font = { bold: true, size: 13, color: { argb: 'FF1D4ED8' } }
  title.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 24

  ws.mergeCells(2, 1, 2, COLUMNS.length)
  const note = ws.getCell(2, 1)
  note.value =
    'Lưu ý: Username và Nhóm chọn từ danh sách xổ xuống. Trọng số & Kết quả nhập SỐ (không nhập dấu %). ' +
    'Tổng trọng số của MỖI người phải = 100 (xem sheet "KiemTra"). Cột Hệ số kết quả tự tính, không sửa.'
  note.font = { size: 10, italic: true, color: { argb: 'FF92400E' } }
  note.alignment = { wrapText: true, vertical: 'middle' }
  ws.getRow(2).height = 30

  // Header
  COLUMNS.forEach((c, i) => {
    const cell = ws.getCell(HEADER_ROW, i + 1)
    cell.value = c.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    ws.getColumn(i + 1).width = c.width
  })
  ws.getRow(HEADER_ROW).height = 32

  // Dữ liệu sẵn có
  rows.forEach((r, i) => {
    const rowIdx = FIRST_DATA_ROW + i
    ws.getCell(rowIdx, COL.username).value = r.username
    ws.getCell(rowIdx, COL.ho_va_ten).value = r.ho_va_ten || ''
    ws.getCell(rowIdx, COL.category).value = r.category || ''
    ws.getCell(rowIdx, COL.name).value = r.name || ''
    ws.getCell(rowIdx, COL.target).value = r.target || ''
    ws.getCell(rowIdx, COL.measure_method).value = r.measure_method || ''
    ws.getCell(rowIdx, COL.weight).value = Number(r.weight) || 0
    ws.getCell(rowIdx, COL.reference_doc).value = r.reference_doc || ''
    ws.getCell(rowIdx, COL.self_result).value = Number(r.self_result) || 0
    ws.getCell(rowIdx, COL.self_explanation).value = r.self_explanation || ''
  })

  const wCol = colLetter(COL.weight)
  const rCol = colLetter(COL.self_result)

  // Ràng buộc + định dạng cho toàn vùng nhập
  for (let rowIdx = FIRST_DATA_ROW; rowIdx <= lastDataRow; rowIdx++) {
    // Dropdown Username -> chỉ chọn người trong phạm vi quyền
    ws.getCell(rowIdx, COL.username).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=_DanhMuc!$B$2:$B$${users.length + 1}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Username không hợp lệ',
      error: 'Chọn Username từ danh sách xổ xuống.',
    }

    // Dropdown Nhóm -> đúng 7 nhóm
    ws.getCell(rowIdx, COL.category).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=_DanhMuc!$A$2:$A$${CATEGORIES.length + 1}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Nhóm không hợp lệ',
      error: 'Chọn Nhóm từ danh sách xổ xuống.',
    }

    // Trọng số: số, 0 < x <= 100
    ws.getCell(rowIdx, COL.weight).dataValidation = {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [0.01, 100],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Trọng số không hợp lệ',
      error: 'Trọng số phải là số trong khoảng 0 đến 100 (nhập số, không nhập %).',
    }
    ws.getCell(rowIdx, COL.weight).numFmt = '0.##'

    // Kết quả: số, 0 <= x <= 100
    ws.getCell(rowIdx, COL.self_result).dataValidation = {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [0, 100],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Kết quả không hợp lệ',
      error: 'Kết quả phải là số từ 0 đến 100 (nhập số, không nhập %).',
    }
    ws.getCell(rowIdx, COL.self_result).numFmt = '0.##'

    // Hệ số kết quả: CÔNG THỨC, khoá không cho sửa
    const coeffCell = ws.getCell(rowIdx, COL.coeff)
    coeffCell.value = {
      formula: `IF(OR(${wCol}${rowIdx}="",${rCol}${rowIdx}=""),"",ROUND(${wCol}${rowIdx}*${rCol}${rowIdx}/100,2))`,
    }
    coeffCell.numFmt = '0.##'
    coeffCell.protection = { locked: true }
    coeffCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }

    // Các ô nhập -> mở khoá
    ;['username', 'ho_va_ten', 'category', 'name', 'target', 'measure_method',
      'weight', 'reference_doc', 'self_result', 'self_explanation'].forEach((k) => {
      ws.getCell(rowIdx, COL[k]).protection = { locked: false }
    })

    ws.getCell(rowIdx, COL.target).alignment = { wrapText: true, vertical: 'top' }
    ws.getCell(rowIdx, COL.measure_method).alignment = { wrapText: true, vertical: 'top' }
    ws.getCell(rowIdx, COL.self_explanation).alignment = { wrapText: true, vertical: 'top' }
  }

  // Khoá sheet: chỉ sửa được ô đã mở khoá ở trên
  await ws.protect('kpi', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    insertRows: false,
    deleteRows: false,
  })

  // ---------- Sheet kiểm tra tổng trọng số theo từng người ----------
  const chk = wb.addWorksheet('KiemTra')
  chk.getCell('A1').value = 'BẢNG KIỂM TRA — Tổng trọng số của mỗi người phải bằng 100'
  chk.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FF1D4ED8' } }
  ;['Username', 'Họ tên', 'Tổng trọng số', 'Kết luận'].forEach((h, i) => {
    const c = chk.getCell(3, i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  })
  chk.getColumn(1).width = 18
  chk.getColumn(2).width = 24
  chk.getColumn(3).width = 16
  chk.getColumn(4).width = 34

  const uCol = colLetter(COL.username)
  users.forEach((u, i) => {
    const r = 4 + i
    chk.getCell(r, 1).value = u.username
    chk.getCell(r, 2).value = u.ho_va_ten || ''
    chk.getCell(r, 3).value = {
      formula: `SUMIF(KPI!$${uCol}$${FIRST_DATA_ROW}:$${uCol}$${lastDataRow},A${r},KPI!$${wCol}$${FIRST_DATA_ROW}:$${wCol}$${lastDataRow})`,
    }
    chk.getCell(r, 3).numFmt = '0.##'
    chk.getCell(r, 4).value = {
      formula: `IF(C${r}=0,"Chưa nhập",IF(ABS(C${r}-100)<0.01,"OK","SAI: tổng phải = 100"))`,
    }
  })

  const lastChk = 3 + users.length
  // Tô đỏ dòng có tổng khác 100 (và khác 0)
  chk.addConditionalFormatting({
    ref: `A4:D${lastChk}`,
    rules: [
      {
        type: 'expression',
        formulae: [`AND($C4<>0,ABS($C4-100)>=0.01)`],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
          font: { color: { argb: 'FF991B1B' }, bold: true },
        },
      },
    ],
  })

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
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------- ĐỌC TEMPLATE
// Chuẩn hoá số: chấp nhận "40,5" và "40.5"; ô lỡ định dạng % (0.4) -> 40
export function toNumber(cellValue, { percentAware = false } = {}) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null
  let v = cellValue
  if (typeof v === 'object') {
    if (v.result !== undefined) v = v.result
    else if (v.richText) v = v.richText.map((t) => t.text).join('')
    else return null
  }
  if (typeof v === 'number') {
    // Ô định dạng % trong Excel lưu 0.4 cho "40%"
    if (percentAware && v > 0 && v < 1) return Math.round(v * 100 * 100) / 100
    return v
  }
  const s = String(v).trim().replace('%', '').replace(/\s/g, '').replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function toText(cellValue) {
  if (cellValue === null || cellValue === undefined) return ''
  let v = cellValue
  if (typeof v === 'object') {
    if (v.result !== undefined) v = v.result
    else if (v.richText) v = v.richText.map((t) => t.text).join('')
    else if (v.text) v = v.text
    else return ''
  }
  return String(v).trim()
}

/**
 * Đọc file template. Chỉ bóc tách + kiểm tra định dạng cơ bản.
 * Việc kiểm tra quyền/trạng thái phiếu do trang gọi thực hiện.
 */
export async function parseTemplate(file) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    // File hỏng, không phải .xlsx (vd .xls cũ, .csv, file đổi đuôi)
    return {
      fatal:
        'Không đọc được file. Hãy chắc chắn đây là file .xlsx tải từ nút "Tải template" và chưa bị đổi định dạng.',
    }
  }

  const meta = wb.getWorksheet('_meta')
  if (!meta || toText(meta.getCell('B1').value) !== APP_MARKER) {
    return { fatal: 'File không phải template của ứng dụng. Hãy bấm "Tải template" để lấy file đúng.' }
  }
  const version = toNumber(meta.getCell('B2').value)
  if (version !== TEMPLATE_VERSION) {
    return {
      fatal: `Template phiên bản cũ (v${version}). Hãy tải lại template mới nhất (v${TEMPLATE_VERSION}) và nhập lại.`,
    }
  }
  const period = toText(meta.getCell('B3').value)
  if (!period) return { fatal: 'Template thiếu thông tin kỳ đánh giá.' }

  const ws = wb.getWorksheet('KPI')
  if (!ws) return { fatal: 'File thiếu sheet "KPI".' }

  const rows = []
  for (let i = FIRST_DATA_ROW; i <= ws.rowCount; i++) {
    const row = ws.getRow(i)
    const username = toText(row.getCell(COL.username).value)
    const category = toText(row.getCell(COL.category).value)
    const name = toText(row.getCell(COL.name).value)
    const target = toText(row.getCell(COL.target).value)
    const measure_method = toText(row.getCell(COL.measure_method).value)
    const reference_doc = toText(row.getCell(COL.reference_doc).value)
    const self_explanation = toText(row.getCell(COL.self_explanation).value)
    const weightRaw = row.getCell(COL.weight).value
    const resultRaw = row.getCell(COL.self_result).value

    // Bỏ qua dòng trống hoàn toàn
    const isEmpty =
      !username && !category && !name && !target && !measure_method &&
      weightRaw === null && resultRaw === null
    if (isEmpty) continue

    rows.push({
      excelRow: i,
      username,
      category,
      name,
      target,
      measure_method,
      reference_doc,
      self_explanation,
      weight: toNumber(weightRaw, { percentAware: true }),
      self_result: toNumber(resultRaw, { percentAware: true }),
    })

    if (rows.length > MAX_TOTAL_ROWS) {
      return { fatal: `File vượt quá ${MAX_TOTAL_ROWS} dòng.` }
    }
  }

  return { fatal: null, period, rows }
}

/**
 * Kiểm tra dữ liệu đã bóc tách. Trả về { errors, byUser }.
 * allowedUsers: Map username -> { ho_va_ten }
 */
export function validateRows(rows, allowedUsers) {
  const errors = []
  const byUser = new Map()

  for (const r of rows) {
    const where = `Dòng ${r.excelRow}`

    if (!r.username) {
      errors.push(`${where}: thiếu Username.`)
      continue
    }
    if (!allowedUsers.has(r.username)) {
      errors.push(`${where}: Username "${r.username}" không tồn tại hoặc ngoài phạm vi bạn được phép nhập.`)
      continue
    }
    if (!r.category || !CATEGORIES.includes(r.category)) {
      errors.push(`${where}: Nhóm "${r.category || '(trống)'}" không hợp lệ.`)
    }
    if (!r.name) errors.push(`${where}: thiếu Tên mục tiêu.`)
    if (!r.target) errors.push(`${where}: thiếu Mục tiêu cần đạt.`)
    if (!r.measure_method) errors.push(`${where}: thiếu Cách thức đo.`)

    if (r.weight === null) errors.push(`${where}: thiếu Trọng số.`)
    else if (Number.isNaN(r.weight)) errors.push(`${where}: Trọng số không phải số.`)
    else if (r.weight <= 0 || r.weight > 100)
      errors.push(`${where}: Trọng số phải trong khoảng 0–100 (đang là ${r.weight}).`)

    if (r.self_result === null) r.self_result = 0
    else if (Number.isNaN(r.self_result)) errors.push(`${where}: Kết quả không phải số.`)
    else if (r.self_result < 0 || r.self_result > 100)
      errors.push(`${where}: Kết quả phải trong khoảng 0–100 (đang là ${r.self_result}).`)

    if (!byUser.has(r.username)) byUser.set(r.username, [])
    byUser.get(r.username).push(r)
  }

  // Kiểm tra theo từng người: số dòng + tổng trọng số
  for (const [username, list] of byUser) {
    if (list.length > MAX_ROWS_PER_USER) {
      errors.push(`${username}: có ${list.length} dòng, vượt tối đa ${MAX_ROWS_PER_USER}.`)
    }
    const total = list.reduce((s, r) => s + (Number(r.weight) || 0), 0)
    if (Math.abs(total - 100) > 0.01) {
      errors.push(
        `${username}: tổng trọng số = ${Math.round(total * 100) / 100}, phải bằng 100.`
      )
    }
  }

  return { errors, byUser }
}
