import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Cambio obligatorio de contraseña.
 *
 * Se muestra encima de todo y sin forma de cerrarlo: mientras la cuenta siga
 * con la contraseña de fábrica, cualquiera que abra la computadora entraría al
 * expediente académico completo.
 */
function ForcePasswordChange() {
  const { user, passwordChanged, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!current || !next || !confirm) { setError('Completa todos los campos'); return }
    if (next !== confirm) { setError('Las contraseñas nuevas no coinciden'); return }

    setSaving(true)
    const res = await window.api.changePassword(current, next)
    setSaving(false)

    if (res.ok) passwordChanged()
    else setError(res.error ?? 'No se pudo cambiar la contraseña')
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2>Cambia tu contraseña</h2>
        </div>

        <div className="alert alert-warning" style={{ margin: '0 1.25rem' }}>
          Bienvenida{user?.full_name ? `, ${user.full_name}` : ''}. La cuenta sigue con la
          contraseña de instalación. Para proteger la información de los alumnos
          debes elegir una nueva antes de continuar.
        </div>

        <form onSubmit={submit} className="modal-body">
          <div className="form-group">
            <label>Contraseña actual</label>
            <input type="password" value={current} autoFocus
              onChange={e => setCurrent(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Nueva contraseña</label>
            <input type="password" value={next}
              onChange={e => setNext(e.target.value)} />
            <small className="hint">
              Mínimo 8 caracteres, con letras y números. No puede ser la inicial.
            </small>
          </div>
          <div className="form-group">
            <label>Confirmar nueva contraseña</label>
            <input type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)} />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => logout()}>
              Cerrar sesión
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar y continuar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Aviso antes del cierre automático, con opción de continuar */
function IdleWarning() {
  const { idleCountdown, idleMinutes, stayLoggedIn, logout } = useAuth()
  if (idleCountdown === null) return null

  const min = Math.floor(idleCountdown / 60)
  const sec = String(idleCountdown % 60).padStart(2, '0')

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>¿Sigues ahí?</h2>
        </div>
        <div className="modal-body">
          <p>
            No se ha detectado actividad en {idleMinutes} minutos. La sesión se
            cerrará en <strong>{min}:{sec}</strong> para que nadie más pueda ver
            la información desde esta computadora.
          </p>
          <p className="hint">
            Lo que ya guardaste está a salvo; lo que estés escribiendo sin guardar se perderá.
          </p>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => logout()}>
              Cerrar sesión ahora
            </button>
            <button className="btn btn-primary" onClick={stayLoggedIn} autoFocus>
              Continuar trabajando
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Envuelve la aplicación con las protecciones de sesión */
export default function SecurityGate({ children }: { children: React.ReactNode }) {
  const { mustChangePassword } = useAuth()

  if (mustChangePassword) return <ForcePasswordChange />

  return (
    <>
      {children}
      <IdleWarning />
    </>
  )
}
