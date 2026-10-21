import * as db from './database/db'

/**
 * Usuario con sesión iniciada en el proceso principal.
 *
 * Se guarda aquí y no en el renderer porque la bitácora debe registrar quién
 * hizo cada cambio sin depender de que la interfaz lo mande en cada llamada:
 * si el dato viajara desde el renderer podría falsificarse o perderse.
 */
let currentUser: { id: number; username: string; full_name: string } | null = null

export function setCurrentUser(u: typeof currentUser) { currentUser = u }
export function getCurrentUser() { return currentUser }
export function clearCurrentUser() { currentUser = null }

/** Nombre a mostrar en la bitácora */
export function actorName(): string {
  return currentUser?.full_name || currentUser?.username || 'Sistema'
}

export interface AuditEntry {
  /** Identificador de la acción, p. ej. evaluation.update */
  action: string
  /** Tipo de dato afectado: evaluation, enrollment, student, backup, auth… */
  entity: string
  entity_id?: number | null
  student_name?: string
  enrollment_number?: string
  /** Complementaria, grupo y periodo, para ubicar el cambio */
  context?: string
  before_value?: string
  after_value?: string
  detail?: string
}

/**
 * Escribe una entrada en la bitácora.
 *
 * Nunca lanza: un fallo al registrar no debe impedir la operación académica
 * que el usuario está realizando. Se usa db.run, así que dentro de una
 * transacción la entrada se confirma o revierte junto con el cambio.
 */
export function logAudit(entry: AuditEntry): void {
  try {
    db.run(
      `INSERT INTO audit_log
        (user_name, action, entity, entity_id, student_name, enrollment_number,
         context, before_value, after_value, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorName(),
        entry.action,
        entry.entity,
        entry.entity_id ?? null,
        entry.student_name ?? '',
        entry.enrollment_number ?? '',
        entry.context ?? '',
        entry.before_value ?? '',
        entry.after_value ?? '',
        entry.detail ?? '',
      ]
    )
  } catch (e) {
    console.error('No se pudo registrar en la bitácora:', e)
  }
}
