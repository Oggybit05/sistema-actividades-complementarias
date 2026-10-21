import { IpcMain } from 'electron'
import * as db from '../database/db'
import type {
  IpcResult, Group, GroupDTO, GroupRoster, RosterEntry,
  RemoveStudentsDTO, RemoveStudentsResult,
} from '../../shared/types'
import { checkTimeRange, parseDays, WEEK_DAYS } from '../../shared/schedule'
import { cleanText } from '../../shared/text'

const VALID_DAYS = new Set<string>(WEEK_DAYS.map(d =>
  d.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))

/**
 * Valida un grupo antes de guardarlo. Al actualizar se pasa `excludeId` para
 * que el propio grupo no cuente como duplicado de sí mismo.
 */
function validateGroup(dto: GroupDTO, excludeId?: number): string | null {
  const number = dto.group_number?.trim()
  if (!number) return 'El número o clave del grupo es obligatorio'

  const capacity = Number(dto.capacity)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)
    return 'El cupo debe ser un número entre 1 y 500'

  const comp = db.get('SELECT id, name FROM complementaries WHERE id = ?', [dto.complementary_id]) as any
  if (!comp) return 'La complementaria seleccionada no existe'

  const period = db.get('SELECT id, name FROM school_periods WHERE id = ?', [dto.period_id]) as any
  if (!period) return 'El periodo seleccionado no existe'

  const timeError = checkTimeRange(dto.start_time, dto.end_time)
  if (timeError) return timeError

  // Días válidos
  for (const d of parseDays(dto.days)) {
    if (!VALID_DAYS.has(d)) return `"${d}" no es un día de la semana válido`
  }

  // Grupo duplicado: misma complementaria, mismo periodo, misma clave
  const dup = db.get(
    `SELECT id FROM groups
     WHERE complementary_id = ? AND period_id = ? AND group_number = ?
       ${excludeId ? 'AND id != ?' : ''}`,
    excludeId
      ? [dto.complementary_id, dto.period_id, number, excludeId]
      : [dto.complementary_id, dto.period_id, number]) as any
  if (dup)
    return `Ya existe el grupo "${number}" en ${comp.name} para el periodo ${period.name}`

  return null
}

const GROUP_SQL = `
  SELECT g.*,
    c.name AS complementary_name,
    p.name AS period_name,
    (SELECT COUNT(*) FROM enrollments e WHERE e.group_id = g.id AND e.status = 'active') AS enrolled_count
  FROM groups g
  JOIN complementaries c ON c.id = g.complementary_id
  JOIN school_periods p ON p.id = g.period_id
`

export function registerGroupHandlers(ipcMain: IpcMain) {
  ipcMain.handle('groups:getAll', (_e, filters?: { period_id?: number; complementary_id?: number }): IpcResult<Group[]> => {
    try {
      let sql = GROUP_SQL
      const params: unknown[] = []
      const where: string[] = []
      if (filters?.period_id) { where.push('g.period_id = ?'); params.push(filters.period_id) }
      if (filters?.complementary_id) { where.push('g.complementary_id = ?'); params.push(filters.complementary_id) }
      if (where.length) sql += ' WHERE ' + where.join(' AND ')
      sql += ' ORDER BY c.name, g.group_number'
      return { ok: true, data: db.all(sql, params) as unknown as Group[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('groups:create', (_e, dto: GroupDTO): IpcResult<Group> => {
    try {
      const invalid = validateGroup(dto)
      if (invalid) return { ok: false, error: invalid }

      const { lastInsertRowid } = db.run(
        `INSERT INTO groups (complementary_id, period_id, group_number, capacity, classroom, days, start_time, end_time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dto.complementary_id, dto.period_id, cleanText(dto.group_number), dto.capacity,
         cleanText(dto.classroom), cleanText(dto.days), dto.start_time, dto.end_time, dto.status]
      )
      return { ok: true, data: db.get(GROUP_SQL + ' WHERE g.id = ?', [lastInsertRowid]) as unknown as Group }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'Ya existe un grupo con ese número en esta complementaria y periodo' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('groups:update', (_e, id: number, dto: GroupDTO): IpcResult<Group> => {
    try {
      const invalid = validateGroup(dto, id)
      if (invalid) return { ok: false, error: invalid }

      // El cupo nuevo no puede quedar por debajo de los alumnos ya inscritos
      const enrolled = Number((db.get(
        "SELECT COUNT(*) AS n FROM enrollments WHERE group_id = ? AND status = 'active'",
        [id]) as any)?.n ?? 0)
      if (Number(dto.capacity) < enrolled)
        return {
          ok: false,
          error: `El cupo no puede ser menor a los ${enrolled} alumnos ya inscritos en el grupo`,
        }

      db.run(
        `UPDATE groups SET complementary_id=?, period_id=?, group_number=?, capacity=?,
         classroom=?, days=?, start_time=?, end_time=?, status=? WHERE id=?`,
        [dto.complementary_id, dto.period_id, cleanText(dto.group_number), dto.capacity,
         cleanText(dto.classroom), cleanText(dto.days), dto.start_time, dto.end_time, dto.status, id]
      )
      return { ok: true, data: db.get(GROUP_SQL + ' WHERE g.id = ?', [id]) as unknown as Group }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'Ya existe un grupo con ese número en esta complementaria y periodo' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('groups:delete', (_e, id: number): IpcResult => {
    try {
      const row = db.get(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
         FROM enrollments WHERE group_id = ?`, [id]) as any
      const total = Number(row?.total ?? 0)
      if (total > 0) {
        const active = Number(row?.active ?? 0)
        return {
          ok: false,
          error: `No se puede eliminar el grupo: tiene ${total} inscripción(es)` +
            (active ? `, ${active} de ellas activas` : '') +
            '. Quita primero a los alumnos desde el botón "Alumnos".',
        }
      }
      db.run('DELETE FROM groups WHERE id = ?', [id])
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // ─── Lista de alumnos del grupo ─────────────────────────────────────────────

  ipcMain.handle('groups:roster', (_e, groupId: number): IpcResult<GroupRoster> => {
    try {
      const group = db.get(GROUP_SQL + ' WHERE g.id = ?', [groupId]) as unknown as Group
      if (!group) return { ok: false, error: 'El grupo no existe' }

      const students = db.all(`
        SELECT
          e.id            AS enrollment_id,
          e.student_id    AS student_id,
          s.enrollment_number,
          s.first_name || ' ' || s.last_name AS student_name,
          c.name          AS career_name,
          e.enrolled_at,
          e.status,
          e.observations,
          ev.score        AS score,
          ev.status       AS evaluation_status
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN careers c ON c.id = s.career_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ?
        ORDER BY s.last_name, s.first_name
      `, [groupId]) as unknown as RosterEntry[]

      return {
        ok: true,
        data: {
          group,
          students,
          active_count: students.filter(s => s.status === 'active').length,
          cancelled_count: students.filter(s => s.status === 'cancelled').length,
          graded_count: students.filter(s => s.score !== null && s.score !== undefined).length,
          closed_count: students.filter(s => s.evaluation_status === 'closed').length,
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Quita alumnos de un grupo.
   *  - mode 'cancel': baja lógica, conserva el historial y la calificación.
   *  - mode 'delete': borra la inscripción y su calificación de forma definitiva.
   * Las evaluaciones cerradas se rechazan: primero hay que reabrir el grupo.
   */
  ipcMain.handle('groups:removeStudents', (_e, dto: RemoveStudentsDTO): IpcResult<RemoveStudentsResult> => {
    try {
      const ids = Array.isArray(dto?.enrollment_ids)
        ? [...new Set(dto.enrollment_ids.map(Number).filter(Number.isInteger))]
        : []
      if (!ids.length) return { ok: false, error: 'No se seleccionó ningún alumno' }
      if (dto.mode !== 'cancel' && dto.mode !== 'delete')
        return { ok: false, error: 'Operación no válida' }

      const ph = ids.map(() => '?').join(',')

      // Todas las inscripciones deben pertenecer al grupo indicado
      const rows = db.all(`
        SELECT e.id, e.status, ev.score, ev.status AS ev_status,
               s.first_name || ' ' || s.last_name AS name
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.id IN (${ph}) AND e.group_id = ?
      `, [...ids, dto.group_id]) as any[]

      if (rows.length !== ids.length) {
        // Distinguir "ya no existen" de "son de otro grupo" para no confundir
        const found = new Set(rows.map(r => Number(r.id)))
        const missing = ids.filter(i => !found.has(i))
        const elsewhere = db.all(
          `SELECT id FROM enrollments WHERE id IN (${missing.map(() => '?').join(',')})`,
          missing) as any[]

        if (elsewhere.length === 0) {
          return {
            ok: false,
            error: `${missing.length} de los alumnos seleccionados ya no están en este grupo. ` +
              'Es probable que la operación ya se haya realizado; la lista se acaba de actualizar.',
          }
        }
        return {
          ok: false,
          error: `${elsewhere.length} inscripción(es) pertenecen a otro grupo. Vuelve a abrir la lista.`,
        }
      }

      const closed = rows.filter(r => r.ev_status === 'closed')
      if (closed.length) {
        return {
          ok: false,
          error: `No se puede modificar: ${closed.length} alumno(s) tienen la evaluación cerrada ` +
            `(${closed.slice(0, 3).map(r => r.name).join(', ')}` +
            `${closed.length > 3 ? '…' : ''}). Reabre la evaluación del grupo primero.`,
        }
      }

      const scoresRemoved = rows.filter(r => r.score !== null && r.score !== undefined).length
      let affected = 0

      db.transaction(() => {
        if (dto.mode === 'delete') {
          db.run(`DELETE FROM evaluations WHERE enrollment_id IN (${ph})`, ids)
          const res = db.run(`DELETE FROM enrollments WHERE id IN (${ph})`, ids)
          affected = res.changes
        } else {
          const reason = (dto.reason ?? '').trim() || 'Baja del grupo'
          const res = db.run(
            `UPDATE enrollments SET status = 'cancelled', observations = ?
             WHERE id IN (${ph}) AND status = 'active'`, [reason, ...ids])
          affected = res.changes
        }
      })

      return {
        ok: true,
        data: {
          mode: dto.mode,
          affected,
          scores_removed: dto.mode === 'delete' ? scoresRemoved : 0,
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /** Reactiva una inscripción dada de baja, validando cupo */
  ipcMain.handle('groups:restoreStudent', (_e, enrollmentId: number): IpcResult => {
    try {
      const row = db.get(`
        SELECT e.group_id, e.status, g.capacity,
               (SELECT COUNT(*) FROM enrollments x WHERE x.group_id = e.group_id AND x.status = 'active') AS enrolled
        FROM enrollments e JOIN groups g ON g.id = e.group_id
        WHERE e.id = ?`, [enrollmentId]) as any
      if (!row) return { ok: false, error: 'La inscripción no existe' }
      if (row.status === 'active') return { ok: false, error: 'La inscripción ya está activa' }
      if (Number(row.enrolled) >= Number(row.capacity))
        return { ok: false, error: `El grupo está lleno (cupo: ${row.capacity})` }

      db.run("UPDATE enrollments SET status = 'active', observations = '' WHERE id = ?", [enrollmentId])
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
