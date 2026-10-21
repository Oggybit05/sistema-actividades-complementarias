import { IpcMain } from 'electron'
import * as db from '../database/db'
import type { IpcResult, SchoolPeriod, PeriodDTO } from '../../shared/types'
import { createSafetyBackup } from './backup'
import { logAudit } from '../session'

/** Periodo con conteo de grupos e inscripciones */
const PERIOD_SQL = `
  SELECT p.*,
    (SELECT COUNT(*) FROM groups g WHERE g.period_id = p.id) AS group_count,
    (SELECT COUNT(*) FROM enrollments e
       JOIN groups g ON g.id = e.group_id
      WHERE g.period_id = p.id AND e.status = 'active') AS enrollment_count
  FROM school_periods p
`

export interface DuplicateOptions {
  source_period_id: number
  name: string
  start_date: string
  end_date: string
  is_active?: boolean
  /** Complementarias a incluir; vacío significa todas */
  complementary_ids?: number[]
  /** Cupo a aplicar a todos los grupos copiados; sin valor conserva el original */
  override_capacity?: number | null
  /** Copiar aula y horario del periodo origen */
  copy_schedule?: boolean
}

/**
 * Validación de un periodo.
 *
 * A propósito es mínima: se piden nombre y fechas, y nada más.
 *
 * - **No se exige duración.** Antes se pedía entre 1 y 13 meses, pero eso
 *   estorbaba para cursos intensivos, cursos de verano o periodos especiales de
 *   pocos días. Un periodo puede durar lo que la escuela decida, incluso un día.
 * - **Se permite que los periodos se traslapen.** Es lo normal en la práctica:
 *   un semestre regular puede coincidir con un intersemestral o con un curso a
 *   distancia. No genera ambigüedad porque una inscripción no se ubica por
 *   fecha: cada grupo guarda su `period_id`, y el panel toma el periodo marcado
 *   como activo, nunca el que "toque" según el calendario.
 *
 * Lo único que se sigue rechazando es el nombre repetido y una fecha de término
 * anterior a la de inicio, porque un rango invertido no es una decisión
 * académica sino un error de captura, y dejaría al periodo sin ningún día.
 */
function validatePeriod(dto: PeriodDTO, excludeId?: number): string | null {
  const name = dto.name?.trim() ?? ''
  if (!name) return 'El nombre del periodo es obligatorio'
  if (!dto.start_date) return 'La fecha de inicio es obligatoria'
  if (!dto.end_date) return 'La fecha de término es obligatoria'

  const start = new Date(dto.start_date)
  const end = new Date(dto.end_date)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Las fechas no son válidas'

  if (end < start)
    return 'La fecha de término no puede ser anterior a la de inicio'

  const dupName = db.get(
    'SELECT id FROM school_periods WHERE lower(name) = lower(?) AND id != ?',
    [name, excludeId ?? 0]
  )
  if (dupName) return `Ya existe un periodo llamado "${name}"`

  return null
}

export function registerPeriodHandlers(ipcMain: IpcMain) {

  ipcMain.handle('periods:getAll', (): IpcResult<SchoolPeriod[]> => {
    try {
      return {
        ok: true,
        data: db.all(`${PERIOD_SQL} ORDER BY p.start_date DESC`) as unknown as SchoolPeriod[],
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('periods:create', (_e, dto: PeriodDTO): IpcResult<SchoolPeriod> => {
    try {
      const invalid = validatePeriod(dto)
      if (invalid) return { ok: false, error: invalid }

      const { lastInsertRowid } = db.run(
        'INSERT INTO school_periods (name, start_date, end_date, is_active) VALUES (?, ?, ?, ?)',
        [dto.name.trim(), dto.start_date, dto.end_date, dto.is_active]
      )
      if (dto.is_active) {
        db.run('UPDATE school_periods SET is_active = 0 WHERE id != ?', [lastInsertRowid])
      }
      return { ok: true, data: db.get(`${PERIOD_SQL} WHERE p.id = ?`, [lastInsertRowid]) as unknown as SchoolPeriod }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'Ya existe un periodo con ese nombre' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('periods:update', (_e, id: number, dto: PeriodDTO): IpcResult<SchoolPeriod> => {
    try {
      const invalid = validatePeriod(dto, id)
      if (invalid) return { ok: false, error: invalid }

      db.run('UPDATE school_periods SET name = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
        [dto.name.trim(), dto.start_date, dto.end_date, dto.is_active, id])
      if (dto.is_active) {
        db.run('UPDATE school_periods SET is_active = 0 WHERE id != ?', [id])
      }
      return { ok: true, data: db.get(`${PERIOD_SQL} WHERE p.id = ?`, [id]) as unknown as SchoolPeriod }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('periods:setActive', (_e, id: number): IpcResult => {
    try {
      db.transaction(() => {
        db.run('UPDATE school_periods SET is_active = 0')
        db.run('UPDATE school_periods SET is_active = 1 WHERE id = ?', [id])
      })
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Qué se llevaría por delante el borrado de un periodo.
   *
   * Se consulta antes de preguntar para que la confirmación diga números
   * concretos en lugar de un "¿seguro?" a ciegas. Borrar un periodo con
   * calificaciones capturadas no se puede deshacer con un botón.
   */
  ipcMain.handle('periods:deletePreview', (_e, id: number): IpcResult => {
    try {
      const period = db.get('SELECT name, is_active FROM school_periods WHERE id = ?', [id]) as any
      if (!period) return { ok: false, error: 'El periodo no existe' }

      const n = (sql: string) => Number((db.get(sql, [id]) as any)?.n ?? 0)

      const groups = n('SELECT COUNT(*) AS n FROM groups WHERE period_id = ?')
      const enrollments = n(`
        SELECT COUNT(*) AS n FROM enrollments e
        JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?`)
      const evaluations = n(`
        SELECT COUNT(*) AS n FROM evaluations ev
        JOIN enrollments e ON e.id = ev.enrollment_id
        JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?`)
      const closed = n(`
        SELECT COUNT(*) AS n FROM evaluations ev
        JOIN enrollments e ON e.id = ev.enrollment_id
        JOIN groups g ON g.id = e.group_id
        WHERE g.period_id = ? AND ev.status = 'closed'`)
      const students = n(`
        SELECT COUNT(DISTINCT e.student_id) AS n FROM enrollments e
        JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?`)

      const byComplementary = db.all(`
        SELECT c.name, COUNT(g.id) AS groups
        FROM groups g JOIN complementaries c ON c.id = g.complementary_id
        WHERE g.period_id = ?
        GROUP BY c.name ORDER BY c.name`, [id])

      return {
        ok: true,
        data: {
          period_name: period.name,
          is_active: Number(period.is_active) === 1,
          groups, enrollments, evaluations, closed, students,
          by_complementary: byComplementary,
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Borra el periodo con todo lo que cuelga de él.
   *
   * Antes exigía vaciar el periodo grupo por grupo, lo que para un semestre con
   * veinte grupos significaba veinte confirmaciones y ninguna garantía de haber
   * terminado. Ahora se borra en cascada, en una sola transacción, y en el orden
   * que respeta las llaves foráneas: evaluaciones, inscripciones, grupos y al
   * final el periodo.
   *
   * Antes de tocar nada se guarda una copia `previo_` que aparece en la pantalla
   * de Respaldos, porque esto sí borra calificaciones de verdad y una equivocación
   * aquí no se arregla con "deshacer".
   */
  ipcMain.handle('periods:delete', (_e, id: number): IpcResult => {
    try {
      const period = db.get('SELECT name FROM school_periods WHERE id = ?', [id]) as any
      if (!period) return { ok: false, error: 'El periodo no existe' }

      const count = (sql: string) => Number((db.get(sql, [id]) as any)?.n ?? 0)
      const groups = count('SELECT COUNT(*) AS n FROM groups WHERE period_id = ?')
      const enrollments = count(`
        SELECT COUNT(*) AS n FROM enrollments e
        JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?`)
      const evaluations = count(`
        SELECT COUNT(*) AS n FROM evaluations ev
        JOIN enrollments e ON e.id = ev.enrollment_id
        JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?`)

      // Solo se respalda si de verdad hay algo que perder
      const backup = (groups || enrollments || evaluations) ? createSafetyBackup() : ''

      db.transaction(() => {
        db.run(`
          DELETE FROM evaluations WHERE enrollment_id IN (
            SELECT e.id FROM enrollments e
            JOIN groups g ON g.id = e.group_id WHERE g.period_id = ?)`, [id])

        db.run(`
          DELETE FROM enrollments WHERE group_id IN (
            SELECT id FROM groups WHERE period_id = ?)`, [id])

        db.run('DELETE FROM groups WHERE period_id = ?', [id])
        db.run('DELETE FROM school_periods WHERE id = ?', [id])
      })

      logAudit({
        action: 'period.delete', entity: 'period', entity_id: id,
        before_value: String(period.name),
        detail: `Periodo eliminado con ${groups} grupo(s), ${enrollments} inscripción(es) ` +
          `y ${evaluations} calificación(es)` +
          (backup ? `. Respaldo previo: ${backup}` : ''),
      })

      return {
        ok: true,
        data: { period_name: period.name, groups, enrollments, evaluations, backup },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // ─── Vista previa de lo que se copiaría ────────────────────────────────
  ipcMain.handle('periods:duplicatePreview', (_e, sourcePeriodId: number): IpcResult => {
    try {
      const rows = db.all(`
        SELECT c.id AS complementary_id, c.name AS complementary_name,
               COUNT(g.id) AS group_count,
               SUM(g.capacity) AS total_capacity
        FROM groups g
        JOIN complementaries c ON c.id = g.complementary_id
        WHERE g.period_id = ?
        GROUP BY c.id, c.name
        ORDER BY c.name
      `, [sourcePeriodId])

      const groups = db.all(`
        SELECT g.id, g.group_number, g.capacity, g.classroom, g.days,
               g.start_time, g.end_time, g.status,
               c.id AS complementary_id, c.name AS complementary_name
        FROM groups g
        JOIN complementaries c ON c.id = g.complementary_id
        WHERE g.period_id = ?
        ORDER BY c.name, g.group_number
      `, [sourcePeriodId])

      return { ok: true, data: { by_complementary: rows, groups } }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // ─── Duplicar periodo copiando la configuración de grupos ──────────────
  ipcMain.handle('periods:duplicate', (_e, opts: DuplicateOptions): IpcResult => {
    try {
      const name = opts.name?.trim()
      if (!name) return { ok: false, error: 'El nombre del nuevo periodo es obligatorio' }
      if (!opts.start_date || !opts.end_date) {
        return { ok: false, error: 'Las fechas de inicio y fin son obligatorias' }
      }
      if (opts.start_date > opts.end_date) {
        return { ok: false, error: 'La fecha de inicio no puede ser posterior a la de fin' }
      }

      const source = db.get('SELECT * FROM school_periods WHERE id = ?', [opts.source_period_id]) as any
      if (!source) return { ok: false, error: 'El periodo de origen no existe' }

      const exists = db.get('SELECT id FROM school_periods WHERE name = ?', [name])
      if (exists) return { ok: false, error: `Ya existe un periodo llamado "${name}"` }

      let newPeriodId = 0
      let copied = 0
      const skipped: string[] = []

      db.transaction(() => {
        const ins = db.run(
          'INSERT INTO school_periods (name, start_date, end_date, is_active) VALUES (?, ?, ?, ?)',
          [name, opts.start_date, opts.end_date, opts.is_active ? 1 : 0]
        )
        newPeriodId = ins.lastInsertRowid

        if (opts.is_active) {
          db.run('UPDATE school_periods SET is_active = 0 WHERE id != ?', [newPeriodId])
        }

        // Grupos del periodo origen, filtrados por complementaria si se indicó
        const filter = opts.complementary_ids?.length
          ? ` AND g.complementary_id IN (${opts.complementary_ids.map(() => '?').join(',')})`
          : ''
        const params: unknown[] = [opts.source_period_id, ...(opts.complementary_ids ?? [])]

        const groups = db.all(`
          SELECT g.*, c.name AS complementary_name, c.status AS complementary_status
          FROM groups g
          JOIN complementaries c ON c.id = g.complementary_id
          WHERE g.period_id = ?${filter}
          ORDER BY c.name, g.group_number
        `, params)

        for (const g of groups) {
          // No copiar grupos de complementarias dadas de baja
          if (g.complementary_status !== 'active') {
            skipped.push(`${g.complementary_name} - ${g.group_number} (complementaria inactiva)`)
            continue
          }

          const capacity = opts.override_capacity ?? g.capacity
          const keepSchedule = opts.copy_schedule !== false

          db.run(`
            INSERT INTO groups (complementary_id, period_id, group_number, capacity,
                                classroom, days, start_time, end_time, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
          `, [
            g.complementary_id, newPeriodId, g.group_number, capacity,
            keepSchedule ? g.classroom : '',
            keepSchedule ? g.days : '',
            keepSchedule ? g.start_time : '',
            keepSchedule ? g.end_time : '',
          ])
          copied++
        }
      })

      return {
        ok: true,
        data: {
          period_id: newPeriodId,
          period_name: name,
          source_name: source.name,
          groups_copied: copied,
          skipped,
        }
      }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) {
        return { ok: false, error: 'Se encontraron grupos duplicados al copiar' }
      }
      return { ok: false, error: e.message }
    }
  })
}
