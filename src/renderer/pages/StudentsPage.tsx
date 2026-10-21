import { useState, useEffect } from 'react'
import type { Student, StudentDTO, Career } from '@shared/types'
import { checkEnrollment } from '@shared/enrollmentNumber'
import {
  institutionalEmail, isInstitutional, INSTITUTIONAL_DOMAIN,
} from '@shared/institutionalEmail'
import StudentHistoryModal from '../components/StudentHistoryModal'

const EMPTY: StudentDTO = {
  enrollment_number: '', first_name: '', last_name: '',
  email: '', phone: '', career_id: 0, semester: 1, status: 'active',
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [careers, setCareers] = useState<Career[]>([])
  const [search, setSearch] = useState('')
  const [filterCareer, setFilterCareer] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [form, setForm] = useState<StudentDTO>(EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /** Aviso sobre la matrícula que se está escribiendo (formato o carrera) */
  const [enrollHint, setEnrollHint] = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  /** Estudiante cuyo historial se está consultando */
  const [historyId, setHistoryId] = useState<number | null>(null)
  /** Pista cuando la búsqueda no da resultados por el filtro de estado */
  const [hint, setHint] = useState('')

  // El correo se deduce del número de control; se muestra para que se vea qué
  // se va a guardar, sin obligar a escribirlo.
  const autoEmail = institutionalEmail(form.enrollment_number)
  const emailMatchesEnrollment = !!autoEmail && form.email.trim().toLowerCase() === autoEmail

  async function load() {
    const filters: any = {}
    if (search) filters.search = search
    if (filterCareer) filters.career_id = Number(filterCareer)
    if (filterStatus) filters.status = filterStatus
    const res = await window.api.getStudents(filters)
    if (!res.ok) return
    const found = res.data as Student[]
    setStudents(found)

    /*
     * "No salgo en la lista" casi nunca significa que el alumno no exista: la
     * pantalla filtra Activos por omisión, así que un alumno dado de baja
     * desaparece sin explicación y parece que se perdió el registro.
     *
     * Cuando la búsqueda no da nada con el filtro puesto, se repite sin filtrar
     * por estado. Si así aparece, se dice dónde está en lugar de dejar un
     * "Sin estudiantes encontrados" que no ayuda.
     */
    if (found.length === 0 && filterStatus && (search || filterCareer)) {
      const otros: any = { ...filters }
      delete otros.status
      const alt = await window.api.getStudents(otros)
      const total = alt.ok ? (alt.data as Student[]).length : 0
      setHint(total > 0
        ? `${total === 1 ? 'Hay 1 estudiante' : `Hay ${total} estudiantes`} que coincide con la búsqueda, ` +
          `pero ${total === 1 ? 'está' : 'están'} ${filterStatus === 'active' ? 'dado(s) de baja' : 'activo(s)'}. ` +
          `Cambia el filtro Estado para ${total === 1 ? 'verlo' : 'verlos'}.`
        : '')
    } else {
      setHint('')
    }
  }

  useEffect(() => {
    window.api.getCareers().then(r => { if (r.ok) setCareers(r.data as Career[]) })
  }, [])

  useEffect(() => { load() }, [search, filterCareer, filterStatus])

  function openCreate() { setEditing(null); setForm(EMPTY); setError(''); setEnrollHint(null); setModal(true) }
  function openEdit(s: Student) {
    setEditing(s)
    setForm({
      enrollment_number: s.enrollment_number, first_name: s.first_name,
      last_name: s.last_name, email: s.email, phone: s.phone,
      career_id: s.career_id, semester: s.semester, status: s.status,
    })
    setError(''); setEnrollHint(null); setModal(true)
  }

  // Detectar carrera automáticamente desde la matrícula (formato AA3CCCXXX)
  function handleEnrollmentChange(value: string) {
    const clean = value.replace(/\D/g, '').slice(0, 9)
    setForm(f => {
      const next = { ...f, enrollment_number: clean }
      const chk = checkEnrollment(clean)
      if (chk.valid && chk.careerCode) {
        const match = careers.find(c => c.code === chk.careerCode)
        if (match) next.career_id = match.id
      }
      // El correo sigue a la matrícula. Solo se pisa si estaba vacío o si era
      // el institucional de otra matrícula; un correo personal no se toca.
      if (!f.email.trim() || isInstitutional(f.email)) {
        next.email = institutionalEmail(clean)
      }
      return next
    })

    // Aviso inmediato: formato incorrecto o código de carrera desconocido
    if (!clean) { setEnrollHint(null); return }
    const chk = checkEnrollment(clean)
    if (!chk.valid) {
      // Mientras se escribe no marcamos error por longitud incompleta
      setEnrollHint(clean.length < 9
        ? { type: 'warn', text: `Faltan ${9 - clean.length} dígito(s)` }
        : { type: 'error', text: chk.error! })
      return
    }
    const match = careers.find(c => c.code === chk.careerCode)
    setEnrollHint(match
      ? { type: 'ok', text: `Ingreso ${chk.entryYear} · ${match.name} (código ${chk.careerCode})` }
      : {
        type: 'error',
        text: `El código ${chk.careerCode} no corresponde a ninguna carrera registrada. ` +
          'Agrégala en el catálogo de carreras o revisa la matrícula.',
      })
  }

  async function handleSave() {
    if (!form.enrollment_number.trim() || !form.first_name.trim() || !form.last_name.trim() || !form.career_id) {
      setError('Matrícula, nombre, apellidos y carrera son obligatorios'); return
    }
    if (form.enrollment_number.length !== 9) {
      setError('La matrícula (No. de Control) debe tener exactamente 9 dígitos'); return
    }
    setLoading(true); setError('')
    const res = editing
      ? await window.api.updateStudent(editing.id, form)
      : await window.api.createStudent(form)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleDeactivate(s: Student) {
    // Se consultan las inscripciones antes de preguntar: dar de baja arrastra
    // las que estén vigentes, y eso hay que decirlo antes, no después.
    const list = await window.api.getStudentEnrollments(s.id)
    const activas = list.ok
      ? (list.data as any[]).filter(e => e.status === 'active')
      : []

    const detalle = activas.length
      ? `\n\nSe darán de baja también sus ${activas.length} inscripción(es) vigente(s):\n` +
        activas.map(e => `  • ${e.complementary_name} — grupo ${e.group_number} — ${e.period_name}`).join('\n') +
        `\n\nAsí liberan el lugar en el grupo y dejan de contar en el Reporte Final.`
      : '\n\nNo tiene inscripciones vigentes.'

    if (!confirm(
      `¿Dar de baja al estudiante "${s.first_name} ${s.last_name}" (${s.enrollment_number})?` +
      detalle +
      `\n\nNo se borra nada: el historial y las calificaciones se conservan, y puedes ` +
      `reactivarlo con el botón Editar.`
    )) return

    const res = await window.api.deleteStudent(s.id)
    if (!res.ok) { alert(res.error); return }

    const d = res.data as { cancelled: number; kept: number } | undefined
    if (d && (d.cancelled || d.kept)) {
      alert(
        `${s.first_name} ${s.last_name} quedó dado de baja.` +
        (d.cancelled ? `\n\nInscripciones dadas de baja: ${d.cancelled}` : '') +
        (d.kept ? `\n\nSe conservaron ${d.kept} inscripción(es) con evaluación cerrada, ` +
          `porque esa calificación ya es definitiva.` : '')
      )
    }
    load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Estudiantes</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nuevo estudiante</button>
      </div>

      <div className="filters-bar">
        <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
          <label className="form-label">Buscar</label>
          <input className="form-control" placeholder="Matrícula, nombre o correo..."
            value={search} onChange={e => setSearch(e.target.value)} />
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
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
          {students.length} estudiante(s) encontrado(s)
        </div>

        {hint && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.6,
            background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)',
          }}>
            {hint}{' '}
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}
              onClick={() => setFilterStatus('')}>Ver todos</button>
          </div>
        )}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>No. Control</th><th>Nombre</th><th>Carrera</th>
                <th>Semestre</th><th>Correo</th><th>Teléfono</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr><td colSpan={8} className="table-empty">Sin estudiantes encontrados</td></tr>
              )}
              {students.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.enrollment_number}</strong></td>
                  <td>{s.first_name} {s.last_name}</td>
                  <td>{s.career_name}</td>
                  <td>{s.semester}°</td>
                  <td>{s.email || '—'}</td>
                  <td>{s.phone || '—'}</td>
                  <td><span className={`badge badge-${s.status}`}>{s.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setHistoryId(s.id)}>
                      Historial
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Editar</button>
                    {s.status === 'active' && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(s)}>Dar de baja</button>
                    )}
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
              <span className="modal-title">{editing ? 'Editar estudiante' : 'Nuevo estudiante'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">No. de Control (9 dígitos) *</label>
                  <input className="form-control" value={form.enrollment_number}
                    onChange={e => handleEnrollmentChange(e.target.value)}
                    placeholder="Ej. 253107216" maxLength={9} />
                  {enrollHint && (
                    <span style={{
                      fontSize: 12, marginTop: 4, display: 'block', lineHeight: 1.4,
                      color: enrollHint.type === 'ok' ? 'var(--success)'
                        : enrollHint.type === 'warn' ? 'var(--text-muted)'
                        : 'var(--danger)',
                    }}>
                      {enrollHint.text}
                    </span>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Carrera *</label>
                  <select className="form-control" value={form.career_id}
                    onChange={e => setForm(f => ({ ...f, career_id: Number(e.target.value) }))}>
                    <option value={0}>Seleccionar...</option>
                    {careers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Nombre(s) *</label>
                  <input className="form-control" value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Apellidos *</label>
                  <input className="form-control" value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Correo institucional</label>
                  <input className="form-control" type="email" value={form.email}
                    placeholder={autoEmail || 'Se llena con el número de control'}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {emailMatchesEnrollment
                      ? `Se genera solo: ${autoEmail}`
                      : autoEmail
                        ? <>Se guardará <strong>{autoEmail}</strong>. Escribe algo distinto solo si usa otro correo.</>
                        : `Escribe el número de control y se arma con @${INSTITUTIONAL_DOMAIN}`}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-control" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Semestre</label>
                  <input className="form-control" type="number" min={1} max={12} value={form.semester}
                    onChange={e => setForm(f => ({ ...f, semester: Number(e.target.value) }))} />
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

      {historyId !== null && (
        <StudentHistoryModal studentId={historyId} onClose={() => setHistoryId(null)} />
      )}
    </div>
  )
}
