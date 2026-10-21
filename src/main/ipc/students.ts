import { IpcMain } from 'electron'
import * as db from '../database/db'
import type {
  IpcResult, Student, StudentDTO, StudentHistory, StudentHistoryEntry,
} from '../../shared/types'
import { checkEnrollment } from '../../shared/enrollmentNumber'
import { resolveStudentEmail } from '../../shared/institutionalEmail'
import { scoreLabel, isPassing } from '../../shared/scores'
import { cleanText } from '../../shared/text'
import { logAudit } from '../session'

const STUDENT_SQL = `
  SELECT s.*, c.name AS career_name
  FROM students s
  JOIN careers c ON c.id = s.career_id
`

/**
 * Valida los datos del alumno antes de escribir en la base.
 *
 * Estas reglas también están en la pantalla de captura, pero se repiten aquí
 * porque la importación de archivos y cualquier otra vía escriben directo en la
 * base sin pasar por el formulario.
 */
function validateStudent(dto: StudentDTO): string | null {
  const chk = checkEnrollment(dto.enrollment_number)
  if (!chk.valid) return chk.error!

  if (!dto.first_name?.trim()) return 'El nombre es obligatorio'
  if (!dto.last_name?.trim()) return 'Los apellidos son obligatorios'

  if (dto.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email.trim()))
    return 'El correo electrónico no tiene un formato válido'

  const semester = Number(dto.semester)
  if (!Number.isInteger(semester) || semester < 1 || semester > 14)
    return 'El semestre debe ser un número entre 1 y 14'

  const career = db.get('SELECT id, code, name FROM careers WHERE id = ?', [dto.career_id]) as any
  if (!career) return 'La carrera seleccionada no existe'

  // Aviso, no bloqueo: la matrícula puede pertenecer a otra carrera por un
  // cambio interno o por planes viejos, pero conviene advertirlo.
  if (career.code !== chk.careerCode) {
    const real = db.get('SELECT name FROM careers WHERE code = ?', [chk.careerCode]) as any
    return real
      ? `La matrícula ${chk.clean} corresponde a ${real.name} (código ${chk.careerCode}), ` +
        `no a ${career.name}. Corrige la carrera o la matrícula.`
      : `El código ${chk.careerCode} de la matrícula ${chk.clean} no corresponde a ninguna ` +
        `carrera registrada. Da de alta esa carrera o revisa la matrícula.`
  }

  return null
}

export function registerStudentHandlers(ipcMain: IpcMain) {
  /** Deduce la carrera a partir de la matrícula, para autocompletar el formulario */
  ipcMain.handle('students:detectCareer', (_e, enrollmentNumber: string): IpcResult<{
    career_id: number | null
    career_name: string | null
    career_code: string
    entry_year: number | null
    warning: string | null
  }> => {
    try {
      const chk = checkEnrollment(enrollmentNumber)
      if (!chk.valid) {
        return { ok: true, data: { career_id: null, career_name: null, career_code: '', entry_year: null, warning: chk.error! } }
      }
      const career = db.get('SELECT id, name FROM careers WHERE code = ?', [chk.careerCode]) as any
      return {
        ok: true,
        data: {
          career_id: career?.id ?? null,
          career_name: career?.name ?? null,
          career_code: chk.careerCode!,
          entry_year: chk.entryYear!,
          warning: career ? null
            : `El código ${chk.careerCode} no corresponde a ninguna carrera registrada. ` +
              'Selecciona la carrera manualmente o agrégala en el catálogo.',
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('students:getAll', (_e, filters?: { search?: string; career_id?: number; status?: string }): IpcResult<Student[]> => {
    try {
      let sql = STUDENT_SQL
      const params: unknown[] = []
      const where: string[] = []
      if (filters?.search) {
        where.push('(s.enrollment_number LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.email LIKE ?)')
        const q = `%${filters.search}%`
        params.push(q, q, q, q)
      }
      if (filters?.career_id) { where.push('s.career_id = ?'); params.push(filters.career_id) }
      if (filters?.status) { where.push('s.status = ?'); params.push(filters.status) }
      if (where.length) sql += ' WHERE ' + where.join(' AND ')
      sql += ' ORDER BY s.last_name, s.first_name'
      return { ok: true, data: db.all(sql, params) as unknown as Student[] }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('students:getOne', (_e, id: number): IpcResult<Student> => {
    try {
      return { ok: true, data: db.get(STUDENT_SQL + ' WHERE s.id = ?', [id]) as unknown as Student }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('students:create', (_e, dto: StudentDTO): IpcResult<Student> => {
    try {
      const invalid = validateStudent(dto)
      if (invalid) return { ok: false, error: invalid }

      const clean = checkEnrollment(dto.enrollment_number).clean
      const email = resolveStudentEmail(clean, dto.email)
      const { lastInsertRowid } = db.run(
        `INSERT INTO students (enrollment_number, first_name, last_name, email, phone, career_id, semester, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [clean, dto.first_name.trim(), dto.last_name.trim(),
         email, cleanText(dto.phone), dto.career_id, dto.semester, dto.status]
      )
      return { ok: true, data: db.get(STUDENT_SQL + ' WHERE s.id = ?', [lastInsertRowid]) as unknown as Student }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'La matrícula ya está registrada' }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('students:update', (_e, id: number, dto: StudentDTO): IpcResult<Student> => {
    try {
      const invalid = validateStudent(dto)
      if (invalid) return { ok: false, error: invalid }

      const clean = checkEnrollment(dto.enrollment_number).clean
      const email = resolveStudentEmail(clean, dto.email)
      db.run(
        `UPDATE students SET enrollment_number=?, first_name=?, last_name=?, email=?,
         phone=?, career_id=?, semester=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
        [clean, dto.first_name.trim(), dto.last_name.trim(),
         email, cleanText(dto.phone), dto.career_id, dto.semester, dto.status, id]
      )
      return { ok: true, data: db.get(STUDENT_SQL + ' WHERE s.id = ?', [id]) as unknown as Student }
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return { ok: false, error: 'La matrícula ya está registrada' }
      return { ok: false, error: e.message }
    }
  })

  /**
   * Baja lógica del estudiante, arrastrando sus inscripciones vigentes.
   *
   * Antes solo marcaba al alumno como inactivo y sus inscripciones seguían
   * "Activas". El resultado era desconcertante: el alumno desaparecía de la
   * pantalla de Estudiantes (que filtra activos por omisión) pero seguía
   * apareciendo en Inscripciones, ocupando lugar en el grupo y contando en el
   * Reporte Final como inscrito no acreditado. Un alumno dado de baja inflando
   * el reporte oficial es un error que nadie nota hasta que ya se entregó.
   *
   * Las inscripciones con evaluación cerrada no se tocan: esa calificación ya
   * es definitiva y forma parte del historial, no es un lugar ocupado.
   */
  ipcMain.handle('students:delete', (_e, id: number): IpcResult<{
    cancelled: number
    kept: number
  }> => {
    try {
      const s = db.get(
        "SELECT enrollment_number, last_name || ' ' || first_name AS name, status FROM students WHERE id = ?",
        [id]
      ) as any
      if (!s) return { ok: false, error: 'El estudiante no existe' }
      if (s.status === 'inactive') return { ok: false, error: 'El estudiante ya está dado de baja' }

      const active = db.all(`
        SELECT e.id, ev.status AS ev_status,
               comp.name AS complementary_name, g.group_number, p.name AS period_name
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        JOIN complementaries comp ON comp.id = g.complementary_id
        JOIN school_periods p ON p.id = g.period_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.student_id = ? AND e.status = 'active'`, [id]) as any[]

      const toCancel = active.filter(r => r.ev_status !== 'closed')
      const kept = active.length - toCancel.length

      db.transaction(() => {
        db.run(`UPDATE students SET status='inactive', updated_at=datetime('now','localtime') WHERE id=?`, [id])

        for (const e of toCancel) {
          db.run(`
            UPDATE enrollments
               SET status = 'cancelled',
                   observations = TRIM(observations || ' | Baja del estudiante')
             WHERE id = ?`, [e.id])
        }
      })

      logAudit({
        action: 'student.deactivate', entity: 'student', entity_id: id,
        student_name: String(s.name), enrollment_number: String(s.enrollment_number),
        before_value: 'Activo', after_value: 'Inactivo',
        detail: `Baja lógica: se conserva el historial. ` +
          `Inscripciones dadas de baja: ${toCancel.length}` +
          (kept ? `. Se conservaron ${kept} con evaluación cerrada` : '') +
          (toCancel.length
            ? ` (${toCancel.map(e => `${e.complementary_name} ${e.group_number} · ${e.period_name}`).join(', ')})`
            : ''),
      })

      return { ok: true, data: { cancelled: toCancel.length, kept } }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Historial completo del estudiante.
   *
   * Evita tener que ir a Inscripciones, Evaluaciones y Grupos por separado para
   * responder algo tan común como "¿esta alumna ya cursó Fotografía?".
   */
  ipcMain.handle('students:history', (_e, id: number): IpcResult<StudentHistory> => {
    try {
      const s = db.get(`
        SELECT s.id, s.enrollment_number, s.semester, s.status, s.email, s.phone,
               s.last_name || ' ' || s.first_name AS full_name,
               c.name AS career_name
        FROM students s
        JOIN careers c ON c.id = s.career_id
        WHERE s.id = ?`, [id]) as any
      if (!s) return { ok: false, error: 'El estudiante no existe' }

      const rows = db.all(`
        SELECT e.id AS enrollment_id, e.enrolled_at, e.status AS enrollment_status,
               e.observations,
               p.name AS period_name, p.start_date,
               comp.name AS complementary_name,
               g.group_number, g.days, g.start_time, g.end_time,
               ev.score, ev.status AS evaluation_status,
               ev.observations AS evaluation_observations
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        JOIN complementaries comp ON comp.id = g.complementary_id
        JOIN school_periods p ON p.id = g.period_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.student_id = ?
        ORDER BY p.start_date DESC, comp.name`, [id]) as any[]

      let active = 0, cancelled = 0, evaluated = 0, passed = 0, failed = 0, sum = 0

      const entries: StudentHistoryEntry[] = rows.map(r => {
        const score = r.score === null || r.score === undefined ? null : Number(r.score)
        if (String(r.enrollment_status) === 'active') active++; else cancelled++
        if (score !== null) {
          evaluated++
          sum += score
          if (isPassing(score)) passed++; else failed++
        }
        return {
          enrollment_id: Number(r.enrollment_id),
          period_name: String(r.period_name),
          complementary_name: String(r.complementary_name),
          group_number: String(r.group_number),
          days: String(r.days ?? ''),
          schedule: r.start_time ? `${r.start_time} - ${r.end_time}` : '',
          enrolled_at: String(r.enrolled_at),
          enrollment_status: String(r.enrollment_status),
          score,
          score_label: scoreLabel(score),
          evaluation_status: r.evaluation_status ? String(r.evaluation_status) : null,
          observations: String(r.observations ?? ''),
          evaluation_observations: String(r.evaluation_observations ?? ''),
        }
      })

      return {
        ok: true,
        data: {
          student: {
            id: Number(s.id),
            enrollment_number: String(s.enrollment_number),
            full_name: String(s.full_name),
            career_name: String(s.career_name),
            semester: Number(s.semester),
            status: String(s.status),
            email: String(s.email ?? ''),
            phone: String(s.phone ?? ''),
          },
          entries,
          summary: {
            total: entries.length,
            active, cancelled, evaluated,
            pending: entries.length - evaluated,
            passed, failed,
            average: evaluated > 0 ? Math.round((sum / evaluated) * 100) / 100 : null,
          },
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
