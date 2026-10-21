import { IpcMain, Dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import * as db from '../database/db'
import type { IpcResult, AppSettings } from '../../shared/types'
import { logAudit } from '../session'
import { loadDemoData, clearDemoData, getDemoStatus } from '../database/demoData'

/** Valores usados cuando la clave todavía no existe en la base */
const FALLBACK: AppSettings = {
  institution_name: '',
  department_name: '',
  teacher_name: '',
  teacher_email: '',
  teacher_phone: '',
  logo_path: '',
  passing_score: 3,
  reports_folder: '',
  idle_minutes: 30,
}

/** Etiquetas legibles para la bitácora */
const LABELS: Record<string, string> = {
  institution_name: 'Institución',
  department_name: 'Departamento',
  teacher_name: 'Docente',
  teacher_email: 'Correo',
  teacher_phone: 'Teléfono',
  logo_path: 'Logo',
  passing_score: 'Calificación mínima aprobatoria',
  reports_folder: 'Carpeta de reportes',
  idle_minutes: 'Minutos de inactividad',
}

/** Lee toda la configuración; se usa también desde reportes */
export function readSettings(): AppSettings {
  const out: Record<string, string> = {}
  for (const row of db.all('SELECT key, value FROM settings')) {
    out[String(row.key)] = String(row.value ?? '')
  }
  return {
    institution_name: out.institution_name ?? FALLBACK.institution_name,
    department_name: out.department_name ?? FALLBACK.department_name,
    teacher_name: out.teacher_name ?? FALLBACK.teacher_name,
    teacher_email: out.teacher_email ?? FALLBACK.teacher_email,
    teacher_phone: out.teacher_phone ?? FALLBACK.teacher_phone,
    logo_path: out.logo_path ?? FALLBACK.logo_path,
    passing_score: clampScore(out.passing_score),
    reports_folder: out.reports_folder ?? FALLBACK.reports_folder,
    idle_minutes: clampIdle(out.idle_minutes),
  }
}

function clampScore(raw: string | undefined): number {
  const n = Number(raw)
  // Un umbral de 0 aprobaría a todos y uno mayor a 4 reprobaría a todos
  if (!Number.isInteger(n) || n < 1 || n > 4) return FALLBACK.passing_score
  return n
}

function clampIdle(raw: string | undefined): number {
  const n = Number(raw)
  // Menos de 5 minutos volvería inusable el programa; más de 8 horas no protege
  if (!Number.isFinite(n) || n < 5 || n > 480) return FALLBACK.idle_minutes
  return Math.round(n)
}

function validate(next: Partial<AppSettings>): string | null {
  if (next.institution_name !== undefined && !next.institution_name.trim())
    return 'El nombre de la institución no puede quedar vacío'
  if (next.teacher_name !== undefined && !next.teacher_name.trim())
    return 'El nombre del docente no puede quedar vacío'

  if (next.teacher_email) {
    const email = next.teacher_email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'El correo no tiene un formato válido'
  }

  if (next.passing_score !== undefined) {
    const n = Number(next.passing_score)
    if (!Number.isInteger(n) || n < 1 || n > 4)
      return 'La calificación mínima aprobatoria debe estar entre 1 y 4'
  }

  if (next.idle_minutes !== undefined) {
    const n = Number(next.idle_minutes)
    if (!Number.isFinite(n) || n < 5 || n > 480)
      return 'El cierre por inactividad debe estar entre 5 y 480 minutos'
  }

  if (next.logo_path && !fs.existsSync(next.logo_path))
    return 'No se encontró el archivo del logo'

  // La carpeta puede estar momentáneamente fuera de alcance: una USB
  // desconectada o una carpeta de red sin conexión. Antes eso bloqueaba TODA la
  // pantalla de configuración, así que no se podía ni corregir el nombre del
  // docente hasta volver a conectar la memoria. Ahora solo se reclama cuando de
  // verdad se está eligiendo una carpeta nueva que no existe; si es la misma que
  // ya estaba guardada, se respeta y se intenta recrear al momento de exportar.
  if (next.reports_folder) {
    const folder = next.reports_folder.trim()
    const stored = readSettings().reports_folder
    if (folder && folder !== stored && !fs.existsSync(folder)) {
      try {
        fs.mkdirSync(folder, { recursive: true })
      } catch {
        return `No se pudo usar la carpeta "${folder}". Revisa que la unidad esté conectada.`
      }
    }
  }

  return null
}

export function registerSettingsHandlers(ipcMain: IpcMain, dialog: Dialog) {

  ipcMain.handle('settings:get', (): IpcResult<AppSettings> => {
    try {
      return { ok: true, data: readSettings() }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('settings:save', (_e, next: Partial<AppSettings>): IpcResult<AppSettings> => {
    try {
      const invalid = validate(next)
      if (invalid) return { ok: false, error: invalid }

      const before = readSettings() as unknown as Record<string, unknown>
      const changes: string[] = []

      db.transaction(() => {
        for (const [key, value] of Object.entries(next)) {
          if (!(key in FALLBACK)) continue
          const text = String(value ?? '').trim()
          if (String(before[key] ?? '') === text) continue

          db.run(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, datetime('now','localtime'))
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value, updated_at = excluded.updated_at`,
            [key, text])

          changes.push(`${LABELS[key] ?? key}: "${before[key] ?? ''}" → "${text}"`)
        }
      })

      if (changes.length) {
        logAudit({
          action: 'settings.update', entity: 'settings',
          detail: changes.join(' · '),
        })
      }

      return { ok: true, data: readSettings() }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // ─── Selección de logo y carpeta ───────────────────────────────────────

  ipcMain.handle('settings:pickLogo', async (): Promise<IpcResult<string>> => {
    try {
      const res = await dialog.showOpenDialog({
        title: 'Selecciona el logo institucional',
        filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg'] }],
        properties: ['openFile'],
      })
      if (res.canceled || !res.filePaths.length) return { ok: false, error: 'cancelado' }

      const file = res.filePaths[0]
      const size = fs.statSync(file).size
      // Un logo enorme haría lento cada reporte, se incrusta en base64
      if (size > 2 * 1024 * 1024)
        return { ok: false, error: 'La imagen pesa más de 2 MB. Usa una versión más ligera.' }

      return { ok: true, data: file }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Elegir la carpeta la guarda de inmediato, no cuando se presione "Guardar".
   *
   * Antes este canal solo devolvía la ruta y la ventana la dejaba en pantalla
   * esperando el botón. Quien elegía la carpeta ya daba el asunto por resuelto,
   * cerraba Configuración y los reportes seguían cayendo en Descargas. Elegir
   * una carpeta en un explorador de archivos ya es una decisión tomada, así que
   * se persiste ahí mismo y se devuelven todos los ajustes para que la pantalla
   * refleje lo que quedó en la base.
   */
  ipcMain.handle('settings:pickReportsFolder', async (): Promise<IpcResult<AppSettings>> => {
    try {
      const current = readSettings()
      const res = await dialog.showOpenDialog({
        title: 'Carpeta donde se guardarán los reportes',
        defaultPath: current.reports_folder || undefined,
        properties: ['openDirectory', 'createDirectory'],
      })
      if (res.canceled || !res.filePaths.length) return { ok: false, error: 'cancelado' }

      const folder = res.filePaths[0]
      db.run(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('reports_folder', ?, datetime('now','localtime'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value, updated_at = excluded.updated_at`, [folder])

      logAudit({
        action: 'settings.update', entity: 'settings',
        detail: `${LABELS.reports_folder}: "${current.reports_folder}" → "${folder}"`,
      })

      return { ok: true, data: readSettings() }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // ─── Datos de demostración ─────────────────────────────────────────────

  ipcMain.handle('demo:status', (): IpcResult => {
    try { return { ok: true, data: getDemoStatus() } }
    catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('demo:load', (): IpcResult => {
    try {
      const res = loadDemoData()
      logAudit({
        action: 'demo.load', entity: 'settings',
        detail: `${res.students} alumno(s) y ${res.groups} grupo(s) de práctica cargados`,
      })
      return { ok: true, data: res }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('demo:clear', (): IpcResult => {
    try {
      const res = clearDemoData()
      logAudit({
        action: 'demo.clear', entity: 'settings',
        detail: `${res.students} alumno(s), ${res.groups} grupo(s) y ` +
          `${res.enrollments} inscripción(es) de práctica retirados`,
      })
      return { ok: true, data: res }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}

/** Logo en base64 para incrustarlo en el PDF sin depender de rutas locales */
export function readLogoDataUrl(logoPath: string): string {
  try {
    if (!logoPath || !fs.existsSync(logoPath)) return ''
    const ext = path.extname(logoPath).toLowerCase().replace('.', '')
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
    return `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`
  } catch {
    // Un logo ilegible no debe impedir que salga el reporte
    return ''
  }
}
