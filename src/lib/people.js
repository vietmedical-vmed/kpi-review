// Danh sách người dùng (bảng users dùng chung) để chọn Người duyệt (N+1).
import { supabase } from './supabase'

const MANAGER_ROLES = new Set(['admin', 'manager', 'area_manager'])

/** Trả { users, userMap, managerSet } — managerSet: vai trò quản lý trong DA hoặc đang có cấp dưới. */
export async function loadPeople() {
  const [{ data: us }, { data: kp }] = await Promise.all([
    supabase.from('kpi_users').select('username, ho_va_ten, da_role, mien, bu').order('ho_va_ten'),
    supabase.from('kpi_profiles').select('username, manager_username'),
  ])
  const users = us || []
  const managerSet = new Set(users.filter((u) => MANAGER_ROLES.has(u.da_role)).map((u) => u.username))
  for (const p of kp || []) if (p.manager_username) managerSet.add(p.manager_username)
  return { users, userMap: new Map(users.map((u) => [u.username, u])), managerSet, profiles: kp || [] }
}

export function userLabel(userMap, un) {
  if (!un) return ''
  return userMap.get(un)?.ho_va_ten || un
}

// Khoảng cách chỉnh sửa (Levenshtein) — gợi ý tên gõ sai chính tả
export function editDistance(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m || !n) return m || n
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
