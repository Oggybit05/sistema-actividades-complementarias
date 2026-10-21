import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardSummary } from '@shared/types'

/** Tarjeta de indicador con enlace opcional a la pantalla correspondiente */
function Stat({ label, value, hint, color, to }: {
  label: string
  value: number | string
  hint?: string
  color?: string
  to?: string
}) {
  const body = (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 18px', height: '100%',
      transition: 'border-color .15s',
    }}>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: color ?? 'var(--primary)' }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}</div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  )
  return to
    ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link>
    : body
}

/** Barra de progreso simple */
function Bar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div style={{
      background: 'var(--bg)', borderRadius: 999, height: 8,
      overflow: 'hidden', border: '1px solid var(--border)',
    }}>
      <div style={{
        width: `${Math.min(100, Math.round(ratio * 100))}%`,
        background: color, height: '100%',
      }} />
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [periodId, setPeriodId] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(pid?: number) {
    setLoading(true); setError('')
    try {
      const res = await window.api.getDashboardSummary(pid)
      if (res.ok) setData(res.data as DashboardSummary)
      else setError(res.error ?? 'No se pudieron cargar los indicadores')
    } catch (e: any) {
      setError(
        String(e?.message ?? e).includes('No handler registered')
          ? 'Cierra la aplicación por completo y vuelve a ejecutar "npm run dev" para cargar el panel nuevo.'
          : String(e?.message ?? e)
      )
    }
    setLoading(false)
  }

  useEffect(() => { load(periodId) }, [periodId])

  if (loading && !data) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Panel principal</h1></div>
        <div className="card"><div className="table-empty">Cargando indicadores…</div></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Panel principal</h1></div>
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }

  if (!data || !data.period) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Panel principal</h1></div>
        <div className="card">
          <div className="table-empty">
            Todavía no hay ningún periodo escolar registrado.<br />
            <Link to="/periods" style={{ color: 'var(--primary)' }}>Crear el primer periodo</Link>
          </div>
        </div>
      </div>
    )
  }

  const totalCaptura = data.evaluated + data.pending
  const avance = totalCaptura > 0 ? data.evaluated / totalCaptura : 0
  const calificados = data.passed + data.failed
  const aprobacion = calificados > 0 ? Math.round((data.passed / calificados) * 100) : 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Panel principal</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Periodo {data.period.name}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-control" style={{ width: 'auto' }}
            value={periodId ?? data.period.id}
            onChange={e => setPeriodId(Number(e.target.value))}>
            {data.periods.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_active ? ' (activo)' : ''}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => load(periodId)}>
            Actualizar
          </button>
        </div>
      </div>

      {/* Inventario del periodo */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12,
      }}>
        <Stat label="Estudiantes registrados" value={data.students}
          hint="En el catálogo, activos" to="/students" />
        <Stat label="Inscripciones activas" value={data.enrollments}
          hint={data.cancelled ? `${data.cancelled} dadas de baja` : 'Sin bajas'}
          to="/enrollments" />
        <Stat label="Complementarias" value={data.complementaries}
          hint="Con grupos en el periodo" to="/complementaries" />
        <Stat label="Grupos activos" value={data.groups}
          hint={`${data.total_capacity} lugares en total`} to="/groups" />
      </div>

      {/* Ocupación */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Ocupación general</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {data.enrollments} de {data.total_capacity} lugares · {data.occupancy}%
          </span>
        </div>
        <Bar ratio={data.occupancy / 100}
          color={data.occupancy >= 90 ? 'var(--danger)' : data.occupancy >= 70 ? 'var(--warning)' : 'var(--success)'} />
      </div>

      {/* Avance de evaluación */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Evaluación</span>
          <Link to="/evaluations" className="btn btn-secondary btn-sm">Ir a capturar</Link>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12, marginBottom: 16,
        }}>
          <Stat label="Estudiantes evaluados" value={data.evaluated}
            hint={`${Math.round(avance * 100)}% de la captura`} color="var(--primary)" />
          <Stat label="Calificaciones pendientes" value={data.pending}
            hint={data.pending === 0 ? 'Captura completa' : 'Falta capturar'}
            color={data.pending > 0 ? 'var(--warning)' : 'var(--success)'} />
          <Stat label="Aprobados" value={data.passed}
            hint={calificados ? `${aprobacion}% de aprobación` : undefined}
            color="var(--success)" />
          <Stat label="No acreditaron" value={data.failed}
            hint={calificados ? `${100 - aprobacion}% del total calificado` : undefined}
            color={data.failed > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Avance de captura: {data.evaluated} de {totalCaptura}
        </div>
        <Bar ratio={avance} color={avance === 1 ? 'var(--success)' : 'var(--primary)'} />

        {data.closed_groups > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            {data.closed_groups} calificación(es) con acta cerrada, protegidas contra cambios.
          </div>
        )}
      </div>

      {/* Grupos próximos a llenarse */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Grupos próximos a llenarse</span>
          <Link to="/groups" className="btn btn-secondary btn-sm">Ver grupos</Link>
        </div>

        {data.nearly_full.length === 0 ? (
          <div className="table-empty">
            Ningún grupo pasa del 80% de su cupo
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Complementaria</th><th>Grupo</th>
                  <th>Ocupación</th><th style={{ width: 160 }}></th><th>Lugares libres</th>
                </tr>
              </thead>
              <tbody>
                {data.nearly_full.map(g => {
                  const pct = Math.round(g.ratio * 100)
                  const full = g.free <= 0
                  return (
                    <tr key={g.id}>
                      <td>{g.complementary_name}</td>
                      <td style={{ fontFamily: 'monospace' }}>{g.group_number}</td>
                      <td>
                        <strong style={{ color: full ? 'var(--danger)' : 'var(--warning)' }}>
                          {g.enrolled}/{g.capacity}
                        </strong>{' '}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({pct}%)</span>
                      </td>
                      <td>
                        <Bar ratio={g.ratio} color={full ? 'var(--danger)' : 'var(--warning)'} />
                      </td>
                      <td>
                        {full
                          ? <span className="badge badge-cancelled">Lleno</span>
                          : <span>{g.free}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {data.empty_groups.length > 0 && (
          <div className="alert alert-warning" style={{ marginTop: 12, marginBottom: 0 }}>
            {data.empty_groups.length} grupo(s) sin ningún inscrito:{' '}
            {data.empty_groups.slice(0, 4).map(g => `${g.complementary_name} ${g.group_number}`).join(', ')}
            {data.empty_groups.length > 4 && ` y ${data.empty_groups.length - 4} más`}.
          </div>
        )}
      </div>

      {/* Avance por complementaria */}
      {data.by_complementary.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Avance por complementaria</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Complementaria</th><th>Inscritos</th><th>Evaluados</th>
                  <th style={{ width: 160 }}>Avance</th><th>Aprobados</th>
                </tr>
              </thead>
              <tbody>
                {data.by_complementary.map(c => {
                  const r = c.enrolled > 0 ? c.evaluated / c.enrolled : 0
                  return (
                    <tr key={c.complementary_name}>
                      <td>{c.complementary_name}</td>
                      <td>{c.enrolled}</td>
                      <td>{c.evaluated}</td>
                      <td>
                        <Bar ratio={r} color={r === 1 ? 'var(--success)' : 'var(--primary)'} />
                      </td>
                      <td>
                        {c.evaluated > 0
                          ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>{c.passed}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
