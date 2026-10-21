import { useState, useEffect } from 'react'
import type { SchoolPeriod, PeriodDTO, Complementary } from '@shared/types'

const EMPTY: PeriodDTO = { name: '', start_date: '', end_date: '', is_active: 0 }

interface PreviewGroup {
  id: number
  group_number: string
  capacity: number
  classroom: string
  days: string
  start_time: string
  end_time: string
  complementary_id: number
  complementary_name: string
}

interface PreviewByComp {
  complementary_id: number
  complementary_name: string
  group_count: number
  total_capacity: number
}

/** Sugerir el siguiente periodo: 2025-2 → 2026-1 */
function nextPeriodName(name: string): string {
  const m = name.match(/^(\d{4})\s*-\s*([12])$/)
  if (!m) return ''
  const year = Number(m[1])
  return m[2] === '1' ? `${year}-2` : `${year + 1}-1`
}

/** Fechas sugeridas para un periodo tipo "2026-1" */
function guessDates(name: string): { start: string; end: string } {
  const m = name.match(/^(\d{4})\s*-\s*([12])$/)
  if (!m) return { start: '', end: '' }
  const year = Number(m[1])
  return m[2] === '1'
    ? { start: `${year}-02-01`, end: `${year}-07-31` }
    : { start: `${year}-08-01`, end: `${year + 1}-01-31` }
}

export default function PeriodsPage() {
  const [items, setItems] = useState<SchoolPeriod[]>([])
  const [complementaries, setComplementaries] = useState<Complementary[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<SchoolPeriod | null>(null)
  const [form, setForm] = useState<PeriodDTO>(EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Duplicación
  const [dupModal, setDupModal] = useState(false)
  const [dupSource, setDupSource] = useState<SchoolPeriod | null>(null)
  const [dupForm, setDupForm] = useState({ name: '', start_date: '', end_date: '', is_active: false })
  const [dupComps, setDupComps] = useState<number[]>([])
  const [dupCapacity, setDupCapacity] = useState<string>('')
  const [dupSchedule, setDupSchedule] = useState(true)
  const [preview, setPreview] = useState<{ by_complementary: PreviewByComp[]; groups: PreviewGroup[] } | null>(null)

  async function load() {
    const [p, c] = await Promise.all([window.api.getPeriods(), window.api.getComplementaries()])
    if (p.ok) setItems(p.data as SchoolPeriod[])
    if (c.ok) setComplementaries(c.data as Complementary[])
  }

  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(p: SchoolPeriod) {
    setEditing(p)
    setForm({ name: p.name, start_date: p.start_date, end_date: p.end_date, is_active: p.is_active })
    setError(''); setModal(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.start_date || !form.end_date) {
      setError('Nombre, fecha inicio y fecha fin son obligatorios'); return
    }
    setLoading(true); setError('')
    const res = editing
      ? await window.api.updatePeriod(editing.id, form)
      : await window.api.createPeriod(form)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleSetActive(p: SchoolPeriod) {
    const res = await window.api.setActivePeriod(p.id)
    if (!res.ok) setError(res.error!)
    else { setMessage(`${p.name} es ahora el periodo activo`); load() }
  }

  /**
   * Borrar un periodo se lleva sus grupos, inscripciones y calificaciones.
   *
   * Se piden los números al proceso principal antes de preguntar: un "¿seguro?"
   * a secas no permite decidir nada, y aquí lo que está en juego son
   * calificaciones capturadas que no se recuperan con un deshacer.
   */
  async function handleDelete(p: SchoolPeriod) {
    const prev = await window.api.deletePeriodPreview(p.id)
    if (!prev.ok) { setError(prev.error!); return }

    const d = prev.data as {
      period_name: string; is_active: boolean
      groups: number; enrollments: number; evaluations: number
      closed: number; students: number
      by_complementary: { name: string; groups: number }[]
    }

    const vacio = !d.groups && !d.enrollments && !d.evaluations
    let aviso = `¿Eliminar el periodo "${d.period_name}"?\n\n`

    if (vacio) {
      aviso += 'El periodo está vacío, no se pierde nada.'
    } else {
      aviso += 'Se eliminará también, de forma permanente:\n'
      if (d.groups) aviso += `  • ${d.groups} grupo(s)\n`
      if (d.enrollments) aviso += `  • ${d.enrollments} inscripción(es) de ${d.students} estudiante(s)\n`
      if (d.evaluations) aviso += `  • ${d.evaluations} calificación(es) capturada(s)\n`
      if (d.closed) aviso += `  • incluidas ${d.closed} evaluación(es) ya cerrada(s)\n`

      if (d.by_complementary.length) {
        aviso += `\nComplementarias afectadas:\n` +
          d.by_complementary.map(c => `  • ${c.name} (${c.groups} grupo(s))`).join('\n') + '\n'
      }

      aviso += `\nLos estudiantes NO se borran, solo su participación en este periodo.`
      aviso += `\n\nSe guardará un respaldo antes de borrar, por si hace falta volver atrás.`
    }

    if (d.is_active) {
      aviso += `\n\nOJO: es el periodo ACTIVO. Después de borrarlo tendrás que marcar otro como activo.`
    }

    if (!confirm(aviso)) return

    // Segunda confirmación solo cuando hay calificaciones en juego
    if (d.evaluations > 0 && !confirm(
      `Última confirmación.\n\n` +
      `Se van a borrar ${d.evaluations} calificación(es) del periodo "${d.period_name}". ` +
      `Esta acción no se puede deshacer desde el programa.\n\n¿Continuar?`
    )) return

    const res = await window.api.deletePeriod(p.id)
    if (!res.ok) { setError(res.error!); return }

    const r = res.data as {
      period_name: string; groups: number; enrollments: number
      evaluations: number; backup: string
    }
    setMessage(
      `Periodo "${r.period_name}" eliminado` +
      (r.groups || r.enrollments || r.evaluations
        ? ` junto con ${r.groups} grupo(s), ${r.enrollments} inscripción(es) y ${r.evaluations} calificación(es)`
        : '') +
      (r.backup ? `. Respaldo previo guardado en Configuración → Respaldos.` : '')
    )
    load()
  }

  // ─── Duplicación ───────────────────────────────────────────────────────
  async function openDuplicate(p: SchoolPeriod) {
    setDupSource(p)
    const suggested = nextPeriodName(p.name)
    const dates = guessDates(suggested)
    setDupForm({ name: suggested, start_date: dates.start, end_date: dates.end, is_active: false })
    setDupCapacity('')
    setDupSchedule(true)
    setError(''); setPreview(null)
    setDupModal(true)

    const res = await window.api.duplicatePeriodPreview(p.id)
    if (res.ok) {
      const data = res.data as any
      setPreview(data)
      // Preseleccionar todas las complementarias con grupos
      setDupComps(data.by_complementary.map((c: PreviewByComp) => c.complementary_id))
    }
  }

  function toggleComp(id: number) {
    setDupComps(cs => cs.includes(id) ? cs.filter(x => x !== id) : [...cs, id])
  }

  async function handleDuplicate() {
    if (!dupSource) return
    if (!dupForm.name.trim() || !dupForm.start_date || !dupForm.end_date) {
      setError('Nombre y fechas son obligatorios'); return
    }
    setLoading(true); setError('')

    const allSelected = preview
      ? dupComps.length === preview.by_complementary.length
      : false

    const res = await window.api.duplicatePeriod({
      source_period_id: dupSource.id,
      name: dupForm.name.trim(),
      start_date: dupForm.start_date,
      end_date: dupForm.end_date,
      is_active: dupForm.is_active,
      complementary_ids: allSelected ? [] : dupComps,
      override_capacity: dupCapacity ? Number(dupCapacity) : null,
      copy_schedule: dupSchedule,
    })
    setLoading(false)

    if (!res.ok) { setError(res.error!); return }
    const d = res.data as any
    setMessage(
      `Periodo ${d.period_name} creado a partir de ${d.source_name} con ${d.groups_copied} grupo(s)` +
      (d.skipped?.length ? `. Se omitieron ${d.skipped.length}.` : '')
    )
    setDupModal(false)
    load()
  }

  // Grupos que se copiarán según la selección actual
  const selectedGroups = preview?.groups.filter(g => dupComps.includes(g.complementary_id)) ?? []

  // Periodos cuyas fechas coinciden con las del formulario. Ya no es un error,
  // solo se informa. Se compara texto contra texto porque las fechas se guardan
  // en formato AAAA-MM-DD, donde el orden alfabético es el orden cronológico.
  const overlapping = (form.start_date && form.end_date)
    ? items.filter(p =>
        p.id !== editing?.id &&
        p.start_date <= form.end_date &&
        p.end_date >= form.start_date)
    : []

  // Días completos entre inicio y fin; null si el rango está invertido
  const duration = (form.start_date && form.end_date)
    ? Math.round(
        (new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86_400_000)
    : null

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Periodos escolares</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nuevo periodo</button>
      </div>

      {message && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}
          onClick={() => setMessage('')}>{message}</div>
      )}
      {error && !modal && !dupModal && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Inicio</th><th>Fin</th>
                <th>Grupos</th><th>Inscripciones</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={7} className="table-empty">Sin periodos registrados</td></tr>
              )}
              {items.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td>{p.group_count ?? 0}</td>
                  <td>{p.enrollment_count ?? 0}</td>
                  <td>
                    {p.is_active
                      ? <span className="badge badge-active">Activo</span>
                      : <span className="badge badge-inactive">Inactivo</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!p.is_active && (
                      <button className="btn btn-success btn-sm" onClick={() => handleSetActive(p)}>
                        Activar
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => openDuplicate(p)}
                      disabled={!p.group_count} title={p.group_count ? '' : 'El periodo no tiene grupos'}>
                      Duplicar
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Editar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal crear / editar */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Editar periodo' : 'Nuevo periodo'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label className="form-label">Nombre *</label>
                <input className="form-control" value={form.name}
                  onChange={e => {
                    const name = e.target.value
                    const d = guessDates(name)
                    setForm(f => ({
                      ...f, name,
                      start_date: d.start || f.start_date,
                      end_date: d.end || f.end_date,
                    }))
                  }}
                  placeholder="Ej. 2026-1" />
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Fecha inicio *</label>
                  <input className="form-control" type="date" value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha fin *</label>
                  <input className="form-control" type="date" value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              {/*
                Los periodos traslapados sí se permiten (un intersemestral o un
                curso a distancia puede coincidir con el semestre regular). Se
                avisa solo para que quede claro que fue a propósito y no un error
                de captura.
              */}
              {overlapping.length > 0 && (
                <div className="alert" style={{
                  background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)',
                  color: 'var(--text)', fontSize: 13, lineHeight: 1.6,
                }}>
                  Estas fechas coinciden con {overlapping.length === 1 ? 'el periodo' : 'los periodos'}{' '}
                  <strong>{overlapping.map(p => p.name).join(', ')}</strong>. Se puede guardar así;
                  cada grupo queda ligado a su propio periodo y los reportes no se mezclan.
                </div>
              )}
              {duration !== null && duration >= 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Duración: {duration === 0 ? 'un solo día' : `${duration + 1} días`}
                </div>
              )}
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active === 1}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} />
                  <span className="form-label" style={{ margin: 0 }}>Marcar como periodo activo</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
                {loading ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal duplicar */}
      {dupModal && dupSource && (
        <div className="modal-overlay" onClick={() => setDupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <span className="modal-title">Duplicar periodo {dupSource.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDupModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}

              <div className="alert alert-info" style={{ marginBottom: 16 }}>
                Se copiará la configuración de grupos, cupos y horarios.
                <strong> No se copian estudiantes ni inscripciones.</strong>
              </div>

              <div className="form-group">
                <label className="form-label">Nombre del nuevo periodo *</label>
                <input className="form-control" value={dupForm.name}
                  onChange={e => {
                    const name = e.target.value
                    const d = guessDates(name)
                    setDupForm(f => ({
                      ...f, name,
                      start_date: d.start || f.start_date,
                      end_date: d.end || f.end_date,
                    }))
                  }}
                  placeholder="2026-1" />
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Fecha inicio *</label>
                  <input className="form-control" type="date" value={dupForm.start_date}
                    onChange={e => setDupForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha fin *</label>
                  <input className="form-control" type="date" value={dupForm.end_date}
                    onChange={e => setDupForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>

              {/* Complementarias a copiar */}
              {preview && (
                <div className="form-group">
                  <label className="form-label">
                    Complementarias a copiar ({dupComps.length} de {preview.by_complementary.length})
                  </label>
                  <div style={{
                    border: '1px solid var(--border)', borderRadius: 8,
                    maxHeight: 200, overflow: 'auto',
                  }}>
                    {preview.by_complementary.map(c => (
                      <label key={c.complementary_id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 14,
                      }}>
                        <input type="checkbox" checked={dupComps.includes(c.complementary_id)}
                          onChange={() => toggleComp(c.complementary_id)} />
                        <span style={{ flex: 1 }}>{c.complementary_name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {c.group_count} grupo(s) · {c.total_capacity} lugares
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn btn-sm"
                      onClick={() => setDupComps(preview.by_complementary.map(c => c.complementary_id))}>
                      Todas
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setDupComps([])}>
                      Ninguna
                    </button>
                  </div>
                </div>
              )}

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Cupo para todos los grupos</label>
                  <input className="form-control" type="number" min={1} value={dupCapacity}
                    onChange={e => setDupCapacity(e.target.value)}
                    placeholder="Conservar el original" />
                </div>
                <div className="form-group">
                  <label className="form-label">Horario y aula</label>
                  <select className="form-control" value={dupSchedule ? '1' : '0'}
                    onChange={e => setDupSchedule(e.target.value === '1')}>
                    <option value="1">Copiar del periodo anterior</option>
                    <option value="0">Dejar en blanco</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={dupForm.is_active}
                    onChange={e => setDupForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="form-label" style={{ margin: 0 }}>
                    Marcar el nuevo periodo como activo
                  </span>
                </label>
              </div>

              {/* Resumen */}
              <div style={{
                background: 'var(--bg)', borderRadius: 8, padding: 12, fontSize: 13,
              }}>
                <strong>Se crearán {selectedGroups.length} grupo(s):</strong>
                {selectedGroups.length > 0 ? (
                  <div style={{ maxHeight: 120, overflow: 'auto', marginTop: 8 }}>
                    {selectedGroups.map(g => (
                      <div key={g.id} style={{ color: 'var(--text-muted)', padding: '2px 0' }}>
                        {g.complementary_name} · {g.group_number} · cupo {dupCapacity || g.capacity}
                        {dupSchedule && g.days ? ` · ${g.days}` : ''}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                    Selecciona al menos una complementaria
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDupModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleDuplicate}
                disabled={loading || !selectedGroups.length}>
                {loading ? 'Duplicando...' : `Crear periodo con ${selectedGroups.length} grupo(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
