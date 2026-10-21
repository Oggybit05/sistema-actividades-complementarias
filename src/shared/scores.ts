/**
 * Escala oficial de evaluación de las complementarias.
 *
 * Es una escala entera de 0 a 4. La única calificación reprobatoria es el 0
 * ("No acreditó"); a partir de 1 ("Suficiente") el estudiante acredita.
 */

export const SCORE_MIN = 0
export const SCORE_MAX = 4

/** Calificación mínima con la que se acredita la complementaria */
export const PASSING_SCORE = 1

export interface ScoreLevel {
  score: number
  label: string
  passing: boolean
}

export const SCORE_SCALE: ScoreLevel[] = [
  { score: 4, label: 'Excelente',   passing: true },
  { score: 3, label: 'Notable',     passing: true },
  { score: 2, label: 'Bueno',       passing: true },
  { score: 1, label: 'Suficiente',  passing: true },
  { score: 0, label: 'No acreditó', passing: false },
]

/** Escala de menor a mayor, útil para gráficas y selectores ascendentes */
export const SCORE_SCALE_ASC: ScoreLevel[] = [...SCORE_SCALE].reverse()

const LABELS: Record<number, string> = Object.fromEntries(
  SCORE_SCALE.map(l => [l.score, l.label])
)

/** Nombre de la calificación, por ejemplo 3 → "Notable" */
export function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Pendiente'
  return LABELS[score] ?? String(score)
}

/** Texto para selectores y reportes, por ejemplo "3 · Notable" */
export function scoreText(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Pendiente'
  return `${score} · ${scoreLabel(score)}`
}

/** Indica si la calificación acredita la complementaria */
export function isPassing(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score >= PASSING_SCORE
}

/** Valida que la calificación sea un entero dentro de la escala */
export function validateScore(score: unknown): string | null { 
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return 'La calificación debe ser un número entero'
  }
  if (score < SCORE_MIN || score > SCORE_MAX) {
    return `La calificación debe estar entre ${SCORE_MIN} y ${SCORE_MAX}`
  }
  return null
}