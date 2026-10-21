import { IpcMain } from 'electron'
import bcrypt from 'bcryptjs'
import * as db from '../database/db'
import type { IpcResult, User } from '../../shared/types'
import { setCurrentUser, clearCurrentUser, logAudit, getCurrentUser } from '../session'

/** Contraseña con la que se entrega el sistema; no puede conservarse */
const DEFAULT_PASSWORD = 'admin123'
const MIN_LENGTH = 8

/** Reglas mínimas para que la contraseña no sea trivial */
function validatePassword(next: string, username: string): string | null {
  if (!next || next.length < MIN_LENGTH)
    return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres`
  if (next.toLowerCase() === DEFAULT_PASSWORD)
    return 'No puedes volver a usar la contraseña inicial'
  if (next.toLowerCase() === username.toLowerCase())
    return 'La contraseña no puede ser igual al nombre de usuario'
  if (!/[a-zA-Z]/.test(next) || !/[0-9]/.test(next))
    return 'La contraseña debe combinar letras y números'
  return null
}

export function registerAuthHandlers(ipcMain: IpcMain) {
  ipcMain.handle('auth:login', (_e, username: string, password: string): IpcResult<User> => {
    try {
      const row = db.get('SELECT * FROM users WHERE username = ?', [username]) as any
      if (!row) return { ok: false, error: 'Usuario no encontrado' }

      if (!bcrypt.compareSync(password, row.password_hash as string)) {
        // Se registra el intento fallido sin guardar la contraseña probada
        logAudit({
          action: 'auth.login_failed', entity: 'auth', entity_id: row.id,
          detail: `Intento fallido para el usuario ${username}`,
        })
        return { ok: false, error: 'Contraseña incorrecta' }
      }

      // Si sigue con la contraseña de fábrica se obliga a cambiarla, aunque la
      // bandera no esté marcada (bases creadas antes de esta versión).
      const isDefault = bcrypt.compareSync(DEFAULT_PASSWORD, row.password_hash as string)
      const mustChange = isDefault || Number(row.must_change_password) === 1

      db.run("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?", [row.id])

      const { password_hash, ...rest } = row
      const user = {
        ...rest,
        must_change_password: mustChange ? 1 : 0,
      } as unknown as User

      setCurrentUser({ id: row.id, username: row.username, full_name: row.full_name })
      logAudit({
        action: 'auth.login', entity: 'auth', entity_id: row.id,
        detail: mustChange ? 'Acceso con contraseña inicial pendiente de cambio' : 'Acceso correcto',
      })

      return { ok: true, data: user }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('auth:logout', (_e, reason?: string): IpcResult => {
    try {
      const u = getCurrentUser()
      if (u) {
        logAudit({
          action: 'auth.logout', entity: 'auth', entity_id: u.id,
          detail: reason === 'idle'
            ? 'Sesión cerrada automáticamente por inactividad'
            : 'Sesión cerrada por el usuario',
        })
      }
      clearCurrentUser()
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle(
    'auth:changePassword',
    (_e, current: string, next: string): IpcResult => {
      try {
        // Se toma el usuario de la sesión activa, no un nombre fijo: si mañana
        // se agrega otra cuenta, cada quien cambia su propia contraseña.
        const session = getCurrentUser()
        const row = session
          ? db.get('SELECT * FROM users WHERE id = ?', [session.id]) as any
          : db.get('SELECT * FROM users WHERE username = ?', ['admin']) as any
        if (!row) return { ok: false, error: 'Usuario no encontrado' }

        if (!bcrypt.compareSync(current, row.password_hash as string))
          return { ok: false, error: 'Contraseña actual incorrecta' }

        if (bcrypt.compareSync(next, row.password_hash as string))
          return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual' }

        const invalid = validatePassword(next, row.username)
        if (invalid) return { ok: false, error: invalid }

        const hash = bcrypt.hashSync(next, 10)
        db.run(
          `UPDATE users SET password_hash = ?, must_change_password = 0,
           updated_at = datetime('now','localtime') WHERE id = ?`,
          [hash, row.id]
        )

        // Nunca se guarda la contraseña, solo el hecho del cambio
        logAudit({
          action: 'auth.password_changed', entity: 'auth', entity_id: row.id,
          detail: 'Contraseña actualizada',
        })

        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    }
  )
}
