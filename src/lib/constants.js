// Các nhóm mục tiêu KPI. Mẫu chuẩn hiện dùng chủ yếu "Công việc" và "Thái độ".
export const CATEGORIES = [
  'Công việc',
  'Tài chính',
  'Khách hàng',
  'Quy trình',
  'Phát triển',
  'Khác',
  'Thái độ',
  'Thành tích',
]

// Trạng thái phiếu đánh giá
export const EVAL_STATUS = {
  DRAFT: 'draft', // nhân viên đang nhập
  SUBMITTED: 'submitted', // đã gửi, chờ quản lý duyệt
  REVIEWED: 'reviewed', // quản lý đã chấm
  APPROVED: 'approved', // đã chốt
}

export const STATUS_LABELS = {
  draft: 'Nháp',
  submitted: 'Chờ duyệt',
  reviewed: 'Đã chấm',
  approved: 'Đã chốt',
}

export const STATUS_COLORS = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-amber-100 text-amber-800',
  reviewed: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
}

// Định dạng kỳ đánh giá dạng "YYYY-MM"
export function formatPeriod(period) {
  if (!period) return ''
  const [y, m] = period.split('-')
  return `Tháng ${m}/${y}`
}

export function currentPeriod() {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${m}`
}

// Danh sách 12 kỳ gần nhất để chọn
export function recentPeriods(count = 12) {
  const out = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push(`${d.getFullYear()}-${m}`)
  }
  return out
}

// ---------------------------------------------------------------- KẾT QUẢ
// Theo mẫu chuẩn "Đăng kí & đánh giá KPI tháng":
//   KẾT QUẢ CUỐI CÙNG = IF(KQ của N+1 = 0, KQ của N, KQ của N+1)
//   XẾP LOẠI          = ĐẠT nếu >= 90%, ngược lại KHÔNG ĐẠT
export const PASS_THRESHOLD = 90

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function finalScore(ev) {
  if (!ev) return null
  if (ev.final_total !== undefined && ev.final_total !== null) return Number(ev.final_total)
  const m = Number(ev.manager_total) || 0
  return m === 0 ? Number(ev.self_total) || 0 : m
}

// Phiếu đã có kết quả để xếp loại chưa (đã gửi trở đi)
export function hasResult(ev) {
  return !!ev && ev.status !== 'draft'
}

export function gradeOf(score) {
  if (score === null || score === undefined) return null
  return score >= PASS_THRESHOLD ? 'ĐẠT' : 'KHÔNG ĐẠT'
}

export const GRADE_COLORS = {
  'ĐẠT': 'bg-green-100 text-green-800',
  'KHÔNG ĐẠT': 'bg-red-100 text-red-800',
}

// Bỏ dấu tiếng Việt + chữ thường + gộp khoảng trắng — dùng để so khớp họ tên
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Kỳ trước đó n tháng của "YYYY-MM"
export function shiftPeriod(period, delta) {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
