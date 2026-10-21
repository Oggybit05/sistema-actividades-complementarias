import { useState, useEffect } from 'react'
import type { Group, SchoolPeriod, Complementary } from '@shared/types'
import ScoreImport from '../components/ScoreImport'

type RowSeverity = 'ok' | 'warn' | 'error'

interface ParsedStudent {
  row: number
  enrollment_number: string
  full_name: string
  first_name: string
  last_name: string
  career_code: string
  career_name: string
  career_id: number
  semester: number
  already_exists: boolean
  severity: RowSeverity
  issues: string[]
}

interface ColumnMapping {
  enrollment?: number
  full_name?: number
  first_name?: number
  last_name?: number
  semester?: number
  score?: number
  sheet?: string
  data_start_row?: number
}

interface FileInspection {
  file_name: string
  kind: 'excel' | 'text' | 'pdf'
  sheets: string[]
  columns: { index: number; header: string; sample: string[] }[]
  preview_rows: string[][]
  suggested: ColumnMapping
  message: string
}

interface DetectedMeta {
  asignatura: string
  grupo: string
  periodo: string
  docente: string
  clave: string
  complementary_id: number
  complementary_name: string
  complementary_confidence: number
  period_id: number
  period_name: string
  group_id: number
  group_number: string
}

interface ImportIssue {
  type: 'matricula_invalida' | 'carrera_no_encontrada' | 'ya_inscrito' | 'cupo_lleno'
  student: string
  detail: string
}

interface ImportSummary {
  inserted: number
  updated: number
  enrolled: number
  skipped: number
  created_period: string
  created_complementary: string
  created_group: string
  group_label: string
  issues: ImportIssue[]
}

type Step = 'select' | 'mapping' | 'preview' | 'result'
type NameOrder = 'last_first' | 'first_last'

const ISSUE_LABELS: Record<ImportIssue['type'], string> = {
  matricula_invalida: 'Número de control inválido',
  carrera_no_encontrada: 'Carrera no registrada',
  ya_inscrito: 'Ya inscrito en esta complementaria',
  cupo_lleno: 'Grupo lleno',
}

/** Campos que la profesora puede asignar a una columna del archivo */
const MAP_FIELDS: { key: keyof ColumnMapping; label: string; help: string }[] = [
  { key: 'enrollment', label: 'No. de Control', help: 'Obligatorio. Los 9 dígitos del alumno.' },
  { key: 'full_name', label: 'Nombre completo', help: 'Úsalo si nombre y apellidos van juntos.' },
  { key: 'last_name', label: 'Apellidos', help: 'Solo si vienen en columna aparte.' },
  { key: 'first_name', label: 'Nombres', help: 'Solo si vienen en columna aparte.' },
  { key: 'semester', label: 'Semestre', help: 'Opcional. Si no está, se estima por la matrícula.' },
]

/** Fechas sugeridas para un periodo tipo "2026-1" o "2025-2" */
function guessPeriodDates(name: string): { start: string; end: string } {
  const m = name.match(/(\d{4})\s*-\s*([12])/)
  if (!m) return { start: '', end: '' }
  const year = Number(m[1])
  return m[2] === '1'
    ? { start: `${year}-02-01`, end: `${year}-07-31` }
    : { start: `${year}-08-01`, end: `${year + 1}-01-31` }
}

export default function ImportPage() {
  const [mode, setMode] = useState<'students' | 'scores'>('students')
  const [step, setStep] = useState<Step>('select')
  const [filePath, setFilePath] = useState('')
  const [fileName, setFileName] = useState('')
  const [students, setStudents] = useState<ParsedStudent[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [meta, setMeta] = useState<DetectedMeta | null>(null)

  const [inspection, setInspection] = useState<FileInspection | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [onlyProblems, setOnlyProblems] = useState(false)

  const [groups, setGroups] = useState<Group[]>([])
  const [periods, setPeriods] = useState<SchoolPeriod[]>([])
  const [complementaries, setComplementaries] = useState<Complementary[]>([])

  const [skipExisting, setSkipExisting] = useState(true)
  const [nameOrder, setNameOrder] = useState<NameOrder>('last_first')
  const [enroll, setEnroll] = useState(true)

  // Configuración de creación automática
  const [periodName, setPeriodName] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodActive, setPeriodActive] = useState(false)
  const [compName, setCompName] = useState('')
  const [groupNumber, setGroupNumber] = useState('')
  const [groupCapacity, setGroupCapacity] = useState(40)
  const [groupDays, setGroupDays] = useState('')
  const [groupStart, setGroupStart] = useState('')
  const [groupEnd, setGroupEnd] = useState('')
  const [groupClassroom, setGroupClassroom] = useState('')
  const [manualGroup, setManualGroup] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportSummary | null>(null)

  useEffect(() => { loadCatalogs() }, [])

  async function loadCatalogs() {
    const [g, p, c] = await Promise.all([
      window.api.getGroups({ status: 'active' }),
      window.api.getPeriods(),
      window.api.getComplementaries(),
    ])
    if (g.ok) setGroups(g.data as Group[])
    if (p.ok) setPeriods(p.data as SchoolPeriod[])
    if (c.ok) setComplementaries(c.data as Complementary[])
  }

  function applyMeta(m: DetectedMeta | null) {
    setMeta(m)
    if (!m) return

    setPeriodName(m.periodo || '')
    const dates = guessPeriodDates(m.periodo || '')
    setPeriodStart(dates.start)
    setPeriodEnd(dates.end)

    setCompName(m.complementary_name || m.asignatura || '')

    setGroupNumber(m.grupo || '')
    setManualGroup(m.group_id ? String(m.group_id) : '')
  }

  async function parseFile(fp: string, order: NameOrder, map?: ColumnMapping) {
    setLoading(true)
    setError('')
    const parse = await window.api.importParseFile(fp, { nameOrder: order, mapping: map })
    setLoading(false)
    if (!parse.ok) { setError(parse.error!); return false }
    const data = parse.data as any
    setStudents(data.students)
    setWarnings(data.warnings)
    applyMeta(data.meta ?? null)
    return true
  }

  async function handleSelectFile() {
    setError('')
    const res = await window.api.importSelectFile()
    if (!res.ok) {
      if (res.error !== 'Operación cancelada') setError(res.error!)
      return
    }
    const { filePath: fp, fileName: fn } = res.data as any
    setFilePath(fp)
    setFileName(fn)

    // Primero se revisa la estructura para que ella pueda corregir columnas
    setLoading(true)
    const insp = await window.api.importInspectFile(fp)
    setLoading(false)
    if (!insp.ok) { setError(insp.error!); return }

    const data = insp.data as FileInspection
    setInspection(data)

    // Los PDF no tienen columnas: no hay nada que mapear
    if (data.kind === 'pdf' || !data.columns.length) {
      if (await parseFile(fp, nameOrder)) setStep('preview')
      return
    }

    setMapping({ ...data.suggested, sheet: data.suggested.sheet ?? data.sheets[0] ?? '' })
    setStep('mapping')
  }

  /**
   * Cambiar de hoja obliga a releer las columnas: cada hoja del Excel tiene su
   * propia estructura y mantener el mapeo anterior traería columnas que no
   * corresponden.
   */
  async function handleSheetChange(sheet: string) {
    setLoading(true)
    setError('')
    const insp = await window.api.importInspectFile(filePath, sheet)
    setLoading(false)
    if (!insp.ok) { setError(insp.error!); return }
    const data = insp.data as FileInspection
    setInspection(data)
    setMapping({ ...data.suggested, sheet })
  }

  async function handleApplyMapping() {
    if (!mapping.enrollment) {
      setError('Indica cuál columna tiene el No. de Control.')
      return
    }
    if (await parseFile(filePath, nameOrder, mapping)) setStep('preview')
  }

  async function reparse(order: NameOrder) {
    setNameOrder(order)
    if (filePath) await parseFile(filePath, order, inspection?.kind === 'pdf' ? undefined : mapping)
  }

  async function handleConfirm() {
    setLoading(true)
    setError('')

    // Nunca se envían las filas con error: son las que el sistema no sabe resolver
    const opts: any = { students: importable, skip_existing: skipExisting }

    if (enroll) {
      if (meta?.period_id) opts.period_id = meta.period_id
      else if (periodName.trim()) {
        opts.new_period = {
          name: periodName.trim(),
          start_date: periodStart,
          end_date: periodEnd,
          is_active: periodActive,
        }
      }

      if (meta?.complementary_id) opts.complementary_id = meta.complementary_id
      else if (compName.trim()) opts.new_complementary = { name: compName.trim() }

      if (manualGroup) {
        opts.group_id = Number(manualGroup)
      } else if (groupNumber.trim()) {
        opts.new_group = {
          group_number: groupNumber.trim(),
          capacity: groupCapacity,
          classroom: groupClassroom,
          days: groupDays,
          start_time: groupStart,
          end_time: groupEnd,
        }
      }
    }

    const res = await window.api.importConfirm(opts)
    setLoading(false)
    if (!res.ok) { setError(res.error!); return }

    setResult(res.data as ImportSummary)
    setStep('result')
    loadCatalogs()
  }

  function handleReset() {
    setStep('select')
    setFilePath(''); setFileName('')
    setStudents([]); setWarnings([]); setMeta(null)
    setInspection(null); setMapping({}); setOnlyProblems(false)
    setManualGroup(''); setResult(null); setError('')
  }

  const importable = students.filter(s => s.severity !== 'error')
  const errorRows = students.filter(s => s.severity === 'error')
  const warnRows = students.filter(s => s.severity === 'warn')
  const newStudents = importable.filter(s => !s.already_exists)
  const existingStudents = importable.filter(s => s.already_exists)
  const visibleRows = onlyProblems ? students.filter(s => s.severity !== 'ok') : students

  const willCreatePeriod = enroll && !meta?.period_id && !!periodName.trim()
  const willCreateComp = enroll && !meta?.complementary_id && !!compName.trim()
  const willCreateGroup = enroll && !manualGroup && !!groupNumber.trim()
  const willEnroll = enroll && (!!manualGroup || !!groupNumber.trim())

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Importar desde archivo</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 16 }}>
        Lee listas desde PDF, Excel, CSV o TXT
      </p>

      {/* Alta de alumnos y captura de calificaciones son procesos distintos:
          separarlos evita que un archivo de notas dé de alta estudiantes. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <TabBtn active={mode === 'students'} onClick={() => setMode('students')}>
          Estudiantes e inscripciones
        </TabBtn>
        <TabBtn active={mode === 'scores'} onClick={() => setMode('scores')}>
          Calificaciones
        </TabBtn>
      </div>

      {mode === 'scores' && <ScoreImport />}

      {mode === 'students' && (
        <>
      <Steps current={step} hasMapping={inspection?.kind !== 'pdf'} />

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ─── PASO 1: Seleccionar archivo ─── */}
      {step === 'select' && (
        <div className="card" style={{
          border: '2px dashed var(--border)', textAlign: 'center', padding: 50,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
          <h3 style={{ margin: '0 0 8px' }}>Selecciona un archivo</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
            Formatos soportados: PDF con texto, Excel (.xlsx, .xls), CSV, TXT y TSV
          </p>

          <div style={{ marginBottom: 20 }}>
            <label className="form-label">Orden del nombre en el documento</label>
            <select className="form-control" value={nameOrder}
              onChange={e => setNameOrder(e.target.value as NameOrder)}
              style={{ maxWidth: 320, margin: '0 auto' }}>
              <option value="last_first">Apellidos primero (listas oficiales)</option>
              <option value="first_last">Nombres primero</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={handleSelectFile} disabled={loading}
            style={{ padding: '10px 32px', fontSize: 15 }}>
            {loading ? 'Leyendo archivo...' : 'Seleccionar archivo'}
          </button>
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            Nada se guarda hasta que revises la vista previa y confirmes
          </div>
        </div>
      )}

      {/* ─── PASO 2: Mapeo de columnas ─── */}
      {step === 'mapping' && inspection && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>{inspection.file_name}</strong>
                <span style={{ marginLeft: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                  {inspection.columns.length} columna(s) detectada(s)
                </span>
              </div>
              <button className="btn" onClick={handleReset}>Cambiar archivo</button>
            </div>
            {inspection.message && (
              <div className="alert alert-warning" style={{ marginTop: 12, marginBottom: 0 }}>
                {inspection.message}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">¿Qué contiene cada columna?</span>
            </div>
            <p style={{ marginTop: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              El programa ya hizo una propuesta. Corrige solo lo que esté mal.
            </p>

            {inspection.sheets.length > 1 && (
              <div className="form-group" style={{ maxWidth: 320 }}>
                <label className="form-label">Hoja del Excel</label>
                <select className="form-control" value={mapping.sheet ?? ''} disabled={loading}
                  onChange={e => handleSheetChange(e.target.value)}>
                  {inspection.sheets.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Se abrió la hoja donde se encontraron números de control.
                </div>
              </div>
            )}

            <div className="form-grid">
              {MAP_FIELDS.map(f => (
                <div className="form-group" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  <select className="form-control"
                    value={String(mapping[f.key] ?? '')}
                    onChange={e => setMapping({
                      ...mapping,
                      [f.key]: e.target.value ? Number(e.target.value) : undefined,
                    })}>
                    <option value="">— No está en el archivo —</option>
                    {inspection.columns.map(c => (
                      <option key={c.index} value={c.index}>
                        {c.index}. {c.header}{c.sample[0] ? `  (ej. ${c.sample[0]})` : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{f.help}</div>
                </div>
              ))}

              <div className="form-group">
                <label className="form-label">Los datos empiezan en la fila</label>
                <input className="form-control" type="number" min={1}
                  value={mapping.data_start_row ?? 1}
                  onChange={e => setMapping({ ...mapping, data_start_row: Number(e.target.value) })} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Sin contar los títulos ni el encabezado del documento.
                </div>
              </div>
            </div>
          </div>

          {inspection.preview_rows.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Así se ve el archivo</span>
              </div>
              <div style={{ overflow: 'auto' }}>
                <table className="table" style={{ margin: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 42 }}>Fila</th>
                      {inspection.columns.map(c => (
                        <th key={c.index} style={{ whiteSpace: 'nowrap' }}>{c.index}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inspection.preview_rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                        {inspection.columns.map(c => (
                          <td key={c.index} style={{ whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r[c.index - 1] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={handleReset}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleApplyMapping} disabled={loading}
              style={{ padding: '8px 28px' }}>
              {loading ? 'Leyendo...' : 'Ver vista previa'}
            </button>
          </div>
        </>
      )}

      {/* ─── PASO 3: Vista previa y confirmación ─── */}
      {step === 'preview' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>{fileName}</strong>
                <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
                  {students.length} renglón(es) leído(s)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {inspection && inspection.kind !== 'pdf' && (
                  <button className="btn" onClick={() => setStep('mapping')}>Corregir columnas</button>
                )}
                <button className="btn" onClick={handleReset}>Cambiar archivo</button>
              </div>
            </div>
          </div>

          {/* Semáforo de revisión */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat n={importable.length} label="Se importarán" color="#2e7d32" bg="#e8f5e9" always />
            <Stat n={warnRows.length} label="Con aviso" color="#e65100" bg="#fff3e0" always />
            <Stat n={errorRows.length} label="No se importarán" color="#c62828" bg="#ffebee" always />
          </div>

          {errorRows.length > 0 && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <strong>{errorRows.length} renglón(es) no se pueden importar.</strong> Se
              omitirán automáticamente. Revísalos en la tabla; si el problema es la
              carrera, regístrala en el catálogo y vuelve a leer el archivo.
            </div>
          )}

          {/* Datos detectados */}
          {meta && (meta.asignatura || meta.grupo || meta.periodo || meta.docente) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><span className="card-title">Datos detectados en el documento</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, fontSize: 13 }}>
                {meta.asignatura && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Asignatura</div>
                    <div style={{ fontWeight: 600 }}>{meta.asignatura}</div>
                    <div style={{ fontSize: 12, marginTop: 2, color: meta.complementary_id ? '#2e7d32' : '#e65100' }}>
                      {meta.complementary_id
                        ? `Coincide con ${meta.complementary_name} (${meta.complementary_confidence}%)`
                        : 'Sin coincidencia en el catálogo'}
                    </div>
                  </div>
                )}
                {meta.grupo && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Grupo</div>
                    <div style={{ fontWeight: 600 }}>{meta.grupo}</div>
                    <div style={{ fontSize: 12, marginTop: 2, color: meta.group_id ? '#2e7d32' : '#e65100' }}>
                      {meta.group_id ? 'Existe en el sistema' : 'No existe todavía'}
                    </div>
                  </div>
                )}
                {meta.periodo && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Periodo</div>
                    <div style={{ fontWeight: 600 }}>{meta.periodo}</div>
                    <div style={{ fontSize: 12, marginTop: 2, color: meta.period_id ? '#2e7d32' : '#e65100' }}>
                      {meta.period_id ? 'Registrado' : 'No existe todavía'}
                    </div>
                  </div>
                )}
                {meta.docente && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Docente</div>
                    <div style={{ fontWeight: 600 }}>{meta.docente}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Configuración de inscripción */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">Inscripción</span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={enroll} onChange={e => setEnroll(e.target.checked)} />
              <span>Inscribir a los estudiantes en una complementaria</span>
            </label>

            {enroll && (
              <>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Usar un grupo que ya existe</label>
                  <select className="form-control" value={manualGroup}
                    onChange={e => setManualGroup(e.target.value)}>
                    <option value="">— Crear el grupo detectado en el documento —</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.complementary_name} - {g.group_number} ({g.period_name})
                      </option>
                    ))}
                  </select>
                </div>

                {!manualGroup && (
                  <div style={{
                    background: 'var(--bg)', borderRadius: 8, padding: 16,
                    display: 'grid', gap: 14,
                  }}>
                    {!meta?.period_id && (
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                          Periodo a crear
                        </div>
                        <div className="form-grid">
                          <div className="form-group">
                            <label className="form-label">Nombre</label>
                            <input className="form-control" value={periodName}
                              onChange={e => setPeriodName(e.target.value)} placeholder="2026-1" />
                          </div>
                          <div className="form-group">
                            <label className="form-label">Inicio</label>
                            <input className="form-control" type="date" value={periodStart}
                              onChange={e => setPeriodStart(e.target.value)} />
                          </div>
                          <div className="form-group">
                            <label className="form-label">Fin</label>
                            <input className="form-control" type="date" value={periodEnd}
                              onChange={e => setPeriodEnd(e.target.value)} />
                          </div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={periodActive}
                            onChange={e => setPeriodActive(e.target.checked)} />
                          Marcar como periodo activo
                        </label>
                      </div>
                    )}

                    {!meta?.complementary_id && (
                      <div className="form-group">
                        <label className="form-label">Complementaria a crear</label>
                        <input className="form-control" value={compName}
                          onChange={e => setCompName(e.target.value)}
                          placeholder="Nombre de la complementaria" />
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          Revisa el nombre antes de crearlo; el documento puede traer erratas
                        </div>
                      </div>
                    )}

                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Grupo a crear</div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Clave del grupo</label>
                          <input className="form-control" value={groupNumber}
                            onChange={e => setGroupNumber(e.target.value)} placeholder="INTEMO-INT" />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Cupo</label>
                          <input className="form-control" type="number" min={1} value={groupCapacity}
                            onChange={e => setGroupCapacity(Number(e.target.value))} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Aula</label>
                          <input className="form-control" value={groupClassroom}
                            onChange={e => setGroupClassroom(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Días</label>
                          <input className="form-control" value={groupDays}
                            onChange={e => setGroupDays(e.target.value)} placeholder="Lunes,Miércoles" />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Hora inicio</label>
                          <input className="form-control" type="time" value={groupStart}
                            onChange={e => setGroupStart(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Hora fin</label>
                          <input className="form-control" type="time" value={groupEnd}
                            onChange={e => setGroupEnd(e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Resumen de acciones */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><span className="card-title">Se ejecutarán estas acciones</span></div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
              {willCreatePeriod && <li>Crear el periodo <strong>{periodName}</strong></li>}
              {willCreateComp && <li>Crear la complementaria <strong>{compName}</strong></li>}
              {willCreateGroup && <li>Crear el grupo <strong>{groupNumber}</strong> con cupo {groupCapacity}</li>}
              {newStudents.length > 0 && <li>Dar de alta <strong>{newStudents.length}</strong> estudiante(s) nuevo(s)</li>}
              {existingStudents.length > 0 && (
                <li>
                  {skipExisting
                    ? <>Conservar sin cambios <strong>{existingStudents.length}</strong> estudiante(s) ya registrado(s)</>
                    : <>Actualizar <strong>{existingStudents.length}</strong> estudiante(s) ya registrado(s)</>}
                </li>
              )}
              {willEnroll && <li>Inscribir a los estudiantes en el grupo</li>}
              {errorRows.length > 0 && (
                <li style={{ color: '#c62828' }}>
                  Omitir <strong>{errorRows.length}</strong> renglón(es) con error
                </li>
              )}
            </ul>
            <div style={{ marginTop: 12, padding: 10, background: 'var(--bg)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              Un estudiante no puede repetir la misma complementaria en el mismo periodo,
              pero sí puede inscribirse en complementarias distintas.
            </div>
          </div>

          {/* Opciones y advertencias */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Orden del nombre</label>
                <select className="form-control" value={nameOrder} disabled={loading}
                  onChange={e => reparse(e.target.value as NameOrder)} style={{ minWidth: 260 }}>
                  <option value="last_first">Apellidos primero (listas oficiales)</option>
                  <option value="first_last">Nombres primero</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={skipExisting}
                  onChange={e => setSkipExisting(e.target.checked)} />
                No actualizar estudiantes que ya existen
              </label>
            </div>

            {warnings.length > 0 && (
              <div className="alert alert-warning" style={{ marginTop: 14, marginBottom: 0 }}>
                <strong>Avisos del archivo:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                  {warnings.length > 8 && <li>y {warnings.length - 8} más</li>}
                </ul>
              </div>
            )}
          </div>

          {/* Tabla */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Renglones leídos</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyProblems}
                  onChange={e => setOnlyProblems(e.target.checked)} />
                Ver solo los que tienen algo que revisar
              </label>
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>Fila</th>
                    <th>No. Control</th><th>Apellidos</th><th>Nombres</th>
                    <th>Carrera</th><th style={{ width: 50 }}>Sem.</th>
                    <th>Qué revisar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(s => (
                    <tr key={`${s.row}-${s.enrollment_number}`} style={{
                      background: s.severity === 'error' ? '#ffebee'
                        : s.severity === 'warn' ? '#fff8e1' : undefined,
                    }}>
                      <td style={{ color: 'var(--text-muted)' }}>{s.row}</td>
                      <td style={{ fontFamily: 'monospace' }}>{s.enrollment_number}</td>
                      <td>{s.last_name}</td>
                      <td>{s.first_name}</td>
                      <td style={{ fontSize: 13 }}>{s.career_name}</td>
                      <td>{s.semester}</td>
                      <td style={{ fontSize: 12 }}>
                        {s.issues.length === 0
                          ? <span style={{ color: '#2e7d32' }}>Correcto</span>
                          : (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {s.issues.map((it, i) => (
                                <li key={i} style={{ color: s.severity === 'error' ? '#c62828' : '#e65100' }}>{it}</li>
                              ))}
                            </ul>
                          )}
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
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
              <button className="btn" onClick={handleReset}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirm}
                disabled={loading || importable.length === 0}
                style={{ padding: '8px 28px' }}>
                {loading ? 'Importando...' : `Confirmar e importar ${importable.length}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── PASO 4: Resultado ─── */}
      {step === 'result' && result && (
        <div className="card">
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>✅</div>
            <h3 style={{ margin: 0 }}>Importación completada</h3>
            {result.group_label && (
              <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>{result.group_label}</div>
            )}
          </div>

          {(result.created_period || result.created_complementary || result.created_group) && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <strong>Se crearon automáticamente:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>
                {result.created_period && <li>Periodo {result.created_period}</li>}
                {result.created_complementary && <li>Complementaria {result.created_complementary}</li>}
                {result.created_group && <li>Grupo {result.created_group}</li>}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
            <Stat n={result.inserted} label="Insertados" color="#2e7d32" bg="#e8f5e9" />
            <Stat n={result.updated} label="Actualizados" color="#e65100" bg="#fff3e0" />
            <Stat n={result.enrolled} label="Inscritos" color="#1565c0" bg="#e3f2fd" />
            <Stat n={result.skipped} label="Omitidos" color="#c62828" bg="#ffebee" />
          </div>

          {result.issues.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Detalle de incidencias ({result.issues.length})
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table" style={{ margin: 0, fontSize: 13 }}>
                  <thead><tr><th>Estudiante</th><th>Motivo</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {result.issues.map((it, i) => (
                      <tr key={i}>
                        <td>{it.student}</td>
                        <td>{ISSUE_LABELS[it.type]}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{it.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleReset} style={{ padding: '10px 32px' }}>
              Importar otro archivo
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}

/** Pestaña simple para separar los dos tipos de importación */
function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
      fontSize: 14, fontWeight: active ? 600 : 400,
      color: active ? 'var(--primary, #1565c0)' : 'var(--text-muted)',
      borderBottom: `2px solid ${active ? 'var(--primary, #1565c0)' : 'transparent'}`,
      marginBottom: -1,
    }}>
      {children}
    </button>
  )
}

/** Barra de pasos para que se vea en qué punto va el proceso */
function Steps({ current, hasMapping }: { current: Step; hasMapping: boolean }) {
  const all: { key: Step; label: string }[] = [
    { key: 'select', label: '1. Archivo' },
    ...(hasMapping ? [{ key: 'mapping' as Step, label: '2. Columnas' }] : []),
    { key: 'preview', label: `${hasMapping ? 3 : 2}. Revisar` },
    { key: 'result', label: `${hasMapping ? 4 : 3}. Listo` },
  ]
  const idx = all.findIndex(s => s.key === current)

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
      {all.map((s, i) => (
        <div key={s.key} style={{
          padding: '6px 14px', borderRadius: 20, fontSize: 13,
          background: i === idx ? 'var(--primary, #1565c0)' : i < idx ? '#e8f5e9' : 'var(--bg)',
          color: i === idx ? '#fff' : i < idx ? '#2e7d32' : 'var(--text-muted)',
          border: '1px solid var(--border)',
        }}>
          {i < idx ? '✓ ' : ''}{s.label}
        </div>
      ))}
    </div>
  )
}

function Stat({ n, label, color, bg, always }: {
  n: number; label: string; color: string; bg: string; always?: boolean
}) {
  if (!n && !always) return null
  return (
    <div style={{ padding: '14px 22px', background: bg, borderRadius: 8, textAlign: 'center', minWidth: 110 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  )
}
