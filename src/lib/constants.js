// Các nhóm mục tiêu KPI (theo mẫu phiếu đánh giá)
export const CATEGORIES = [
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
