/**
 * Correo institucional del alumno.
 *
 * En el Tecnológico de Cuautitlán el correo siempre se forma con el número de
 * control seguido del dominio institucional:
 *
 *   233107216  →  233107216@cuautitlan.tecnm.mx
 *
 * Como se puede deducir por completo del número de control, el programa lo
 * calcula solo y la profesora no tiene que escribirlo: teclearlo a mano solo
 * abriría la puerta a errores de dedo en un dato que ya conocemos.
 *
 * Este archivo es la única fuente de verdad. Lo usan el proceso principal al
 * guardar e importar, y la interfaz para mostrarlo mientras se captura.
 */

import { cleanEnrollment, checkEnrollment } from './enrollmentNumber'

export const INSTITUTIONAL_DOMAIN = 'cuautitlan.tecnm.mx'

/**
 * Construye el correo a partir del número de control.
 * Devuelve '' si el número no tiene el formato válido, para no inventar
 * direcciones a partir de una matrícula mal capturada.
 */
export function institutionalEmail(enrollmentNumber: string): string {
  const chk = checkEnrollment(enrollmentNumber)
  if (!chk.valid) return ''
  return `${chk.clean}@${INSTITUTIONAL_DOMAIN}`
}

/**
 * Correo que se debe guardar para un alumno.
 *
 * Si la profesora escribió un correo distinto (por ejemplo uno personal), se
 * respeta. Si lo dejó vacío, o si es el institucional pero con otra matrícula
 * —típico al copiar y pegar el renglón de otro alumno—, se corrige con el que
 * corresponde al número de control.
 */
export function resolveStudentEmail(enrollmentNumber: string, current?: string): string {
  const expected = institutionalEmail(enrollmentNumber)
  const value = (current ?? '').trim()

  if (!value) return expected
  if (!expected) return value

  // Cualquier dirección del dominio institucional debe coincidir con la
  // matrícula del alumno; si no, se sustituye por la correcta.
  if (isInstitutional(value)) return expected

  return value
}

/** Indica si una dirección pertenece al dominio institucional */
export function isInstitutional(email: string): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(`@${INSTITUTIONAL_DOMAIN}`)
}

/**
 * Extrae el número de control de un correo institucional.
 * Sirve para reconocer al alumno cuando un archivo trae el correo en lugar de
 * la matrícula.
 */
export function enrollmentFromEmail(email: string): string {
  const value = (email ?? '').trim().toLowerCase()
  if (!isInstitutional(value)) return ''
  return cleanEnrollment(value.split('@')[0])
}
