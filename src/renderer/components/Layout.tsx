import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackupReminder from './BackupReminder'

const NAV = [
  { to: '/dashboard', label: 'Panel', icon: '📊' },
  { to: '/students', label: 'Estudiantes', icon: '👤' },
  { to: '/enrollments', label: 'Inscripciones', icon: '📋' },
  { to: '/groups', label: 'Grupos', icon: '🗂️' },
  { to: '/complementaries', label: 'Complementarias', icon: '📚' },
  { to: '/careers', label: 'Carreras', icon: '🎓' },
  { to: '/periods', label: 'Periodos', icon: '📅' },
  { to: '/reports', label: 'Reportes', icon: '📄' },
  { to: '/import', label: 'Importar', icon: '📥' },
  { to: '/evaluations', label: 'Evaluaciones', icon: '⭐' },
  { to: '/settings', label: 'Configuración', icon: '⚙️' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 'var(--sidebar-w)', background: 'var(--primary)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        overflowY: 'auto',
      }}>
        <div style={{
          padding: '20px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Sistema de Actividades</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Complementarias</div>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8, marginBottom: 2,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                textDecoration: 'none', fontSize: 14, fontWeight: isActive ? 600 : 400,
                transition: 'all 0.15s',
              })}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div style={{
          padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginBottom: 8 }}>
            {user?.full_name}
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: 'rgba(255,255,255,0.8)', padding: '6px 12px',
              borderRadius: 6, cursor: 'pointer', fontSize: 13, width: '100%',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Contenido */}
      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <BackupReminder />
        <div style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
