/**
 * Reglas de la matrícula (número de control) del Tecnológico.
 *
 * Formato: 9 dígitos  AA 3 CCC XXX
 *   AA   → últimos dos dígitos del año de ingreso
 *   3    → dígito fijo
 *   CCC  → código de la carrera
 *   XXX  → consecutivo asignado por la institución
 *
 * Ejemplo: 233107216 → ingresó en 2023, carrera 107 (Sistemas Computacionales)
 *
 * Este archivo es la única fuente de verdad: lo usan el proceso principal para
 * validar antes de escribir en la base y la interfaz para avisar mientras se
 * captura. Así no pueden desincronizarse.
 */

export const ENROLLMENT_LENGTH = 9

export interface EnrollmentCheck {
  valid: boolean
  /** Matrícula normalizada (sin espacios ni guiones) */
  clean: string
  /** Mensaje listo para mostrar cuando valid es false */
  error?: string
  /** Código de carrera, solo cuando el formato es correcto */
  careerCode?: string
  /** Año de ingreso deducido de los dos primeros dígitos */
  entryYear?: number
}

/** Quita espacios, guiones y cualquier caracter que no sea dígito */
export function cleanEnrollment(value: string): string {
  return (value ?? '').replace(/\D/g, '')
}

/** Valida el formato completo de una matrícula */
export function checkEnrollment(value: string): EnrollmentCheck {
  const clean = cleanEnrollment(value)

  if (!clean) {
    return { valid: false, clean, error: 'La matrícula es obligatoria' }
  }
  if (clean.length !== ENROLLMENT_LENGTH) {
    return {
      valid: false, clean,
      error: `La matrícula debe tener ${ENROLLMENT_LENGTH} dígitos (tiene ${clean.length})`,
    }
  }
  if (clean[2] !== '3') {
    return {
      valid: false, clean,
      error: `El tercer dígito debe ser 3 según el formato institucional (AA3CCCXXX), y es ${clean[2]}`,
    }
  }

  const yy = Number(clean.substring(0, 2))
  const currentYY = new Date().getFullYear() % 100
  // Se aceptan ingresos pasados y hasta el siguiente ciclo; más allá es un error de captura
  if (yy > currentYY + 1) {
    return {
      valid: false, clean,
      error: `El año de ingreso (20${clean.substring(0, 2)}) es posterior al ciclo actual`,
    }
  }

  return {
    valid: true,
    clean,
    careerCode: clean.substring(3, 6),
    entryYear: 2000 + yy,
  }
}

/** Extrae el código de carrera; devuelve '' si el formato no es válido */
export function careerCodeOf(value: string): string {
  const r = checkEnrollment(value)
  return r.careerCode ?? ''
}
