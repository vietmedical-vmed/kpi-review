// Xuất Excel theo dữ liệu MỚI NHẤT trên hệ thống, cùng định dạng & biểu mẫu với
// file đã upload:
//  • Phiếu có file gốc  -> mở lại file gốc, ghi số liệu mới vào đúng ô, tải về
//    với tên file gốc. File cả đội: mọi người trong file được cập nhật cùng lúc.
//  • Phiếu không có file gốc (nhập trước khi có tính năng lưu file, hoặc file gốc
//    không ghi được) -> tạo file theo mẫu chuẩn "Đăng kí & đánh giá KPI tháng".
import { supabase } from './supabase'
import { buildStandardWorkbook, downloadBlob, fillOriginalWorkbook, standardFileName } from './excel'

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function loadObjectives(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('objectives')
      .select('*')
      .in('evaluation_id', ids.slice(i, i + 150))
      .order('position')
    if (error) throw error
    for (const o of data || []) {
      if (!out.has(o.evaluation_id)) out.set(o.evaluation_id, [])
      out.get(o.evaluation_id).push(o)
    }
  }
  return out
}

/**
 * evals: các dòng evaluations cần xuất. Với file cả đội, chỉ cần 1 phiếu trong
 * file là cả file được xuất (các phiếu khác cùng file mà người dùng xem được
 * cũng được điền số liệu mới).
 * Trả { files, fallback: [{ name, reason }] }.
 */
export async function exportEvaluations(evals) {
  const fileIds = [...new Set(evals.map((e) => e.source_file_id).filter(Boolean))]

  // Lấy đủ các phiếu cùng file gốc (không chỉ phiếu đang chọn)
  let all = [...evals]
  if (fileIds.length) {
    const { data, error } = await supabase.from('evaluations').select('*').in('source_file_id', fileIds)
    if (error) throw error
    const seen = new Set(all.map((e) => e.id))
    for (const e of data || []) if (!seen.has(e.id)) all.push(e)
  }
  const objs = await loadObjectives(all.map((e) => e.id))
  const entryOf = (e) => ({
    key: e.id,
    sheet: e.source_sheet || '',
    employeeName: e.employee_name || '',
    objectives: objs.get(e.id) || [],
    registrationComment: e.registration_comment || '',
    managerComment: e.manager_comment || '',
  })

  const fallback = [] // [{ ev, reason }]
  let files = 0
  for (const fid of fileIds) {
    const group = all.filter((e) => e.source_file_id === fid)
    const { data: f } = await supabase.from('kpi_files').select('file_name, content_b64').eq('id', fid).maybeSingle()
    if (!f) {
      for (const ev of group.filter((g) => evals.some((x) => x.id === g.id)))
        fallback.push({ ev, reason: 'không còn file gốc' })
      continue
    }
    try {
      const { blob, failed } = await fillOriginalWorkbook(f.content_b64, group.map(entryOf))
      if (files++) await pause(400)
      downloadBlob(blob, f.file_name)
      for (const x of failed) {
        const ev = group.find((g) => g.id === x.key)
        if (ev) fallback.push({ ev, reason: x.reason })
      }
    } catch (err) {
      for (const ev of group.filter((g) => evals.some((x) => x.id === g.id)))
        fallback.push({ ev, reason: 'không mở được file gốc: ' + (err.message || err) })
    }
  }

  const noFile = evals.filter((e) => !e.source_file_id).map((ev) => ({ ev, reason: null }))
  for (const { ev } of [...noFile, ...fallback]) {
    const name = ev.employee_name || ev.username || 'Nhan vien'
    const blob = await buildStandardWorkbook({
      personName: name,
      username: ev.username || '',
      period: ev.period,
      objectives: objs.get(ev.id) || [],
      registrationComment: ev.registration_comment || '',
      managerComment: ev.manager_comment || '',
    })
    if (files++) await pause(400)
    downloadBlob(blob, standardFileName(name, ev.period))
  }

  return {
    files,
    fallback: fallback.map(({ ev, reason }) => ({ name: ev.employee_name || ev.username, reason })),
  }
}
