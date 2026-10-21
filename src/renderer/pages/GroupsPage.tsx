import { useState, useEffect, useRef } from 'react'
import type {
  Group, GroupDTO, Complementary, SchoolPeriod,
  GroupRoster, RosterEntry, RemovalMode,
} from '@shared/types'
import { scoreText, isPassing } from '@shared/scores'

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const EMPTY: GroupDTO = {
  complementary_id: 0, period_id: 0, group_number: '',
  capacity: 30, classroom: '', days: '', start_time: '', end_time: '', status: 'active',
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [complementaries, setComplementaries] = useState<Complementary[]>([])
  const [periods, setPeriods] = useState<SchoolPeriod[]>([])
  const [filterPeriod, setFilterPeriod] = useState('')
  const [filterComp, setFilterComp] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [form, setForm] = useState<GroupDTO>(EMPTY)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // ─── Lista de alumnos del grupo ───────────────────────────────────────────
  const [roster, setRoster] = useState<GroupRoster | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmMode, setConfirmMode] = useState<RemovalMode | null>(null)
  const [reason, setReason] = useState('')
  const [rosterMsg, setRosterMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [working, setWorking] = useState(false)
  /** Candado síncrono: evita que un doble clic mande la operación dos veces */
  const busy = useRef(false)

  async function load() {
    const filters: any = {}
    if (filterPeriod) filters.period_id = Number(filterPeriod)
    if (filterComp) filters.complementary_id = Number(filterComp)
    const res = await window.api.getGroups(filters)
    if (res.ok) setGroups(res.data as Group[])
  }

  useEffect(() => {
    Promise.all([window.api.getComplementaries(), window.api.getPeriods()]).then(([c, p]) => {
      if (c.ok) setComplementaries(c.data as Complementary[])
      if (p.ok) setPeriods(p.data as SchoolPeriod[])
    })
  }, [])

  useEffect(() => { load() }, [filterPeriod, filterComp])

  function openCreate() {
    setEditing(null); setForm(EMPTY); setSelectedDays([]); setError(''); setModal(true)
  }
  function openEdit(g: Group) {
    setEditing(g)
    setForm({
      complementary_id: g.complementary_id, period_id: g.period_id,
      group_number: g.group_number, capacity: g.capacity, classroom: g.classroom,
      days: g.days, start_time: g.start_time, end_time: g.end_time, status: g.status,
    })
    setSelectedDays(g.days ? g.days.split(',') : [])
    setError(''); setModal(true)
  }

  function toggleDay(day: string) {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  async function handleSave() {
    if (!form.complementary_id || !form.period_id || !form.group_number.trim()) {
      setError('Complementaria, periodo y número de grupo son obligatorios'); return
    }
    const dto = { ...form, days: selectedDays.join(',') }
    setLoading(true); setError('')
    const res = editing
      ? await window.api.updateGroup(editing.id, dto)
      : await window.api.createGroup(dto)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleDelete(g: Group) {
    if (!confirm(`¿Eliminar el grupo "${g.group_number}"?`)) return
    const res = await window.api.deleteGroup(g.id)
    if (!res.ok) alert(res.error)
    else load()
  }

  // ─── Alumnos del grupo ────────────────────────────────────────────────────

  /**
   * Envuelve una llamada IPC para que un canal inexistente o un fallo del
   * proceso principal no deje la pantalla colgada en "Cargando…".
   */
  async function callApi<T>(fn: () => Promise<any>): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
      const res = await fn()
      if (!res) return { ok: false, error: 'El proceso principal no respondió' }
      return res
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (msg.includes('No handler registered')) {
        return {
          ok: false,
          error: 'Esta función es nueva y la aplicación está corriendo con una versión anterior. ' +
            'Cierra la ventana por completo y vuelve a ejecutar "npm run dev".',
        }
      }
      return { ok: false, error: msg }
    }
  }

  async function openRoster(g: Group) {
    setRosterLoading(true)
    setSelected(new Set()); setConfirmMode(null); setReason(''); setRosterMsg(null)
    setRoster({ group: g, students: [], active_count: 0, cancelled_count: 0, graded_count: 0, closed_count: 0 })
    const res = await callApi<GroupRoster>(() => window.api.getGroupRoster(g.id))
    setRosterLoading(false)
    if (res.ok && res.data) setRoster(res.data)
    else setRosterMsg({ type: 'error', text: res.error ?? 'No se pudo cargar la lista de alumnos' })
  }

  async function reloadRoster() {
    if (!roster) return
    const res = await callApi<GroupRoster>(() => window.api.getGroupRoster(roster.group.id))
    if (res.ok && res.data) setRoster(res.data)
  }

  function closeRoster() {
    setRoster(null); setSelected(new Set()); setConfirmMode(null); setRosterMsg(null)
  }

  function toggleStudent(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setRosterMsg(null)
  }

  function toggleAll() {
    if (!roster) return
    const selectable = roster.students.filter(s => s.evaluation_status !== 'closed')
    setSelected(prev =>
      prev.size === selectable.length ? new Set() : new Set(selectable.map(s => s.enrollment_id))
    )
    setRosterMsg(null)
  }

  /** Alumnos elegidos, en el mismo orden que la tabla */
  function chosen(): RosterEntry[] {
    return roster ? roster.students.filter(s => selected.has(s.enrollment_id)) : []
  }

  function askRemove(mode: RemovalMode) {
    if (!selected.size) {
      setRosterMsg({ type: 'error', text: 'Selecciona al menos un alumno' })
      return
    }
    const blocked = chosen().filter(s => s.evaluation_status === 'closed')
    if (blocked.length) {
      setRosterMsg({
        type: 'error',
        text: `${blocked.length} alumno(s) tienen la evaluación cerrada. Reabre la evaluación del grupo antes de quitarlos.`,
      })
      return
    }
    if (mode === 'cancel' && chosen().every(s => s.status === 'cancelled')) {
      setRosterMsg({ type: 'error', text: 'Los alumnos seleccionados ya están dados de baja' })
      return
    }
    setReason(''); setRosterMsg(null); setConfirmMode(mode)
  }

  async function doRemove() {
    if (!roster || !confirmMode) return
    if (busy.current) return          // ya hay una operación en curso
    busy.current = true
    setWorking(true)

    const mode = confirmMode
    const res = await callApi<{ affected: number; scores_removed: number }>(() =>
      window.api.removeGroupStudents({
        group_id: roster.group.id,
        enrollment_ids: [...selected],
        mode,
        reason,
      }))

    setWorking(false)
    busy.current = false
    setConfirmMode(null)
    setSelected(new Set())

    if (!res.ok || !res.data) {
      setRosterMsg({ type: 'error', text: res.error ?? 'Error' })
      // La lista puede estar desactualizada: la refrescamos siempre
      await reloadRoster(); load()
      return
    }

    const r = res.data
    setRosterMsg({
      type: 'success',
      text: mode === 'delete'
        ? `Se eliminaron ${r.affected} inscripción(es)` +
          (r.scores_removed ? ` y ${r.scores_removed} calificación(es)` : '')
        : `Se dieron de baja ${r.affected} alumno(s)`,
    })
    await reloadRoster(); load()
  }

  async function restoreStudent(s: RosterEntry) {
    if (busy.current) return
    busy.current = true
    const res = await callApi(() => window.api.restoreGroupStudent(s.enrollment_id))
    busy.current = false
    if (!res.ok) {
      setRosterMsg({ type: 'error', text: res.error ?? 'Error' })
      await reloadRoster()
      return
    }
    setRosterMsg({ type: 'success', text: `${s.student_name} fue reactivado en el grupo` })
    await reloadRoster(); load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Grupos</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nuevo grupo</button>
      </div>

      <div className="filters-bar">
        <div className="form-group">
          <label className="form-label">Periodo</label>
          <select className="form-control" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="">Todos</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Complementaria</label>
          <select className="form-control" value={filterComp} onChange={e => setFilterComp(e.target.value)}>
            <option value="">Todas</option>
            {complementaries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Complementaria</th><th>Grupo</th><th>Periodo</th>
                <th>Aula</th><th>Días</th><th>Horario</th>
                <th>Cupo</th><th>Inscritos</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={10} className="table-empty">Sin grupos registrados</td></tr>
              )}
              {groups.map(g => (
                <tr key={g.id}>
                  <td>{g.complementary_name}</td>
                  <td><strong>{g.group_number}</strong></td>
                  <td>{g.period_name}</td>
                  <td>{g.classroom || '—'}</td>
                  <td style={{ fontSize: 12 }}>{g.days || '—'}</td>
                  <td style={{ fontSize: 12 }}>{g.start_time && g.end_time ? `${g.start_time} - ${g.end_time}` : '—'}</td>
                  <td>{g.capacity}</td>
                  <td>
                    <span style={{
                      color: (g.enrolled_count ?? 0) >= g.capacity ? 'var(--danger)' : 'var(--success)',
                      fontWeight: 600,
                    }}>
                      {g.enrolled_count ?? 0}
                    </span>
                  </td>
                  <td><span className={`badge badge-${g.status}`}>{g.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openRoster(g)}>
                      Alumnos{(g.enrolled_count ?? 0) > 0 ? ` (${g.enrolled_count})` : ''}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(g)}>Editar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(g)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Editar grupo' : 'Nuevo grupo'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Complementaria *</label>
                  <select className="form-control" value={form.complementary_id}
                    onChange={e => setForm(f => ({ ...f, complementary_id: Number(e.target.value) }))}>
                    <option value={0}>Seleccionar...</option>
                    {complementaries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Periodo *</label>
                  <select className="form-control" value={form.period_id}
                    onChange={e => setForm(f => ({ ...f, period_id: Number(e.target.value) }))}>
                    <option value={0}>Seleccionar...</option>
                    {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Número de grupo *</label>
                  <input className="form-control" value={form.group_number}
                    onChange={e => setForm(f => ({ ...f, group_number: e.target.value }))}
                    placeholder="Ej. A, 01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Cupo</label>
                  <input className="form-control" type="number" min={1} value={form.capacity}
                    onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Aula</label>
                <input className="form-control" value={form.classroom}
                  onChange={e => setForm(f => ({ ...f, classroom: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Días</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {DAYS.map(d => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={selectedDays.includes(d)} onChange={() => toggleDay(d)} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Hora inicio</label>
                  <input className="form-control" type="time" value={form.start_time}
                    onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Hora fin</label>
                  <input className="form-control" type="time" value={form.end_time}
                    onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Estado</label>
                <select className="form-control" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}>
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
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

      {roster && (
        <div className="modal-overlay" onClick={closeRoster}>
          <div className="modal" style={{ maxWidth: 940 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                Alumnos · {roster.group.complementary_name} — Grupo {roster.group.group_number}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={closeRoster}>✕</button>
            </div>

            {/* ── Paso 2: aviso de confirmación ── */}
            {confirmMode ? (
              <>
                <div className="modal-body">
                  <div className={confirmMode === 'delete' ? 'alert alert-error' : 'alert alert-warning'}>
                    <div>
                      <strong style={{ display: 'block', marginBottom: 6, fontSize: 15 }}>
                        {confirmMode === 'delete'
                          ? 'Vas a eliminar alumnos de forma definitiva'
                          : 'Vas a dar de baja alumnos del grupo'}
                      </strong>
                      {confirmMode === 'delete'
                        ? 'Esta acción no se puede deshacer. Se borrará el registro de inscripción y su calificación. El alumno seguirá existiendo en el catálogo y podrá volver a inscribirse.'
                        : 'La inscripción se marca como cancelada. Se conserva el historial y la calificación capturada, y puedes reactivarla después desde esta misma ventana.'}
                    </div>
                  </div>

                  <div>
                    <strong style={{ fontSize: 13 }}>Se van a afectar {chosen().length} alumno(s):</strong>
                    <div style={{
                      maxHeight: 220, overflow: 'auto', marginTop: 8,
                      border: '1px solid var(--border)', borderRadius: 6,
                    }}>
                      <table>
                        <thead>
                          <tr><th>No. Control</th><th>Nombre</th><th>Estado actual</th><th>Calificación</th></tr>
                        </thead>
                        <tbody>
                          {chosen().map(s => (
                            <tr key={s.enrollment_id}>
                              <td style={{ fontFamily: 'monospace' }}>{s.enrollment_number}</td>
                              <td>{s.student_name}</td>
                              <td>
                                <span className={`badge badge-${s.status === 'active' ? 'active' : 'cancelled'}`}>
                                  {s.status === 'active' ? 'Inscrito' : 'Baja'}
                                </span>
                              </td>
                              <td style={{ fontSize: 12 }}>
                                {s.score === null || s.score === undefined ? (
                                  <span style={{ color: 'var(--text-muted)' }}>Sin calificar</span>
                                ) : (
                                  <span style={{
                                    color: confirmMode === 'delete' ? 'var(--danger)' : 'inherit',
                                    fontWeight: 600,
                                  }}>
                                    {scoreText(s.score)}{confirmMode === 'delete' ? ' — se borrará' : ''}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {(() => {
                    const withScore = chosen().filter(s => s.score !== null && s.score !== undefined).length
                    if (confirmMode === 'delete' && withScore > 0) return (
                      <div className="alert alert-warning">
                        Atención: {withScore} de los alumnos seleccionados ya tienen calificación capturada
                        y se perderá. Si solo quieres sacarlos del grupo conservando el registro,
                        cancela y usa <strong>Dar de baja</strong>.
                      </div>
                    )
                    return null
                  })()}

                  {confirmMode === 'cancel' && (
                    <div className="form-group">
                      <label className="form-label">Motivo de la baja (opcional)</label>
                      <input className="form-control" value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Ej. Baja solicitada por el alumno, cambio de grupo…" />
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Después de esta operación el grupo quedaría con{' '}
                    <strong>
                      {roster.active_count - chosen().filter(s => s.status === 'active').length}
                    </strong>{' '}
                    alumno(s) inscritos de {roster.group.capacity} lugares.
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setConfirmMode(null)} disabled={working}>
                    Cancelar
                  </button>
                  <button
                    className={confirmMode === 'delete' ? 'btn btn-danger' : 'btn btn-primary'}
                    onClick={doRemove} disabled={working}>
                    {working
                      ? 'Procesando...'
                      : confirmMode === 'delete'
                        ? `Sí, eliminar ${chosen().length} definitivamente`
                        : `Sí, dar de baja ${chosen().length}`}
                  </button>
                </div>
              </>
            ) : (
              /* ── Paso 1: lista y selección ── */
              <>
                <div className="modal-body">
                  {rosterMsg && (
                    <div className={`alert alert-${rosterMsg.type}`}>{rosterMsg.text}</div>
                  )}

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                    <span>Inscritos: <strong>{roster.active_count}</strong> / {roster.group.capacity}</span>
                    <span>Bajas: <strong>{roster.cancelled_count}</strong></span>
                    <span>Calificados: <strong>{roster.graded_count}</strong></span>
                    {roster.closed_count > 0 && (
                      <span style={{ color: 'var(--danger)' }}>
                        Evaluación cerrada: <strong>{roster.closed_count}</strong>
                      </span>
                    )}
                  </div>

                  {roster.closed_count > 0 && (
                    <div className="alert alert-warning">
                      Hay alumnos con la evaluación cerrada. No se pueden dar de baja ni eliminar
                      hasta reabrir la evaluación del grupo desde la pantalla de Evaluaciones.
                    </div>
                  )}

                  {rosterLoading ? (
                    <div className="table-empty">Cargando alumnos…</div>
                  ) : roster.students.length === 0 ? (
                    <div className="table-empty">
                      {rosterMsg?.type === 'error'
                        ? 'No se pudo leer la lista'
                        : 'Este grupo no tiene alumnos inscritos'}
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: 380, overflow: 'auto',
                      border: '1px solid var(--border)', borderRadius: 6,
                    }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: 36 }}>
                              <input type="checkbox"
                                checked={
                                  selected.size > 0 &&
                                  selected.size === roster.students.filter(s => s.evaluation_status !== 'closed').length
                                }
                                onChange={toggleAll}
                                title="Seleccionar todos" />
                            </th>
                            <th>No. Control</th>
                            <th>Nombre</th>
                            <th>Carrera</th>
                            <th>Estado</th>
                            <th>Calificación</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {roster.students.map(s => {
                            const locked = s.evaluation_status === 'closed'
                            return (
                              <tr key={s.enrollment_id}
                                style={{
                                  background: selected.has(s.enrollment_id) ? '#eff6ff' : undefined,
                                  opacity: s.status === 'cancelled' ? 0.65 : 1,
                                }}>
                                <td>
                                  <input type="checkbox" disabled={locked}
                                    checked={selected.has(s.enrollment_id)}
                                    onChange={() => toggleStudent(s.enrollment_id)} />
                                </td>
                                <td style={{ fontFamily: 'monospace' }}>{s.enrollment_number}</td>
                                <td>{s.student_name}</td>
                                <td style={{ fontSize: 12 }}>{s.career_name}</td>
                                <td>
                                  <span className={`badge badge-${s.status === 'active' ? 'active' : 'cancelled'}`}>
                                    {s.status === 'active' ? 'Inscrito' : 'Baja'}
                                  </span>
                                  {locked && (
                                    <span className="badge badge-inactive" style={{ marginLeft: 4 }}>Cerrada</span>
                                  )}
                                </td>
                                <td style={{ fontSize: 12 }}>
                                  {s.score === null || s.score === undefined ? (
                                    <span style={{ color: 'var(--text-muted)' }}>Pendiente</span>
                                  ) : (
                                    <span style={{
                                      color: isPassing(s.score) ? 'var(--success)' : 'var(--danger)',
                                      fontWeight: 600,
                                    }}>{scoreText(s.score)}</span>
                                  )}
                                </td>
                                <td>
                                  {s.status === 'cancelled' && (
                                    <button className="btn btn-secondary btn-sm"
                                      onClick={() => restoreStudent(s)}>Reactivar</button>
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

                <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {selected.size} seleccionado(s)
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={closeRoster}>Cerrar</button>
                    <button className="btn btn-primary" disabled={!selected.size}
                      onClick={() => askRemove('cancel')}>
                      Dar de baja{selected.size ? ` (${selected.size})` : ''}
                    </button>
                    <button className="btn btn-danger" disabled={!selected.size}
                      onClick={() => askRemove('delete')}>
                      Eliminar del grupo{selected.size ? ` (${selected.size})` : ''}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
