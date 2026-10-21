import { useState, useEffect } from 'react'
import type { Group } from '@shared/types'

type RowSeverity = 'ok' | 'warn' | 'error'

interface ParsedScore {
  row: number
  enrollment_number: string
  student_name: string
  enrollment_id: number
  score: number | null
  score_label: string
  current_score: number | null
  severity: RowSeverity
  issues: string[]
}

interface ScoreParseResult {
  file_name: string
  group_label: string
  rows: ParsedScore[]
  missing: string[]
}

/**
 * Importación de calificaciones desde archivo.
 *
 * Está separada del alta de alumnos porque son dos momentos distintos del
 * semestre: aquí nunca se crea un estudiante, solo se califica a quien ya está
 * inscrito en el grupo elegido.
 */
export default function ScoreImport() {
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [parsed, setParsed] = useState<ScoreParseResult | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ saved: number; skipped: number; errors: string[] } | null>(null)

  useEffect(() => {
    window.api.getGroups({ status: 'active' }).then(r => {
      if (r.ok) setGroups(r.data as Group[])
    })
  }, [])

  async function handlePick() {
    if (!groupId) { setError('Primero elige el grupo'); return }
    setError('')
    setDone(null)

    const sel = await window.api.importSelectFile()
    if (!sel.ok) {
      if (sel.error !== 'Operación cancelada') setError(sel.error!)
      return
    }
    const { filePath } = sel.data as any

    setLoading(true)
    const res = await window.api.importParseScores({
      filePath, group_id: Number(groupId),
    })
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }
    setParsed(res.data as ScoreParseResult)
  }

  async function handleConfirm() {
    if (!parsed) return
    const applicable = parsed.rows.filter(r => r.severity !== 'error')
    if (!window.confirm(
      `Se guardarán ${applicable.length} calificación(es) en ${parsed.group_label}.\n\n` +
      `Las calificaciones que se reemplacen no se podrán recuperar.\n\n` +
      '¿Continuar?'
    )) return

    setLoading(true)
    setError('')
    const res = await window.api.importConfirmScores({
      group_id: Number(groupId), rows: applicable,
    })
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }

    setDone(res.data as any)
    setParsed(null)
  }

  function reset() {
    setParsed(null); setDone(null); setError(''); setOnlyProblems(false)
  }

  const applicable = parsed?.rows.filter(r => r.severity !== 'error') ?? []
  const errorRows = parsed?.rows.filter(r => r.severity === 'error') ?? []
  const warnRows = parsed?.rows.filter(r => r.severity === 'warn') ?? []
  const visible = onlyProblems
    ? (parsed?.rows.filter(r => r.severity !== 'ok') ?? [])
    : (parsed?.rows ?? [])

  return (
    <>
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {done && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <strong>Se guardaron {done.saved} calificación(es).</strong>
          {done.skipped > 0 && <> {done.skipped} sin calificación se dejaron pendientes.</>}
          {done.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
              {done.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {!parsed && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Cargar calificaciones desde un archivo</span>
          </div>
          <p style={{ marginTop: 0, fontSize: 14, color: 'var(--text-muted)' }}>
            El archivo debe tener el No. de Control y la calificación (0 a 4).
            No se dan de alta estudiantes: solo se califica a quienes ya están
            inscritos en el grupo que elijas.
          </p>

          <div className="form-group" style={{ maxWidth: 520 }}>
            <label className="form-label">Grupo al que pertenecen las calificaciones</label>
            <select className="form-control" value={groupId}
              onChange={e => { setGroupId(e.target.value); reset() }}>
              <option value="">— Selecciona un grupo —</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.complementary_name} - {g.group_number} ({g.period_name})
                </option>
              ))}
            </select>
          </div>

          <button className="btn btn-primary" onClick={handlePick}
            disabled={loading || !groupId} style={{ padding: '9px 26px' }}>
            {loading ? 'Leyendo archivo...' : 'Seleccionar archivo'}
          </button>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            Nada se guarda hasta que revises la vista previa y confirmes.
          </div>
        </div>
      )}

      {parsed && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>{parsed.file_name}</strong>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {parsed.group_label}
                </div>
              </div>
              <button className="btn" onClick={reset}>Cambiar archivo</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Box n={applicable.length} label="Se guardarán" color="#2e7d32" bg="#e8f5e9" />
            <Box n={warnRows.length} label="Reemplazan una nota" color="#e65100" bg="#fff3e0" />
            <Box n={errorRows.length} label="No se pueden guardar" color="#c62828" bg="#ffebee" />
            <Box n={parsed.missing.length} label="Sin calificar en el grupo" color="#616161" bg="#f5f5f5" />
          </div>

          {parsed.missing.length > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <strong>{parsed.missing.length} alumno(s) del grupo no vienen en el archivo</strong> y
              quedarán pendientes de calificar:
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>
                {parsed.missing.slice(0, 10).map((m, i) => <li key={i}>{m}</li>)}
                {parsed.missing.length > 10 && <li>y {parsed.missing.length - 10} más</li>}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title">Calificaciones leídas</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyProblems}
                  onChange={e => setOnlyProblems(e.target.checked)} />
                Ver solo los que hay que revisar
              </label>
            </div>

            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>Fila</th>
                    <th>No. Control</th><th>Estudiante</th>
                    <th style={{ width: 70 }}>Actual</th>
                    <th style={{ width: 140 }}>Nueva</th>
                    <th>Qué revisar</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => (
                    <tr key={`${r.row}-${r.enrollment_number}`} style={{
                      background: r.severity === 'error' ? '#ffebee'
                        : r.severity === 'warn' ? '#fff8e1' : undefined,
                    }}>
                      <td style={{ color: 'var(--text-muted)' }}>{r.row}</td>
                      <td style={{ fontFamily: 'monospace' }}>{r.enrollment_number}</td>
                      <td>{r.student_name}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        {r.current_score ?? '—'}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {r.score === null ? '—' : `${r.score} · ${r.score_label}`}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {r.issues.length === 0
                          ? <span style={{ color: '#2e7d32' }}>Correcto</span>
                          : (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {r.issues.map((it, i) => (
                                <li key={i} style={{ color: r.severity === 'error' ? '#c62828' : '#e65100' }}>{it}</li>
                              ))}
                            </ul>
                          )}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
                      No hay renglones con problemas.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 'auto' }}>
                Hasta aquí no se ha guardado nada.
              </span>
              <button className="btn" onClick={reset}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirm}
                disabled={loading || applicable.length === 0} style={{ padding: '8px 28px' }}>
                {loading ? 'Guardando...' : `Guardar ${applicable.length} calificación(es)`}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Box({ n, label, color, bg }: { n: number; label: string; color: string; bg: string }) {
  return (
    <div style={{ padding: '14px 22px', background: bg, borderRadius: 8, textAlign: 'center', minWidth: 120 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  )
}
