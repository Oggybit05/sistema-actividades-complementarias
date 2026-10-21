import { IpcMain } from 'electron'
import * as db from '../database/db'
import type { IpcResult, Complementary, ComplementaryDTO } from '../../shared/types'
import { cleanText } from '../../shared/text'

/** El nombre distingue la complementaria en reportes y actas; no puede repetirse */
function validateComplementary(dto: ComplementaryDTO, excludeId?: number): string | null {
  const name = dto.name?.trim() ?? ''
  if (!name) return 'El nombre de la complementaria es obligatorio'
  if (name.length < 3) return 'El nombre es demasiado corto'

  const dup = db.get(
    'SELECT id FROM complementaries WHERE lower(name) = lower(?) AND id != ?',
    [name, excludeId ?? 0]
  )
  if (dup) return `Ya existe una complementaria llamada "${name}"`

  return null
}

export function registerComplementaryHandlers(ipcMain: IpcMain) {
  ipcMain.handle('complementaries:getAll', (): IpcResult<Complementary[]> => {
    try {
      return { ok: true, data: db.all('SELECT * FROM complementaries ORDER BY name') as unknown as Complementary[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('complementaries:create', (_e, dto: ComplementaryDTO): IpcResult<Complementary> => {
    try {
      const invalid = validateComplementary(dto)
      if (invalid) return { ok: false, error: invalid }

      const { lastInsertRowid } = db.run(
        'INSERT INTO complementaries (name, description, status) VALUES (?, ?, ?)',
        [cleanText(dto.name), cleanText(dto.description), dto.status ?? 'active']
      )
      return { ok: true, data: db.get('SELECT * FROM complementaries WHERE id = ?', [lastInsertRowid]) as unknown as Complementary }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('complementaries:update', (_e, id: number, dto: ComplementaryDTO): IpcResult<Complementary> => {
    try {
      const invalid = validateComplementary(dto, id)
      if (invalid) return { ok: false, error: invalid }

      db.run('UPDATE complementaries SET name = ?, description = ?, status = ? WHERE id = ?',
        [cleanText(dto.name), cleanText(dto.description), dto.status ?? 'active', id])
      return { ok: true, data: db.get('SELECT * FROM complementaries WHERE id = ?', [id]) as unknown as Complementary }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('complementaries:delete', (_e, id: number): IpcResult => {
    try {
      const used = db.get('SELECT COUNT(*) AS n FROM groups WHERE complementary_id = ?', [id]) as any
      if (Number(used?.n ?? 0) > 0) {
        return {
          ok: false,
          error: `No se puede eliminar: tiene ${used.n} grupo(s) registrados. ` +
            'Si ya no se imparte, cámbiale el estado a inactiva para conservar el historial.',
        }
      }
      db.run('DELETE FROM complementaries WHERE id = ?', [id])
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
