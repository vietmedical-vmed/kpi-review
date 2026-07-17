import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import EvaluationList from './pages/EvaluationList'
import EvaluationForm from './pages/EvaluationForm'
import ManagerReview from './pages/ManagerReview'
import ExcelImport from './pages/ExcelImport'
import Admin from './pages/Admin'

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
        <Route path="/" element={<Dashboard />} />
        <Route path="/danh-gia" element={<EvaluationList />} />
        <Route path="/danh-gia/:id" element={<EvaluationForm />} />
        <Route path="/excel" element={<ExcelImport />} />
        <Route
          path="/duyet"
          element={
            <ProtectedRoute requireManager>
              <ManagerReview />
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
      </Route>
    </Routes>
  )
}
