import { useState, useEffect, useRef } from 'react'
import type {
  BackupInfo, BackupEntry, DbSummary, AppSettings, DemoStatus,
} from '@shared/types'
import { SCORE_SCALE } from '@shared/scores'
import { useAuth } from '../context/AuthContext'

const KIND_LABEL: Record<string, string> = {
  auto: 'Automático',
  manual: 'Manual',
  safety: 'Previo a restaurar',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Días transcurridos desde una fecha, para el aviso de respaldo pendiente */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export default function SettingsPage() {
  const { passwordChanged } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')

  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  /** Respaldo elegido para restaurar, con su contenido ya leído */
  const [pending, setPending] = useState<{ path: string; name: string; summary: DbSummary } | null>(null)
  const busy = useRef(false)

  // ─── Datos institucionales ─────────────────────────────────────────────
  const [settings, setSettings] = useState<AppSettings | null>(null)
  /** Copia de lo guardado, para saber si hay cambios sin aplicar */
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [stMsg, setStMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // ─── Datos de práctica ─────────────────────────────────────────────────
  const [demo, setDemo] = useState<DemoStatus | null>(null)
  const [demoBusy, setDemoBusy] = useState(false)

  const settingsDirty = !!settings && !!savedSettings &&
    JSON.stringify(settings) !== JSON.stringify(savedSettings)

  async function loadSettings() {
    try {
      const res = await window.api.getSettings()
      if (res.ok) {
        setSettings(res.data as AppSettings)
        setSavedSettings(res.data as AppSettings)
      }
    } catch { /* la pantalla sigue sirviendo para respaldos */ }
  }

  async function loadDemo() {
    try {
      const res = await window.api.getDemoStatus()
      if (res.ok) setDemo(res.data as DemoStatus)
    } catch { /* opcional */ }
  }

  function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(s => (s ? { ...s, [key]: value } : s))
    setStMsg(null)
  }

  async function handleSaveSettings() {
    if (!settings) return
    setSavingSettings(true); setStMsg(null)
    const res = await window.api.saveSettings(settings)
    setSavingSettings(false)

    if (res.ok) {
      setSettings(res.data as AppSettings)
      setSavedSettings(res.data as AppSettings)
      setStMsg({ type: 'success', text: 'Datos institucionales actualizados' })
    } else {
      setStMsg({ type: 'error', text: res.error ?? 'No se pudo guardar' })
    }
  }

  async function handlePickLogo() {
    const res = await window.api.pickLogo()
    if (res.ok) setSetting('logo_path', String(res.data))
    else if (res.error !== 'cancelado') setStMsg({ type: 'error', text: res.error ?? 'Error' })
  }

  /**
   * La carpeta se guarda sola: el proceso principal la deja escrita antes de
   * contestar. Por eso se actualiza también `savedSettings`, para que el botón
   * de abajo no quede diciendo "Guardar cambios" por algo que ya está guardado.
   */
  async function handlePickFolder() {
    const res = await window.api.pickReportsFolder()
    if (res.ok) {
      const saved = res.data as AppSettings
      setSettings(s => (s ? { ...s, reports_folder: saved.reports_folder } : saved))
      setSavedSettings(s => (s ? { ...s, reports_folder: saved.reports_folder } : saved))
      setStMsg({
        type: 'success',
        text: `Los reportes se guardarán en ${saved.reports_folder}. Queda fijo hasta que lo cambies.`,
      })
    }
    else if (res.error !== 'cancelado') setStMsg({ type: 'error', text: res.error ?? 'Error' })
  }

  /** Volver a Descargas también se guarda de inmediato, por simetría */
  async function handleUseDownloads() {
    const res = await window.api.saveSettings({ reports_folder: '' })
    if (res.ok) {
      setSettings(res.data as AppSettings)
      setSavedSettings(res.data as AppSettings)
      setStMsg({ type: 'success', text: 'Los reportes volverán a la carpeta de Descargas' })
    } else {
      setStMsg({ type: 'error', text: res.error ?? 'No se pudo guardar' })
    }
  }

  async function handleLoadDemo() {
    const warning = demo && demo.real_students > 0
      ? `Ya tienes ${demo.real_students} alumno(s) reales registrados.\n\n` +
        'Los de práctica se agregarán aparte y quedarán marcados para poder retirarlos después.\n\n¿Continuar?'
      : 'Se agregarán 33 alumnos y varios grupos de ejemplo para que puedas practicar.\n\n¿Continuar?'
    if (!window.confirm(warning)) return

    setDemoBusy(true); setMsg(null)
    const res = await window.api.loadDemoData()
    setDemoBusy(false)

    if (res.ok) {
      const d = res.data as any
      setMsg({
        type: 'success',
        text: `Se cargaron ${d.students} alumno(s) y ${d.groups} grupo(s) de práctica` +
          (d.skipped ? `. Se omitieron ${d.skipped} que ya existían.` : '.'),
      })
    } else {
      setMsg({ type: 'error', text: res.error ?? 'No se pudieron cargar los datos de práctica' })
    }
    loadDemo(); loadInfo()
  }

  async function handleClearDemo() {
    if (!demo) return
    const ok = window.confirm(
      'Se eliminarán DEFINITIVAMENTE:\n\n' +
      `· ${demo.students} alumno(s) de práctica\n` +
      `· ${demo.groups} grupo(s) de práctica\n` +
      `· ${demo.enrollments} inscripción(es) y sus calificaciones\n\n` +
      `Tus ${demo.real_students} alumno(s) reales NO se tocan.\n\n¿Continuar?`
    )
    if (!ok) return

    setDemoBusy(true); setMsg(null)
    const res = await window.api.clearDemoData()
    setDemoBusy(false)

    if (res.ok) {
      const d = res.data as any
      setMsg({
        type: 'success',
        text: `Se retiraron ${d.students} alumno(s), ${d.groups} grupo(s) y ${d.enrollments} inscripción(es) de práctica.`,
      })
    } else {
      setMsg({ type: 'error', text: res.error ?? 'No se pudieron eliminar' })
    }
    loadDemo(); loadInfo()
  }

  async function loadInfo() {
    const res = await window.api.getBackupInfo()
    if (res.ok) setInfo(res.data as BackupInfo)
    else setMsg({ type: 'error', text: res.error ?? 'No se pudo leer la información de respaldos' })
  }

  useEffect(() => { loadInfo(); loadSettings(); loadDemo() }, [])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(''); setPwSuccess('')
    if (!current || !next || !confirmPw) { setPwError('Completa todos los campos'); return }
    if (next !== confirmPw) { setPwError('Las contraseñas nuevas no coinciden'); return }
    if (next.length < 8) { setPwError('La contraseña debe tener al menos 8 caracteres'); return }
    const res = await window.api.changePassword(current, next)
    if (res.ok) {
      passwordChanged()
      setPwSuccess('Contraseña actualizada correctamente'); setCurrent(''); setNext(''); setConfirmPw('')
    }
    else setPwError(res.error ?? 'Error')
  }

  async function handleExport() {
    setMsg(null)
    const res = await window.api.backupDatabase()
    if (res.ok) {
      const savedPath = res.data as string
      setMsg({ type: 'success', text: `Respaldo guardado en: ${savedPath}` })
      // Se ofrece abrir la carpeta porque el siguiente paso real es copiar el
      // archivo a la USB, y buscarlo a mano es donde suele quedarse el trámite.
      if (confirm(`Respaldo guardado.\n\n${savedPath}\n\n¿Abrir la carpeta donde quedó?`)) {
        await window.api.revealBackupFile(savedPath)
      }
    }
    else if (res.error !== 'Operación cancelada') setMsg({ type: 'error', text: res.error ?? 'Error' })
    loadInfo()
  }

  async function handleLocalBackup() {
    setMsg(null)
    const res = await window.api.createLocalBackup()
    if (res.ok) {
      const b = res.data as BackupEntry
      setMsg({ type: 'success', text: `Copia creada: ${b.file}` })
      loadInfo()
    } else setMsg({ type: 'error', text: res.error ?? 'Error' })
  }

  /** Paso 1 de restaurar: leer y validar el archivo, sin reemplazar nada */
  async function pickBackup(entry: BackupEntry) {
    setMsg(null)
    const res = await window.api.inspectBackup(entry.path)
    if (!res.ok) { setMsg({ type: 'error', text: res.error ?? 'Archivo inválido' }); return }
    setPending({ path: entry.path, name: entry.file, summary: res.data as DbSummary })
  }

  async function pickExternal() {
    setMsg(null)
    const res = await window.api.chooseBackupFile()
    if (!res.ok) {
      if (res.error !== 'Operación cancelada') setMsg({ type: 'error', text: res.error ?? 'Error' })
      return
    }
    const d = res.data as { path: string; summary: DbSummary }
    setPending({ path: d.path, name: d.path.split(/[\\/]/).pop() ?? d.path, summary: d.summary })
  }

  /** Paso 2 de restaurar: reemplazar la base activa */
  async function confirmRestore() {
    if (!pending || busy.current) return
    busy.current = true
    const res = await window.api.restoreFromBackup(pending.path)
    busy.current = false
    if (!res.ok) { setMsg({ type: 'error', text: res.error ?? 'Error' }); setPending(null); return }
    const d = res.data as { safety: string }
    setMsg({
      type: 'success',
      text: `Base de datos restaurada desde ${pending.name}.` +
        (d.safety ? ` El estado anterior quedó guardado como ${d.safety}.` : ''),
    })
    setPending(null)
    loadInfo()
  }

  async function handleDelete(entry: BackupEntry) {
    if (!confirm(`¿Borrar la copia ${entry.file}? Esta acción no se puede deshacer.`)) return
    const res = await window.api.deleteBackup(entry.path)
    if (!res.ok) setMsg({ type: 'error', text: res.error ?? 'Error' })
    else loadInfo()
  }

  const sinceManual = daysSince(info?.last_manual_at ?? null)
  // El criterio lo decide el proceso principal: ahí se sabe cuántos movimientos
  // hubo desde la última copia, no solo cuántos días pasaron.
  const needsExternal = info?.needs_manual_backup ?? (sinceManual === null || sinceManual >= 7)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
      </div>

      {/* Cambiar contraseña */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Cambiar contraseña</span>
        </div>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 400 }}>
          {pwError && <div className="alert alert-error">{pwError}</div>}
          {pwSuccess && <div className="alert alert-success">{pwSuccess}</div>}
          <div className="form-group">
            <label className="form-label">Contraseña actual</label>
            <input className="form-control" type="password" value={current}
              onChange={e => setCurrent(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Nueva contraseña</label>
            <input className="form-control" type="password" value={next}
              onChange={e => setNext(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirmar nueva contraseña</label>
            <input className="form-control" type="password" value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>
            Actualizar contraseña
          </button>
        </form>
      </div>

      {/* Datos institucionales */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Datos institucionales</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Aparecen en el encabezado de cada reporte
          </span>
        </div>

        {stMsg && <div className={`alert alert-${stMsg.type}`} style={{ marginBottom: 14 }}>{stMsg.text}</div>}

        {settings && (
          <>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Institución</label>
                <input className="form-control" value={settings.institution_name}
                  onChange={e => setSetting('institution_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Departamento o área</label>
                <input className="form-control" value={settings.department_name}
                  onChange={e => setSetting('department_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Docente</label>
                <input className="form-control" value={settings.teacher_name}
                  onChange={e => setSetting('teacher_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Correo</label>
                <input className="form-control" type="email" value={settings.teacher_email}
                  onChange={e => setSetting('teacher_email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-control" value={settings.teacher_phone}
                  onChange={e => setSetting('teacher_phone', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Calificación mínima aprobatoria</label>
                <select className="form-control" value={settings.passing_score}
                  onChange={e => setSetting('passing_score', Number(e.target.value))}>
                  {SCORE_SCALE.filter(s => s.score >= 1).map(s => (
                    <option key={s.score} value={s.score}>{s.score} — {s.label}</option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-muted)' }}>
                  Con {settings.passing_score} acreditan quienes obtengan {settings.passing_score} o más
                </small>
              </div>
              <div className="form-group">
                <label className="form-label">Cerrar sesión tras (minutos)</label>
                <input className="form-control" type="number" min={5} max={480}
                  value={settings.idle_minutes}
                  onChange={e => setSetting('idle_minutes', Number(e.target.value))} />
                <small style={{ color: 'var(--text-muted)' }}>Entre 5 y 480 minutos</small>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ flex: '1 1 260px' }}>
                <label className="form-label">Logo institucional</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={handlePickLogo}>
                    {settings.logo_path ? 'Cambiar logo' : 'Elegir logo'}
                  </button>
                  {settings.logo_path && (
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setSetting('logo_path', '')}>Quitar</button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, wordBreak: 'break-all' }}>
                  {settings.logo_path || 'Sin logo: el reporte sale solo con el texto'}
                </div>
              </div>

              <div style={{ flex: '1 1 260px' }}>
                <label className="form-label">Carpeta de reportes</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={handlePickFolder}>
                    Elegir carpeta
                  </button>
                  {settings.reports_folder && (
                    <button className="btn btn-secondary btn-sm"
                      onClick={handleUseDownloads}>Usar Descargas</button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, wordBreak: 'break-all' }}>
                  {settings.reports_folder
                    ? `${settings.reports_folder} — queda guardada, no hay que elegirla cada vez`
                    : 'Se guardarán en la carpeta de Descargas'}
                </div>
              </div>
            </div>

            <button className="btn btn-primary" style={{ marginTop: 16 }}
              onClick={handleSaveSettings} disabled={savingSettings || !settingsDirty}>
              {savingSettings ? 'Guardando…' : settingsDirty ? 'Guardar cambios' : 'Sin cambios por guardar'}
            </button>
          </>
        )}
      </div>

      {/* Datos de práctica */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Datos de demostración</span>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.7 }}>
          Alumnos y grupos de ejemplo para practicar sin tocar la información real.
          No se cargan solos: se agregan únicamente cuando lo pides aquí y se pueden
          retirar después sin afectar a tus alumnos.
        </p>

        {demo && (
          <div className={`alert ${demo.loaded ? 'alert-warning' : 'alert-success'}`}
            style={{ marginBottom: 12 }}>
            {demo.loaded
              ? `Hay ${demo.students} alumno(s), ${demo.groups} grupo(s) y ${demo.enrollments} ` +
                `inscripción(es) de práctica. Tus datos reales: ${demo.real_students} alumno(s).`
              : `No hay datos de práctica. Alumnos reales registrados: ${demo.real_students}.`}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleLoadDemo} disabled={demoBusy}>
            {demoBusy ? 'Trabajando…' : 'Cargar datos de demostración'}
          </button>
          {demo?.loaded && (
            <button className="btn btn-danger" onClick={handleClearDemo} disabled={demoBusy}>
              Eliminar solo los datos de práctica
            </button>
          )}
        </div>
      </div>

      {/* Estado de los datos */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Estado de los datos</span>
          <button className="btn btn-secondary btn-sm" onClick={loadInfo}>Actualizar</button>
        </div>

        {msg && <div className={`alert alert-${msg.type}`} style={{ marginBottom: 14 }}>{msg.text}</div>}

        {info?.summary && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 12, marginBottom: 16,
          }}>
            {[
              ['Estudiantes', info.summary.students],
              ['Inscripciones', info.summary.enrollments],
              ['Grupos', info.summary.groups],
              ['Complementarias', info.summary.complementaries],
              ['Calificaciones', info.summary.evaluations],
            ].map(([label, n]) => (
              <div key={label as string} style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.9 }}>
          <div><strong>Archivo:</strong> {info?.db_path ?? '—'}</div>
          <div><strong>Tamaño:</strong> {info ? formatSize(info.db_size) : '—'}</div>
          <div><strong>Periodos:</strong> {info?.summary?.periods.join(', ') || '—'}</div>
        </div>
      </div>

      {/* Copia fuera de la computadora */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Copia de seguridad externa</span>
        </div>

        {needsExternal ? (
          <div className="alert alert-warning" style={{ marginBottom: 12 }}>
            {sinceManual === null
              ? 'Todavía no has guardado ninguna copia fuera de esta computadora. Si el equipo falla, se pierde todo.'
              : `Han pasado ${sinceManual} días desde tu última copia externa. Conviene guardar una nueva en la USB o en la nube.`}
            {!!info?.changes_since_manual && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Desde entonces se han registrado <strong>{info.changes_since_manual}</strong> movimiento(s)
                que aún no tienen copia externa.
              </div>
            )}
          </div>
        ) : (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>
            Última copia externa: {formatDate(info?.last_manual_at ?? null)}
            {sinceManual === 0 ? ' (hoy)' : ` (hace ${sinceManual} día${sinceManual === 1 ? '' : 's'})`}
            {info?.last_manual_path && (
              <button onClick={() => window.api.revealBackupFile(info.last_manual_path!)}
                style={{
                  marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'inherit', textDecoration: 'underline', fontSize: 13,
                }}>
                Abrir ubicación
              </button>
            )}
          </div>
        )}

        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Las copias automáticas viven en esta misma computadora, así que no protegen contra
          una falla del disco duro o un robo. Guarda una copia en una USB o en tu carpeta de
          nube al menos una vez por semana.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleExport}>
            Guardar copia en USB o nube
          </button>
          <button className="btn btn-secondary" onClick={pickExternal}>
            Restaurar desde un archivo
          </button>
        </div>
      </div>

      {/* Historial de respaldos */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Respaldos en esta computadora</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => window.api.openBackupFolder()}>
              Abrir carpeta
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleLocalBackup}>
              Crear copia ahora
            </button>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          Cada vez que abres el sistema se guarda automáticamente una copia del estado inicial,
          siempre que haya cambios respecto a la anterior. Se conservan las 10 más recientes.
        </p>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Archivo</th><th>Tipo</th><th>Tamaño</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(!info || info.backups.length === 0) && (
                <tr><td colSpan={5} className="table-empty">Aún no hay respaldos</td></tr>
              )}
              {info?.backups.map(b => (
                <tr key={b.path}>
                  <td>{formatDate(b.created_at)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.file}</td>
                  <td>
                    <span className={`badge badge-${b.kind === 'safety' ? 'cancelled' : 'active'}`}>
                      {KIND_LABEL[b.kind]}
                    </span>
                  </td>
                  <td>{formatSize(b.size)}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => pickBackup(b)}>
                      Restaurar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(b)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Acerca del sistema</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <div><strong>Sistema:</strong> Sistema de Actividades Complementarias</div>
          <div><strong>Versión:</strong> 1.0.0</div>
          <div><strong>Base de datos:</strong> SQLite (local, sin internet)</div>
          <div><strong>Carpeta de respaldos:</strong> {info?.folder ?? '—'}</div>
        </div>
      </div>

      {/* Confirmación de restauración */}
      {pending && (
        <div className="modal-overlay" onClick={() => setPending(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Confirmar restauración</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPending(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning">
                <div>
                  <strong style={{ display: 'block', marginBottom: 6, fontSize: 15 }}>
                    Se reemplazarán todos los datos actuales
                  </strong>
                  Antes de reemplazar se guarda automáticamente una copia del estado actual,
                  así que puedes volver atrás si te equivocas.
                </div>
              </div>

              <div style={{ fontSize: 13 }}>
                <strong>Archivo:</strong>{' '}
                <span style={{ fontFamily: 'monospace' }}>{pending.name}</span>
              </div>

              <div>
                <strong style={{ fontSize: 13 }}>Contenido que vas a recuperar:</strong>
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr><th>Dato</th><th>En el respaldo</th><th>Ahora</th></tr>
                  </thead>
                  <tbody>
                    {([
                      ['Estudiantes', 'students'],
                      ['Inscripciones', 'enrollments'],
                      ['Grupos', 'groups'],
                      ['Complementarias', 'complementaries'],
                      ['Calificaciones', 'evaluations'],
                    ] as const).map(([label, key]) => {
                      const from = pending.summary[key] as number
                      const now = (info?.summary?.[key] as number) ?? 0
                      const diff = from - now
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td><strong>{from}</strong></td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {now}
                            {diff !== 0 && (
                              <span style={{
                                marginLeft: 6, fontWeight: 600,
                                color: diff > 0 ? 'var(--success)' : 'var(--danger)',
                              }}>
                                ({diff > 0 ? '+' : ''}{diff})
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 13 }}>
                <strong>Periodos en el respaldo:</strong>{' '}
                {pending.summary.periods.join(', ') || '—'}
              </div>

              {(() => {
                const perdidas = (info?.summary?.enrollments ?? 0) - pending.summary.enrollments
                const califs = (info?.summary?.evaluations ?? 0) - pending.summary.evaluations
                if (perdidas > 0 || califs > 0) return (
                  <div className="alert alert-error">
                    Atención: este respaldo es más antiguo que tus datos actuales. Perderías{' '}
                    {perdidas > 0 && <strong>{perdidas} inscripción(es)</strong>}
                    {perdidas > 0 && califs > 0 && ' y '}
                    {califs > 0 && <strong>{califs} calificación(es)</strong>}.
                  </div>
                )
                return null
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPending(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmRestore}>
                Sí, restaurar este respaldo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
