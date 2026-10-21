import { useState, useEffect } from 'react'
import type {
  Career, Complementary, SchoolPeriod, ReportFilters, ReportKind, Group,
} from '@shared/types'

/** Qué responde cada tipo de reporte, en palabras de la profesora */
const KINDS: { value: ReportKind; label: string; help: string }[] = [
  { value: 'enrollments', label: 'Listado de inscritos',
    help: 'Quiénes están inscritos. Sin calificaciones.' },
  { value: 'evaluations', label: 'Inscritos y calificaciones',
    help: 'Todos los inscritos con su calificación; los pendientes aparecen marcados.' },
  { value: 'final', label: 'Calificaciones finales',
    help: 'Solo los alumnos que ya tienen calificación capturada.' },
  { value: 'closed', label: 'Actas cerradas',
    help: 'Solo grupos cuya acta ya fue cerrada. Sirve para entregar a control escolar.' },
]

export default function ReportsPage() {
  const [careers, setCareers] = useState<Career[]>([])
  const [complementaries, setComplementaries] = useState<Complementary[]>([])
  const [periods, setPeriods] = useState<SchoolPeriod[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [filters, setFilters] = useState<ReportFilters>({ status: 'active', kind: 'evaluations' })
  const [loading, setLoading] = useState<'excel' | 'pdf' | 'final' | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [folder, setFolder] = useState('')

  useEffect(() => {
    Promise.all([
      window.api.getCareers(),
      window.api.getComplementaries(),
      window.api.getPeriods(),
      window.api.getSettings(),
    ]).then(([c, comp, p, s]) => {
      if (c.ok) setCareers(c.data as Career[])
      if (comp.ok) setComplementaries(comp.data as Complementary[])
      if (p.ok) {
        const list = p.data as SchoolPeriod[]
        setPeriods(list)
        // Se preselecciona el periodo en curso: es lo que ella necesita el 95% de las veces
        const active = list.find(x => x.is_active)
        if (active) setFilters(f => ({ ...f, period_id: active.id }))
      }
      if (s.ok) setFolder((s.data as any).reports_folder ?? '')
    }).catch(() => setMessage(''))
  }, [])

  // Los grupos dependen del periodo y la complementaria elegidos
  useEffect(() => {
    if (!filters.period_id && !filters.complementary_id) { setGroups([]); return }
    window.api.getGroups({
      period_id: filters.period_id,
      complementary_id: filters.complementary_id,
    }).then(res => {
      if (res.ok) setGroups(res.data as Group[])
    }).catch(() => setGroups([]))
  }, [filters.period_id, filters.complementary_id])

  // Si el grupo elegido ya no está en la lista, se limpia para no filtrar por algo invisible
  useEffect(() => {
    if (filters.group_id && !groups.some(g => g.id === filters.group_id)) {
      setFilters(f => ({ ...f, group_id: undefined }))
    }
  }, [groups, filters.group_id])

  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters(f => ({ ...f, [key]: value }))
    setMessage('')
  }

  async function generate(type: 'excel' | 'pdf') {
    setLoading(type); setMessage(''); setIsError(false)
    try {
      const res = type === 'excel'
        ? await window.api.exportExcel(filters)
        : await window.api.exportPdf(filters)

      if (res.ok) {
        setIsError(false)
        setMessage(`Archivo generado: ${res.data}`)
      } else {
        setIsError(true)
        setMessage(res.error ?? 'No se pudo generar el archivo')
      }
    } catch (e: any) {
      setIsError(true)
      setMessage(String(e?.message ?? '').includes('No handler registered')
        ? 'Cierra la aplicación por completo y vuelve a abrirla para activar los reportes.'
        : 'No se pudo generar el archivo')
    }
    setLoading(null)
  }

  /**
   * Reporte Final con el formato oficial. No usa los demás filtros a propósito:
   * el formato oficial es del periodo completo, con una hoja por grupo.
   */
  async function generateFinal() {
    setLoading('final'); setMessage(''); setIsError(false)
    try {
      const res = await window.api.exportFinalReport({ period_id: filters.period_id })
      if (res.ok) {
        const d = res.data as {
          file: string; groups: number; pending: number
          enrolled: number; passed: number; failed: number
          pass_rate: number; fail_rate: number
        }
        setIsError(false)
        setMessage(
          `Reporte Final generado con ${d.groups} ${d.groups === 1 ? 'hoja' : 'hojas'} de grupo: ${d.file}` +
          `\n\nResultado del periodo: ${d.enrolled} inscritos · ` +
          `${d.passed} acreditados (${d.pass_rate}%) · ` +
          `${d.failed} no acreditados (${d.fail_rate}%)` +
          (d.pending > 0
            ? `\n\nAviso: ${d.pending} ${d.pending === 1 ? 'alumno sigue' : 'alumnos siguen'} sin calificación capturada. ` +
              `En el formato oficial solo hay acreditados y no acreditados, así que ${d.pending === 1 ? 'cuenta' : 'cuentan'} ` +
              `como no acreditados y el porcentaje de aprobación sale más bajo de lo real. ` +
              `Captura esas calificaciones y vuelve a generarlo.`
            : '')
        )
      } else {
        setIsError(true)
        setMessage(res.error ?? 'No se pudo generar el Reporte Final')
      }
    } catch (e: any) {
      setIsError(true)
      setMessage(String(e?.message ?? '').includes('No handler registered')
        ? 'Cierra la aplicación por completo y vuelve a abrirla para activar el Reporte Final.'
        : 'No se pudo generar el Reporte Final')
    }
    setLoading(null)
  }

  const kind = filters.kind ?? 'evaluations'
  const kindInfo = KINDS.find(k => k.value === kind)!

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Reportes</h1>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Qué quieres generar</span>
        </div>

        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Tipo de reporte</label>
            <select className="form-control" value={kind}
              onChange={e => set('kind', e.target.value as ReportKind)}>
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <small style={{ color: 'var(--text-muted)' }}>{kindInfo.help}</small>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">Periodo</label>
            <select className="form-control"
              value={filters.period_id ?? ''}
              onChange={e => set('period_id', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">Todos los periodos</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.is_active ? ' (actual)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Complementaria</label>
            <select className="form-control"
              value={filters.complementary_id ?? ''}
              onChange={e => set('complementary_id', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">Todas</option>
              {complementaries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Grupo</label>
            <select className="form-control"
              value={filters.group_id ?? ''}
              disabled={!groups.length}
              onChange={e => set('group_id', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">{groups.length ? 'Todos los grupos' : 'Elige periodo o complementaria'}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.group_number} — {g.complementary_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Carrera</label>
            <select className="form-control"
              value={filters.career_id ?? ''}
              onChange={e => set('career_id', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">Todas</option>
              {careers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Estado de inscripción</label>
            <select className="form-control"
              value={filters.status ?? ''}
              onChange={e => set('status', e.target.value || undefined)}>
              <option value="">Inscritos y bajas</option>
              <option value="active">Solo inscritos</option>
              <option value="cancelled">Solo bajas</option>
            </select>
          </div>
        </div>

        {message && (
          <div className={`alert ${isError ? 'alert-error' : 'alert-success'}`}
            style={{ marginBottom: 16, wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => generate('pdf')} disabled={!!loading}>
            {loading === 'pdf' ? 'Generando PDF…' : 'Descargar PDF'}
          </button>
          <button className="btn btn-success" onClick={() => generate('excel')} disabled={!!loading}>
            {loading === 'excel' ? 'Generando Excel…' : 'Descargar Excel'}
          </button>
        </div>

        <div style={{
          marginTop: 20, padding: 16, background: 'var(--bg)', borderRadius: 8,
          fontSize: 13, color: 'var(--text-muted)',
        }}>
          El PDF se genera directo, ya no hace falta abrir el navegador ni usar Ctrl+P.
          Ambos archivos incluyen el encabezado institucional, los filtros aplicados y un
          resumen con acreditados, no acreditados y promedio.
          <br />
          Se guardan en: <strong>{folder || 'la carpeta de Descargas'}</strong>
          {!folder && ' (puedes elegir otra carpeta en Configuración)'}.
        </div>
      </div>

      {/* El formato oficial va aparte: no depende de los filtros de arriba */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <span className="card-title">Reporte Final (formato oficial)</span>
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.7 }}>
          Genera el Excel con la misma estructura que entregas cada semestre: una hoja
          <strong> REPORTE TOTAL</strong> con el concentrado por actividad y la tabla de
          códigos de división, y <strong>una hoja por cada grupo</strong> con las divisiones,
          inscritos, acreditados y no acreditados. Los totales van con fórmula, igual que
          en el archivo original.
          <br /><br />
          Cada tabla incluye además el <strong>porcentaje de acreditados y no acreditados</strong>,
          por división y en los totales. También van con fórmula, así que si corriges un
          número en Excel el porcentaje se recalcula solo.
          <br /><br />
          Toma el periodo que elegiste arriba e incluye <strong>todos</strong> sus grupos;
          los demás filtros no se aplican, porque el formato oficial es del periodo completo.
        </p>

        <button className="btn btn-primary" onClick={generateFinal} disabled={!!loading}>
          {loading === 'final' ? 'Generando Reporte Final…' : 'Generar Reporte Final'}
        </button>
      </div>
    </div>
  )
}
