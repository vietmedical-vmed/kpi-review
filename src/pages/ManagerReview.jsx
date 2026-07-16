import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  formatPeriod,
  recentPeriods,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../lib/constants'
import Spinner from '../components/Spinner'

export default function ManagerReview() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rows, setRows] = useState([])
  const [userMap, setUserMap] = useState({})
  const [loading, setLoading] = useState(true)
  const periods = recentPeriods(12)

  async function load() {
    setLoading(true)
    // RLS đảm bảo chỉ trả về phiếu của nhân viên thuộc quyền quản lý (hoặc admin xem tất cả)
    let query = supabase
      .from('evaluations')
      .select('*')
      .order('period', { ascending: false })
    if (period) query = query.eq('period', period)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    const { data } = await query
    const list = data || []
    setRows(list)

    // Tra tên nhân viên cho các username xuất hiện
    const usernames = [...new Set(list.map((e) => e.username))]
    if (usernames.length) {
      const { data: users } = await supabase
        .from('kpi_users')
        .select('username, ho_va_ten, mien, bu')
        .in('username', usernames)
      const map = {}
      for (const u of users || []) map[u.username] = u
      setUserMap(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, statusFilter])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Duyệt KPI nhân viên</h1>
          <p className="text-sm text-slate-500">
            Xem lại và chấm điểm các phiếu nhân viên đã gửi.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Kỳ</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Tất cả kỳ</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {formatPeriod(p)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Trạng thái
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">Tất cả</option>
              <option value="submitted">Chờ duyệt</option>
              <option value="reviewed">Đã chấm</option>
              <option value="approved">Đã chốt</option>
              <option value="draft">Nháp</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Nhân viên</th>
                <th className="px-4 py-3 font-medium">Miền / BU</th>
                <th className="px-4 py-3 font-medium">Kỳ</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 text-right font-medium">Tự đánh giá</th>
                <th className="px-4 py-3 text-right font-medium">QL chấm</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Không có phiếu nào.
                  </td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {userMap[e.username]?.ho_va_ten || e.username}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {[userMap[e.username]?.mien, userMap[e.username]?.bu]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3">{formatPeriod(e.period)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[e.status]}`}
                    >
                      {STATUS_LABELS[e.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{e.self_total}%</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {e.status === 'reviewed' || e.status === 'approved'
                      ? `${e.manager_total}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/danh-gia/${e.id}`)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {e.status === 'submitted' ? 'Chấm điểm' : 'Xem'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
