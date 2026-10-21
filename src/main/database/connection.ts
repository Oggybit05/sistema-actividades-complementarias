import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { runMigrations } from './migrations'

let db: Database
let SQL: SqlJsStatic

export function getDb(): Database {
  return db
}

export async function initDatabase(): Promise<void> {
  const dbPath = getDbPath()

  // Localizar el wasm: en dev está en node_modules, en producción en resources
  let wasmPath: string
  if (app.isPackaged) {
    wasmPath = path.join(process.resourcesPath, 'sql-wasm.wasm')
  } else {
    wasmPath = path.join(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm')
  }

  SQL = await initSqlJs({ locateFile: () => wasmPath })

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath))
  } else {
    db = new SQL.Database()
  }

  // WAL no aplica en sql.js, pero sí foreign keys
  db.run('PRAGMA foreign_keys = ON')

  runMigrations(db)
  persistDb(dbPath)
  console.log('Base de datos inicializada en:', dbPath)
}

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'complementarias.db')
}

/** Abre un archivo .db en memoria sin tocar la base activa (para validar respaldos) */
export function openDatabaseFile(filePath: string): Database {
  return new SQL.Database(fs.readFileSync(filePath))
}

/** Descarta la base en memoria y la vuelve a leer del disco (tras restaurar) */
export function reloadFromDisk(): void {
  const dbPath = getDbPath()
  try { db.close() } catch { /* la instancia anterior ya no importa */ }
  db = new SQL.Database(fs.readFileSync(dbPath))
  db.run('PRAGMA foreign_keys = ON')
  runMigrations(db)
}

/**
 * Persiste el estado actual de la DB en disco de forma atómica.
 *
 * Se escribe primero un archivo temporal y después se renombra. Así un corte
 * de energía o un cierre forzado no puede dejar el archivo principal a medias,
 * que con una escritura directa significaría perder toda la información.
 */
export function persistDb(dbPath?: string): void {
  const target = dbPath ?? getDbPath()
  const tmp = target + '.tmp'
  const data = Buffer.from(db.export())

  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)          // fuerza la escritura física antes de reemplazar
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, target)  // el rename es atómico en NTFS
}
