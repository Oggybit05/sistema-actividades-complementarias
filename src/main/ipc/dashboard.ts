import { IpcMain } from 'electron'
import * as db from '../database/db'
import { PASSING_SCORE } from '../../shared/scores'
import type { IpcResult, DashboardSummary } from '../../shared/types'

/** A partir de este porcentaje de ocupación se considera que el grupo se va a llenar */
const NEARLY_FULL_RATIO = 0.8

export function registerDashboardHandlers(ipcMain: IpcMain) {
  /**
   * Devuelve todos los indicadores del panel en una sola consulta por métrica.
   *
   * Se calcula en SQL en lugar de traer las listas completas y contarlas en la
   * interfaz: con varios periodos acumulados eso significaría mover miles de
   * registros al renderer solo para mostrar un número.
   */
  ipcMain.handle('dashboard:summary', (_e, periodId?: number): IpcResult<DashboardSummary> => {
    try {
      // Periodo de referencia: el indicado, o el activo, o el más reciente
      const period = (periodId
        ? db.get('SELECT id, name, start_date, end_date FROM school_periods WHERE id = ?', [periodId])
        : db.get(`SELECT id, name, start_date, end_date FROM school_periods
                  ORDER BY is_active DESC, name DESC LIMIT 1`)) as any

      const periods = db.all(
        'SELECT id, name, is_active FROM school_periods ORDER BY name DESC') as any[]

      if (!period) {
        return {
          ok: true,
          data: {
            period: null, periods: [],
            students: 0, enrollments: 0, cancelled: 0, complementaries: 0, groups: 0,
            evaluated: 0, pending: 0, passed: 0, failed: 0,
            closed_groups: 0, total_capacity: 0, occupancy: 0,
            nearly_full: [], empty_groups: [], by_complementary: [],
          },
        }
      }

      const num = (row: any, key = 'n') => Number(row?.[key] ?? 0)

      // Estudiantes activos en el catálogo (no depende del periodo)
      const students = num(db.get("SELECT COUNT(*) AS n FROM students WHERE status = 'active'"))

      // Complementarias que tienen al menos un grupo activo en el periodo
      const complementaries = num(db.get(`
        SELECT COUNT(DISTINCT g.complementary_id) AS n
        FROM groups g
        JOIN complementaries c ON c.id = g.complementary_id
        WHERE g.period_id = ? AND g.status = 'active' AND c.status = 'active'`, [period.id]))

      const groupRow = db.get(`
        SELECT COUNT(*) AS n, COALESCE(SUM(capacity), 0) AS cap
        FROM groups WHERE period_id = ? AND status = 'active'`, [period.id]) as any

      // Inscripciones y estado de evaluación del periodo, en una pasada
      const e = db.get(`
        SELECT
          SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) AS activas,
          SUM(CASE WHEN e.status = 'cancelled' THEN 1 ELSE 0 END) AS bajas,
          SUM(CASE WHEN e.status = 'active' AND ev.score IS NOT NULL THEN 1 ELSE 0 END) AS evaluadas,
          SUM(CASE WHEN e.status = 'active' AND ev.score IS NULL THEN 1 ELSE 0 END) AS pendientes,
          SUM(CASE WHEN e.status = 'active' AND ev.score >= ${PASSING_SCORE} THEN 1 ELSE 0 END) AS aprobados,
          SUM(CASE WHEN e.status = 'active' AND ev.score IS NOT NULL AND ev.score < ${PASSING_SCORE} THEN 1 ELSE 0 END) AS reprobados,
          SUM(CASE WHEN e.status = 'active' AND ev.status = 'closed' THEN 1 ELSE 0 END) AS cerradas
        FROM enrollments e
        JOIN groups g ON g.id = e.group_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE g.period_id = ?`, [period.id]) as any

      // Ocupación por grupo, para detectar los que se llenan y los vacíos
      const groups = db.all(`
        SELECT g.id, g.group_number, g.capacity, c.name AS complementary_name,
               g.days, g.start_time, g.end_time,
               (SELECT COUNT(*) FROM enrollments x
                WHERE x.group_id = g.id AND x.status = 'active') AS enrolled
        FROM groups g
        JOIN complementaries c ON c.id = g.complementary_id
        WHERE g.period_id = ? AND g.status = 'active'
        ORDER BY c.name, g.group_number`, [period.id]) as any[]

      const withRatio = groups.map(g => ({
        id: Number(g.id),
        group_number: String(g.group_number),
        complementary_name: String(g.complementary_name),
        capacity: Number(g.capacity),
        enrolled: Number(g.enrolled),
        free: Number(g.capacity) - Number(g.enrolled),
        ratio: Number(g.capacity) > 0 ? Number(g.enrolled) / Number(g.capacity) : 0,
      }))

      const nearlyFull = withRatio
        .filter(g => g.ratio >= NEARLY_FULL_RATIO)
        .sort((a, b) => b.ratio - a.ratio)

      const emptyGroups = withRatio.filter(g => g.enrolled === 0)

      // Avance de captura por complementaria
      const byComplementary = db.all(`
        SELECT c.name AS complementary_name,
               COUNT(e.id) AS enrolled,
               SUM(CASE WHEN ev.score IS NOT NULL THEN 1 ELSE 0 END) AS evaluated,
               SUM(CASE WHEN ev.score >= ${PASSING_SCORE} THEN 1 ELSE 0 END) AS passed
        FROM groups g
        JOIN complementaries c ON c.id = g.complementary_id
        LEFT JOIN enrollments e ON e.group_id = g.id AND e.status = 'active'
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE g.period_id = ? AND g.status = 'active'
        GROUP BY c.id
        HAVING enrolled > 0
        ORDER BY c.name`, [period.id]) as any[]

      const activeEnrollments = num(e, 'activas')
      const totalCapacity = num(groupRow, 'cap')

      return {
        ok: true,
        data: {
          period: { id: Number(period.id), name: String(period.name) },
          periods: periods.map(p => ({
            id: Number(p.id), name: String(p.name), is_active: Number(p.is_active) === 1,
          })),
          students,
          enrollments: activeEnrollments,
          cancelled: num(e, 'bajas'),
          complementaries,
          groups: num(groupRow),
          evaluated: num(e, 'evaluadas'),
          pending: num(e, 'pendientes'),
          passed: num(e, 'aprobados'),
          failed: num(e, 'reprobados'),
          closed_groups: num(e, 'cerradas'),
          total_capacity: totalCapacity,
          occupancy: totalCapacity > 0
            ? Math.round((activeEnrollments / totalCapacity) * 100) : 0,
          nearly_full: nearlyFull,
          empty_groups: emptyGroups,
          by_complementary: byComplementary.map(r => ({
            complementary_name: String(r.complementary_name),
            enrolled: Number(r.enrolled),
            evaluated: Number(r.evaluated ?? 0),
            passed: Number(r.passed ?? 0),
          })),
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
