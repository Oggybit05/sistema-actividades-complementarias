/**
 * Wrapper sobre sql.js para exponer una API similar a better-sqlite3.
 * sql.js es síncrono en sus operaciones, solo la inicialización es async.
 */
import { Database, QueryExecResult, SqlValue } from 'sql.js'
import { getDb, persistDb } from './connection'

type Row = Record<string, unknown>
type Params = SqlValue[]

function resultToRows(results: QueryExecResult[]): Row[] {
  if (!results.length) return []
  const { columns, values } = results[0]
  return values.map((row: SqlValue[]) =>
    Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]]))
  )
}

/** Ejecuta una consulta y devuelve todos los resultados */
export function all(sql: string, params: unknown[] = []): Row[] {
  const db = getDb()
  const results = db.exec(sql, params as Params)
  return resultToRows(results)
}

/** Ejecuta una consulta y devuelve el primer resultado */
export function get(sql: string, params: unknown[] = []): Row | undefined {
  return all(sql, params)[0]
}

/** Profundidad de transacción en curso: mientras sea > 0 no se guarda a disco */
let txDepth = 0

/** Ejecuta una sentencia de escritura y devuelve lastInsertRowid y filas afectadas */
export function run(sql: string, params: unknown[] = []): { lastInsertRowid: number; changes: number } {
  const db = getDb()
  db.run(sql, params as Params)
  const changes = db.getRowsModified()
  const rowid = (db.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] as number) ?? 0
  // Dentro de una transacción se persiste una sola vez, al confirmar
  if (txDepth === 0) persistDb()
  return { lastInsertRowid: rowid, changes }
}

/** Ejecuta múltiples sentencias en una transacción */
export function transaction(fn: () => void): void {
  const db = getDb()
  db.run('BEGIN')
  txDepth++
  try {
    fn()
    txDepth--
    db.run('COMMIT')
    persistDb()
  } catch (e) {
    txDepth--
    db.run('ROLLBACK')
    // El disco no se tocó durante la transacción, no hace falta restaurar
    throw e
  }
}
