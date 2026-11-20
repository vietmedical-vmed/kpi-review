// Kỳ đánh giá được tạo TỰ ĐỘNG theo thời gian thực — admin không cần tạo.
//  • Giao diện luôn có sẵn tháng hiện tại, tháng kế tiếp và các tháng gần đây.
//  • Bảng kpi_periods chỉ lưu kỳ đã phát sinh phiếu (trigger DB tự thêm khi
//    tạo phiếu đầu tiên) hoặc kỳ admin đã khoá. Kỳ chưa có dòng = đang mở.
//  • Khoảng hợp lệ khớp trigger DB: lùi PERIOD_BACK tháng, tiến PERIOD_AHEAD tháng.
import { supabase } from './supabase'
import { currentPeriod, shiftPeriod } from './constants'

export const PERIOD_BACK = 24
export const PERIOD_AHEAD = 1
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isPeriodAllowed(period) {
  if (!PERIOD_RE.test(period || '')) return false
  const cur = currentPeriod()
  return period >= shiftPeriod(cur, -PERIOD_BACK) && period <= shiftPeriod(cur, PERIOD_AHEAD)
}

/**
 * Danh sách kỳ để chọn: các dòng trong kpi_periods + tháng kế tiếp, tháng hiện
 * tại và `recent` tháng gần nhất (nếu chưa có dòng thì coi như đang mở).
 * Trả về mảng { period, is_open, auto } sắp xếp mới -> cũ.
 */
export async function loadPeriods(recent = 12) {
  const { data } = await supabase.from('kpi_periods').select('*')
  const map = new Map((data || []).map((p) => [p.period, { ...p, auto: false }]))
  const cur = currentPeriod()
  for (let i = -PERIOD_AHEAD; i < recent; i++) {
    const p = shiftPeriod(cur, -i)
    if (!map.has(p)) map.set(p, { period: p, is_open: true, auto: true })
  }
  return [...map.values()].sort((a, b) => b.period.localeCompare(a.period))
}

// Kỳ mặc định: tháng hiện tại nếu đang mở, không thì kỳ mở gần nhất
export function defaultPeriod(periods) {
  const cur = currentPeriod()
  const hit = periods.find((p) => p.period === cur && p.is_open)
  return hit?.period || periods.find((p) => p.is_open && p.period <= cur)?.period || periods[0]?.period || cur
}
