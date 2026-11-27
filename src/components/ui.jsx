import { GRADE_COLORS, STATUS_COLORS, STATUS_LABELS } from '../lib/constants'

export function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}

export function StatusBadge({ status }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function GradeBadge({ grade, score }) {
  if (!grade) return <span className="text-xs text-slate-400">—</span>
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_COLORS[grade]}`}>
      {score !== undefined && score !== null ? `${score}% · ` : ''}
      {grade}
    </span>
  )
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null
  const cls = {
    error: 'bg-red-50 text-red-700',
    success: 'bg-green-50 text-green-700',
    info: 'bg-blue-50 text-blue-700',
    warn: 'bg-amber-50 text-amber-800',
  }[kind]
  return <div className={`mb-4 rounded-md px-4 py-3 text-sm ${cls}`}>{children}</div>
}

export const pct = (v) => (v === null || v === undefined || v === '' ? '—' : `${v}%`)

// Chọn người duyệt (N+1): nhóm quản lý lên trước
export function ApproverSelect({ value, onChange, users, managerSet, me, className = 'input', emptyLabel = '— Chọn người duyệt —' }) {
  const managers = users.filter((u) => managerSet.has(u.username))
  const others = users.filter((u) => !managerSet.has(u.username))
  const label = (u) => `${u.ho_va_ten || u.username} (${u.username})${u.username === me ? ' — tôi' : ''}`
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{emptyLabel}</option>
      {managers.length > 0 && (
        <optgroup label="Quản lý">
          {managers.map((u) => (
            <option key={u.username} value={u.username}>
              {label(u)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={managers.length ? 'Khác' : 'Tất cả'}>
        {others.map((u) => (
          <option key={u.username} value={u.username}>
            {label(u)}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
