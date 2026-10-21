import { IpcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'
import * as db from '../database/db'
import type { IpcResult, ReportFilters, ReportKind, AppSettings } from '../../shared/types'
import { SCORE_SCALE, scoreLabel } from '../../shared/scores'
import { readSettings, readLogoDataUrl } from './settings'
import ExcelJS from 'exceljs'

const REPORT_SQL = `
  SELECT
    s.enrollment_number AS matricula,
    s.last_name || ' ' || s.first_name AS estudiante,
    c.name AS carrera,
    s.semester AS semestre,
    comp.name AS complementaria,
    g.group_number AS grupo,
    p.name AS periodo,
    g.classroom AS aula,
    g.days AS dias,
    CASE WHEN g.start_time = '' THEN ''
         ELSE g.start_time || ' - ' || g.end_time END AS horario,
    e.enrolled_at AS fecha_inscripcion,
    e.status AS estado,
    e.observations AS observaciones,
    ev.score AS calificacion,
    ev.status AS estado_acta,
    ev.closed_by AS cerrada_por,
    ev.closed_at AS fecha_cierre,
    ev.updated_by AS capturado_por,
    ev.evaluated_at AS fecha_evaluacion,
    ev.observations AS observaciones_evaluacion
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  JOIN careers c ON c.id = s.career_id
  JOIN groups g ON g.id = e.group_id
  JOIN complementaries comp ON comp.id = g.complementary_id
  JOIN school_periods p ON p.id = g.period_id
  LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
`

const KIND_TITLE: Record<ReportKind, string> = {
  enrollments: 'Listado de inscritos',
  evaluations: 'Inscritos y calificaciones',
  final: 'Calificaciones finales',
  closed: 'Actas cerradas',
}

/** Nombre de archivo por tipo de reporte */
const KIND_FILE: Record<ReportKind, string> = {
  enrollments: 'inscritos',
  evaluations: 'evaluaciones',
  final: 'calificaciones_finales',
  closed: 'actas_cerradas',
}

function buildQuery(filters: ReportFilters) {
  const params: unknown[] = []
  const where: string[] = []
  const kind: ReportKind = filters.kind ?? 'evaluations'

  if (filters.period_id) { where.push('g.period_id = ?'); params.push(filters.period_id) }
  if (filters.complementary_id) { where.push('g.complementary_id = ?'); params.push(filters.complementary_id) }
  if (filters.career_id) { where.push('s.career_id = ?'); params.push(filters.career_id) }
  if (filters.group_id) { where.push('g.id = ?'); params.push(filters.group_id) }
  if (filters.status) { where.push('e.status = ?'); params.push(filters.status) }

  // Cada tipo de reporte responde a una pregunta distinta
  if (kind === 'final') where.push('ev.score IS NOT NULL')
  if (kind === 'closed') where.push("ev.status = 'closed'")
  if (kind === 'enrollments' && !filters.status) where.push("e.status = 'active'")

  let sql = REPORT_SQL
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY p.name, comp.name, g.group_number, s.last_name, s.first_name'
  return { sql, params, kind }
}

interface Summary {
  total: number
  evaluated: number
  pending: number
  passed: number
  failed: number
  cancelled: number
  pass_rate: number
  average: number | null
  distribution: Record<number, number>
}

/** Resumen calculado sobre las filas ya filtradas, para que siempre coincida */
function summarize(rows: Record<string, unknown>[], passingScore: number): Summary {
  const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  let evaluated = 0, passed = 0, failed = 0, cancelled = 0, sum = 0

  for (const r of rows) {
    if (String(r.estado) === 'cancelled') cancelled++
    const raw = r.calificacion
    if (raw === null || raw === undefined) continue
    const score = Number(raw)
    evaluated++
    sum += score
    dist[score] = (dist[score] ?? 0) + 1
    if (score >= passingScore) passed++; else failed++
  }

  return {
    total: rows.length,
    evaluated,
    pending: rows.length - evaluated,
    passed, failed, cancelled,
    pass_rate: evaluated > 0 ? Math.round((passed / evaluated) * 100) : 0,
    average: evaluated > 0 ? Math.round((sum / evaluated) * 100) / 100 : null,
    distribution: dist,
  }
}

/** Descripción de los filtros aplicados, para que el reporte se explique solo */
function describeFilters(filters: ReportFilters): string[] {
  const parts: string[] = []
  const name = (sql: string, id: number) => {
    const r = db.get(sql, [id]) as any
    return r ? String(r.name) : ''
  }

  if (filters.period_id) {
    const v = name('SELECT name FROM school_periods WHERE id = ?', filters.period_id)
    if (v) parts.push(`Periodo: ${v}`)
  }
  if (filters.complementary_id) {
    const v = name('SELECT name FROM complementaries WHERE id = ?', filters.complementary_id)
    if (v) parts.push(`Complementaria: ${v}`)
  }
  if (filters.group_id) {
    const v = name('SELECT group_number AS name FROM groups WHERE id = ?', filters.group_id)
    if (v) parts.push(`Grupo: ${v}`)
  }
  if (filters.career_id) {
    const v = name('SELECT name FROM careers WHERE id = ?', filters.career_id)
    if (v) parts.push(`Carrera: ${v}`)
  }
  if (filters.status) {
    parts.push(`Estado: ${filters.status === 'active' ? 'Inscrito' : 'Baja'}`)
  }
  if (!parts.length) parts.push('Sin filtros: se incluye toda la información registrada')
  return parts
}

/**
 * Carpeta destino: la que se configuró, o Descargas si no hay ninguna.
 *
 * Si la carpeta configurada no existe se intenta crearla antes de rendirse.
 * Es lo que pasa cuando alguien la borra, la renombra o la tenía en una USB:
 * caer en Descargas sin avisar hacía que el reporte "no apareciera" donde se
 * esperaba. Descargas queda solo como último recurso, porque siempre existe y
 * es preferible a no exportar nada.
 */
export function outputFolder(settings: AppSettings): string {
  const folder = settings.reports_folder?.trim()
  if (folder) {
    try {
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
      return folder
    } catch {
      // Unidad desconectada o sin permisos de escritura
    }
  }
  return app.getPath('downloads')
}

/** Sello legible para el nombre del archivo: 2026-08-05_2314 */
export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

const ESTADO_TEXT: Record<string, string> = {
  active: 'Inscrito',
  cancelled: 'Baja',
}

const ACTA_TEXT: Record<string, string> = {
  captured: 'Capturada',
  closed: 'Cerrada',
}

export function registerReportHandlers(ipcMain: IpcMain) {

  ipcMain.handle('reports:exportExcel', async (_e, filters: ReportFilters): Promise<IpcResult<string>> => {
    try {
      const settings = readSettings()
      const { sql, params, kind } = buildQuery(filters)
      const rows = db.all(sql, params)
      if (!rows.length) return { ok: false, error: 'No hay información que coincida con los filtros' }

      const summary = summarize(rows, settings.passing_score)
      const withScores = kind !== 'enrollments'

      const wb = new ExcelJS.Workbook()
      wb.creator = settings.teacher_name || 'Sistema de Actividades Complementarias'
      wb.created = new Date()

      // ── Hoja 1: detalle ────────────────────────────────────────────────
      const ws = wb.addWorksheet(KIND_TITLE[kind].substring(0, 31))

      const columns: Partial<ExcelJS.Column>[] = [
        { header: 'No. de Control', key: 'matricula', width: 15 },
        { header: 'Estudiante', key: 'estudiante', width: 32 },
        { header: 'Carrera', key: 'carrera', width: 32 },
        { header: 'Sem.', key: 'semestre', width: 6 },
        { header: 'Complementaria', key: 'complementaria', width: 26 },
        { header: 'Grupo', key: 'grupo', width: 12 },
        { header: 'Periodo', key: 'periodo', width: 12 },
        { header: 'Días', key: 'dias', width: 18 },
        { header: 'Horario', key: 'horario', width: 14 },
      ]

      if (withScores) {
        columns.push(
          { header: 'Calificación', key: 'calificacion', width: 12 },
          { header: 'Nivel', key: 'nivel', width: 14 },
          { header: 'Resultado', key: 'resultado', width: 14 },
          { header: 'Acta', key: 'acta', width: 12 },
          { header: 'Capturó', key: 'capturado_por', width: 22 },
          { header: 'Cerró el acta', key: 'cerrada_por', width: 22 },
          { header: 'Fecha de cierre', key: 'cierre_texto', width: 18 },
        )
      }

      columns.push(
        { header: 'Estado', key: 'estado_texto', width: 11 },
        { header: 'Observaciones', key: 'observaciones_final', width: 34 },
      )
      ws.columns = columns

      // Encabezado institucional sobre la tabla
      const headerLines = [
        settings.institution_name,
        settings.department_name,
        `${KIND_TITLE[kind]} — Docente: ${settings.teacher_name}`,
        describeFilters(filters).join('  |  '),
        `Generado: ${new Date().toLocaleString('es-MX')}`,
      ].filter(Boolean)

      ws.spliceRows(1, 0, ...headerLines.map(() => []))
      headerLines.forEach((line, i) => {
        const row = ws.getRow(i + 1)
        ws.mergeCells(i + 1, 1, i + 1, columns.length)
        row.getCell(1).value = line
        row.getCell(1).font = { bold: i < 2, size: i === 0 ? 13 : 11 }
        row.getCell(1).alignment = { horizontal: 'center' }
      })

      const headerRowIndex = headerLines.length + 1
      const headerRow = ws.getRow(headerRowIndex)
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      })

      for (const r of rows) {
        const score = r.calificacion === null || r.calificacion === undefined
          ? null : Number(r.calificacion)

        ws.addRow({
          ...r,
          nivel: score === null ? 'Pendiente' : scoreLabel(score),
          resultado: score === null
            ? 'Sin calificar'
            : score >= settings.passing_score ? 'Acreditado' : 'No acreditó',
          acta: ACTA_TEXT[String(r.estado_acta ?? '')] ?? 'Pendiente',
          cierre_texto: r.fecha_cierre
            ? new Date(String(r.fecha_cierre)).toLocaleString('es-MX')
            : '',
          estado_texto: ESTADO_TEXT[String(r.estado)] ?? String(r.estado),
          observaciones_final: [r.observaciones, r.observaciones_evaluacion]
            .map(v => String(v ?? '').trim()).filter(Boolean).join(' | '),
        })
      }

      // Colorear el resultado para que se lea de un vistazo
      ws.eachRow((row, i) => {
        if (i <= headerRowIndex) return
        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
          }
        })
        if (!withScores) return
        const resultado = String(row.getCell('resultado').value ?? '')
        if (resultado === 'No acreditó') {
          row.getCell('resultado').font = { color: { argb: 'FFB00020' }, bold: true }
        } else if (resultado === 'Acreditado') {
          row.getCell('resultado').font = { color: { argb: 'FF1B6B33' }, bold: true }
        }
      })

      ws.views = [{ state: 'frozen', ySplit: headerRowIndex }]
      ws.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: columns.length },
      }

      // ── Hoja 2: resumen ────────────────────────────────────────────────
      const rs = wb.addWorksheet('Resumen')
      rs.columns = [
        { header: 'Concepto', key: 'k', width: 34 },
        { header: 'Valor', key: 'v', width: 18 },
      ]
      rs.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      })

      const lines: Array<[string, string | number]> = [
        ['Institución', settings.institution_name],
        ['Departamento', settings.department_name],
        ['Docente', settings.teacher_name],
        ['Reporte', KIND_TITLE[kind]],
        ['Filtros', describeFilters(filters).join(' | ')],
        ['Generado', new Date().toLocaleString('es-MX')],
        ['', ''],
        ['Registros incluidos', summary.total],
        ['Inscripciones dadas de baja', summary.cancelled],
      ]

      if (withScores) {
        lines.push(
          ['Calificados', summary.evaluated],
          ['Pendientes de calificar', summary.pending],
          ['Acreditados', summary.passed],
          ['No acreditaron', summary.failed],
          ['Porcentaje de acreditación', `${summary.pass_rate}%`],
          ['Promedio del grupo', summary.average ?? 'Sin datos'],
          ['', ''],
          [`Calificación mínima aprobatoria`, settings.passing_score],
        )
        for (const level of SCORE_SCALE) {
          lines.push([`${level.score} · ${level.label}`, summary.distribution[level.score] ?? 0])
        }
      }

      lines.forEach(([k, v]) => rs.addRow({ k, v }))
      rs.getColumn('k').font = { bold: false }

      const file = path.join(outputFolder(settings), `${KIND_FILE[kind]}_${stamp()}.xlsx`)
      await wb.xlsx.writeFile(file)
      return { ok: true, data: file }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('reports:exportPdf', async (_e, filters: ReportFilters): Promise<IpcResult<string>> => {
    let reportWindow: BrowserWindow | null = null
    try {
      const settings = readSettings()
      const { sql, params, kind } = buildQuery(filters)
      const rows = db.all(sql, params)
      if (!rows.length) return { ok: false, error: 'No hay información que coincida con los filtros' }

      const summary = summarize(rows, settings.passing_score)
      const html = buildHtmlReport(rows, summary, settings, filters, kind)

      reportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      const pdf = await reportWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: true,
        margins: { marginType: 'default' },
      })

      const file = path.join(outputFolder(settings), `${KIND_FILE[kind]}_${stamp()}.pdf`)
      fs.writeFileSync(file, pdf)
      return { ok: true, data: file }
    } catch (e: any) {
      return { ok: false, error: e.message }
    } finally {
      // Se cierra siempre: una ventana oculta huérfana impide que la app termine
      if (reportWindow && !reportWindow.isDestroyed()) reportWindow.destroy()
    }
  })
}

/**
 * Se exponen para poder revisar el reporte generado sin abrir Electron.
 * Son las mismas funciones que usa `reports:exportPdf`, no una copia.
 */
export const __testing = { buildHtmlReport, buildQuery, summarize }

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtmlReport(
  rows: Record<string, unknown>[],
  summary: Summary,
  settings: AppSettings,
  filters: ReportFilters,
  kind: ReportKind
): string {
  const withScores = kind !== 'enrollments'

  const headers = ['No. Control', 'Estudiante', 'Carrera', 'Sem.', 'Complementaria',
    'Grupo', 'Periodo', 'Horario']
  if (withScores) headers.push('Calif.', 'Nivel', 'Resultado')
  headers.push('Estado', 'Observaciones')

  const trs = rows.map(r => {
    const score = r.calificacion === null || r.calificacion === undefined
      ? null : Number(r.calificacion)
    const passed = score !== null && score >= settings.passing_score

    const cells: string[] = [
      escapeHtml(r.matricula),
      escapeHtml(r.estudiante),
      escapeHtml(r.carrera),
      escapeHtml(r.semestre),
      escapeHtml(r.complementaria),
      escapeHtml(r.grupo),
      escapeHtml(r.periodo),
      escapeHtml(r.horario),
    ]

    if (withScores) {
      cells.push(
        score === null ? '—' : String(score),
        score === null ? 'Pendiente' : escapeHtml(scoreLabel(score)),
        score === null
          ? '<span class="pend">Sin calificar</span>'
          : passed ? '<span class="ok">Acreditado</span>' : '<span class="no">No acreditó</span>'
      )
    }

    cells.push(
      escapeHtml(ESTADO_TEXT[String(r.estado)] ?? r.estado),
      escapeHtml([r.observaciones, r.observaciones_evaluacion]
        .map(v => String(v ?? '').trim()).filter(Boolean).join(' | '))
    )

    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
  }).join('\n')

  const logo = readLogoDataUrl(settings.logo_path)
  const contact = [settings.teacher_email, settings.teacher_phone].filter(Boolean).join(' · ')

  // Si todo lo incluido pertenece a un acta cerrada, se hace constar en el
  // documento: es lo que da valor oficial al reporte impreso.
  const closures = rows
    .filter(r => String(r.estado_acta) === 'closed' && r.fecha_cierre)
    .map(r => `${String(r.cerrada_por || 'usuario no registrado')}|${String(r.fecha_cierre)}`)
  const allClosed = closures.length === rows.length && rows.length > 0
  const uniqueClosures = Array.from(new Set(closures))

  const closureNote = allClosed && uniqueClosures.length === 1
    ? (() => {
      const [by, at] = uniqueClosures[0].split('|')
      const when = new Date(at)
      return `<div class="closed">ACTA CERRADA · Firmada por ${escapeHtml(by)} el ` +
        `${escapeHtml(isNaN(when.getTime()) ? at : when.toLocaleString('es-MX'))}</div>`
    })()
    : allClosed
      ? '<div class="closed">ACTA CERRADA</div>'
      : ''

  const distRows = SCORE_SCALE.map(l =>
    `<tr><td>${l.score} · ${l.label}</td><td class="num">${summary.distribution[l.score] ?? 0}</td></tr>`
  ).join('')

  const summaryBlock = withScores ? `
  <div class="summary">
    <table class="mini">
      <tr><td>Registros</td><td class="num">${summary.total}</td></tr>
      <tr><td>Calificados</td><td class="num">${summary.evaluated}</td></tr>
      <tr><td>Pendientes</td><td class="num">${summary.pending}</td></tr>
      <tr><td>Acreditados</td><td class="num ok">${summary.passed}</td></tr>
      <tr><td>No acreditaron</td><td class="num no">${summary.failed}</td></tr>
      <tr><td>Acreditación</td><td class="num">${summary.pass_rate}%</td></tr>
      <tr><td>Promedio</td><td class="num">${summary.average ?? '—'}</td></tr>
    </table>
    <table class="mini">${distRows}</table>
  </div>` : `
  <div class="summary">
    <table class="mini">
      <tr><td>Registros</td><td class="num">${summary.total}</td></tr>
      <tr><td>Bajas</td><td class="num">${summary.cancelled}</td></tr>
    </table>
  </div>`

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${escapeHtml(KIND_TITLE[kind])}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body{font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#222;margin:0}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #1E3A5F;padding-bottom:8px;margin-bottom:10px}
  .head img{height:52px;object-fit:contain}
  .head .txt{flex:1;text-align:center}
  .inst{font-size:13px;font-weight:bold;color:#1E3A5F}
  .dept{font-size:10px;color:#555}
  .title{font-size:11px;font-weight:bold;margin-top:4px}
  .meta{font-size:8px;color:#555;margin-top:3px}
  .summary{display:flex;gap:14px;margin-bottom:8px}
  .mini{border-collapse:collapse;font-size:8px}
  .mini td{border:1px solid #ccc;padding:2px 8px}
  .num{text-align:right;font-weight:bold}
  table.data{border-collapse:collapse;width:100%}
  table.data th{background:#1E3A5F;color:#fff;padding:5px 6px;text-align:left;font-size:8px}
  table.data td{padding:3px 6px;border-bottom:1px solid #ddd}
  table.data tr:nth-child(even) td{background:#f5f7fa}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  .ok{color:#1B6B33;font-weight:bold}
  .no{color:#B00020;font-weight:bold}
  .pend{color:#8a6d00}
  .closed{display:inline-block;margin-top:5px;padding:2px 10px;border:1px solid #B00020;
    color:#B00020;font-weight:bold;font-size:8px;border-radius:3px;letter-spacing:.5px}
  .sign{margin-top:26px;display:flex;justify-content:space-around;font-size:9px}
  .sign div{border-top:1px solid #333;padding-top:4px;width:240px;text-align:center}
  .foot{margin-top:10px;font-size:7.5px;color:#777;text-align:center}
</style></head>
<body>
  <div class="head">
    ${logo ? `<img src="${logo}" alt="">` : ''}
    <div class="txt">
      <div class="inst">${escapeHtml(settings.institution_name)}</div>
      <div class="dept">${escapeHtml(settings.department_name)}</div>
      <div class="title">${escapeHtml(KIND_TITLE[kind])}</div>
      <div class="meta">
        Docente: ${escapeHtml(settings.teacher_name)}${contact ? ` · ${escapeHtml(contact)}` : ''}
      </div>
      <div class="meta">${escapeHtml(describeFilters(filters).join('  |  '))}</div>
      <div class="meta">Generado: ${escapeHtml(new Date().toLocaleString('es-MX'))}</div>
      ${closureNote}
    </div>
  </div>

  ${summaryBlock}

  <table class="data">
    <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${trs}</tbody>
  </table>

  <div class="sign">
    <div>${escapeHtml(settings.teacher_name)}<br>Docente</div>
    <div>&nbsp;<br>Coordinación de ${escapeHtml(settings.department_name)}</div>
  </div>

  <div class="foot">
    Calificación mínima aprobatoria: ${settings.passing_score}.
    Escala: ${SCORE_SCALE.map(l => `${l.score} ${l.label}`).join(' · ')}
  </div>
</body></html>`
}
