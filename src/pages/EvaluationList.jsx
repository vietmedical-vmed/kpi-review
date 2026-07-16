import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  formatPeriod,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../lib/constants'
import Spinner from '../components/Spinner'

export default function EvaluationList() {
  const { username } = useAuth()
  const navigate = useNavigate()
  const [evaluations, setEvaluations] = useState([])
  const [openPeriods, setOpenPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: evals }, { data: periods }] = await Promise.all([
      supabase
        .from('evaluations')
        .select('*')
        .eq('username', username)
        .order('period', { ascending: false }),
      supabase
        .from('kpi_periods')
        .select('*')
        .eq('is_open', true)
        .order('period', { ascending: false }),
    ])
    setEvaluations(evals || [])
    setOpenPeriods(periods || [])
    setSelectedPeriod(periods?.[0]?.period || '')
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createEvaluation() {
    if (!selectedPeriod) return
    setError('')
    // Tránh tạo trùng phiếu cho cùng kỳ
    if (evaluations.some((e) => e.period === selectedPeriod)) {
      setError('Bạn đã có phiếu cho kỳ này.')
      return
    }
    setCreating(true)
    const { data, error } = await supabase
      .from('evaluations')
      .insert({ username, period: selectedPeriod, status: 'draft' })
      .select()
      .single()
    setCreating(false)
    if (error) {
      setError('Không tạo được phiếu: ' + error.message)
      return
    }
    navigate(`/danh-gia/${data.id}`)
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Phiếu KPI của tôi</h1>
          <p className="text-sm text-slate-500">
            Tạo và theo dõi phiếu đánh giá KPI theo từng tháng.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Kỳ đang mở
            </label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {openPeriods.length === 0 && <option value="">Chưa có kỳ mở</option>}
              {openPeriods.map((p) => (
                <option key={p.period} value={p.period}>
                  {formatPeriod(p.period)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={createEvaluation}
            disabled={creating || !selectedPeriod}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creating ? 'Đang tạo...' : '+ Tạo phiếu mới'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kỳ đánh giá</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
              <th className="px-4 py-3 text-right font-medium">Tự đánh giá</th>
              <th className="px-4 py-3 text-right font-medium">Quản lý chấm</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {evaluations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Chưa có phiếu nào. Hãy tạo phiếu cho kỳ hiện tại.
                </td>
              </tr>
            )}
            {evaluations.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {formatPeriod(e.period)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[e.status]}`}
                  >
                    {STATUS_LABELS[e.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {e.self_total}%
                </td>
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
                    Mở
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
