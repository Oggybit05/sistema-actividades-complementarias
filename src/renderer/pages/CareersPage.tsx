import { useState, useEffect } from 'react'
import type { Career, CareerDTO } from '@shared/types'

const EMPTY: CareerDTO = { name: '', code: '', status: 'active' }

export default function CareersPage() {
  const [careers, setCareers] = useState<Career[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Career | null>(null)
  const [form, setForm] = useState<CareerDTO>(EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    const res = await window.api.getCareers()
    if (res.ok) setCareers(res.data as Career[])
  }

  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(c: Career) {
    setEditing(c)
    setForm({ name: c.name, code: c.code, status: c.status })
    setError(''); setModal(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim()) { setError('Nombre y código son obligatorios'); return }
    setLoading(true); setError('')
    const res = editing
      ? await window.api.updateCareer(editing.id, form)
      : await window.api.createCareer(form)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleDelete(c: Career) {
    if (!confirm(`¿Eliminar la carrera "${c.name}"?`)) return
    const res = await window.api.deleteCareer(c.id)
    if (!res.ok) alert(res.error)
    else load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Carreras</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nueva carrera</button>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {careers.length === 0 && (
                <tr><td colSpan={4} className="table-empty">Sin carreras registradas</td></tr>
              )}
              {careers.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.name}</td>
                  <td><span className={`badge badge-${c.status}`}>{c.status === 'active' ? 'Activa' : 'Inactiva'}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Editar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Editar carrera' : 'Nueva carrera'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label className="form-label">Nombre *</label>
                <input className="form-control" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Código *</label>
                <input className="form-control" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Estado</label>
                <select className="form-control" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}>
                  <option value="active">Activa</option>
                  <option value="inactive">Inactiva</option>
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
    </div>
  )
}
