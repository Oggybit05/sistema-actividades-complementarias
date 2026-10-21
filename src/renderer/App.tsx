import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StudentsPage from './pages/StudentsPage'
import CareersPage from './pages/CareersPage'
import ComplementariesPage from './pages/ComplementariesPage'
import PeriodsPage from './pages/PeriodsPage'
import GroupsPage from './pages/GroupsPage'
import EnrollmentsPage from './pages/EnrollmentsPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import ImportPage from './pages/ImportPage'
import EvaluationsPage from './pages/EvaluationsPage'

export default function App() {
  return (
    <AuthProvider>
      {/*
        HashRouter y no BrowserRouter: la app empaquetada se abre con file://,
        y ahí la ruta del documento es "/C:/.../dist/index.html". Con
        BrowserRouter eso no coincide con ninguna ruta, cae en path="*" y el
        Navigate a "/" manda la página a file:///C:/ — la ventana se queda en
        blanco. Con HashRouter las rutas viven en "#/dashboard" y la dirección
        del archivo ya no interfiere.
      */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="careers" element={<CareersPage />} />
            <Route path="complementaries" element={<ComplementariesPage />} />
            <Route path="periods" element={<PeriodsPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="enrollments" element={<EnrollmentsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="evaluations" element={<EvaluationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
