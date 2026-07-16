import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'

export default function ProtectedRoute({ children, requireManager, requireAdmin }) {
  const { username, profile, loading, isManager, isAdmin } = useAuth()

  if (loading) return <Spinner />
  if (!username) return <Navigate to="/login" replace />

  // Chờ hồ sơ tải xong trước khi kiểm tra quyền
  if (!profile) return <Spinner label="Đang tải hồ sơ..." />

  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />
  if (requireManager && !isManager) return <Navigate to="/" replace />

  return children
}
