import { IpcMain } from 'electron'
import * as db from '../database/db'
import type { IpcResult, Enrollment, EnrollmentDTO } from '../../shared/types'
import { scheduleConflict } from '../../shared/schedule'
import { logAudit } from '../session'

const ENROLLMENT_SQL = `
  SELECT e.*,
    s.first_name || ' ' || s.last_name AS student_name,
    s.enrollment_number,
    s.status AS student_status,
    c.name AS career_name,
    comp.name AS complementary_name,
    g.group_number,
    p.name AS period_name,
    g.classroom, g.days, g.start_time, g.end_time
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  JOIN careers c ON c.id = s.career_id
  JOIN groups g ON g.id = e.group_id
  JOIN complementaries comp ON comp.id = g.complementary_id
  JOIN school_periods p ON p.id = g.period_id
`

export function registerEnrollmentHandlers(ipcMain: IpcMain) {
  ipcMain.handle('enrollments:getAll', (_e, filters?: {
    period_id?: number; complementary_id?: number; career_id?: number; status?: string; search?: string
  }): IpcResult<Enrollment[]> => {
    try {
      let sql = ENROLLMENT_SQL
      const params: unknown[] = []
      const where: string[] = []
      if (filters?.period_id) { where.push('g.period_id = ?'); params.push(filters.period_id) }
      if (filters?.complementary_id) { where.push('g.complementary_id = ?'); params.push(filters.complementary_id) }
      if (filters?.career_id) { where.push('s.career_id = ?'); params.push(filters.career_id) }
      if (filters?.status) { where.push('e.status = ?'); params.push(filters.status) }
      if (filters?.search) {
        where.push('(s.enrollment_number LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ?)')
        const q = `%${filters.search}%`
        params.push(q, q, q)
      }
      if (where.length) sql += ' WHERE ' + where.join(' AND ')
      sql += ' ORDER BY e.enrolled_at DESC'
      return { ok: true, data: db.all(sql, params) as unknown as Enrollment[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('enrollments:byStudent', (_e, studentId: number): IpcResult<Enrollment[]> => {
    try {
      return { ok: true, data: db.all(ENROLLMENT_SQL + ' WHERE e.student_id = ? ORDER BY e.enrolled_at DESC', [studentId]) as unknown as Enrollment[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('enrollments:create', (_e, dto: EnrollmentDTO): IpcResult<Enrollment> => {
    try {
      // Verificar grupo activo
      const group = db.get("SELECT * FROM groups WHERE id = ? AND status = 'active'", [dto.group_id]) as any
      if (!group) return { ok: false, error: 'El grupo no existe o está inactivo' }

      // Verificar cupo
      const countRow = db.get("SELECT COUNT(*) as n FROM enrollments WHERE group_id = ? AND status = 'active'", [dto.group_id]) as any
      const count = Number(countRow?.n ?? 0)
      if (count >= Number(group.capacity))
        return { ok: false, error: `El grupo está lleno (cupo: ${group.capacity})` }

      // No se inscribe a alguien que está dado de baja: quedaría ocupando lugar
      // y contando en el Reporte Final sin ser alumno vigente.
      const student = db.get('SELECT status, first_name, last_name FROM students WHERE id = ?', [dto.student_id]) as any
      if (!student) return { ok: false, error: 'El estudiante no existe' }
      if (student.status !== 'active') {
        return {
          ok: false,
          error: `${student.first_name} ${student.last_name} está dado de baja. ` +
            `Reactívalo en Estudiantes antes de inscribirlo.`,
        }
      }

      // Verificar duplicado: no puede cursar la misma complementaria dos veces
      // a la vez, aunque sea en otro grupo. Sí puede cursar otras
      // complementarias, y sí puede repetirla en un periodo posterior.
      //
      // Se revisa el mismo periodo y también cualquier otro cuyas fechas se
      // cruzen con él, porque los periodos pueden traslaparse (un
      // intersemestral dentro del semestre regular). Sin esa segunda condición,
      // dos periodos que corren al mismo tiempo dejarían pasar al mismo alumno
      // dos veces a la misma clase.
      const dup = db.get(`
        SELECT comp.name AS complementary_name, g.group_number, p.name AS period_name,
               p.id = ? AS same_period
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        JOIN complementaries comp ON comp.id = g.complementary_id
        JOIN school_periods p ON p.id = g.period_id
        WHERE e.student_id = ?
          AND g.complementary_id = ?
          AND e.status = 'active'
          AND (
            p.id = ?
            OR (p.start_date <= (SELECT end_date   FROM school_periods WHERE id = ?)
            AND p.end_date   >= (SELECT start_date FROM school_periods WHERE id = ?))
          )
        LIMIT 1
      `, [
        group.period_id, dto.student_id, group.complementary_id,
        group.period_id, group.period_id, group.period_id,
      ]) as any
      if (dup) {
        return {
          ok: false,
          error: Number(dup.same_period)
            ? `El estudiante ya está inscrito en ${dup.complementary_name} (grupo ${dup.group_number}) en este periodo`
            : `El estudiante ya está inscrito en ${dup.complementary_name} (grupo ${dup.group_number}) ` +
              `en el periodo "${dup.period_name}", que se traslapa con este. ` +
              `Cancela esa inscripción o elige otra complementaria.`,
        }
      }

      // Verificar conflicto de horario.
      // Un choque real exige compartir día Y cruzarse en horas: dos grupos a las
      // 12:00, uno en lunes y otro en viernes, no se estorban.
      if (group.start_time && group.end_time) {
        const others = db.all(`
          SELECT comp.name AS complementary_name, g.group_number,
                 g.days, g.start_time, g.end_time
          FROM enrollments e
          JOIN groups g ON g.id = e.group_id
          JOIN complementaries comp ON comp.id = g.complementary_id
          WHERE e.student_id = ?
            AND g.period_id = ?
            AND e.status = 'active'
            AND g.id != ?
            AND g.start_time != ''
        `, [dto.student_id, group.period_id, dto.group_id]) as any[]

        for (const other of others) {
          const days = scheduleConflict(group, other)
          if (days.length) {
            return {
              ok: false,
              error: `Choca con ${other.complementary_name} (grupo ${other.group_number}) ` +
                `el día ${days.join(' y ')} de ${other.start_time} a ${other.end_time}`,
            }
          }
        }
      }

      const { lastInsertRowid } = db.run(
        'INSERT INTO enrollments (student_id, group_id, observations) VALUES (?, ?, ?)',
        [dto.student_id, dto.group_id, dto.observations ?? '']
      )
      const created = db.get(ENROLLMENT_SQL + ' WHERE e.id = ?', [lastInsertRowid]) as any

      logAudit({
        action: 'enrollment.create', entity: 'enrollment', entity_id: Number(lastInsertRowid),
        student_name: created?.student_name, enrollment_number: created?.enrollment_number,
        context: `${created?.complementary_name} · ${created?.group_number} · ${created?.period_name}`,
        after_value: 'Inscrito',
      })

      return { ok: true, data: created as Enrollment }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'El estudiante ya está inscrito en este grupo' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('enrollments:cancel', (_e, id: number, observations?: string): IpcResult => {
    try {
      const row = db.get(`
        SELECT e.status, e.observations, ev.status AS ev_status,
               s.first_name || ' ' || s.last_name AS name
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.id = ?`, [id]) as any

      if (!row) return { ok: false, error: 'La inscripción no existe' }
      if (row.status === 'cancelled') return { ok: false, error: 'La inscripción ya está dada de baja' }
      if (row.ev_status === 'closed')
        return {
          ok: false,
          error: `No se puede dar de baja a ${row.name}: su evaluación está cerrada. ` +
            'Reabre la evaluación del grupo primero.',
        }

      // Se agrega el motivo sin borrar lo que ya estaba anotado
      const reason = (observations ?? '').trim() || 'Baja solicitada'
      const previous = (row.observations ?? '').trim()
      const merged = previous && previous !== reason ? `${previous} | ${reason}` : reason

      db.run("UPDATE enrollments SET status='cancelled', observations=? WHERE id=?", [merged, id])

      logAudit({
        action: 'enrollment.cancel', entity: 'enrollment', entity_id: id,
        student_name: String(row.name),
        before_value: 'Inscrito', after_value: 'Baja',
        detail: reason,
      })

      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
