import { IpcMain } from 'electron'
import * as db from '../database/db'
import type { IpcResult, Career, CareerDTO } from '../../shared/types'

/**
 * El código de carrera son los dígitos 4 a 6 de la matrícula (AA3CCCXXX).
 * Si no son exactamente tres dígitos, la detección automática de carrera
 * dejaría de funcionar para todos los alumnos de esa carrera.
 */
function validateCareer(dto: CareerDTO): string | null {
  if (!dto.name?.trim()) return 'El nombre de la carrera es obligatorio'
  const code = dto.code?.trim() ?? ''
  if (!/^\d{3}$/.test(code))
    return 'El código debe ser de exactamente 3 dígitos, como aparece en la matrícula (ej. 107)'
  return null
}

export function registerCareerHandlers(ipcMain: IpcMain) {
  ipcMain.handle('careers:getAll', (): IpcResult<Career[]> => {
    try {
      return { ok: true, data: db.all('SELECT * FROM careers ORDER BY name') as unknown as Career[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('careers:create', (_e, dto: CareerDTO): IpcResult<Career> => {
    try {
      const invalid = validateCareer(dto)
      if (invalid) return { ok: false, error: invalid }

      const { lastInsertRowid } = db.run(
        'INSERT INTO careers (name, code, status) VALUES (?, ?, ?)',
        [dto.name.trim(), dto.code.trim(), dto.status ?? 'active']
      )
      return { ok: true, data: db.get('SELECT * FROM careers WHERE id = ?', [lastInsertRowid]) as unknown as Career }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'El código de carrera ya existe' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('careers:update', (_e, id: number, dto: CareerDTO): IpcResult<Career> => {
    try {
      const invalid = validateCareer(dto)
      if (invalid) return { ok: false, error: invalid }

      db.run('UPDATE careers SET name = ?, code = ?, status = ? WHERE id = ?',
        [dto.name.trim(), dto.code.trim(), dto.status ?? 'active', id])
      return { ok: true, data: db.get('SELECT * FROM careers WHERE id = ?', [id]) as unknown as Career }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'El código de carrera ya existe' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('careers:delete', (_e, id: number): IpcResult => {
    try {
      const used = db.get('SELECT COUNT(*) AS n FROM students WHERE career_id = ?', [id]) as any
      if (Number(used?.n ?? 0) > 0) {
        return {
          ok: false,
          error: `No se puede eliminar: ${used.n} estudiante(s) pertenecen a esta carrera. ` +
            'Si ya no se ofrece, cámbiale el estado a inactiva para conservar el historial.',
        }
      }
      db.run('DELETE FROM careers WHERE id = ?', [id])
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
