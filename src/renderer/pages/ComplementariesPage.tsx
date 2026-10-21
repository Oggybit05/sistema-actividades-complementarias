import { useState, useEffect } from 'react'
import type { Complementary, ComplementaryDTO } from '@shared/types'

const EMPTY: ComplementaryDTO = { name: '', description: '', status: 'active' }

export default function ComplementariesPage() {
  const [items, setItems] = useState<Complementary[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Complementary | null>(null)
  const [form, setForm] = useState<ComplementaryDTO>(EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    const res = await window.api.getComplementaries()
    if (res.ok) setItems(res.data as Complementary[])
  }

  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(c: Complementary) {
    setEditing(c)
    // `?? ''` mantiene el textarea como campo controlado: con undefined React
    // lo suelta y lo escrito deja de reflejarse en el estado que se guarda.
    setForm({ name: c.name, description: c.description ?? '', status: c.status })
    setError(''); setModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setLoading(true); setError('')
    const res = editing
      ? await window.api.updateComplementary(editing.id, form)
      : await window.api.createComplementary(form)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error'); return }
    setModal(false); load()
  }

  async function handleDelete(c: Complementary) {
    if (!confirm(`¿Eliminar "${c.name}"?`)) return
    const res = await window.api.deleteComplementary(c.id)
    if (!res.ok) alert(res.error)
    else load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Complementarias</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nueva complementaria</button>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={4} className="table-empty">Sin complementarias registradas</td></tr>
              )}
              {items.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description || '—'}
                  </td>
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
              <span className="modal-title">{editing ? 'Editar complementaria' : 'Nueva complementaria'}</span>
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
                <label className="form-label">Descripción</label>
                <textarea className="form-control" rows={3} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
