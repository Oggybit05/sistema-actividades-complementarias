import { IpcMain, Dialog, Shell, App } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDbPath, openDatabaseFile, reloadFromDisk } from '../database/connection'
import * as db from '../database/db'
import type { IpcResult, BackupEntry, BackupInfo, DbSummary } from '../../shared/types'

/** Copias automáticas que se conservan antes de empezar a borrar las más viejas */
const MAX_AUTO_BACKUPS = 10

/**
 * Días tras los cuales se le recuerda sacar una copia fuera del programa.
 *
 * Las copias automáticas viven en el mismo disco: si esa computadora falla se
 * pierden junto con la base. Por eso el aviso es sobre la copia manual.
 */
const MANUAL_BACKUP_DAYS = 7

/** Movimientos acumulados que también disparan el recordatorio */
const MANUAL_BACKUP_CHANGES = 50

/** Tablas que debe contener un archivo para considerarse un respaldo válido */
const REQUIRED_TABLES = [
  'users', 'careers', 'school_periods', 'complementaries',
  'groups', 'students', 'enrollments',
]

let backupDir = ''
let metaPath = ''

function ensureDirs(app: App) {
  if (!backupDir) {
    backupDir = path.join(app.getPath('userData'), 'respaldos')
    metaPath = path.join(app.getPath('userData'), 'respaldos.json')
  }
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
}

interface Meta {
  last_manual_at?: string
  last_manual_path?: string
  last_auto_hash?: string
}

function readMeta(): Meta {
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { return {} }
}
function writeMeta(m: Meta) {
  try { fs.writeFileSync(metaPath, JSON.stringify(m, null, 2)) } catch { /* no crítico */ }
}

function hashFile(p: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** Lee los totales de un archivo .db sin tocar la base activa */
function summarize(filePath: string): DbSummary {
  let d
  try {
    d = openDatabaseFile(filePath)
  } catch {
    throw new Error('El archivo está dañado o no es una base de datos de este sistema')
  }
  try {
    const tables = new Set<string>()
    const res = d.exec("SELECT name FROM sqlite_master WHERE type='table'")
    if (res.length) for (const row of res[0].values) tables.add(String(row[0]))

    const missing = REQUIRED_TABLES.filter(t => !tables.has(t))
    if (missing.length) {
      throw new Error(`El archivo no es un respaldo de este sistema (faltan: ${missing.join(', ')})`)
    }

    const count = (t: string) => {
      const r = d.exec(`SELECT COUNT(*) FROM ${t}`)
      return r.length ? Number(r[0].values[0][0]) : 0
    }
    const periodRes = d.exec('SELECT name FROM school_periods ORDER BY name')
    const periods = periodRes.length ? periodRes[0].values.map(v => String(v[0])) : []

    return {
      students: count('students'),
      enrollments: count('enrollments'),
      groups: count('groups'),
      complementaries: count('complementaries'),
      evaluations: tables.has('evaluations') ? count('evaluations') : 0,
      periods,
    }
  } finally {
    d.close()
  }
}

function listBackups(): BackupEntry[] {
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = path.join(backupDir, f)
      const st = fs.statSync(full)
      return {
        file: f,
        path: full,
        created_at: st.mtime.toISOString(),
        size: st.size,
        kind: f.startsWith('auto_') ? 'auto' as const
          : f.startsWith('previo_') ? 'safety' as const
          : 'manual' as const,
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Borra las copias automáticas más antiguas que excedan el límite */
function rotate() {
  const autos = listBackups().filter(b => b.kind === 'auto')
  for (const old of autos.slice(MAX_AUTO_BACKUPS)) {
    try { fs.unlinkSync(old.path) } catch { /* si falla se reintenta luego */ }
  }
}

/**
 * Copia de seguridad justo antes de una operación que borra datos de verdad.
 *
 * Se guarda como `previo_`, igual que la que se hace antes de restaurar, para
 * que aparezca en la lista de respaldos y se pueda volver atrás desde la misma
 * pantalla. Devuelve la ruta, o cadena vacía si no se pudo: no vale abortar un
 * borrado que la usuaria ya confirmó porque falló la copia, pero sí conviene
 * poder decírselo.
 */
export function createSafetyBackup(): string {
  try {
    const src = getDbPath()
    if (!backupDir || !fs.existsSync(src)) return ''
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    const dest = path.join(backupDir, `previo_${stamp()}.db`)
    fs.copyFileSync(src, dest)
    return dest
  } catch { return '' }
}

/**
 * Crea una copia automática al arrancar. Si el contenido es idéntico al de la
 * última copia no genera un archivo nuevo, para no llenar el disco de copias
 * iguales cuando la profesora solo abre y cierra la aplicación.
 */
export function createAutoBackup(app: App): BackupEntry | null {
  try {
    ensureDirs(app)
    const src = getDbPath()
    if (!fs.existsSync(src)) return null

    const hash = hashFile(src)
    const meta = readMeta()
    if (meta.last_auto_hash === hash) return null

    const dest = path.join(backupDir, `auto_${stamp()}.db`)
    fs.copyFileSync(src, dest)
    writeMeta({ ...meta, last_auto_hash: hash })
    rotate()

    const st = fs.statSync(dest)
    return {
      file: path.basename(dest), path: dest,
      created_at: st.mtime.toISOString(), size: st.size, kind: 'auto',
    }
  } catch (e) {
    console.error('No se pudo crear el respaldo automático:', e)
    return null
  }
}

export function registerBackupHandlers(
  ipcMain: IpcMain,
  dialog: Dialog,
  shell: Shell,
  app: App
) {
  ensureDirs(app)

  /** Estado general: última copia, cuántas hay y qué contiene la base actual */
  ipcMain.handle('backup:info', (): IpcResult<BackupInfo> => {
    try {
      const src = getDbPath()
      const meta = readMeta()
      const backups = listBackups()

      const days = meta.last_manual_at
        ? Math.floor((Date.now() - new Date(meta.last_manual_at).getTime()) / 86400000)
        : null

      // Se cuenta la actividad real, no solo el tiempo: una semana sin usar el
      // programa no corre riesgo, pero 50 movimientos en dos días sí.
      let changes = 0
      try {
        const since = meta.last_manual_at ?? '1970-01-01'
        changes = Number(db.get(
          'SELECT COUNT(*) AS n FROM audit_log WHERE created_at > ?', [since]
        )?.n ?? 0)
      } catch { /* la bitácora puede no existir en bases viejas */ }

      return {
        ok: true,
        data: {
          db_path: src,
          db_size: fs.existsSync(src) ? fs.statSync(src).size : 0,
          folder: backupDir,
          backups,
          last_manual_at: meta.last_manual_at ?? null,
          last_manual_path: meta.last_manual_path ?? null,
          summary: fs.existsSync(src) ? summarize(src) : null,
          days_since_manual: days,
          needs_manual_backup: days === null
            || days >= MANUAL_BACKUP_DAYS
            || changes >= MANUAL_BACKUP_CHANGES,
          changes_since_manual: changes,
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /** Copia manual en la ubicación que elija la usuaria (USB, nube, etc.) */
  ipcMain.handle('backup:export', async (): Promise<IpcResult<string>> => {
    try {
      const src = getDbPath()
      const { filePath } = await dialog.showSaveDialog({
        title: 'Guardar respaldo',
        defaultPath: `respaldo_complementarias_${stamp()}.db`,
        filters: [{ name: 'Base de datos', extensions: ['db'] }],
      })
      if (!filePath) return { ok: false, error: 'Operación cancelada' }
      fs.copyFileSync(src, filePath)
      writeMeta({ ...readMeta(), last_manual_at: new Date().toISOString(), last_manual_path: filePath })
      return { ok: true, data: filePath }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /** Copia manual dentro de la carpeta de respaldos de la aplicación */
  ipcMain.handle('backup:createLocal', (): IpcResult<BackupEntry> => {
    try {
      const src = getDbPath()
      const dest = path.join(backupDir, `manual_${stamp()}.db`)
      fs.copyFileSync(src, dest)
      const st = fs.statSync(dest)
      return {
        ok: true,
        data: {
          file: path.basename(dest), path: dest,
          created_at: st.mtime.toISOString(), size: st.size, kind: 'manual',
        },
      }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Revisa un archivo y devuelve su contenido SIN reemplazar nada.
   * Sirve para que la usuaria vea qué va a recuperar antes de decidir.
   */
  ipcMain.handle('backup:inspect', (_e, filePath: string): IpcResult<DbSummary> => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'El archivo ya no existe' }
      return { ok: true, data: summarize(filePath) }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  /** Abre el diálogo, valida el archivo y devuelve su resumen */
  ipcMain.handle('backup:choose', async (): Promise<IpcResult<{ path: string; summary: DbSummary }>> => {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Elegir archivo de respaldo',
        filters: [{ name: 'Base de datos', extensions: ['db'] }],
        properties: ['openFile'],
      })
      if (!filePaths.length) return { ok: false, error: 'Operación cancelada' }
      return { ok: true, data: { path: filePaths[0], summary: summarize(filePaths[0]) } }
    } catch (e: any) {
      return { ok: false, error: `No se pudo leer el archivo: ${e.message}` }
    }
  })

  /**
   * Restaura desde un archivo ya validado. Antes de reemplazar guarda el
   * estado actual como copia "previo_", así siempre se puede deshacer.
   */
  ipcMain.handle('backup:restoreFrom', (_e, filePath: string): IpcResult<{ safety: string }> => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'El archivo ya no existe' }

      // Validar antes de tocar nada
      summarize(filePath)

      const dest = getDbPath()
      let safety = ''
      if (fs.existsSync(dest)) {
        safety = path.join(backupDir, `previo_${stamp()}.db`)
        fs.copyFileSync(dest, safety)
      }

      fs.copyFileSync(filePath, dest)
      reloadFromDisk()   // aplica el cambio sin reiniciar la aplicación

      return { ok: true, data: { safety: safety ? path.basename(safety) : '' } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('backup:delete', (_e, filePath: string): IpcResult => {
    try {
      if (path.dirname(filePath) !== backupDir)
        return { ok: false, error: 'Solo se pueden borrar copias de la carpeta de respaldos' }
      fs.unlinkSync(filePath)
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('backup:openFolder', async (): Promise<IpcResult> => {
    try {
      ensureDirs(app)
      await shell.openPath(backupDir)
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  /**
   * Abre el explorador con el archivo seleccionado.
   * Es lo que se necesita después de exportar: ver dónde quedó la copia para
   * poder arrastrarla a la USB sin buscarla a mano.
   */
  ipcMain.handle('backup:revealFile', (_e, filePath: string): IpcResult => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'El archivo ya no está en esa ubicación' }
      }
      shell.showItemInFolder(filePath)
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })

  // Compatibilidad con la versión anterior de la pantalla de Configuración
  ipcMain.handle('backup:import', async (): Promise<IpcResult> => {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Restaurar respaldo',
        filters: [{ name: 'Base de datos', extensions: ['db'] }],
        properties: ['openFile'],
      })
      if (!filePaths.length) return { ok: false, error: 'Operación cancelada' }
      summarize(filePaths[0])
      const dest = getDbPath()
      if (fs.existsSync(dest)) fs.copyFileSync(dest, path.join(backupDir, `previo_${stamp()}.db`))
      fs.copyFileSync(filePaths[0], dest)
      reloadFromDisk()
      return { ok: true }
    } catch (e: any) { return { ok: false, error: e.message } }
  })
}
