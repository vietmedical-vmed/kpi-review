import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPeriod, currentPeriod, STATUS_LABELS } from '../lib/constants'
import Spinner from '../components/Spinner'

function StatCard({ label, value, sub, to }) {
  const body = (
    <div className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export default function Dashboard() {
  const { username, profile, isManager } = useAuth()
  const [loading, setLoading] = useState(true)
  const [latest, setLatest] = useState(null)
  const [pending, setPending] = useState(0)

  useEffect(() => {
    async function load() {
      const { data: mine } = await supabase
        .from('evaluations')
        .select('*')
        .eq('username', username)
        .order('period', { ascending: false })
        .limit(1)
      setLatest(mine?.[0] || null)

      if (isManager) {
        const { count } = await supabase
          .from('evaluations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted')
        setPending(count || 0)
      }
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">
          Xin chào, {profile?.ho_va_ten || 'bạn'} 👋
        </h1>
        <p className="text-sm text-slate-500">
          Kỳ hiện tại: {formatPeriod(currentPeriod())}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Phiếu gần nhất"
          value={latest ? formatPeriod(latest.period) : 'Chưa có'}
          sub={latest ? STATUS_LABELS[latest.status] : 'Hãy tạo phiếu đầu tiên'}
          to="/danh-gia"
        />
        <StatCard
          label="Điểm tự đánh giá gần nhất"
          value={latest ? `${latest.self_total}%` : '—'}
          sub={
            latest && (latest.status === 'reviewed' || latest.status === 'approved')
              ? `Quản lý chấm: ${latest.manager_total}%`
              : 'Chưa có điểm quản lý'
          }
        />
        {isManager && (
          <StatCard
            label="Phiếu chờ duyệt"
            value={pending}
            sub="Nhân viên đã gửi, chờ bạn chấm"
            to="/duyet"
          />
        )}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-semibold text-slate-800">Hướng dẫn nhanh</h2>
        <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
          <li>Vào <b>Phiếu của tôi</b> để tạo phiếu KPI cho kỳ đang mở.</li>
          <li>Thêm các dòng mục tiêu, đảm bảo tổng trọng số bằng 100%.</li>
          <li>Nhập kết quả tự đánh giá rồi bấm <b>Gửi duyệt</b>.</li>
          <li>Quản lý xem lại, chấm điểm và <b>Chốt kết quả</b>.</li>
        </ol>
      </div>
    </div>
  )
}
