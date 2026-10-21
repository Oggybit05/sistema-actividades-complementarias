/**
 * Utilidades de horario compartidas entre el proceso principal y la interfaz.
 *
 * Los días de un grupo se guardan como texto separado por comas
 * ("Lunes,Miércoles"). Dos grupos solo se traslapan si comparten al menos un
 * día Y sus rangos de hora se cruzan.
 */

export const WEEK_DAYS = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
] as const

/** Normaliza un día para comparar sin acentos ni mayúsculas */
function normalizeDay(d: string): string {
  return d.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Convierte "Lunes,Miércoles" en un conjunto comparable */
export function parseDays(days: string | null | undefined): Set<string> {
  if (!days) return new Set()
  return new Set(
    days.split(',').map(normalizeDay).filter(Boolean)
  )
}

/** Días que dos grupos tienen en común, con el nombre original legible */
export function sharedDays(a: string | null | undefined, b: string | null | undefined): string[] {
  const setB = parseDays(b)
  if (!setB.size) return []
  return (a ?? '').split(',')
    .map(d => d.trim())
    .filter(d => d && setB.has(normalizeDay(d)))
}

/** "14:00" → 840 minutos. Devuelve null si el formato no es válido */
export function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** ¿Se cruzan dos rangos de hora? Tocarse en el extremo no cuenta */
export function timesOverlap(
  startA: string | null | undefined, endA: string | null | undefined,
  startB: string | null | undefined, endB: string | null | undefined
): boolean {
  const a1 = toMinutes(startA), a2 = toMinutes(endA)
  const b1 = toMinutes(startB), b2 = toMinutes(endB)
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false
  return a1 < b2 && b1 < a2
}

/**
 * Determina si dos grupos chocan de verdad: mismo día y horas cruzadas.
 * Devuelve los días en conflicto, o un arreglo vacío si no hay choque.
 */
export function scheduleConflict(
  a: { days?: string | null; start_time?: string | null; end_time?: string | null },
  b: { days?: string | null; start_time?: string | null; end_time?: string | null }
): string[] {
  if (!timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) return []
  return sharedDays(a.days, b.days)
}

/** Valida que el rango de horas de un grupo sea coherente */
export function checkTimeRange(start?: string | null, end?: string | null): string | null {
  const hasStart = !!start?.trim(), hasEnd = !!end?.trim()
  if (!hasStart && !hasEnd) return null           // horario por definir, se permite
  if (hasStart !== hasEnd) return 'Captura la hora de inicio y la de fin, o deja ambas vacías'

  const s = toMinutes(start), e = toMinutes(end)
  if (s === null) return `La hora de inicio "${start}" no tiene el formato HH:MM`
  if (e === null) return `La hora de fin "${end}" no tiene el formato HH:MM`
  if (s >= e) return 'La hora de fin debe ser posterior a la hora de inicio'
  return null
}
