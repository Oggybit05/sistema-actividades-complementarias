// ─── Entidades base ───────────────────────────────────────────────────────────

export interface User {
  id: number
  username: string
  full_name: string
  created_at: string
  updated_at: string
  /** Obliga a cambiar la contraseña antes de poder usar el sistema */
  must_change_password?: boolean
  last_login_at?: string | null
}

export interface Career {
  id: number
  name: string
  code: string
  status: 'active' | 'inactive'
  created_at: string
}

export interface SchoolPeriod {
  id: number
  name: string
  start_date: string
  end_date: string
  is_active: 0 | 1
  created_at: string
  /** Calculados en la consulta */
  group_count?: number
  enrollment_count?: number
}

export interface Complementary {
  id: number
  name: string
  description: string
  status: 'active' | 'inactive'
  created_at: string
}

export interface Group {
  id: number
  complementary_id: number
  period_id: number
  group_number: string
  capacity: number
  classroom: string
  days: string          // ej. "Lunes,Miércoles"
  start_time: string    // "HH:MM"
  end_time: string      // "HH:MM"
  status: 'active' | 'inactive'
  created_at: string
  // joins
  complementary_name?: string
  period_name?: string
  enrolled_count?: number
}

export interface Student {
  id: number
  enrollment_number: string
  first_name: string
  last_name: string
  email: string
  phone: string
  career_id: number
  semester: number
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
  // joins
  career_name?: string
}

export interface Enrollment {
  id: number
  student_id: number
  group_id: number
  enrolled_at: string
  status: 'active' | 'cancelled'
  observations: string
  // joins
  student_name?: string
  enrollment_number?: string
  career_name?: string
  complementary_name?: string
  group_number?: string
  period_name?: string
  classroom?: string
  days?: string
  start_time?: string
  end_time?: string
}

// ─── DTOs de entrada ──────────────────────────────────────────────────────────

export interface LoginDTO {
  username: string
  password: string
}

export interface CareerDTO {
  name: string
  code: string
  status: 'active' | 'inactive'
}

export interface PeriodDTO {
  name: string
  start_date: string
  end_date: string
  is_active: 0 | 1
}

export interface ComplementaryDTO {
  name: string
  description: string
  status: 'active' | 'inactive'
}

export interface GroupDTO {
  complementary_id: number
  period_id: number
  group_number: string
  capacity: number
  classroom: string
  days: string
  start_time: string
  end_time: string
  status: 'active' | 'inactive'
}

/** Un alumno dentro de la lista de un grupo */
export interface RosterEntry {
  enrollment_id: number
  student_id: number
  enrollment_number: string
  student_name: string
  career_name: string
  enrolled_at: string
  status: 'active' | 'cancelled'
  observations: string
  /** null cuando aún no se le captura calificación */
  score: number | null
  evaluation_status: 'captured' | 'closed' | null
}

/** Lista completa de un grupo con sus totales */
export interface GroupRoster {
  group: Group
  students: RosterEntry[]
  active_count: number
  cancelled_count: number
  graded_count: number
  closed_count: number
}

export type RemovalMode = 'cancel' | 'delete'

export interface RemoveStudentsDTO {
  group_id: number
  enrollment_ids: number[]
  mode: RemovalMode
  /** Motivo que se guarda en observaciones al dar de baja */
  reason?: string
}

export interface RemoveStudentsResult {
  mode: RemovalMode
  affected: number
  /** Calificaciones que se borraron junto con las inscripciones */
  scores_removed: number
}

export interface StudentDTO {
  enrollment_number: string
  first_name: string
  last_name: string
  email: string
  phone: string
  career_id: number
  semester: number
  status: 'active' | 'inactive'
}

export interface EnrollmentDTO {
  student_id: number
  group_id: number
  observations?: string
}

export interface ReportFilters {
  period_id?: number
  complementary_id?: number
  career_id?: number
  group_id?: number
  status?: string
  /** Qué se incluye en el archivo generado */
  kind?: ReportKind
}

export type ReportKind =
  | 'enrollments'   // listado de inscritos
  | 'evaluations'   // inscritos con su calificación
  | 'final'         // solo alumnos ya calificados
  | 'closed'        // solo actas cerradas

// ─── Configuración institucional ──────────────────────────────────────────────

export interface AppSettings {
  institution_name: string
  department_name: string
  teacher_name: string
  teacher_email: string
  teacher_phone: string
  logo_path: string
  /** Calificación mínima para acreditar (1 a 4) */
  passing_score: number
  reports_folder: string
  /** Minutos de inactividad antes de cerrar la sesión */
  idle_minutes: number
}

export interface DemoStatus {
  loaded: boolean
  students: number
  groups: number
  enrollments: number
  real_students: number
}

// ─── Historial del estudiante ─────────────────────────────────────────────────

export interface StudentHistoryEntry {
  enrollment_id: number
  period_name: string
  complementary_name: string
  group_number: string
  days: string
  schedule: string
  enrolled_at: string
  enrollment_status: string
  score: number | null
  score_label: string
  evaluation_status: string | null
  observations: string
  evaluation_observations: string
}

export interface StudentHistory {
  student: {
    id: number
    enrollment_number: string
    full_name: string
    career_name: string
    semester: number
    status: string
    email: string
    phone: string
  }
  entries: StudentHistoryEntry[]
  summary: {
    total: number
    active: number
    cancelled: number
    evaluated: number
    pending: number
    passed: number
    failed: number
    average: number | null
  }
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export interface GroupOccupancy {
  id: number
  group_number: string
  complementary_name: string
  capacity: number
  enrolled: number
  /** Lugares disponibles */
  free: number
  /** Ocupación entre 0 y 1 */
  ratio: number
}

export interface ComplementaryProgress {
  complementary_name: string
  enrolled: number
  evaluated: number
  passed: number
}

export interface DashboardSummary {
  period: { id: number; name: string } | null
  periods: Array<{ id: number; name: string; is_active: boolean }>
  students: number
  enrollments: number
  cancelled: number
  complementaries: number
  groups: number
  evaluated: number
  pending: number
  passed: number
  failed: number
  /** Inscripciones con evaluación cerrada */
  closed_groups: number
  total_capacity: number
  /** Porcentaje entero de ocupación global */
  occupancy: number
  nearly_full: GroupOccupancy[]
  empty_groups: GroupOccupancy[]
  by_complementary: ComplementaryProgress[]
}

// ─── Respaldos ────────────────────────────────────────────────────────────────

/** Contenido de un archivo de base de datos, para revisarlo antes de restaurar */
export interface DbSummary {
  students: number
  enrollments: number
  groups: number
  complementaries: number
  evaluations: number
  periods: string[]
}

/** auto = al iniciar la app · manual = a petición · safety = previo a restaurar */
export type BackupKind = 'auto' | 'manual' | 'safety'

export interface BackupEntry {
  file: string
  path: string
  created_at: string
  size: number
  kind: BackupKind
}

export interface BackupInfo {
  db_path: string
  db_size: number
  folder: string
  backups: BackupEntry[]
  last_manual_at: string | null
  last_manual_path: string | null
  summary: DbSummary | null
  /** Días desde la última copia fuera del programa; null si nunca se ha hecho */
  days_since_manual: number | null
  /** true cuando conviene recordarle que saque una copia a USB o nube */
  needs_manual_backup: boolean
  /** Movimientos registrados desde la última copia manual */
  changes_since_manual: number
}

// ─── Respuestas IPC ───────────────────────────────────────────────────────────

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
