import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BackupInfo } from '@shared/types'

/** Cada cuánto se vuelve a revisar el estado del respaldo mientras trabaja */
const RECHECK_MS = 10 * 60 * 1000

/** Clave para recordar que ya se pospuso el aviso en esta sesión */
const SNOOZE_KEY = 'backup_reminder_snoozed_at'

/**
 * Recordatorio de respaldo visible en todas las pantallas.
 *
 * Va en la barra superior y no dentro de Configuración a propósito: si el aviso
 * vive en la pantalla que ella casi nunca abre, no cumple su función. Las copias
 * automáticas están en el mismo disco, así que solo la copia manual protege de
 * que se descomponga esa computadora.
 */
export default function BackupReminder() {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [snoozed, setSnoozed] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    check()
    const t = setInterval(check, RECHECK_MS)
    return () => clearInterval(t)
  }, [])

  async function check() {
    const res = await window.api.getBackupInfo()
    if (res.ok) setInfo(res.data as BackupInfo)

    // Posponer dura hasta que cierre el programa, no para siempre
    const at = sessionStorage.getItem(SNOOZE_KEY)
    setSnoozed(!!at)
  }

  async function handleBackup() {
    setBusy(true)
    const res = await window.api.backupDatabase()
    setBusy(false)
    if (!res.ok) {
      if (res.error !== 'Operación cancelada') alert(res.error)
      return
    }
    const savedPath = res.data as string
    await check()
    if (window.confirm(
      `Respaldo guardado en:\n${savedPath}\n\n` +
      'Cópialo a una memoria USB o a la nube.\n\n¿Abrir la carpeta donde quedó?'
    )) {
      await window.api.revealBackupFile(savedPath)
    }
  }

  function handleSnooze() {
    sessionStorage.setItem(SNOOZE_KEY, new Date().toISOString())
    setSnoozed(true)
  }

  if (!info || !info.needs_manual_backup || snoozed) return null

  const reason = info.days_since_manual === null
    ? 'Todavía no has guardado ninguna copia fuera del programa.'
    : info.changes_since_manual >= 50
      ? `Llevas ${info.changes_since_manual} movimientos desde la última copia (hace ${info.days_since_manual} día(s)).`
      : `Tu última copia es de hace ${info.days_since_manual} día(s).`

  return (
    <div style={{
      background: '#fff8e1', borderBottom: '1px solid #ffe082',
      padding: '10px 24px', display: 'flex', alignItems: 'center',
      gap: 14, flexWrap: 'wrap', fontSize: 14,
    }}>
      <span style={{ fontSize: 18 }}>💾</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <strong>Conviene respaldar tu información.</strong>{' '}
        <span style={{ color: '#6d4c41' }}>{reason}</span>
      </div>
      <button className="btn btn-primary" onClick={handleBackup} disabled={busy}
        style={{ padding: '6px 16px', fontSize: 13 }}>
        {busy ? 'Guardando...' : 'Guardar copia ahora'}
      </button>
      <button className="btn" onClick={() => navigate('/settings')}
        style={{ padding: '6px 14px', fontSize: 13 }}>
        Ver respaldos
      </button>
      <button onClick={handleSnooze} title="Se volverá a mostrar la próxima vez que abras el programa"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#8d6e63', fontSize: 13, textDecoration: 'underline',
        }}>
        Ahora no
      </button>
    </div>
  )
}
