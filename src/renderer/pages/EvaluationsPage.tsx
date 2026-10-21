import { useEffect, useState, useMemo } from 'react'
import type { Group } from '@shared/types'
import { SCORE_SCALE, SCORE_SCALE_ASC, PASSING_SCORE, scoreText, scoreLabel } from '@shared/scores'

interface EvaluationRow {
  enrollment_id: number
  enrollment_number: string
  last_name: string
  first_name: string
  student_name: string
  career_name: string
  complementary_name: string
  group_id: number
  group_number: string
  period_name: string
  evaluation_id: number | null
  score: number | null
  observations: string | null
  evaluated_at: string | null
  closed_by: string | null
  closed_at: string | null
  status: 'pending' | 'captured' | 'closed'
}

interface Stats {
  total: number
  evaluated: number
  pending: number
  passed: number
  failed: number
  closed: number
  pass_rate: number
  distribution: Record<string, number>
  passing_score: number
}

/** Estado editable en pantalla antes de guardar */
interface Draft {
  score: number | null
  observations: string
}

/** Fecha del cierre en formato legible; si viene rara se muestra tal cual */
function formatClosedAt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function EvaluationsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [rows, setRows] = useState<EvaluationRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  /** Renglones marcados para calificar en bloque */
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.getGroups({ status: 'active' }).then(r => {
      if (r.ok) setGroups(r.data as Group[])
    })
  }, [])

  useEffect(() => { load() }, [groupId])

  async function load() {
    setError('')
    const filters = groupId ? { group_id: Number(groupId) } : {}
    const [listRes, statsRes] = await Promise.all([
      window.api.getEvaluations(filters),
      window.api.getEvaluationStats(filters),
    ])

    if (listRes.ok) {
      const data = listRes.data as EvaluationRow[]
      setRows(data)
      // Reiniciar borradores con lo que hay en la base de datos
      const next: Record<number, Draft> = {}
      for (const r of data) {
        next[r.enrollment_id] = {
          score: r.score ?? null,
          observations: r.observations ?? '',
        }
      }
      setDrafts(next)
      setSelected(new Set())
    } else {
      setError(listRes.error || 'No se pudieron cargar las evaluaciones')
    }

    if (statsRes.ok) setStats(statsRes.data as Stats)
  }

  function setDraft(id: number, patch: Partial<Draft>) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  /** Filas cuyo borrador difiere de lo guardado */
  const dirty = useMemo(() => rows.filter(r => {
    const d = drafts[r.enrollment_id]
    if (!d) return false
    if (r.status === 'closed') return false
    return d.score !== (r.score ?? null) || d.observations !== (r.observations ?? '')
  }), [rows, drafts])

  const isClosed = stats !== null && stats.total > 0 && stats.closed === stats.total

  /** Firma del acta: quién la cerró y cuándo */
  const closure = useMemo(() => {
    const row = rows.find(r => r.status === 'closed' && r.closed_at)
    if (!row) return null
    return { by: row.closed_by || 'usuario no registrado', at: row.closed_at! }
  }, [rows])

  async function saveAll() {
    if (!dirty.length) return
    setLoading(true)
    setError(''); setMessage('')

    const items = dirty.map(r => ({
      enrollment_id: r.enrollment_id,
      score: drafts[r.enrollment_id].score,
      observations: drafts[r.enrollment_id].observations,
    }))

    const res = await window.api.saveEvaluationBatch(items)
    setLoading(false)

    if (!res.ok) { setError(res.error!); return }
    const d = res.data as { saved: number; skipped: number; errors: string[] }
    setMessage(
      `${d.saved} calificación(es) guardada(s) de una sola vez` +
      // Sin calificación no hay nada que guardar, y la observación se quedaría
      // en el aire: más vale decirlo que dejar creer que se guardó.
      (d.skipped
        ? `. Se omitieron ${d.skipped} renglón(es) sin calificación` +
          `; si escribiste una observación ahí, ponle calificación para que se guarde.`
        : '')
    )
    if (d.errors.length) setError(d.errors.join(' · '))
    load()
  }

  async function clearOne(row: EvaluationRow) {
    if (!window.confirm(`¿Borrar la calificación de ${row.student_name}?`)) return
    setLoading(true)
    const res = await window.api.clearEvaluation(row.enrollment_id)
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }
    setMessage('Calificación eliminada')
    load()
  }

  async function clearGroup() {
    if (!groupId || !stats?.evaluated) return
    if (!window.confirm(
      `Se eliminarán las ${stats.evaluated} calificación(es) capturadas de este grupo.\n\n` +
      'Las actas cerradas no se modificarán. Los alumnos volverán a quedar pendientes.\n\n' +
      '¿Continuar?'
    )) return
    setLoading(true); setError(''); setMessage('')
    const res = await window.api.clearEvaluationGroup(Number(groupId))
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }
    const result = res.data as { cleared: number; closed: number }
    setMessage(
      `${result.cleared} calificación(es) eliminada(s)` +
      (result.closed ? `. ${result.closed} acta(s) cerrada(s) se conservaron.` : '')
    )
    load()
  }

  /**
   * Pide el resumen antes de cerrar.
   *
   * Cerrar bloquea las calificaciones, así que primero se muestra exactamente
   * qué va a quedar firmado en lugar de un "¿estás segura?" a ciegas.
   */
  async function closeGroup() {
    if (!groupId) return
    setLoading(true); setError(''); setMessage('')

    let preview: any
    try {
      const res = await window.api.closeEvaluationPreview(Number(groupId))
      if (!res.ok) { setLoading(false); setError(res.error!); return }
      preview = res.data
    } catch (e: any) {
      setLoading(false)
      setError(String(e?.message ?? '').includes('No handler registered')
        ? 'Cierra la aplicación por completo y vuelve a abrirla para activar esta función.'
        : 'No se pudo revisar el acta')
      return
    }
    setLoading(false)

    if (preview.total === 0) { setError('El grupo no tiene alumnos inscritos'); return }
    if (preview.already_closed) { setError('El acta de este grupo ya está cerrada'); return }

    const lines = [
      `Acta: ${preview.group}`,
      '',
      `Inscritos: ${preview.total}`,
      `Calificados: ${preview.evaluated}`,
      `Pendientes: ${preview.pending}`,
      `Acreditados: ${preview.passed}`,
      `No acreditaron: ${preview.failed}`,
      `Acreditación: ${preview.pass_rate}%`,
      `Promedio: ${preview.average ?? '—'}`,
    ]

    if (preview.pending > 0) {
      lines.push('', 'FALTAN POR CALIFICAR:')
      preview.missing.forEach((m: string) => lines.push(`  · ${m}`))
      if (preview.missing_extra > 0) lines.push(`  · y ${preview.missing_extra} más`)
      lines.push('', 'Si cierras ahora, estos alumnos quedarán sin calificación.')
    }

    lines.push('', 'Al cerrar ya no se podrán modificar las calificaciones.', '¿Continuar?')

    if (!window.confirm(lines.join('\n'))) return

    setLoading(true)
    const res = await window.api.closeEvaluationGroup(Number(groupId))
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }
    setMessage(`Acta cerrada: ${preview.passed} acreditado(s), ${preview.failed} no acreditó/aron`)
    load()
  }

  async function reopenGroup() {
    if (!groupId) return
    if (!window.confirm(
      'Se reabrirá el acta para permitir cambios en las calificaciones.\n\n¿Continuar?'
    )) return
    setLoading(true)
    setError(''); setMessage('')
    const res = await window.api.reopenEvaluationGroup(Number(groupId))
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }
    setMessage('Acta reabierta')
    load()
  }

  /** Poner la misma calificación a quienes aún no tienen una */
  function fillPending(score: number) {
    setDrafts(d => {
      const next = { ...d }
      for (const r of rows) {
        if (r.status === 'closed') continue
        if (next[r.enrollment_id]?.score === null) {
          next[r.enrollment_id] = { ...next[r.enrollment_id], score }
        }
      }
      return next
    })
  }

  /**
   * Cambiar de grupo recarga la lista y descarta los borradores.
   *
   * Al capturar en bloque es fácil llenar veinte calificaciones y tocar el
   * filtro sin haber guardado; sin este aviso el trabajo se perdía en silencio.
   */
  function changeGroup(value: string) {
    if (dirty.length > 0 && !window.confirm(
      `Tienes ${dirty.length} cambio(s) sin guardar.\n\n` +
      `Si cambias de grupo ahora se van a perder. ¿Continuar?`
    )) return
    setGroupId(value)
  }

  /** Renglones que se pueden editar (el acta cerrada no se toca) */
  const editable = useMemo(() => rows.filter(r => r.status !== 'closed'), [rows])

  const allSelected = editable.length > 0 && editable.every(r => selected.has(r.enrollment_id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(editable.map(r => r.enrollment_id)))
  }

  function toggleOne(id: number) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  /**
   * Asigna la misma calificación a todos los seleccionados.
   *
   * A diferencia de "asignar a los pendientes", esto sí sobrescribe una
   * calificación ya puesta: sirve para corregir a un grupo entero de un jalón.
   * Solo queda en el borrador; nada se escribe hasta "Guardar cambios".
   */
  function assignSelected(score: number) {
    setDrafts(d => {
      const next = { ...d }
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], score }
      }
      return next
    })
  }

  /** Deja los seleccionados como pendientes en el borrador */
  function clearSelected() {
    setDrafts(d => {
      const next = { ...d }
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], score: null }
      }
      return next
    })
  }

  /** Devuelve los borradores al valor guardado, sin tocar la base */
  function discardChanges() {
    if (!window.confirm(`¿Descartar los ${dirty.length} cambio(s) sin guardar?`)) return
    const next: Record<number, Draft> = {}
    for (const r of rows) {
      next[r.enrollment_id] = { score: r.score ?? null, observations: r.observations ?? '' }
    }
    setDrafts(next)
    setMessage(''); setError('')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          Evaluaciones
          {isClosed && (
            <span title={closure ? `Cerrada por ${closure.by} el ${formatClosedAt(closure.at)}` : 'Acta cerrada'}
              style={{
                marginLeft: 12, fontSize: 12, fontWeight: 600, verticalAlign: 'middle',
                padding: '3px 10px', borderRadius: 12,
                background: '#ffe0b2', color: '#e65100', border: '1px solid #ffb74d',
              }}>
              🔒 ACTA CERRADA
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Cerrar y reabrir son por acta, así que necesitan un grupo elegido */}
          {groupId && (isClosed
            ? <button className="btn" onClick={reopenGroup} disabled={loading}>Reabrir acta</button>
            : <>
                <button className="btn" onClick={clearGroup}
                  disabled={loading || !stats?.evaluated}>
                  Limpiar calificaciones
                </button>
                <button className="btn" onClick={closeGroup} disabled={loading || !stats?.total}>Cerrar acta</button>
              </>
          )}
          {/*
            Guardar en lote NO depende del grupo. Antes este botón vivía dentro
            de `groupId && ...`, así que con "Todos los grupos" —la opción por
            omisión— desaparecía y el único camino visible era el botón Guardar
            de cada renglón. De ahí venía el "tengo que guardar uno por uno".
          */}
          <button className="btn btn-primary" onClick={saveAll} disabled={loading || !dirty.length}>
            {loading ? 'Guardando...' : `Guardar cambios${dirty.length ? ` (${dirty.length})` : ''}`}
          </button>
        </div>
      </div>

      {/* Filtro */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Grupo</label>
          <select className="form-control" value={groupId} onChange={e => changeGroup(e.target.value)}>
            <option value="">Todos los grupos</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.complementary_name} - {g.group_number} ({g.period_name})
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Escala:</span>
          {SCORE_SCALE.map(l => (
            <span key={l.score} style={{
              fontSize: 12, padding: '3px 10px', borderRadius: 12, fontWeight: 600,
              background: l.passing ? '#e8f5e9' : '#ffebee',
              color: l.passing ? '#2e7d32' : '#c62828',
            }}>
              {l.score} · {l.label}
            </span>
          ))}
        </div>
      </div>

      {message && <div className="alert alert-success" style={{ marginBottom: 16 }}>{message}</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {isClosed && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <div>
            Este acta está <strong>cerrada</strong>. Para modificar calificaciones usa “Reabrir acta”.
          </div>
          {closure && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Cerrada por <strong>{closure.by}</strong> el {formatClosedAt(closure.at)}.
            </div>
          )}
        </div>
      )}

      {/* Estadísticas */}
      {stats && stats.total > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title">Resumen</span></div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat n={stats.total} label="Inscritos" color="#37474f" bg="#eceff1" />
            <Stat n={stats.evaluated} label="Evaluados" color="#1565c0" bg="#e3f2fd" />
            <Stat n={stats.pending} label="Pendientes" color="#e65100" bg="#fff3e0" />
            <Stat n={stats.passed} label="Aprobados" color="#2e7d32" bg="#e8f5e9" />
            <Stat n={stats.failed} label="Reprobados" color="#c62828" bg="#ffebee" />
            <Stat n={stats.pass_rate} label="% Aprobación" color="#4527a0" bg="#ede7f6" suffix="%" />
          </div>

          {/* Distribución de calificaciones */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Distribución</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {SCORE_SCALE_ASC.map(({ score, passing }) => {
                const n = Number(stats.distribution?.[score] ?? 0)
                const pct = stats.evaluated ? (n / stats.evaluated) * 100 : 0
                return (
                  <div key={score} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      height: 70, display: 'flex', alignItems: 'flex-end',
                      background: 'var(--bg)', borderRadius: 6, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: '100%', height: `${Math.max(pct, n ? 8 : 0)}%`,
                        background: passing ? '#66bb6a' : '#ef5350',
                        transition: 'height .2s',
                      }} />
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>{score}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{scoreLabel(score)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{n}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Captura en bloque */}
      {!isClosed && editable.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          {selected.size > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>
                Calificar a los <strong>{selected.size}</strong> seleccionado(s):
              </span>
              {SCORE_SCALE_ASC.map(({ score, label }) => (
                <button key={score} className="btn" onClick={() => assignSelected(score)}
                  title={`${score} · ${label}`} style={{ minWidth: 42, fontWeight: 600 }}>
                  {score}
                </button>
              ))}
              <button className="btn btn-sm" onClick={clearSelected}>Dejar pendientes</button>
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
                Quitar selección
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Se aplica a todos de una vez; nada se guarda hasta presionar “Guardar cambios”.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Marca los alumnos de la lista para calificar a varios al mismo tiempo.
              </span>
              {stats && stats.pending > 0 && (
                <>
                  <span style={{ fontSize: 13 }}>
                    O asigna de golpe a los <strong>{stats.pending}</strong> pendientes:
                  </span>
                  {SCORE_SCALE_ASC.map(({ score, label }) => (
                    <button key={score} className="btn" onClick={() => fillPending(score)}
                      title={`${score} · ${label}`} style={{ minWidth: 42 }}>
                      {score}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabla */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Estudiantes</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{rows.length} registro(s)</span>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
            No hay estudiantes inscritos en la selección
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      disabled={isClosed || editable.length === 0}
                      title="Seleccionar todos" />
                  </th>
                  <th>No. Control</th>
                  <th>Estudiante</th>
                  <th>Carrera</th>
                  {!groupId && <th>Grupo</th>}
                  <th style={{ width: 150 }}>Calificación</th>
                  <th>Observaciones</th>
                  <th style={{ width: 110 }}>Estado</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const d = drafts[row.enrollment_id] ?? { score: null, observations: '' }
                  const locked = row.status === 'closed'
                  const changed = !locked && (
                    d.score !== (row.score ?? null) ||
                    d.observations !== (row.observations ?? '')
                  )
                  const passed = d.score !== null && d.score >= (stats?.passing_score ?? PASSING_SCORE)

                  return (
                    <tr key={row.enrollment_id} style={{ background: changed ? '#fffde7' : undefined }}>
                      <td>
                        <input type="checkbox" disabled={locked}
                          checked={selected.has(row.enrollment_id)}
                          onChange={() => toggleOne(row.enrollment_id)} />
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.enrollment_number}</td>
                      <td>{row.student_name}</td>
                      <td style={{ fontSize: 13 }}>{row.career_name}</td>
                      {!groupId && (
                        <td style={{ fontSize: 13 }}>
                          {row.complementary_name} · {row.group_number}
                        </td>
                      )}
                      <td>
                        <select
                          className="form-control"
                          value={d.score ?? ''}
                          disabled={locked}
                          onChange={e => setDraft(row.enrollment_id, {
                            score: e.target.value === '' ? null : Number(e.target.value),
                          })}
                          style={{
                            fontWeight: 600,
                            color: d.score === null ? undefined : passed ? '#2e7d32' : '#c62828',
                          }}
                        >
                          <option value="">Pendiente</option>
                          {SCORE_SCALE.map(({ score }) => (
                            <option key={score} value={score}>{scoreText(score)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="form-control"
                          value={d.observations}
                          disabled={locked}
                          placeholder="Opcional"
                          onChange={e => setDraft(row.enrollment_id, { observations: e.target.value })}
                        />
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td>
                        {/*
                          Ya no hay botón "Guardar" por renglón: invitaba a
                          guardar de uno en uno cuando el guardado en lote hace
                          lo mismo con todos. "Limpiar" se queda porque borra la
                          calificación en la base, que es otra cosa.
                        */}
                        {!locked && row.evaluation_id && (
                          <button className="btn btn-sm" onClick={() => clearOne(row)} disabled={loading}>
                            Limpiar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*
        Barra fija al pie: con 30 alumnos el botón del encabezado queda fuera de
        la pantalla justo cuando más se necesita, y las listas largas son
        precisamente el caso en que se califica en bloque.
      */}
      {dirty.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: '#fffde7', border: '1px solid #fdd835', borderRadius: 8,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.08)', zIndex: 5,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {dirty.length} cambio(s) sin guardar
          </span>
          <button className="btn btn-primary" onClick={saveAll} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar todos los cambios'}
          </button>
          <button className="btn" onClick={discardChanges} disabled={loading}>
            Descartar
          </button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: EvaluationRow['status'] }) {
  const map = {
    pending: { text: 'Pendiente', bg: '#fff3e0', color: '#e65100' },
    captured: { text: 'Capturada', bg: '#e3f2fd', color: '#1565c0' },
    closed: { text: 'Cerrada', bg: '#eceff1', color: '#455a64' },
  }[status]
  return (
    <span style={{
      background: map.bg, color: map.color, padding: '3px 10px',
      borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {map.text}
    </span>
  )
}

function Stat({ n, label, color, bg, suffix = '' }: {
  n: number; label: string; color: string; bg: string; suffix?: string
}) {
  return (
    <div style={{ padding: '12px 20px', background: bg, borderRadius: 8, textAlign: 'center', minWidth: 100 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{n}{suffix}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  )
}
