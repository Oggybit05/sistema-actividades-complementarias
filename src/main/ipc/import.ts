import { IpcMain, Dialog, BrowserWindow } from 'electron'
import * as db from '../database/db'
import type { IpcResult } from '../../shared/types'
import { careerCodeOf, checkEnrollment } from '../../shared/enrollmentNumber'
import { institutionalEmail } from '../../shared/institutionalEmail'
import { validateScore, scoreLabel } from '../../shared/scores'
import { persistScore, assertEditable } from './evaluations'
import { logAudit } from '../session'
import path from 'path'
import fs from 'fs'

/** Gravedad de lo detectado en una fila */
export type RowSeverity = 'ok' | 'warn' | 'error'

/** Datos parseados de un estudiante para previsualización */
export interface ParsedStudent {
  row: number
  enrollment_number: string
  full_name: string
  first_name: string
  last_name: string
  career_code: string
  career_name: string   // resuelto desde la DB
  career_id: number     // resuelto desde la DB
  semester: number
  already_exists: boolean
  /** error = no se puede importar; warn = se importa pero revisa */
  severity: RowSeverity
  issues: string[]
}

/** Mapeo manual de columnas cuando la detección automática no acierta */
export interface ColumnMapping {
  /** Índice de columna (base 1) o 0 si no aplica */
  enrollment?: number
  full_name?: number
  first_name?: number
  last_name?: number
  semester?: number
  score?: number
  /** Hoja de Excel a usar; vacío = todas */
  sheet?: string
  /** Fila donde empiezan los datos (base 1); 0 = detectar sola */
  data_start_row?: number
}

/** Opciones de lectura enviadas desde la interfaz */
export interface ParseOptions {
  nameOrder?: NameOrder
  mapping?: ColumnMapping
}

/** Columnas encontradas en el archivo, para que la profesora las asigne */
export interface FileInspection {
  file_name: string
  kind: 'excel' | 'text' | 'pdf'
  sheets: string[]
  /** Encabezados detectados por columna */
  columns: { index: number; header: string; sample: string[] }[]
  /** Primeras filas tal cual, para que reconozca el archivo */
  preview_rows: string[][]
  suggested: ColumnMapping
  message: string
}

/** Resultado del parseo de archivo */
interface ParseResult {
  students: ParsedStudent[]
  file_name: string
  total_lines: number
  warnings: string[]
  meta: DetectedMeta
}

/** Datos del encabezado detectados en el documento */
export interface DetectedMeta {
  // Texto tal como aparece en el documento
  asignatura: string
  grupo: string
  periodo: string
  docente: string
  clave: string
  // Coincidencias resueltas contra los catálogos de la base de datos
  complementary_id: number
  complementary_name: string
  complementary_confidence: number
  period_id: number
  period_name: string
  group_id: number
  group_number: string
}

const EMPTY_META: DetectedMeta = {
  asignatura: '', grupo: '', periodo: '', docente: '', clave: '',
  complementary_id: 0, complementary_name: '', complementary_confidence: 0,
  period_id: 0, period_name: '', group_id: 0, group_number: '',
}

/** Tipos de incidencia detectados al importar */
export type IssueType =
  | 'matricula_invalida'
  | 'carrera_no_encontrada'
  | 'ya_inscrito'
  | 'cupo_lleno'

export interface ImportIssue {
  type: IssueType
  student: string
  detail: string
}

/** Opciones enviadas desde la interfaz al confirmar la importación */
export interface ImportOptions {
  students: ParsedStudent[]
  skip_existing: boolean
  // Usar catálogos existentes
  period_id?: number
  complementary_id?: number
  group_id?: number
  // O crearlos durante la importación
  new_period?: { name: string; start_date: string; end_date: string; is_active?: boolean }
  new_complementary?: { name: string; description?: string }
  new_group?: {
    group_number: string
    capacity?: number
    classroom?: string
    days?: string
    start_time?: string
    end_time?: string
  }
}

/** Resultado consolidado de la importación */
export interface ImportSummary {
  inserted: number
  updated: number
  enrolled: number
  skipped: number
  created_period: string
  created_complementary: string
  created_group: string
  group_label: string
  issues: ImportIssue[]
}

/** Normalizar texto para comparación: mayúsculas, sin acentos ni signos */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Distancia de Levenshtein para tolerar errores de captura */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  const curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr.slice()
  }
  return prev[n]
}

/** Palabras del encabezado que no aportan al nombre de la complementaria */
const STOPWORDS = new Set(['INTERSEMESTRAL', 'ACTIVIDAD', 'COMPLEMENTARIA', 'CURSO', 'TALLER', 'DE', 'DEL', 'LA', 'EL', 'Y', 'A'])

/**
 * Similitud por tokens tolerante a errores ortográficos.
 * Devuelve la proporción de tokens del catálogo hallados en el documento.
 */
function similarity(docText: string, catalogText: string): number {
  const docTokens = normalize(docText).split(' ').filter(t => t && !STOPWORDS.has(t))
  const catTokens = normalize(catalogText).split(' ').filter(t => t && !STOPWORDS.has(t))
  if (!catTokens.length || !docTokens.length) return 0

  let matched = 0
  for (const cat of catTokens) {
    const hit = docTokens.some(doc => {
      if (doc === cat) return true
      const tolerance = cat.length >= 8 ? 2 : cat.length >= 5 ? 1 : 0
      return levenshtein(doc, cat) <= tolerance
    })
    if (hit) matched++
  }
  return matched / catTokens.length
}

/** Leer un valor del encabezado, por ejemplo "Asignatura   INTELIGENCIA EMOCIONAL" */
function readHeaderValue(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Acepta separador de dos puntos o solo espacios, y valor en la misma línea
  const re = new RegExp(`${escaped}\\s*:?\\s*(.+)`, 'i')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re)
    if (m) {
      const value = m[1].replace(/\s{2,}/g, ' ').trim()
      if (value) return value
    }
  }
  return ''
}

/** Extraer encabezado del documento y resolverlo contra los catálogos */
function detectMeta(text: string): DetectedMeta {
  const meta: DetectedMeta = { ...EMPTY_META }

  meta.asignatura = readHeaderValue(text, 'Asignatura')
  meta.grupo = readHeaderValue(text, 'Grupo')
  meta.periodo = readHeaderValue(text, 'Periodo')
  meta.docente = readHeaderValue(text, 'Nombre Docente') || readHeaderValue(text, 'Docente')
  meta.clave = readHeaderValue(text, 'Clave Asignatura')

  // "Clave Asignatura" también empieza con "Asignatura"; descartar si se cruzaron
  if (meta.asignatura && /^N\/?A$/i.test(meta.asignatura)) meta.asignatura = ''

  // Resolver complementaria por similitud de nombre
  if (meta.asignatura) {
    const comps = db.all('SELECT id, name FROM complementaries WHERE status = ?', ['active'])
    let best = { id: 0, name: '', score: 0 }
    for (const c of comps) {
      const score = similarity(meta.asignatura, c.name as string)
      if (score > best.score) best = { id: c.id as number, name: c.name as string, score }
    }
    if (best.score >= 0.6) {
      meta.complementary_id = best.id
      meta.complementary_name = best.name
    }
    meta.complementary_confidence = Math.round(best.score * 100)
  }

  // Resolver periodo por nombre exacto o normalizado
  if (meta.periodo) {
    const periods = db.all('SELECT id, name FROM school_periods')
    const target = normalize(meta.periodo)
    const found = periods.find(p => normalize(p.name as string) === target)
    if (found) {
      meta.period_id = found.id as number
      meta.period_name = found.name as string
    }
  }

  // Resolver grupo usando complementaria y periodo detectados
  if (meta.grupo) {
    const where: string[] = ['status = ?']
    const params: unknown[] = ['active']
    if (meta.complementary_id) { where.push('complementary_id = ?'); params.push(meta.complementary_id) }
    if (meta.period_id) { where.push('period_id = ?'); params.push(meta.period_id) }
    const groups = db.all(`SELECT id, group_number FROM groups WHERE ${where.join(' AND ')}`, params)
    const target = normalize(meta.grupo)
    const found = groups.find(g => normalize(g.group_number as string) === target)
    if (found) {
      meta.group_id = found.id as number
      meta.group_number = found.group_number as string
    }
  }

  return meta
}

/** Extraer código de carrera del No. de Control (formato AA3CCCXXX) */
function getCareerCode(enrollNum: string): string {
  return careerCodeOf(enrollNum)
}

/** Construir mapa de carreras desde la DB */
function getCareerMap(): Record<string, { id: number; name: string }> {
  const rows = db.all('SELECT id, code, name FROM careers WHERE status = ?', ['active'])
  const map: Record<string, { id: number; name: string }> = {}
  for (const r of rows) {
    map[r.code as string] = { id: r.id as number, name: r.name as string }
  }
  return map
}

/** Verificar si un estudiante ya existe en la DB */
function studentExists(enrollNum: string): boolean {
  const row = db.get('SELECT id FROM students WHERE enrollment_number = ?', [enrollNum])
  return !!row
}

/** Calcular semestre aproximado */
function estimateSemester(enrollNum: string): number {
  const yearPrefix = parseInt(enrollNum.substring(0, 2))
  const currentYear = new Date().getFullYear() % 100
  const sem = Math.max(1, (currentYear - yearPrefix) * 2 + 1)
  return Math.min(sem, 12)
}

/** Orden en que aparece el nombre en el documento */
export type NameOrder = 'last_first' | 'first_last'

/**
 * Separar nombre completo en nombres y apellidos.
 * Las listas oficiales usan "APELLIDO_P APELLIDO_M NOMBRE(S)" (last_first).
 */
function splitName(fullName: string, order: NameOrder): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  if (parts.length === 2) {
    return order === 'last_first'
      ? { first: parts[1], last: parts[0] }
      : { first: parts[0], last: parts[1] }
  }
  // 3 o más: dos apellidos y el resto nombres
  return order === 'last_first'
    ? { first: parts.slice(2).join(' '), last: parts.slice(0, 2).join(' ') }
    : { first: parts.slice(0, parts.length - 2).join(' '), last: parts.slice(-2).join(' ') }
}

/**
 * Arma la fila de vista previa y anota todo lo que esté mal.
 *
 * La validación vive aquí y no en cada lector (PDF, Excel, texto) para que las
 * tres rutas apliquen exactamente las mismas reglas; antes cada una avisaba
 * cosas distintas.
 */
function buildRow(
  rowNumber: number,
  enrollNum: string,
  fullName: string,
  careerMap: Record<string, { id: number; name: string }>,
  order: NameOrder,
  semesterOverride?: number
): ParsedStudent {
  const issues: string[] = []
  let severity: RowSeverity = 'ok'

  const check = checkEnrollment(enrollNum)
  if (!check.valid) {
    issues.push(check.error ?? 'Matrícula inválida')
    severity = 'error'
  }

  const { first, last } = splitName(fullName, order)
  if (!first && !last) {
    issues.push('No se pudo leer el nombre')
    severity = 'error'
  } else if (!last) {
    issues.push('Solo se detectó una palabra en el nombre; revisa apellidos')
    if (severity === 'ok') severity = 'warn'
  }

  const careerCode = careerCodeOf(enrollNum)
  const career = careerMap[careerCode]
  if (!career) {
    issues.push(`No hay una carrera registrada con el código ${careerCode}`)
    severity = 'error'
  }

  const exists = studentExists(enrollNum)
  if (exists) {
    issues.push('Ya está registrado; se actualizarán sus datos')
    if (severity === 'ok') severity = 'warn'
  }

  let semester = semesterOverride ?? estimateSemester(enrollNum)
  if (!Number.isInteger(semester) || semester < 1 || semester > 14) {
    issues.push(`Semestre fuera de rango (${semester}); se usará el estimado`)
    semester = estimateSemester(enrollNum)
    if (severity === 'ok') severity = 'warn'
  }

  return {
    row: rowNumber,
    enrollment_number: enrollNum,
    full_name: `${first} ${last}`.trim(),
    first_name: first,
    last_name: last,
    career_code: careerCode,
    career_name: career?.name ?? 'Desconocida',
    career_id: career?.id ?? 0,
    semester,
    already_exists: exists,
    severity,
    issues,
  }
}

/** Parsear texto plano (PDF, CSV, TXT) buscando líneas con No. de Control de 9 dígitos */
function parseStudentsFromText(
  text: string,
  careerMap: Record<string, { id: number; name: string }>,
  order: NameOrder
): { students: ParsedStudent[]; warnings: string[] } {
  const students: ParsedStudent[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  // Formatos soportados por línea, por ejemplo:
  //   "1 F 233107286 DIAZ ARCOS JOANNA JOCELYN"
  //   "1,233107216,MARTINEZ ESTRADA DIEGO"
  //   "233107216  MARTINEZ ESTRADA DIEGO  4"
  const lines = text.split(/\r?\n/)
  const enrollRegex = /\b(\d{9})\b/
  let rowNumber = 0

  for (const line of lines) {
    rowNumber++
    // Normalizar separadores de CSV/TSV a espacios para reutilizar la misma lógica
    const normalized = line.replace(/[;,\t|]+/g, ' ')
    const match = normalized.match(enrollRegex)
    if (!match) continue

    const enrollNum = match[1]
    if (seen.has(enrollNum)) {
      warnings.push(`Línea ${rowNumber}: el No. de Control ${enrollNum} aparece repetido en el archivo`)
      continue
    }
    seen.add(enrollNum)

    const cleanNamePart = (raw: string) => raw
      .replace(/\d+(\.\d+)?/g, ' ')                 // quitar números (fila, calificaciones)
      .replace(/\b[MF]\b/g, ' ')                    // quitar marca de sexo M/F
      .replace(/[_.]{2,}/g, ' ')                    // quitar líneas de firma
      .replace(/\s{2,}/g, ' ')
      .trim()

    // El nombre normalmente va después del No. de Control
    const idx = normalized.indexOf(enrollNum)
    let fullName = cleanNamePart(normalized.substring(idx + 9))

    // Si no hay nombre después, intentar antes del número
    if (fullName.length < 3) {
      fullName = cleanNamePart(normalized.substring(0, idx))
    }

    students.push(buildRow(rowNumber, enrollNum, fullName, careerMap, order))
  }

  return { students, warnings }
}

/** Parsear archivo Excel (.xlsx/.xls) buscando columnas con No. de Control */
async function parseExcelFile(
  filePath: string,
  careerMap: Record<string, { id: number; name: string }>,
  order: NameOrder,
  mapping?: ColumnMapping
): Promise<{ students: ParsedStudent[]; warnings: string[]; meta: DetectedMeta }> {
  const ExcelJS = require('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const students: ParsedStudent[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  // Volcar las primeras filas de cada hoja a texto para detectar el encabezado
  const headerLines: string[] = []
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
      const cells: string[] = []
      sheet.getRow(r).eachCell((cell: any) => {
        const v = String(cell.value ?? '').trim()
        if (v) cells.push(v)
      })
      if (cells.length) headerLines.push(cells.join('  '))
    }
  }
  const meta = detectMeta(headerLines.join('\n'))

  // Si la profesora eligió una hoja concreta, se respeta su decisión
  const sheets = mapping?.sheet
    ? workbook.worksheets.filter((s: any) => s.name === mapping.sheet)
    : workbook.worksheets

  if (mapping?.sheet && !sheets.length) {
    warnings.push(`No se encontró la hoja "${mapping.sheet}"; se revisaron todas.`)
  }

  for (const sheet of (sheets.length ? sheets : workbook.worksheets)) {
    let enrollCol = mapping?.enrollment ?? -1
    let nameCol = mapping?.full_name ?? -1
    const firstCol = mapping?.first_name ?? -1
    const lastCol = mapping?.last_name ?? -1
    const semCol = mapping?.semester ?? -1

    // Solo se detecta sola si no vino un mapeo manual
    if (enrollCol <= 0) {
      enrollCol = -1
      nameCol = -1
      const headerRow = sheet.getRow(1)

      headerRow.eachCell((cell: any, colNumber: number) => {
        const val = String(cell.value ?? '').toLowerCase()
        if (val.includes('control') || val.includes('matrícula') || val.includes('matricula')) {
          enrollCol = colNumber
        }
        if (val.includes('nombre') || val.includes('alumno')) {
          nameCol = colNumber
        }
      })

      // Si no encontramos headers, buscar en las primeras 5 filas
      if (enrollCol === -1) {
        for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
          const row = sheet.getRow(r)
          row.eachCell((cell: any, colNumber: number) => {
            const val = String(cell.value ?? '').toLowerCase()
            if (val.includes('control') || val.includes('matrícula') || val.includes('matricula')) {
              enrollCol = colNumber
            }
            if (val.includes('nombre') || val.includes('alumno')) {
              nameCol = colNumber
            }
          })
          if (enrollCol !== -1) break
        }
      }

      // Si aún no, buscar cualquier celda con 9 dígitos y asumir esa columna
      if (enrollCol === -1) {
        for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
          const row = sheet.getRow(r)
          row.eachCell((cell: any, colNumber: number) => {
            const val = String(cell.value ?? '').trim()
            if (/^\d{9}$/.test(val) && enrollCol === -1) {
              enrollCol = colNumber
              // El nombre suele estar en la columna siguiente
              if (nameCol === -1) nameCol = colNumber + 1
            }
          })
          if (enrollCol !== -1) break
        }
      }
    }

    if (enrollCol === -1) continue

    const startRow = mapping?.data_start_row && mapping.data_start_row > 0
      ? mapping.data_start_row : 1

    for (let r = startRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r)
      const cellText = (c: number) => c > 0 ? String(row.getCell(c).value ?? '').trim() : ''
      const enrollVal = cellText(enrollCol)

      if (!/^\d{9}$/.test(enrollVal)) continue
      if (seen.has(enrollVal)) {
        warnings.push(`Fila ${r}: el No. de Control ${enrollVal} aparece repetido en el archivo`)
        continue
      }
      seen.add(enrollVal)

      // Con columnas separadas de nombre y apellido no hace falta adivinar
      let fullName = ''
      if (firstCol > 0 || lastCol > 0) {
        fullName = order === 'last_first'
          ? `${cellText(lastCol)} ${cellText(firstCol)}`.trim()
          : `${cellText(firstCol)} ${cellText(lastCol)}`.trim()
      } else if (nameCol > 0) {
        fullName = cellText(nameCol)
      }

      // Último recurso: la primera celda con letras a la derecha del número
      if (!fullName) {
        for (let c = enrollCol + 1; c <= enrollCol + 3; c++) {
          const v = cellText(c)
          if (v && /[a-záéíóúñ]/i.test(v)) { fullName = v; break }
        }
      }

      const semRaw = semCol > 0 ? Number(cellText(semCol)) : NaN
      students.push(buildRow(
        r, enrollVal, fullName, careerMap, order,
        Number.isFinite(semRaw) ? semRaw : undefined
      ))
    }
  }

  return { students, warnings, meta }
}

/**
 * Lee la estructura del archivo sin importar nada.
 *
 * Sirve para que la profesora vea qué entendió el programa y corrija la
 * asignación de columnas antes de tocar la base de datos.
 */
async function inspectFile(filePath: string, sheetName?: string): Promise<FileInspection> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)

  if (ext === '.xlsx' || ext === '.xls') {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)

    const sheets: string[] = wb.worksheets.map((s: any) => s.name)

    // La primera hoja suele ser un resumen o portada. Se abre la primera que
    // realmente traiga matrículas para que no vea columnas que no le sirven.
    const hasEnrollments = (sh: any) => {
      for (let r = 1; r <= Math.min(40, sh.rowCount); r++) {
        for (let c = 1; c <= Math.min(15, sh.columnCount || 15); c++) {
          if (/^\d{9}$/.test(String(sh.getRow(r).getCell(c).value ?? '').trim())) return true
        }
      }
      return false
    }

    const sheet = (sheetName && wb.worksheets.find((s: any) => s.name === sheetName))
      || wb.worksheets.find(hasEnrollments)
      || wb.worksheets[0]

    const maxCol = Math.min(sheet.columnCount || 12, 20)
    const maxRow = Math.min(sheet.rowCount || 10, 14)

    const previewRows: string[][] = []
    for (let r = 1; r <= maxRow; r++) {
      const cells: string[] = []
      for (let c = 1; c <= maxCol; c++) {
        cells.push(String(sheet.getRow(r).getCell(c).value ?? '').trim())
      }
      previewRows.push(cells)
    }

    // El encabezado es la primera fila que tenga texto en varias columnas
    let headerIdx = 0
    for (let i = 0; i < previewRows.length; i++) {
      const filled = previewRows[i].filter(v => v).length
      if (filled >= 2) { headerIdx = i; break }
    }

    const columns = []
    for (let c = 1; c <= maxCol; c++) {
      const sample = previewRows.slice(headerIdx + 1).map(row => row[c - 1] ?? '')
      columns.push({
        index: c,
        header: previewRows[headerIdx]?.[c - 1] || `Columna ${c}`,
        sample: sample.filter(v => v).slice(0, 3),
      })
    }

    const suggested = suggestMapping(columns, previewRows, headerIdx)
    suggested.sheet = sheet.name

    return {
      file_name: fileName, kind: 'excel', sheets, columns,
      preview_rows: previewRows.slice(0, 8),
      suggested,
      message: suggested.enrollment
        ? ''
        : 'No se encontró una columna con No. de Control en esta hoja. Si la lista está en otra, cámbiala arriba.',
    }
  }

  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    const text = fs.readFileSync(filePath, 'utf-8')
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 12)
    // Se elige el separador que produzca más columnas
    const sep = [',', ';', '\t', '|']
      .map(s => ({ s, n: (lines[0]?.split(s).length ?? 1) }))
      .sort((a, b) => b.n - a.n)[0]

    const previewRows = lines.map(l => l.split(sep.s).map(v => v.trim()))
    const maxCol = Math.max(...previewRows.map(r => r.length))
    const columns = []
    for (let c = 1; c <= maxCol; c++) {
      columns.push({
        index: c,
        header: previewRows[0]?.[c - 1] || `Columna ${c}`,
        sample: previewRows.slice(1, 4).map(r => r[c - 1] ?? '').filter(v => v),
      })
    }

    return {
      file_name: fileName, kind: 'text', sheets: [], columns,
      preview_rows: previewRows.slice(0, 8),
      suggested: suggestMapping(columns, previewRows, 0),
      message: sep.n <= 1
        ? 'No se detectaron columnas separadas; se leerá línea por línea.'
        : '',
    }
  }

  return {
    file_name: fileName, kind: 'pdf', sheets: [], columns: [], preview_rows: [],
    suggested: {},
    message: 'Los PDF no tienen columnas: se lee cada renglón buscando el No. de Control de 9 dígitos.',
  }
}

/** Adivina qué columna es cuál, mirando el encabezado y el contenido */
function suggestMapping(
  columns: { index: number; header: string; sample: string[] }[],
  rows: string[][],
  headerIdx: number
): ColumnMapping {
  const m: ColumnMapping = { data_start_row: headerIdx + 2 }

  for (const col of columns) {
    const h = normalize(col.header)
    const hasNineDigits = col.sample.some(v => /^\d{9}$/.test(v))

    if (!m.enrollment && (hasNineDigits || h.includes('CONTROL') || h.includes('MATRICULA')))
      m.enrollment = col.index
    else if (!m.full_name && (h.includes('NOMBRE') || h.includes('ALUMNO') || h.includes('ESTUDIANTE')))
      m.full_name = col.index
    else if (!m.last_name && h.includes('APELLIDO'))
      m.last_name = col.index
    else if (!m.semester && (h.includes('SEMESTRE') || h === 'SEM'))
      m.semester = col.index
    else if (!m.score && (h.includes('CALIF') || h.includes('NOTA') || h.includes('EVALUA')))
      m.score = col.index
  }

  return m
}

/** Una calificación leída del archivo, ya cruzada con la lista del grupo */
export interface ParsedScore {
  row: number
  enrollment_number: string
  student_name: string
  /** 0 si el alumno no está inscrito en el grupo elegido */
  enrollment_id: number
  score: number | null
  score_label: string
  /** Calificación que ya tenía registrada, si la había */
  current_score: number | null
  severity: RowSeverity
  issues: string[]
}

export interface ScoreParseResult {
  file_name: string
  group_label: string
  rows: ParsedScore[]
  /** Inscritos del grupo que no aparecieron en el archivo */
  missing: string[]
}

/**
 * Saca pares "matrícula → calificación" de cualquier formato.
 *
 * Se busca deliberadamente un número de una sola cifra 0-4: en las listas
 * oficiales conviven la matrícula, el número de fila y a veces el porcentaje de
 * asistencia, y tomar "el último número" traía la columna equivocada.
 */
async function readScorePairs(
  filePath: string,
  mapping?: ColumnMapping
): Promise<{ row: number; enrollment_number: string; score: number | null }[]> {
  const ext = path.extname(filePath).toLowerCase()
  const out: { row: number; enrollment_number: string; score: number | null }[] = []

  if (ext === '.xlsx' || ext === '.xls') {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)

    const sheets = mapping?.sheet
      ? wb.worksheets.filter((s: any) => s.name === mapping.sheet)
      : wb.worksheets

    for (const sheet of (sheets.length ? sheets : wb.worksheets)) {
      let enrollCol = mapping?.enrollment ?? 0
      let scoreCol = mapping?.score ?? 0

      // Detección automática por encabezado si no vino mapeo
      if (!enrollCol || !scoreCol) {
        for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
          sheet.getRow(r).eachCell((cell: any, c: number) => {
            const v = normalize(String(cell.value ?? ''))
            if (!enrollCol && (v.includes('CONTROL') || v.includes('MATRICULA'))) enrollCol = c
            if (!scoreCol && (v.includes('CALIF') || v.includes('NOTA') || v.includes('EVALUA'))) scoreCol = c
          })
          if (enrollCol && scoreCol) break
        }
      }
      if (!enrollCol) continue

      for (let r = 1; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r)
        const enrollVal = String(row.getCell(enrollCol).value ?? '').trim()
        if (!/^\d{9}$/.test(enrollVal)) continue

        let score: number | null = null
        if (scoreCol) {
          const raw = String(row.getCell(scoreCol).value ?? '').trim()
          const n = Number(raw)
          score = raw !== '' && Number.isFinite(n) ? n : null
        } else {
          // Sin columna identificada, se busca el primer 0-4 a la derecha
          for (let c = enrollCol + 1; c <= Math.min(enrollCol + 8, sheet.columnCount); c++) {
            const raw = String(row.getCell(c).value ?? '').trim()
            if (/^[0-4]$/.test(raw)) { score = Number(raw); break }
          }
        }
        out.push({ row: r, enrollment_number: enrollVal, score })
      }
    }
    return out
  }

  // PDF y texto plano: se lee renglón por renglón
  let text = ''
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse')
    const parser = new PDFParse({ data: fs.readFileSync(filePath) })
    try {
      const data = await parser.getText()
      text = String(data?.text ?? '')
    } finally {
      await parser.destroy()
    }
    if (!text.trim()) {
      throw new Error('El PDF no contiene texto seleccionable; usa el archivo de Excel')
    }
  } else {
    text = fs.readFileSync(filePath, 'utf-8')
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].replace(/[;,\t|]+/g, ' ')
    const m = normalized.match(/\b(\d{9})\b/)
    if (!m) continue

    // Solo se mira lo que va después de la matrícula, nunca el número de fila
    const after = normalized.substring(normalized.indexOf(m[1]) + 9)
    const digits = after.match(/(?:^|\s)([0-4])(?:\s|$)/)
    out.push({
      row: i + 1,
      enrollment_number: m[1],
      score: digits ? Number(digits[1]) : null,
    })
  }
  return out
}

export function registerImportHandlers(ipcMain: IpcMain, dialog: Dialog) {
  // Abrir diálogo para seleccionar archivo
  ipcMain.handle('import:selectFile', async (): Promise<IpcResult<{ filePath: string; fileName: string }>> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Seleccionar archivo para importar',
        filters: [
          { name: 'Archivos soportados', extensions: ['pdf', 'xlsx', 'xls', 'csv', 'txt', 'tsv'] },
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'Excel', extensions: ['xlsx', 'xls'] },
          { name: 'Texto / CSV', extensions: ['csv', 'txt', 'tsv'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || !result.filePaths.length) {
        return { ok: false, error: 'Operación cancelada' }
      }

      const filePath = result.filePaths[0]
      return { ok: true, data: { filePath, fileName: path.basename(filePath) } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  /**
   * Revisar la estructura del archivo sin importar nada.
   * Devuelve columnas, hojas y una sugerencia de mapeo.
   */
  ipcMain.handle('import:inspectFile', async (_e, filePath: string, sheet?: string): Promise<IpcResult<FileInspection>> => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'El archivo no existe' }
      return { ok: true, data: await inspectFile(filePath, sheet) }
    } catch (e: any) {
      return { ok: false, error: `No se pudo revisar el archivo: ${e.message}` }
    }
  })

  // Parsear archivo y devolver preview
  ipcMain.handle('import:parseFile', async (_e, filePath: string, options?: NameOrder | ParseOptions): Promise<IpcResult<ParseResult>> => {
    try {
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: 'El archivo no existe' }
      }

      // Se acepta el formato viejo (solo el orden del nombre) para no romper
      // las pantallas que todavía llaman con un string.
      const opts: ParseOptions = typeof options === 'string'
        ? { nameOrder: options }
        : (options ?? {})

      const ext = path.extname(filePath).toLowerCase()
      const careerMap = getCareerMap()
      const order: NameOrder = opts.nameOrder ?? 'last_first'

      if (!Object.keys(careerMap).length) {
        return { ok: false, error: 'No hay carreras registradas. Registra el catálogo de carreras antes de importar.' }
      }

      let result: { students: ParsedStudent[]; warnings: string[] }
      let meta: DetectedMeta = { ...EMPTY_META }

      if (ext === '.pdf') {
        const { PDFParse } = require('pdf-parse')
        const buffer = fs.readFileSync(filePath)
        const parser = new PDFParse({ data: buffer })
        try {
          const pdfData = await parser.getText()
          const text = String(pdfData?.text ?? '')
          if (!text.trim()) {
            return {
              ok: false,
              error: 'El PDF no contiene texto seleccionable. Parece ser un documento escaneado como imagen; usa el archivo de Excel o un PDF con texto.',
            }
          }
          meta = detectMeta(text)
          result = parseStudentsFromText(text, careerMap, order)
        } finally {
          await parser.destroy()
        }
      } else if (ext === '.xlsx' || ext === '.xls') {
        const parsed = await parseExcelFile(filePath, careerMap, order, opts.mapping)
        result = parsed
        meta = parsed.meta
      } else if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
        const text = fs.readFileSync(filePath, 'utf-8')
        meta = detectMeta(text)
        result = parseStudentsFromText(text, careerMap, order)
      } else {
        // Intentar como texto plano para cualquier otra extensión
        try {
          const text = fs.readFileSync(filePath, 'utf-8')
          meta = detectMeta(text)
          result = parseStudentsFromText(text, careerMap, order)
        } catch {
          return { ok: false, error: `Formato no soportado: ${ext || 'sin extensión'}` }
        }
      }

      if (!result.students.length) {
        return { ok: false, error: 'No se encontraron estudiantes en el archivo. Verifica que contenga números de control de 9 dígitos.' }
      }

      return {
        ok: true,
        data: {
          students: result.students,
          file_name: path.basename(filePath),
          total_lines: result.students.length,
          warnings: result.warnings,
          meta,
        }
      }
    } catch (e: any) {
      return { ok: false, error: `Error al leer el archivo: ${e.message}` }
    }
  })

  /**
   * Confirmar importación.
   * Puede crear periodo, complementaria y grupo si no existen, dar de alta a los
   * estudiantes e inscribirlos, todo dentro de una sola transacción.
   */
  ipcMain.handle('import:confirm', (_e, opts: ImportOptions): IpcResult<ImportSummary> => {
    try {
      const summary: ImportSummary = {
        inserted: 0, updated: 0, enrolled: 0, skipped: 0,
        created_period: '', created_complementary: '', created_group: '',
        group_label: '', issues: [],
      }

      db.transaction(() => {
        // ─── 1. Resolver o crear el periodo ────────────────────────────
        let periodId = opts.period_id ?? 0
        if (!periodId && opts.new_period?.name) {
          const name = opts.new_period.name.trim()
          const found = db.get('SELECT id FROM school_periods WHERE name = ?', [name]) as any
          if (found) {
            periodId = found.id
          } else {
            const { lastInsertRowid } = db.run(
              'INSERT INTO school_periods (name, start_date, end_date, is_active) VALUES (?, ?, ?, ?)',
              [name, opts.new_period.start_date, opts.new_period.end_date, opts.new_period.is_active ? 1 : 0]
            )
            periodId = lastInsertRowid
            summary.created_period = name
          }
          // Si se marcó como activo, desactivar los demás
          if (opts.new_period.is_active) {
            db.run('UPDATE school_periods SET is_active = 0 WHERE id != ?', [periodId])
            db.run('UPDATE school_periods SET is_active = 1 WHERE id = ?', [periodId])
          }
        }

        // ─── 2. Resolver o crear la complementaria ─────────────────────
        let complementaryId = opts.complementary_id ?? 0
        if (!complementaryId && opts.new_complementary?.name) {
          const name = opts.new_complementary.name.trim()
          const found = db.get('SELECT id FROM complementaries WHERE name = ?', [name]) as any
          if (found) {
            complementaryId = found.id
          } else {
            const { lastInsertRowid } = db.run(
              'INSERT INTO complementaries (name, description) VALUES (?, ?)',
              [name, opts.new_complementary.description ?? '']
            )
            complementaryId = lastInsertRowid
            summary.created_complementary = name
          }
        }

        // ─── 3. Resolver o crear el grupo ──────────────────────────────
        let groupId = opts.group_id ?? 0
        if (!groupId && opts.new_group?.group_number && complementaryId && periodId) {
          const num = opts.new_group.group_number.trim()
          const found = db.get(
            'SELECT id FROM groups WHERE complementary_id = ? AND period_id = ? AND group_number = ?',
            [complementaryId, periodId, num]
          ) as any
          if (found) {
            groupId = found.id
          } else {
            const { lastInsertRowid } = db.run(
              `INSERT INTO groups (complementary_id, period_id, group_number, capacity, classroom, days, start_time, end_time)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [complementaryId, periodId, num,
               opts.new_group.capacity ?? 40,
               opts.new_group.classroom ?? '',
               opts.new_group.days ?? '',
               opts.new_group.start_time ?? '',
               opts.new_group.end_time ?? '']
            )
            groupId = lastInsertRowid
            summary.created_group = num
          }
        }

        // Datos del grupo destino para validar cupo y duplicados
        const targetGroup = groupId
          ? db.get(`SELECT g.*, comp.name AS complementary_name
                    FROM groups g JOIN complementaries comp ON comp.id = g.complementary_id
                    WHERE g.id = ?`, [groupId]) as any
          : null

        if (targetGroup) {
          summary.group_label = `${targetGroup.complementary_name} - ${targetGroup.group_number}`
        }

        // Cupo disponible al inicio de la importación
        let freeSlots = Infinity
        if (targetGroup) {
          const countRow = db.get(
            "SELECT COUNT(*) AS n FROM enrollments WHERE group_id = ? AND status = 'active'",
            [groupId]
          ) as any
          freeSlots = Number(targetGroup.capacity) - Number(countRow?.n ?? 0)
        }

        // ─── 4. Estudiantes e inscripciones ────────────────────────────
        for (const s of opts.students) {
          const label = `${s.enrollment_number} ${s.last_name} ${s.first_name}`.trim()

          if (!/^\d{9}$/.test(s.enrollment_number)) {
            summary.issues.push({ type: 'matricula_invalida', student: label,
              detail: 'El número de control debe tener 9 dígitos' })
            summary.skipped++
            continue
          }

          if (!s.career_id) {
            summary.issues.push({ type: 'carrera_no_encontrada', student: label,
              detail: `No existe una carrera con el código ${s.career_code}` })
            summary.skipped++
            continue
          }

          const existing = db.get(
            'SELECT id FROM students WHERE enrollment_number = ?',
            [s.enrollment_number]
          ) as any

          let studentId: number
          if (existing) {
            studentId = existing.id as number
            if (!opts.skip_existing) {
              db.run(
                `UPDATE students SET first_name = ?, last_name = ?, career_id = ?, semester = ?,
                 email = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
                [s.first_name, s.last_name, s.career_id, s.semester,
                 institutionalEmail(s.enrollment_number), studentId]
              )
              summary.updated++
            }
          } else {
            const { lastInsertRowid } = db.run(
              `INSERT INTO students (enrollment_number, first_name, last_name, career_id, semester, email)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [s.enrollment_number, s.first_name, s.last_name, s.career_id, s.semester,
               institutionalEmail(s.enrollment_number)]
            )
            studentId = lastInsertRowid
            summary.inserted++
          }

          if (!targetGroup) continue

          // Duplicado por complementaria y periodo, no por grupo:
          // el estudiante puede cursar otras complementarias sin problema.
          const dup = db.get(`
            SELECT g.group_number
            FROM enrollments e
            JOIN groups g ON g.id = e.group_id
            WHERE e.student_id = ?
              AND g.complementary_id = ?
              AND g.period_id = ?
              AND e.status = 'active'
          `, [studentId, targetGroup.complementary_id, targetGroup.period_id]) as any

          if (dup) {
            const sameGroup = dup.group_number === targetGroup.group_number
            summary.issues.push({
              type: 'ya_inscrito',
              student: label,
              detail: sameGroup
                ? `Ya está inscrito en este grupo (${dup.group_number})`
                : `Ya cursa ${targetGroup.complementary_name} en el grupo ${dup.group_number} de este periodo`,
            })
            continue
          }

          if (freeSlots <= 0) {
            summary.issues.push({ type: 'cupo_lleno', student: label,
              detail: `El grupo alcanzó su cupo de ${targetGroup.capacity}` })
            continue
          }

          // Reactivar una baja previa en lugar de duplicar el registro
          const cancelled = db.get(
            "SELECT id FROM enrollments WHERE student_id = ? AND group_id = ? AND status = 'cancelled'",
            [studentId, groupId]
          ) as any

          if (cancelled) {
            db.run("UPDATE enrollments SET status='active', observations='Reinscrito por importación' WHERE id = ?",
              [cancelled.id])
          } else {
            db.run('INSERT INTO enrollments (student_id, group_id) VALUES (?, ?)', [studentId, groupId])
          }
          summary.enrolled++
          freeSlots--
        }
      })

      return { ok: true, data: summary }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Importación de CALIFICACIONES
  //
  // Va aparte del alta de alumnos a propósito: son dos momentos distintos del
  // semestre y mezclarlos haría que un archivo de calificaciones diera de alta
  // estudiantes por accidente. Aquí nunca se crea ni se modifica un alumno.
  // ═══════════════════════════════════════════════════════════════════════

  /** Leer un archivo y cruzar sus calificaciones contra los inscritos del grupo */
  ipcMain.handle('import:parseScores', async (_e, args: {
    filePath: string
    group_id: number
    mapping?: ColumnMapping
  }): Promise<IpcResult<ScoreParseResult>> => {
    try {
      const { filePath, group_id } = args
      if (!fs.existsSync(filePath)) return { ok: false, error: 'El archivo no existe' }
      if (!group_id) return { ok: false, error: 'Selecciona el grupo al que pertenecen las calificaciones' }

      const group = db.get(`
        SELECT g.id, g.group_number, comp.name AS complementary_name, p.name AS period_name
        FROM groups g
        JOIN complementaries comp ON comp.id = g.complementary_id
        JOIN school_periods p ON p.id = g.period_id
        WHERE g.id = ?`, [group_id]) as any
      if (!group) return { ok: false, error: 'El grupo no existe' }

      // Inscritos del grupo, indexados por matrícula
      const roster = db.all(`
        SELECT e.id AS enrollment_id, s.enrollment_number,
               s.last_name || ' ' || s.first_name AS student_name,
               ev.score AS current_score, ev.status AS ev_status
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN evaluations ev ON ev.enrollment_id = e.id
        WHERE e.group_id = ? AND e.status = 'active'`, [group_id]) as any[]

      const byEnroll = new Map<string, any>()
      for (const r of roster) byEnroll.set(String(r.enrollment_number), r)

      const pairs = await readScorePairs(filePath, args.mapping)
      if (!pairs.length) {
        return {
          ok: false,
          error: 'No se encontró ninguna calificación en el archivo. Debe tener el No. de Control y un número del 0 al 4.',
        }
      }

      const rows: ParsedScore[] = []
      const seen = new Set<string>()

      for (const p of pairs) {
        if (seen.has(p.enrollment_number)) continue
        seen.add(p.enrollment_number)

        const issues: string[] = []
        let severity: RowSeverity = 'ok'

        const member = byEnroll.get(p.enrollment_number)
        if (!member) {
          issues.push('No está inscrito en este grupo')
          severity = 'error'
        }

        const scoreError = p.score === null ? 'No se leyó una calificación' : validateScore(p.score)
        if (scoreError) {
          issues.push(scoreError)
          severity = 'error'
        }

        if (member?.ev_status === 'closed') {
          issues.push('El acta está cerrada; reábrela para poder cambiarla')
          severity = 'error'
        }

        const current = member?.current_score
        if (severity !== 'error' && current !== null && current !== undefined) {
          if (Number(current) === p.score) {
            issues.push('Ya tiene esta misma calificación; no cambia nada')
          } else {
            issues.push(`Se reemplazará ${current} (${scoreLabel(Number(current))}) por ${p.score}`)
            severity = 'warn'
          }
        }

        rows.push({
          row: p.row,
          enrollment_number: p.enrollment_number,
          student_name: member?.student_name ?? '(no encontrado)',
          enrollment_id: member?.enrollment_id ?? 0,
          score: p.score,
          score_label: p.score === null ? '' : scoreLabel(p.score),
          current_score: current === null || current === undefined ? null : Number(current),
          severity,
          issues,
        })
      }

      // Los que están en el grupo pero no venían en el archivo
      const missing = roster
        .filter(r => !seen.has(String(r.enrollment_number)))
        .map(r => `${r.student_name} (${r.enrollment_number})`)

      return {
        ok: true,
        data: {
          file_name: path.basename(filePath),
          group_label: `${group.complementary_name} · ${group.group_number} · ${group.period_name}`,
          rows,
          missing,
        },
      }
    } catch (e: any) {
      return { ok: false, error: `Error al leer el archivo: ${e.message}` }
    }
  })

  /** Guardar las calificaciones ya revisadas */
  ipcMain.handle('import:confirmScores', (_e, args: {
    group_id: number
    rows: ParsedScore[]
  }): IpcResult<{ saved: number; skipped: number; errors: string[] }> => {
    try {
      let saved = 0
      let skipped = 0
      const errors: string[] = []

      db.transaction(() => {
        for (const r of args.rows) {
          // Se vuelve a validar aquí: la interfaz pudo quedar desfasada si la
          // profesora dejó la pantalla abierta y cerró el acta en otra pestaña.
          if (!r.enrollment_id || r.score === null) { skipped++; continue }

          const scoreError = validateScore(r.score)
          if (scoreError) { errors.push(`${r.enrollment_number}: ${scoreError}`); continue }

          const editError = assertEditable(r.enrollment_id)
          if (editError) { errors.push(`${r.enrollment_number}: ${editError}`); continue }

          persistScore(r.enrollment_id, r.score, 'Capturada por importación de archivo')
          saved++
        }
      })

      const group = db.get(`
        SELECT comp.name AS c, g.group_number AS g, p.name AS p
        FROM groups g
        JOIN complementaries comp ON comp.id = g.complementary_id
        JOIN school_periods p ON p.id = g.period_id
        WHERE g.id = ?`, [args.group_id]) as any

      logAudit({
        action: 'evaluation.import',
        entity: 'group',
        entity_id: args.group_id,
        context: group ? `${group.c} · ${group.g} · ${group.p}` : `Grupo ${args.group_id}`,
        after_value: `${saved} calificación(es) importadas`,
        detail: `${skipped} omitidas, ${errors.length} con error`,
      })

      return { ok: true, data: { saved, skipped, errors } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })
}
