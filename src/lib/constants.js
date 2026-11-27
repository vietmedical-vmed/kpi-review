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

// Trạng thái phiếu — luồng rút gọn 2 bước:
//   Chờ duyệt (submitted): người nhập đã nhập, còn sửa được.
//   Đã duyệt  (approved) : N+1/admin đã duyệt, khoá sửa (trừ N+1/admin bỏ duyệt).
// 'draft' / 'reviewed' là trạng thái cũ, hiển thị như "Chờ duyệt".
export const EVAL_STATUS = {
  PENDING: 'submitted',
  APPROVED: 'approved',
}

export const STATUS_LABELS = {
  draft: 'Chờ duyệt',
  submitted: 'Chờ duyệt',
  reviewed: 'Chờ duyệt',
  approved: 'Đã duyệt',
}

export const STATUS_COLORS = {
  draft: 'bg-amber-100 text-amber-800',
  submitted: 'bg-amber-100 text-amber-800',
  reviewed: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
}

export const isApproved = (ev) => ev?.status === 'approved'

/**
 * Quyền trên 1 phiếu (khớp RLS kpi_can_edit_eval ở DB):
 *  - approve: người duyệt (manager_username) hoặc admin; phiếu gắn TK cũ: QL trực tiếp
 *  - edit   : người duyệt / admin luôn sửa được; người nhập (imported_by) và chủ
 *             phiếu chỉ sửa khi chưa duyệt
 *  - remove : admin, hoặc người nhập / người duyệt khi chưa duyệt
 */
export function evalPermissions(ev, { username, isAdmin, canUpload, directManager } = {}) {
  if (!ev) return { approve: false, edit: false, remove: false, isApprover: false, isUploader: false }
  const isApprover = isAdmin || (ev.username ? directManager === username : ev.manager_username === username)
  const isUploader = !!ev.imported_by && ev.imported_by === username && canUpload
  const isOwner = !!ev.username && ev.username === username
  const approved = isApproved(ev)
  return {
    isApprover,
    isUploader,
    approve: isApprover,
    edit: isApprover || (!approved && (isUploader || isOwner)),
    remove: isAdmin || (!approved && (isUploader || (!ev.username && ev.manager_username === username))),
  }
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

// Phiếu có kết quả để xếp loại chưa (đã có KQ của N hoặc N+1)
export function hasResult(ev) {
  return !!ev && (Number(ev.self_total) > 0 || Number(ev.manager_total) > 0)
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

// ---------------------------------------------------------------- NHÂN VIÊN
// Phiếu có thể KHÔNG gắn tài khoản (nhân viên không được cấp TK, leader nhập hộ):
// khi đó nhận diện bằng employee_key (tên chuẩn hoá) + manager_username (N+1 phụ trách).
export function personKey(ev) {
  if (!ev) return ''
  return ev.username || `name:${ev.employee_key}|${ev.manager_username}`
}

// Tên hiển thị: ưu tiên tên lấy từ file Excel, sau đó tên trong hệ thống
export function displayName(ev, user) {
  return ev?.employee_name || user?.ho_va_ten || ev?.username || ''
}
