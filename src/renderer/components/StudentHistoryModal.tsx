import { useState, useEffect } from 'react'
import type { StudentHistory } from '@shared/types'

const ENROLL_STATUS: Record<string, { text: string; cls: string }> = {
  active: { text: 'Inscrito', cls: 'badge-active' },
  cancelled: { text: 'Baja', cls: 'badge-inactive' },
}

const ACTA_STATUS: Record<string, string> = {
  captured: 'Capturada',
  closed: 'Cerrada',
}

/**
 * Historial académico de un estudiante.
 *
 * Responde de un vistazo lo que antes obligaba a revisar Inscripciones,
 * Evaluaciones y Grupos por separado: qué ha cursado, con qué calificación y
 * si sigue inscrito.
 */
export default function StudentHistoryModal({
  studentId, onClose,
}: { studentId: number; onClose: () => void }) {
  const [data, setData] = useState<StudentHistory | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')

    window.api.getStudentHistory(studentId)
      .then(res => {
        if (!alive) return
        if (res.ok) setData(res.data as StudentHistory)
        else setError(res.error ?? 'No se pudo cargar el historial')
      })
      .catch(e => {
        if (!alive) return
        setError(String(e?.message ?? '').includes('No handler registered')
          ? 'Cierra la aplicación por completo y vuelve a abrirla para activar el historial.'
          : 'No se pudo cargar el historial')
      })
      .finally(() => { if (alive) setLoading(false) })

    // Evita escribir en un componente ya cerrado si la consulta tarda
    return () => { alive = false }
  }, [studentId])

  const s = data?.student
  const sum = data?.summary

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 940 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            Historial{s ? ` — ${s.full_name}` : ''}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading && <p style={{ color: 'var(--text-muted)' }}>Cargando historial…</p>}
          {error && <div className="alert alert-error">{error}</div>}

          {s && sum && (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10, marginBottom: 16, fontSize: 13,
              }}>
                <div><strong>No. de Control</strong><br />{s.enrollment_number}</div>
                <div><strong>Carrera</strong><br />{s.career_name}</div>
                <div><strong>Semestre</strong><br />{s.semester}°</div>
                <div><strong>Estado</strong><br />
                  <span className={`badge badge-${s.status}`}>
                    {s.status === 'active' ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                {s.email && <div><strong>Correo</strong><br />{s.email}</div>}
                {s.phone && <div><strong>Teléfono</strong><br />{s.phone}</div>}
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 10, marginBottom: 18,
              }}>
                {([
                  ['Complementarias', sum.total, 'var(--primary)'],
                  ['Inscrito', sum.active, 'var(--primary)'],
                  ['Bajas', sum.cancelled, 'var(--text-muted)'],
                  ['Acreditadas', sum.passed, '#1B6B33'],
                  ['No acreditó', sum.failed, '#B00020'],
                  ['Sin calificar', sum.pending, '#8a6d00'],
                  ['Promedio', sum.average ?? '—', 'var(--primary)'],
                ] as [string, string | number, string][]).map(([label, value, color]) => (
                  <div key={label} style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>

              {data!.entries.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>
                  Este estudiante todavía no está inscrito en ninguna complementaria.
                </p>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Complementaria</th>
                        <th>Grupo</th>
                        <th>Horario</th>
                        <th>Calificación</th>
                        <th>Acta</th>
                        <th>Estado</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.entries.map(e => {
                        const st = ENROLL_STATUS[e.enrollment_status]
                          ?? { text: e.enrollment_status, cls: '' }
                        const obs = [e.observations, e.evaluation_observations]
                          .filter(Boolean).join(' | ')
                        return (
                          <tr key={e.enrollment_id}>
                            <td>{e.period_name}</td>
                            <td>{e.complementary_name}</td>
                            <td>{e.group_number}</td>
                            <td style={{ fontSize: 12 }}>
                              {e.days || '—'}
                              {e.schedule && <><br />{e.schedule}</>}
                            </td>
                            <td>
                              {e.score === null
                                ? <span style={{ color: '#8a6d00' }}>Pendiente</span>
                                : <><strong>{e.score}</strong> · {e.score_label}</>}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {e.evaluation_status
                                ? ACTA_STATUS[e.evaluation_status] ?? e.evaluation_status
                                : '—'}
                            </td>
                            <td><span className={`badge ${st.cls}`}>{st.text}</span></td>
                            <td style={{ fontSize: 12 }}>{obs || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
