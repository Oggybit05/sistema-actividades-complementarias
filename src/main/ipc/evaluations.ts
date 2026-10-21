import { IpcMain } from 'electron'
import * as db from '../database/db'
import type { IpcResult } from '../../shared/types'
import { PASSING_SCORE, SCORE_SCALE, validateScore, scoreText } from '../../shared/scores'
import { logAudit, actorName } from '../session'

/** Datos del alumno para dejar constancia legible en la bitácora */
function auditContext(enrollmentId: number) {
  const r = db.get(`
    SELECT s.enrollment_number,
           s.last_name || ' ' || s.first_name AS student_name,
           comp.name AS complementary_name, g.group_number, p.name AS period_name,
           ev.score AS prev_score, ev.observations AS prev_obs, ev.status AS prev_status
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN groups g ON g.id = e.group_id
    JOIN complementaries comp ON comp.id = g.complementary_id
    JOIN school_periods p ON p.id = g.period_id
    LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
    WHERE e.id = ?`, [enrollmentId]) as any
  if (!r) return null
  return {
    student_name: String(r.student_name),
    enrollment_number: String(r.enrollment_number),
    context: `${r.complementary_name} · ${r.group_number} · ${r.period_name}`,
    prev_score: r.prev_score === null || r.prev_score === undefined ? null : Number(r.prev_score),
    prev_obs: String(r.prev_obs ?? ''),
    prev_status: r.prev_status ?? null,
  }
}

/** "3 (Notable)" o "sin calificar" */
function describe(score: number | null): string {
  return score === null || score === undefined ? 'sin calificar' : `${score} (${scoreText(score)})`
}

/** "Inteligencia Emocional · INTEMO-INT · 2026-1" */
function groupLabel(groupId: number): string {
  const r = db.get(`
    SELECT comp.name AS c, g.group_number AS g, p.name AS p
    FROM groups g
    JOIN complementaries comp ON comp.id = g.complementary_id
    JOIN school_periods p ON p.id = g.period_id
    WHERE g.id = ?`, [groupId]) as any
  return r ? `${r.c} · ${r.g} · ${r.p}` : `Grupo ${groupId}`
}

/** Guarda la calificación y deja constancia del antes y el después */
export function persistScore(enrollmentId: number, score: number, observations: string) {
  const prev = auditContext(enrollmentId)

  db.run(`
    INSERT INTO evaluations (enrollment_id, score, observations, updated_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(enrollment_id) DO UPDATE SET
      score = excluded.score,
      observations = excluded.observations,
      evaluated_at = datetime('now','localtime'),
      updated_by = excluded.updated_by,
      updated_at = datetime('now','localtime'),
      status = 'captured'
  `, [enrollmentId, score, observations, actorName()])

  if (!prev) return
  const isNew = prev.prev_score === null
  const changedScore = prev.prev_score !== score
  const changedObs = prev.prev_obs !== observations

  // No se registra cuando se guarda exactamente lo mismo
  if (!isNew && !changedScore && !changedObs) return

  logAudit({
    action: isNew ? 'evaluation.create' : 'evaluation.update',
    entity: 'evaluation',
    entity_id: enrollmentId,
    student_name: prev.student_name,
    enrollment_number: prev.enrollment_number,
    context: prev.context,
    before_value: describe(prev.prev_score),
    after_value: describe(score),
    detail: changedObs
      ? `Observaciones: "${prev.prev_obs || '—'}" → "${observations || '—'}"`
      : '',
  })
}

const BASE_QUERY = `
  SELECT
    e.id                AS enrollment_id,
    s.enrollment_number,
    s.last_name,
    s.first_name,
    s.last_name || ' ' || s.first_name AS student_name,
    c.name              AS career_name,
    comp.name           AS complementary_name,
    g.id                AS group_id,
    g.group_number,
    p.name              AS period_name,
    ev.id               AS evaluation_id,
    ev.score,
    ev.observations,
    ev.evaluated_at,
    ev.closed_by,
    ev.closed_at,
    COALESCE(ev.status, 'pending') AS status
  FROM enrollments e
  JOIN students s        ON s.id = e.student_id
  JOIN careers c         ON c.id = s.career_id
  JOIN groups g          ON g.id = e.group_id
  JOIN complementaries comp ON comp.id = g.complementary_id
  JOIN school_periods p  ON p.id = g.period_id
  LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
`

interface Filters {
  group_id?: number
  period_id?: number
  complementary_id?: number
}

function buildWhere(filters?: Filters) {
  const where = ["e.status = 'active'"]
  const params: unknown[] = []
  if (filters?.group_id) { where.push('g.id = ?'); params.push(filters.group_id) }
  if (filters?.period_id) { where.push('g.period_id = ?'); params.push(filters.period_id) }
  if (filters?.complementary_id) { where.push('g.complementary_id = ?'); params.push(filters.complementary_id) }
  return { clause: where.join(' AND '), params }
}

/** Verificar que la inscripción exista y que su evaluación no esté cerrada */
export function assertEditable(enrollmentId: number): string | null {
  const enr = db.get(
    "SELECT id FROM enrollments WHERE id = ? AND status = 'active'",
    [enrollmentId]
  )
  if (!enr) return 'La inscripción no existe o fue cancelada'

  const ev = db.get(
    'SELECT status FROM evaluations WHERE enrollment_id = ?',
    [enrollmentId]
  ) as any
  if (ev?.status === 'closed') {
    return 'La evaluación está cerrada. Reábrela para poder modificarla.'
  }
  return null
}

export function registerEvaluationHandlers(ipcMain: IpcMain) {

  // ─── Listado de estudiantes con su evaluación ──────────────────────────
  ipcMain.handle('evaluations:getAll', (_e, filters?: Filters): IpcResult => {
    try {
      const { clause, params } = buildWhere(filters)
      const rows = db.all(
        `${BASE_QUERY} WHERE ${clause} ORDER BY s.last_name, s.first_name`,
        params
      )
      return { ok: true, data: rows }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Estadísticas del grupo ────────────────────────────────────────────
  ipcMain.handle('evaluations:getStats', (_e, filters?: Filters): IpcResult => {
    try {
      const { clause, params } = buildWhere(filters)
      const row = db.get(`
        SELECT
          COUNT(*)                                                   AS total,
          SUM(CASE WHEN ev.id IS NOT NULL THEN 1 ELSE 0 END)         AS evaluated,
          SUM(CASE WHEN ev.id IS NULL THEN 1 ELSE 0 END)             AS pending,
          SUM(CASE WHEN ev.score >= ${PASSING_SCORE} THEN 1 ELSE 0 END) AS passed,
          SUM(CASE WHEN ev.score IS NOT NULL AND ev.score < ${PASSING_SCORE} THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN ev.status = 'closed' THEN 1 ELSE 0 END)      AS closed
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE ${clause}
      `, params) as any

      const total = Number(row?.total ?? 0)
      const evaluated = Number(row?.evaluated ?? 0)
      const passed = Number(row?.passed ?? 0)
      const failed = Number(row?.failed ?? 0)

      // Distribución por calificación 0..4
      const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
      const distRows = db.all(`
        SELECT ev.score, COUNT(*) AS n
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE ${clause}
        GROUP BY ev.score
      `, params)
      for (const r of distRows) dist[Number(r.score)] = Number(r.n)

      return {
        ok: true,
        data: {
          total,
          evaluated,
          pending: Number(row?.pending ?? 0),
          passed,
          failed,
          closed: Number(row?.closed ?? 0),
          pass_rate: evaluated > 0 ? Math.round((passed / evaluated) * 100) : 0,
          distribution: dist,
          passing_score: PASSING_SCORE,
          scale: SCORE_SCALE,
        }
      }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Guardar una evaluación ────────────────────────────────────────────
  ipcMain.handle('evaluations:save', (_e, data: {
    enrollment_id: number
    score: number
    observations?: string
  }): IpcResult => {
    try {
      const scoreError = validateScore(data.score)
      if (scoreError) return { ok: false, error: scoreError }

      const editError = assertEditable(data.enrollment_id)
      if (editError) return { ok: false, error: editError }

      persistScore(data.enrollment_id, data.score, data.observations ?? '')

      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Guardado en lote ──────────────────────────────────────────────────
  ipcMain.handle('evaluations:saveBatch', (_e, items: Array<{
    enrollment_id: number
    score: number | null
    observations?: string
  }>): IpcResult => {
    try {
      let saved = 0
      let skipped = 0
      const errors: string[] = []

      db.transaction(() => {
        for (const item of items) {
          // Sin calificación se deja pendiente, no es un error
          if (item.score === null || item.score === undefined) { skipped++; continue }

          const scoreError = validateScore(item.score)
          if (scoreError) { errors.push(`Inscripción ${item.enrollment_id}: ${scoreError}`); continue }

          const editError = assertEditable(item.enrollment_id)
          if (editError) { errors.push(`Inscripción ${item.enrollment_id}: ${editError}`); continue }

          persistScore(item.enrollment_id, item.score, item.observations ?? '')
          saved++
        }
      })

      return { ok: true, data: { saved, skipped, errors } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Limpiar una evaluación (volver a pendiente) ───────────────────────
  ipcMain.handle('evaluations:clear', (_e, enrollmentId: number): IpcResult => {
    try {
      const editError = assertEditable(enrollmentId)
      if (editError) return { ok: false, error: editError }

      const prev = auditContext(enrollmentId)
      db.run('DELETE FROM evaluations WHERE enrollment_id = ?', [enrollmentId])

      if (prev && prev.prev_score !== null) {
        logAudit({
          action: 'evaluation.clear', entity: 'evaluation', entity_id: enrollmentId,
          student_name: prev.student_name, enrollment_number: prev.enrollment_number,
          context: prev.context,
          before_value: describe(prev.prev_score),
          after_value: 'sin calificar',
          detail: 'Calificación eliminada, el alumno vuelve a pendiente',
        })
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Limpiar todas las calificaciones abiertas de un grupo ─────────────
  ipcMain.handle('evaluations:clearGroup', (_e, groupId: number): IpcResult => {
    try {
      if (!groupId) return { ok: false, error: 'Selecciona un grupo' }

      const rows = db.all(`
        SELECT e.id AS enrollment_id, ev.score, s.first_name, s.last_name,
               s.enrollment_number
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ? AND e.status = 'active' AND ev.id IS NOT NULL
              AND ev.status <> 'closed'
      `, [groupId]) as any[]

      db.transaction(() => {
        for (const row of rows) {
          const prev = auditContext(row.enrollment_id)
          db.run('DELETE FROM evaluations WHERE enrollment_id = ?', [row.enrollment_id])
          if (prev && prev.prev_score !== null) {
            logAudit({
              action: 'evaluation.clear', entity: 'evaluation', entity_id: row.enrollment_id,
              student_name: prev.student_name, enrollment_number: prev.enrollment_number,
              context: prev.context,
              before_value: describe(prev.prev_score),
              after_value: 'sin calificar',
              detail: 'Calificación del grupo eliminada antes de cerrar el acta',
            })
          }
        }
      })

      const closed = db.get(`
        SELECT COUNT(*) AS n
        FROM enrollments e
        JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ? AND ev.status = 'closed'
      `, [groupId]) as any

      return {
        ok: true,
        data: { cleared: rows.length, closed: Number(closed?.n ?? 0) },
      }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Vista previa antes de cerrar el acta ──────────────────────────────
  // Cerrar bloquea las calificaciones, así que conviene que vea exactamente
  // qué va a quedar firmado antes de confirmar.
  ipcMain.handle('evaluations:closePreview', (_e, groupId: number): IpcResult => {
    try {
      if (!groupId) return { ok: false, error: 'Selecciona un grupo' }

      const rows = db.all(`
        SELECT s.last_name || ' ' || s.first_name AS student_name,
               s.enrollment_number, ev.score, ev.status,
               ev.closed_by, ev.closed_at
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ? AND e.status = 'active'
        ORDER BY s.last_name, s.first_name`, [groupId]) as any[]

      let evaluated = 0, passed = 0, failed = 0, closed = 0, sum = 0
      const missing: string[] = []
      const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
      let closedBy = '', closedAt = ''

      for (const r of rows) {
        if (r.status === 'closed') {
          closed++
          // El acta se cierra de golpe, así que basta con la firma de cualquiera
          if (!closedBy && r.closed_by) { closedBy = r.closed_by; closedAt = r.closed_at ?? '' }
        }
        if (r.score === null || r.score === undefined) {
          missing.push(`${r.student_name} (${r.enrollment_number})`)
          continue
        }
        const score = Number(r.score)
        evaluated++
        sum += score
        dist[score] = (dist[score] ?? 0) + 1
        if (score >= PASSING_SCORE) passed++; else failed++
      }

      return {
        ok: true,
        data: {
          group: groupLabel(groupId),
          total: rows.length,
          evaluated,
          pending: missing.length,
          // Se recortan para que el aviso siga siendo legible en grupos grandes
          missing: missing.slice(0, 20),
          missing_extra: Math.max(0, missing.length - 20),
          passed, failed, closed,
          pass_rate: evaluated > 0 ? Math.round((passed / evaluated) * 100) : 0,
          average: evaluated > 0 ? Math.round((sum / evaluated) * 100) / 100 : null,
          distribution: dist,
          can_close: rows.length > 0 && missing.length === 0,
          already_closed: rows.length > 0 && closed === rows.length,
          closed_by: closedBy,
          closed_at: closedAt,
        },
      }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Cerrar evaluaciones de un grupo ───────────────────────────────────
  ipcMain.handle('evaluations:closeGroup', (_e, groupId: number): IpcResult => {
    try {
      if (!groupId) return { ok: false, error: 'Selecciona un grupo' }

      const pending = db.get(`
        SELECT COUNT(*) AS n
        FROM enrollments e
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ? AND e.status = 'active' AND ev.id IS NULL
      `, [groupId]) as any

      if (Number(pending?.n ?? 0) > 0) {
        return {
          ok: false,
          error: `Faltan ${pending.n} estudiante(s) por evaluar. Captura todas las calificaciones antes de cerrar.`,
        }
      }

      // Se firma el acta: queda escrito quién la cerró y cuándo, para poder
      // responder después quién autorizó esas calificaciones.
      const who = actorName()
      const when = new Date().toISOString()
      const res = db.run(`
        UPDATE evaluations SET status = 'closed', closed_by = ?, closed_at = ?
        WHERE enrollment_id IN (
          SELECT id FROM enrollments WHERE group_id = ? AND status = 'active'
        )
      `, [who, when, groupId])

      logAudit({
        action: 'evaluation.close_group', entity: 'group', entity_id: groupId,
        context: groupLabel(groupId),
        before_value: 'Acta abierta', after_value: 'Acta cerrada',
        detail: `${res.changes} calificación(es) protegidas contra cambios`,
      })

      return { ok: true, data: { closed: res.changes, closed_by: who, closed_at: when } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ─── Reabrir evaluaciones de un grupo ──────────────────────────────────
  ipcMain.handle('evaluations:reopenGroup', (_e, groupId: number): IpcResult => {
    try {
      if (!groupId) return { ok: false, error: 'Selecciona un grupo' }
      // Se limpia la firma: un acta reabierta ya no está firmada por nadie.
      // Quién la cerró y quién la reabrió queda en la bitácora.
      const res = db.run(`
        UPDATE evaluations SET status = 'captured', closed_by = '', closed_at = NULL
        WHERE enrollment_id IN (
          SELECT id FROM enrollments WHERE group_id = ? AND status = 'active'
        )
      `, [groupId])

      logAudit({
        action: 'evaluation.reopen_group', entity: 'group', entity_id: groupId,
        context: groupLabel(groupId),
        before_value: 'Acta cerrada', after_value: 'Acta abierta',
        detail: `${res.changes} calificación(es) quedan editables de nuevo`,
      })

      return { ok: true, data: { reopened: res.changes } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })
}
