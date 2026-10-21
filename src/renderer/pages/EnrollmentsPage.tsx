import { useState, useEffect } from 'react'
import type { Enrollment, EnrollmentDTO, Student, Group, Career, Complementary, SchoolPeriod } from '@shared/types'

export default function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [careers, setCareers] = useState<Career[]>([])
  const [complementaries, setComplementaries] = useState<Complementary[]>([])
  const [periods, setPeriods] = useState<SchoolPeriod[]>([])

  const [filterPeriod, setFilterPeriod] = useState('')
  const [filterComp, setFilterComp] = useState('')
  const [filterCareer, setFilterCareer] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<EnrollmentDTO>({ student_id: 0, group_id: 0, observations: '' })
  const [studentSearch, setStudentSearch] = useState('')
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [cancelModal, setCancelModal] = useState<Enrollment | null>(null)
  const [cancelObs, setCancelObs] = useState('')

  async function load() {
    const filters: any = {}
    if (filterPeriod) filters.period_id = Number(filterPeriod)
    if (filterComp) filters.complementary_id = Number(filterComp)
    if (filterCareer) filters.career_id = Number(filterCareer)
    if (filterStatus) filters.status = filterStatus
    if (search) filters.search = search
    const res = await window.api.getEnrollments(filters)
    if (res.ok) setEnrollments(res.data as Enrollment[])
  }

  useEffect(() => {
    Promise.all([
      window.api.getStudents({ status: 'active' }),
      window.api.getGroups(),
      window.api.getCareers(),
      window.api.getComplementaries(),
      window.api.getPeriods(),
    ]).then(([s, g, c, comp, p]) => {
      if (s.ok) setStudents(s.data as Student[])
      if (g.ok) setGroups(g.data as Group[])
      if (c.ok) setCareers(c.data as Career[])
      if (comp.ok) setComplementaries(comp.data as Complementary[])
      if (p.ok) setPeriods(p.data as SchoolPeriod[])
    })
  }, [])

  useEffect(() => { load() }, [filterPeriod, filterComp, filterCareer, filterStatus, search])

  useEffect(() => {
    if (!studentSearch) { setFilteredStudents([]); return }
    const q = studentSearch.toLowerCase()
    setFilteredStudents(
      students.filter(s =>
        s.enrollment_number.toLowerCase().includes(q) ||
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q)
      ).slice(0, 8)
    )
  }, [studentSearch, students])

  function openCreate() {
    setForm({ student_id: 0, group_id: 0, observations: '' })
    setStudentSearch(''); setFilteredStudents([]); setError(''); setModal(true)
  }

  async function handleSave() {
    if (!form.student_id || !form.group_id) {
      setError('Selecciona un estudiante y un grupo'); return
    }
    setLoading(true); setError('')
    const res = await window.api.createEnrollment(form)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleCancel() {
    if (!cancelModal) return
    const res = await window.api.cancelEnrollment(cancelModal.id, cancelObs || 'Baja solicitada')
    if (!res.ok) alert(res.error)
    else { setCancelModal(null); load() }
  }

  const selectedGroup = groups.find(g => g.id === form.group_id)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Inscripciones</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nueva inscripción</button>
      </div>

      <div className="filters-bar">
        <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
          <label className="form-label">Buscar estudiante</label>
          <input className="form-control" placeholder="Matrícula o nombre..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
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
        <div className="form-group">
          <label className="form-label">Carrera</label>
          <select className="form-control" value={filterCareer} onChange={e => setFilterCareer(e.target.value)}>
            <option value="">Todas</option>
            {careers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Estado</label>
          <select className="form-control" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="active">Activas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
          {enrollments.length} inscripción(es)
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>No. Control</th><th>Estudiante</th><th>Carrera</th>
                <th>Complementaria</th><th>Grupo</th><th>Periodo</th>
                <th>Horario</th><th>Fecha</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 && (
                <tr><td colSpan={10} className="table-empty">Sin inscripciones encontradas</td></tr>
              )}
              {enrollments.map(e => (
                <tr key={e.id}>
                  <td><strong>{e.enrollment_number}</strong></td>
                  <td>
                    {e.student_name}
                    {/* Un alumno dado de baja con inscripción vigente es una
                        incongruencia que conviene ver, no esconder. */}
                    {(e as any).student_status === 'inactive' && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>
                        Estudiante dado de baja
                      </div>
                    )}
                  </td>
                  <td>{e.career_name}</td>
                  <td>{e.complementary_name}</td>
                  <td>{e.group_number}</td>
                  <td>{e.period_name}</td>
                  <td style={{ fontSize: 12 }}>
                    {e.days && e.start_time ? `${e.days} ${e.start_time}-${e.end_time}` : '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>{e.enrolled_at?.slice(0, 10)}</td>
                  <td>
                    <span className={`badge badge-${e.status === 'active' ? 'active' : 'cancelled'}`}>
                      {e.status === 'active' ? 'Activa' : 'Cancelada'}
                    </span>
                  </td>
                  <td>
                    {e.status === 'active' && (
                      <button className="btn btn-danger btn-sm"
                        onClick={() => { setCancelModal(e); setCancelObs('') }}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nueva inscripción */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Nueva inscripción</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}

              {/* Búsqueda de estudiante */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">Buscar estudiante *</label>
                <input className="form-control" placeholder="Matrícula o nombre..."
                  value={studentSearch}
                  onChange={e => { setStudentSearch(e.target.value); setForm(f => ({ ...f, student_id: 0 })) }} />
                {filteredStudents.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: '#fff', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: 'var(--shadow)', zIndex: 10,
                  }}>
                    {filteredStudents.map(s => (
                      <div key={s.id}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f5f7fa')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onClick={() => {
                          setForm(f => ({ ...f, student_id: s.id }))
                          setStudentSearch(`${s.enrollment_number} - ${s.first_name} ${s.last_name}`)
                          setFilteredStudents([])
                        }}>
                        <strong>{s.enrollment_number}</strong> — {s.first_name} {s.last_name}
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{s.career_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selección de grupo */}
              <div className="form-group">
                <label className="form-label">Grupo *</label>
                <select className="form-control" value={form.group_id}
                  onChange={e => setForm(f => ({ ...f, group_id: Number(e.target.value) }))}>
                  <option value={0}>Seleccionar grupo...</option>
                  {groups.filter(g => g.status === 'active').map(g => (
                    <option key={g.id} value={g.id}>
                      {g.complementary_name} — Grupo {g.group_number} ({g.period_name}) [{g.enrolled_count ?? 0}/{g.capacity}]
                    </option>
                  ))}
                </select>
              </div>

              {/* Info del grupo seleccionado */}
              {selectedGroup && (
                <div className="alert alert-warning" style={{ fontSize: 13 }}>
                  <strong>Aula:</strong> {selectedGroup.classroom || '—'} &nbsp;|&nbsp;
                  <strong>Días:</strong> {selectedGroup.days || '—'} &nbsp;|&nbsp;
                  <strong>Horario:</strong> {selectedGroup.start_time} - {selectedGroup.end_time} &nbsp;|&nbsp;
                  <strong>Cupo disponible:</strong> {selectedGroup.capacity - (selectedGroup.enrolled_count ?? 0)}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Observaciones</label>
                <textarea className="form-control" rows={2} value={form.observations}
                  onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
                {loading ? 'Inscribiendo...' : 'Inscribir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cancelar inscripción */}
      {cancelModal && (
        <div className="modal-overlay" onClick={() => setCancelModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Cancelar inscripción</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setCancelModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14 }}>
                ¿Cancelar la inscripción de <strong>{cancelModal.student_name}</strong> en{' '}
                <strong>{cancelModal.complementary_name}</strong> grupo {cancelModal.group_number}?
              </p>
              <div className="form-group">
                <label className="form-label">Motivo / observaciones</label>
                <textarea className="form-control" rows={2} value={cancelObs}
                  onChange={e => setCancelObs(e.target.value)}
                  placeholder="Opcional" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCancelModal(null)}>No cancelar</button>
              <button className="btn btn-danger" onClick={handleCancel}>Confirmar cancelación</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
