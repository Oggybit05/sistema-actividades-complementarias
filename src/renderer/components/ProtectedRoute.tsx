import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SecurityGate from './SecurityGate'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <SecurityGate>{children}</SecurityGate>
}
