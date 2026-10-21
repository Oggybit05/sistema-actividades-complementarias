import { IpcMain } from 'electron'
import path from 'path'
import ExcelJS from 'exceljs'
import * as db from '../database/db'
import type { IpcResult } from '../../shared/types'
import { readSettings } from './settings'
import { outputFolder, stamp } from './reports'

/**
 * Reporte Final de Actividades Complementarias.
 *
 * Reproduce el formato oficial que entrega la profesora, tal como está en
 * "Reporte Final AC <periodo> RIPOLL.xlsx":
 *
 *   - Hoja "REPORTE TOTAL": concentrado por actividad + tabla de códigos de división.
 *   - Una hoja por grupo, con las 13 divisiones y sus totales.
 *
 * Se respetan las mismas celdas, combinaciones, fórmulas y colores del original,
 * para que el archivo se pueda entregar sin retocarlo a mano.
 */

// ─── Constantes del formato oficial ───────────────────────────────────────────

/** Primera fila de divisiones en la hoja de un grupo */
const DIV_FIRST_ROW = 7

/** Colores del concentrado, en el orden en que aparecen en el archivo original */
const ACTIVITY_FILLS = [
  'FFFF9900', 'FFC00000', 'FF00FF00', 'FFFFFF00', 'FFF779EE', 'FF00B0F0',
]

/**
 * Color de cada código de división. Va por código y no por posición para que
 * el color siga siendo el mismo aunque cambie el orden del catálogo.
 */
const CODE_FILLS: Record<string, string> = {
  '116': 'FFFF9900', '107': 'FFFFFF00', '138': 'FFFF0000', '142': 'FF00FFFF',
  '103': 'FFFF00FF', '139': 'FF00FF00', '110': 'FF85200C', '113': 'FF96147C',
  '137': 'FFEA095E', '143': 'FF1155CC', '140': 'FFB7B7B7', '141': 'FFB7B7B7',
  '144': 'FFB7B7B7',
}

const GRAY_BAND = 'FFD9D9D9'   // franja de encabezados
const GRAY_HEAD = 'FFBFBFBF'   // encabezado del concentrado y fila TOTAL

/** Texto blanco sobre los códigos oscuros; en los claros se deja negro */
const LIGHT_TEXT = new Set(['FF85200C', 'FF96147C', 'FFEA095E', 'FF1155CC'])

const THIN = { style: 'thin' as const }
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN }

// ─── Datos ────────────────────────────────────────────────────────────────────

interface GroupRow {
  id: number
  group_number: string
  complementary_id: number
  complementary_name: string
}

interface Tally {
  enrolled: number
  passed: number
  pending: number
}

/** Conteos por grupo y división, ya resueltos en SQL */
const COUNT_SQL = `
  SELECT
    e.group_id                                                        AS group_id,
    s.career_id                                                       AS career_id,
    COUNT(*)                                                          AS enrolled,
    SUM(CASE WHEN ev.score >= ? THEN 1 ELSE 0 END)                    AS passed,
    SUM(CASE WHEN ev.score IS NULL THEN 1 ELSE 0 END)                 AS pending
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  JOIN groups g ON g.id = e.group_id
  LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
  WHERE e.status = 'active' AND g.period_id = ?
  GROUP BY e.group_id, s.career_id
`

/**
 * Nombre de la actividad tal como lo escribe la profesora en el formato.
 *
 * Sus grupos ya se llaman "FOTO 1-M", "YOGA 2-M", etc., así que anteponer la
 * complementaria daría "FOTOGRAFÍA FOTO 1-M". Solo se antepone cuando la
 * etiqueta del grupo no dice de qué actividad es (por ejemplo un grupo "1",
 * que se convierte en "FOTOGRAFÍA 1").
 */
function activityTitle(complementary: string, group: string): string {
  const comp = complementary.trim().toUpperCase()
  const grp = group.trim().toUpperCase()
  if (!grp) return comp

  const stem = comp.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').substring(0, 4)
  if (stem && grp.includes(stem)) return grp

  return `${comp} ${grp}`
}

/**
 * Nombre de hoja válido para Excel: sin caracteres prohibidos, máximo 31
 * caracteres y sin repetirse. Si dos grupos chocan, se numera el segundo.
 */
function sheetName(base: string, used: Set<string>): string {
  let name = base.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 31)
  if (!name) name = 'GRUPO'

  if (used.has(name)) {
    let n = 2
    let candidate: string
    do {
      const suffix = ` (${n++})`
      candidate = name.substring(0, 31 - suffix.length) + suffix
    } while (used.has(candidate))
    name = candidate
  }

  used.add(name)
  return name
}

// ─── Construcción del libro ───────────────────────────────────────────────────

interface BuildInput {
  periodName: string
  careers: { id: number; name: string; code: string }[]
  groups: GroupRow[]
  tally: Map<string, Tally>
  institution: string
}

/**
 * Arma el libro completo. Está separado del handler para poder verificar el
 * archivo generado sin abrir Electron.
 */
function buildWorkbook(input: BuildInput): ExcelJS.Workbook {
  const { periodName, careers, groups, tally } = input

  const wb = new ExcelJS.Workbook()
  wb.creator = input.institution
  wb.created = new Date()

  const totalSheet = wb.addWorksheet('REPORTE TOTAL')
  const used = new Set<string>(['REPORTE TOTAL'])

  // Una hoja por grupo, en el mismo orden en que vienen (actividad y grupo)
  const perActivity = new Map<number, { name: string; enrolled: number; passed: number }>()

  for (const g of groups) {
    const title = activityTitle(g.complementary_name, g.group_number)
    const ws = wb.addWorksheet(sheetName(title, used))

    let enrolled = 0
    let passed = 0

    ws.getColumn('A').width = 10.7
    ws.getColumn('B').width = 27
    ws.getColumn('C').width = 23.7
    ws.getColumn('D').width = 24.3
    ws.getColumn('E').width = 27.4
    ws.getColumn('F').width = 16
    ws.getColumn('G').width = 18

    // El título abarca hasta G para que cubra también las dos columnas de
    // porcentaje; si se quedara en E, la tabla se vería cortada por la mitad.
    // Título — B2:G3
    ws.mergeCells('B2:G3')
    const title1 = ws.getCell('B2')
    title1.value = 'Reporte final de Actividades Complementarias'
    title1.font = { bold: true, size: 15, name: 'Calibri' }
    title1.alignment = { horizontal: 'center', vertical: 'middle' }
    paint('B2:G3', ws, GRAY_BAND)

    // Semestre — B4:G4
    ws.mergeCells('B4:G4')
    const sem = ws.getCell('B4')
    sem.value = `SEMESTRE ${periodName}`
    sem.font = { bold: true, size: 11, name: 'Arial' }
    sem.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    paint('B4:G4', ws, GRAY_BAND)
    ws.getRow(4).height = 30.75

    // Nombre de la actividad — B5 / C5:G5
    const label = ws.getCell('B5')
    label.value = 'NOMBRE DE LA ACTIVIDAD '
    label.font = { bold: true, size: 9, name: 'Arial' }
    label.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    label.fill = solid(GRAY_BAND)
    label.border = BOX

    ws.mergeCells('C5:G5')
    const activity = ws.getCell('C5')
    activity.value = title
    activity.font = { bold: true, size: 12, name: 'Calibri' }
    activity.alignment = { horizontal: 'center', vertical: 'middle' }
    borderRange('C5:G5', ws)
    ws.getRow(5).height = 24.75

    // Encabezados de la tabla
    const heads = [
      'DIVISIÓN ',
      'NO. DE ESTUDIANTES INSCRITOS',
      'NO. DE ESTUDIANTES ACREDITADOS ',
      'NO. DE ESTUDIANTES NO ACREDITADOS ',
      '% ACREDITADOS',
      '% NO ACREDITADOS',
    ]
    heads.forEach((text, i) => {
      const cell = ws.getCell(6, 2 + i)
      cell.value = text
      cell.font = { bold: true, size: 9, name: 'Arial' }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.fill = solid(GRAY_BAND)
      cell.border = BOX
    })
    ws.getRow(6).height = 28.5

    // Una fila por división, aunque no tenga inscritos: el formato oficial
    // siempre lleva las 13 y la profesora las entrega completas.
    careers.forEach((career, i) => {
      const row = DIV_FIRST_ROW + i
      const t = tally.get(`${g.id}:${career.id}`)
      const insc = t?.enrolled ?? 0
      const acred = t?.passed ?? 0

      enrolled += insc
      passed += acred

      const nameCell = ws.getCell(row, 2)
      nameCell.value = career.name.toUpperCase()
      nameCell.font = { bold: true, size: 9, name: 'Arial' }
      nameCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      nameCell.fill = solid(GRAY_BAND)
      nameCell.border = BOX

      // Sin acreditar = inscritos - acreditados. Quien no tiene calificación
      // capturada cae aquí, igual que en el formato en papel.
      const values = [insc, acred, insc - acred]
      values.forEach((v, j) => {
        const cell = ws.getCell(row, 3 + j)
        cell.value = v
        cell.font = { bold: true, size: 13, name: 'Calibri' }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = BOX
      })

      // Porcentajes como fórmula viva: si se corrige un número a mano en Excel,
      // el porcentaje se recalcula solo. Las divisiones sin inscritos se dejan
      // en blanco en vez de "0%", porque 0 de 0 no es un cero real y pondría
      // trece renglones de ruido en una hoja que casi siempre va incompleta.
      percentCells(ws, row, `C${row}`, `D${row}`, `E${row}`)

      ws.getRow(row).height = 32.25
    })

    // TOTALES con fórmula viva, como en el original
    const totalRow = DIV_FIRST_ROW + careers.length
    const last = totalRow - 1
    const totalLabel = ws.getCell(totalRow, 2)
    totalLabel.value = 'TOTALES'
    totalLabel.font = { bold: true, size: 12, name: 'Calibri' }
    totalLabel.alignment = { horizontal: 'center', vertical: 'middle' }
    totalLabel.fill = solid(GRAY_BAND)
    totalLabel.border = BOX

    for (const col of ['C', 'D', 'E']) {
      const cell = ws.getCell(`${col}${totalRow}`)
      cell.value = { formula: `SUM(${col}${DIV_FIRST_ROW}:${col}${last})` }
      cell.font = { bold: true, size: 12, name: 'Calibri' }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = solid(GRAY_BAND)
      cell.border = BOX
    }

    // Porcentaje general del grupo, sobre los totales de la propia hoja
    percentCells(ws, totalRow, `C${totalRow}`, `D${totalRow}`, `E${totalRow}`, GRAY_BAND)
    ws.getRow(totalRow).height = 32.25

    const acc = perActivity.get(g.complementary_id) ?? {
      name: g.complementary_name.toUpperCase(), enrolled: 0, passed: 0,
    }
    acc.enrolled += enrolled
    acc.passed += passed
    perActivity.set(g.complementary_id, acc)
  }

  buildTotalSheet(totalSheet, careers, [...perActivity.values()])
  return wb
}

/** Hoja de concentrado: una fila por actividad y la tabla de códigos */
function buildTotalSheet(
  ws: ExcelJS.Worksheet,
  careers: { name: string; code: string }[],
  activities: { name: string; enrolled: number; passed: number }[],
) {
  ws.getColumn('A').width = 10.7
  ws.getColumn('B').width = 27
  ws.getColumn('C').width = 21
  ws.getColumn('D').width = 14
  ws.getColumn('E').width = 16
  ws.getColumn('F').width = 22
  ws.getColumn('G').width = 14
  ws.getColumn('H').width = 16

  // Encabezado
  const heads: [string, string][] = [
    ['C3', 'Estudiantes inscritos'], ['D3', 'Aprobados'],
    ['E3', 'No aprobados'], ['F3', 'Actividad'],
    ['G3', '% Aprobados'], ['H3', '% No aprobados'],
  ]
  ws.getCell('B3').fill = solid(GRAY_HEAD)
  for (const [ref, text] of heads) {
    const cell = ws.getCell(ref)
    cell.value = text
    cell.font = { bold: true, size: 13, name: 'Calibri' }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = solid(GRAY_HEAD)
  }
  ws.getRow(3).height = 34.5

  // Una fila por actividad, con su color
  activities.forEach((a, i) => {
    const row = 4 + i
    const fill = ACTIVITY_FILLS[i % ACTIVITY_FILLS.length]
    const values: (string | number)[] = ['TOTALES', a.enrolled, a.passed, a.enrolled - a.passed, a.name]

    values.forEach((v, j) => {
      const cell = ws.getCell(row, 2 + j)
      cell.value = v
      cell.font = { bold: true, size: 12, name: 'Calibri' }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.fill = solid(fill)
    })

    // Porcentaje de cada actividad, con el mismo color de su renglón
    percentRow(ws, row, fill, 12)
    ws.getRow(row).height = 15.75
  })

  // TOTAL general
  const totalRow = 4 + activities.length
  const last = totalRow - 1
  const label = ws.getCell(totalRow, 2)
  label.value = 'TOTAL'
  label.font = { bold: true, size: 13, name: 'Calibri' }
  label.alignment = { horizontal: 'center', vertical: 'middle' }
  label.fill = solid(GRAY_HEAD)

  for (const col of ['C', 'D', 'E']) {
    const cell = ws.getCell(`${col}${totalRow}`)
    cell.value = activities.length
      ? { formula: `SUM(${col}4:${col}${last})` }
      : 0
    cell.font = { bold: true, size: 13, name: 'Calibri' }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = solid(GRAY_HEAD)
  }
  ws.getCell(`F${totalRow}`).fill = solid(GRAY_HEAD)

  // Porcentaje general del periodo: el dato que suele pedir la coordinación
  percentRow(ws, totalRow, GRAY_HEAD, 13)
  ws.getRow(totalRow).height = 17.25

  // Tabla de divisiones y códigos, dos filas más abajo
  const headRow = totalRow + 2
  ws.mergeCells(`B${headRow}:D${headRow}`)
  const divHead = ws.getCell(`B${headRow}`)
  divHead.value = 'DIVISIÓN '
  divHead.font = { bold: true, size: 11, name: 'Calibri' }
  divHead.alignment = { horizontal: 'center', vertical: 'middle' }
  borderRange(`B${headRow}:D${headRow}`, ws)

  const codeHead = ws.getCell(`E${headRow}`)
  codeHead.value = 'CODIGOS'
  codeHead.font = { bold: true, size: 11, name: 'Calibri' }
  codeHead.alignment = { horizontal: 'center', vertical: 'middle' }
  codeHead.border = BOX

  careers.forEach((career, i) => {
    const row = headRow + 1 + i
    ws.mergeCells(`B${row}:D${row}`)
    const name = ws.getCell(`B${row}`)
    name.value = career.name.toUpperCase()
    name.font = { bold: true, size: 11, name: 'Calibri' }
    name.alignment = { horizontal: 'center', vertical: 'middle' }
    borderRange(`B${row}:D${row}`, ws)

    const fill = CODE_FILLS[career.code] ?? 'FFB7B7B7'
    const code = ws.getCell(`E${row}`)
    code.value = Number(career.code) || career.code
    code.font = {
      bold: true, size: 12, name: 'Calibri',
      color: { argb: LIGHT_TEXT.has(fill) ? 'FFFFFFFF' : 'FF000000' },
    }
    code.alignment = { horizontal: 'center', vertical: 'middle' }
    code.fill = solid(fill)
    code.border = BOX
    ws.getRow(row).height = 15.75
  })
}

// ─── Utilidades de formato ────────────────────────────────────────────────────

function solid(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/**
 * Escribe el par de porcentajes (acreditados y no acreditados) de un renglón.
 *
 * Se usan fórmulas y no números ya calculados para que el archivo siga siendo
 * útil si alguien ajusta un conteo a mano en Excel. El `IF(...=0,"")` evita el
 * `#¡DIV/0!` de las divisiones sin inscritos, que en este formato son la
 * mayoría: el reporte lleva siempre las trece, tenga o no alumnos.
 *
 * @param enrolledRef celda con los inscritos (denominador)
 * @param passedRef   celda con los acreditados
 * @param failedRef   celda con los no acreditados
 * @param fill        color de fondo, para las filas de totales
 */
function percentCells(
  ws: ExcelJS.Worksheet,
  row: number,
  enrolledRef: string,
  passedRef: string,
  failedRef: string,
  fill?: string,
) {
  const pairs: [number, string][] = [[6, passedRef], [7, failedRef]]
  for (const [col, numerator] of pairs) {
    const cell = ws.getCell(row, col)
    cell.value = { formula: `IF(${enrolledRef}=0,"",${numerator}/${enrolledRef})` }
    cell.numFmt = '0.0%'
    cell.font = { bold: true, size: 12, name: 'Calibri' }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = BOX
    if (fill) cell.fill = solid(fill)
  }
}

/**
 * Igual que `percentCells`, pero para el concentrado, donde las columnas son
 * G y H y los renglones se distinguen por color en vez de por marco.
 */
function percentRow(ws: ExcelJS.Worksheet, row: number, fill: string, size: number) {
  const pairs: [number, string][] = [[7, `D${row}`], [8, `E${row}`]]
  for (const [col, numerator] of pairs) {
    const cell = ws.getCell(row, col)
    cell.value = { formula: `IF(C${row}=0,"",${numerator}/C${row})` }
    cell.numFmt = '0.0%'
    cell.font = { bold: true, size, name: 'Calibri' }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = solid(fill)
  }
}

/** Pinta y enmarca un rango combinado (ExcelJS no propaga el estilo solo) */
function paint(range: string, ws: ExcelJS.Worksheet, argb: string) {
  eachCell(range, ws, cell => {
    cell.fill = solid(argb)
    cell.border = BOX
  })
}

function borderRange(range: string, ws: ExcelJS.Worksheet) {
  eachCell(range, ws, cell => { cell.border = BOX })
}

function eachCell(range: string, ws: ExcelJS.Worksheet, fn: (c: ExcelJS.Cell) => void) {
  const [from, to] = range.split(':')
  const parse = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!
    return { col: ws.getColumn(m[1]).number, row: Number(m[2]) }
  }
  const a = parse(from)
  const b = parse(to)
  for (let r = a.row; r <= b.row; r++) {
    for (let c = a.col; c <= b.col; c++) fn(ws.getCell(r, c))
  }
}

// ─── Canal IPC ────────────────────────────────────────────────────────────────

export interface FinalReportResult {
  file: string
  groups: number
  pending: number
  /** Totales del periodo, para poder mostrar el resultado sin abrir el archivo */
  enrolled: number
  passed: number
  failed: number
  pass_rate: number
  fail_rate: number
}

export function registerFinalReportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('reports:exportFinal', async (
    _e, params: { period_id?: number },
  ): Promise<IpcResult<FinalReportResult>> => {
    try {
      const settings = readSettings()

      const period = params?.period_id
        ? db.get('SELECT id, name FROM school_periods WHERE id = ?', [params.period_id])
        : db.get('SELECT id, name FROM school_periods WHERE is_active = 1 ORDER BY id DESC LIMIT 1')

      if (!period) return { ok: false, error: 'No hay un periodo seleccionado' }

      const careers = db.all(
        "SELECT id, name, code FROM careers WHERE status = 'active' ORDER BY id",
      ) as { id: number; name: string; code: string }[]

      if (!careers.length) return { ok: false, error: 'No hay carreras registradas' }

      const groups = db.all(`
        SELECT g.id, g.group_number, g.complementary_id, comp.name AS complementary_name
        FROM groups g
        JOIN complementaries comp ON comp.id = g.complementary_id
        WHERE g.period_id = ? AND g.status = 'active'
        ORDER BY comp.name, g.group_number
      `, [period.id]) as unknown as GroupRow[]

      if (!groups.length) {
        return { ok: false, error: `El periodo ${period.name} no tiene grupos registrados` }
      }

      const counts = db.all(COUNT_SQL, [settings.passing_score, period.id]) as Record<string, number>[]
      const tally = new Map<string, Tally>()
      let pending = 0
      let enrolled = 0
      let passed = 0

      for (const c of counts) {
        tally.set(`${c.group_id}:${c.career_id}`, {
          enrolled: Number(c.enrolled),
          passed: Number(c.passed),
          pending: Number(c.pending),
        })
        pending += Number(c.pending)
        enrolled += Number(c.enrolled)
        passed += Number(c.passed)
      }

      const wb = buildWorkbook({
        periodName: String(period.name),
        careers,
        groups,
        tally,
        institution: settings.institution_name,
      })

      const safePeriod = String(period.name).replace(/[\\/:*?"<>|]/g, '-')
      const file = path.join(
        outputFolder(settings),
        `Reporte Final AC ${safePeriod}_${stamp()}.xlsx`,
      )
      await wb.xlsx.writeFile(file)

      const failed = enrolled - passed
      const rate = (n: number) => (enrolled ? Math.round((n / enrolled) * 1000) / 10 : 0)

      return {
        ok: true,
        data: {
          file, groups: groups.length, pending,
          enrolled, passed, failed,
          pass_rate: rate(passed),
          fail_rate: rate(failed),
        },
      }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })
}

/** Se expone para poder revisar el libro generado sin abrir Electron */
export const __testing = { buildWorkbook, sheetName, activityTitle }
