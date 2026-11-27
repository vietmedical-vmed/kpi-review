import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import ImportKpi from './pages/ImportKpi'
import KpiList from './pages/KpiList'
import EvaluationDetail from './pages/EvaluationDetail'
import TeamInsights from './pages/TeamInsights'
import Admin from './pages/Admin'

// Luồng chính: Nhập KPI (/nhap) -> Phiếu & duyệt (/phieu, /phieu/:id) -> Báo cáo (/bao-cao)
function LegacyEvalRedirect() {
  const { id } = useParams()
  return <Navigate to={`/phieu/${id}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/phieu" replace />} />
        <Route
          path="/nhap"
          element={
            <ProtectedRoute requireUpload>
              <ImportKpi />
            </ProtectedRoute>
          }
        />
        <Route path="/phieu" element={<KpiList />} />
        <Route path="/phieu/:id" element={<EvaluationDetail />} />
        <Route
          path="/bao-cao"
          element={
            <ProtectedRoute requireManager>
              <TeamInsights />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quan-tri"
          element={
            <ProtectedRoute requireAdmin>
              <Admin />
            </ProtectedRoute>
          }
        />
        {/* Đường dẫn cũ */}
        <Route path="/danh-gia/:id" element={<LegacyEvalRedirect />} />
        <Route path="/danh-gia" element={<Navigate to="/phieu" replace />} />
        <Route path="/duyet" element={<Navigate to="/phieu" replace />} />
        <Route path="/excel" element={<Navigate to="/nhap" replace />} />
        <Route path="*" element={<Navigate to="/phieu" replace />} />
      </Route>
    </Routes>
  )
}
