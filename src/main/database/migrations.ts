import { Database } from 'sql.js'
import bcrypt from 'bcryptjs'
import { INSTITUTIONAL_DOMAIN } from '../../shared/institutionalEmail'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  student_name TEXT NOT NULL DEFAULT '',
  enrollment_number TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  before_value TEXT NOT NULL DEFAULT '',
  after_value TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS school_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS careers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS complementaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complementary_id INTEGER NOT NULL REFERENCES complementaries(id),
  period_id INTEGER NOT NULL REFERENCES school_periods(id),
  group_number TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 40,
  classroom TEXT NOT NULL DEFAULT '',
  days TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(complementary_id, period_id, group_number)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_number TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  career_id INTEGER NOT NULL REFERENCES careers(id),
  semester INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status TEXT NOT NULL DEFAULT 'active',
  observations TEXT NOT NULL DEFAULT '',
  UNIQUE(student_id, group_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 4),
  observations TEXT NOT NULL DEFAULT '',
  evaluated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','closed')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  closed_by TEXT NOT NULL DEFAULT '',
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students(enrollment_number);
CREATE INDEX IF NOT EXISTS idx_students_career ON students(career_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_group ON enrollments(group_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_enrollment ON evaluations(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_groups_period ON groups(period_id);
CREATE INDEX IF NOT EXISTS idx_groups_complementary ON groups(complementary_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
`

// Carreras reales del TESCI con sus códigos
const CAREERS = [
  { name: 'Ing. Industrial', code: '116' },
  { name: 'Ing. en Sistemas Computacionales', code: '107' },
  { name: 'Ing. en Logística', code: '138' },
  { name: 'Ing. Química', code: '142' },
  { name: 'Contador Público', code: '103' },
  { name: 'Ing. en Administración', code: '139' },
  { name: "Ing. en TIC's", code: '110' },
  { name: 'Ing. en Mecatrónica', code: '113' },
  { name: 'Ing. en Gestión Empresarial', code: '137' },
  { name: 'Ing. en Semiconductores', code: '143' },
  { name: 'Ing. en Gestión Empresarial a Distancia', code: '140' },
  { name: 'Ing. Industrial a Distancia', code: '141' },
  { name: 'Ing. en Sistemas Computacionales a Distancia', code: '144' },
]

// Complementarias reales de la profesora Ripoll
const COMPLEMENTARIES = [
  { name: 'Fotografía', description: 'Actividad complementaria de fotografía' },
  { name: 'Inteligencia Emocional', description: 'Actividad complementaria de inteligencia emocional' },
  { name: 'Yoga y Meditación', description: 'Actividad complementaria de yoga y meditación' },
  { name: 'Teatro', description: 'Actividad complementaria de teatro' },
  { name: 'Tanatología', description: 'Actividad complementaria de tanatología' },
  { name: 'Inteligencia Emocional Distancia', description: 'Inteligencia emocional modalidad a distancia' },
]

/** Matrículas sembradas por versiones anteriores; se marcan como demostración */
const LEGACY_DEMO = [
  '253116294', '253103183', '253142136', '243107340', '233107139', '243116256',
  '253143108', '253113418', '253137164', '253138231', '253107313', '253103223',
  '253103141', '253142178', '253142168', '253107164', '253103148', '253139235',
  '253116171', '253142176', '253137141', '233138229', '263137114', '243138185',
  '253107202', '253107235', '233116358', '253107259', '253103166', '253107189',
  '253107300', '253107163', '253107166',
]

/** Configuración institucional inicial; se edita desde la pantalla de ajustes */
const DEFAULT_SETTINGS: [string, string][] = [
  ['institution_name', 'Tecnológico de Estudios Superiores de Cuautitlán Izcalli'],
  ['department_name', 'Actividades Complementarias'],
  ['teacher_name', 'Ripoll Herrera Elena'],
  ['teacher_email', ''],
  ['teacher_phone', ''],
  ['logo_path', ''],
  ['passing_score', '3'],
  ['reports_folder', ''],
  ['idle_minutes', '30'],
]

export function runMigrations(db: Database) {
  db.run(SCHEMA)

  // ─── Migración: columnas de seguridad en users ───────────────────────
  // Las bases creadas antes de la auditoría no las tienen.
  try {
    const cols = db.exec('PRAGMA table_info(users)')
    const names: string[] = cols.length
      ? cols[0].values.map((row: any[]) => String(row[1]))
      : []
    if (!names.includes('must_change_password')) {
      db.run('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0')
      console.log('users: columna must_change_password agregada.')
    }
    if (!names.includes('last_login_at')) {
      db.run('ALTER TABLE users ADD COLUMN last_login_at TEXT')
      console.log('users: columna last_login_at agregada.')
    }
  } catch (e) {
    console.error('No se pudieron agregar las columnas de seguridad:', e)
  }

  // ─── Migración: retirar la columna de asistencia de evaluations ──────
  // Se conserva la calificación y las observaciones ya capturadas.
  try {
    const cols = db.exec('PRAGMA table_info(evaluations)')
    const names: string[] = cols.length
      ? cols[0].values.map((row: any[]) => String(row[1]))
      : []

    if (names.includes('attendance')) {
      console.log('Migrando evaluations: eliminando columna de asistencia...')
      db.run(`
        CREATE TABLE evaluations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
          score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 4),
          observations TEXT NOT NULL DEFAULT '',
          evaluated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','closed')),
          closed_by TEXT NOT NULL DEFAULT '',
          closed_at TEXT
        );
        INSERT INTO evaluations_new (id, enrollment_id, score, observations, evaluated_at, status)
          SELECT id, enrollment_id, score, observations, evaluated_at,
                 CASE WHEN status = 'closed' THEN 'closed' ELSE 'captured' END
          FROM evaluations;
        DROP TABLE evaluations;
        ALTER TABLE evaluations_new RENAME TO evaluations;
        CREATE INDEX IF NOT EXISTS idx_evaluations_enrollment ON evaluations(enrollment_id);
      `)
      console.log('Migración de evaluations completada.')
    }
  } catch (e) {
    console.error('No se pudo migrar la tabla evaluations:', e)
  }

  // ─── Migración: quién y cuándo modificó cada calificación ────────────
  // Va después de la migración de asistencia, que recrea la tabla.
  try {
    const cols = db.exec('PRAGMA table_info(evaluations)')
    const names: string[] = cols.length
      ? cols[0].values.map((row: any[]) => String(row[1]))
      : []
    if (names.length && !names.includes('updated_by')) {
      db.run("ALTER TABLE evaluations ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''")
      db.run('ALTER TABLE evaluations ADD COLUMN updated_at TEXT')
      console.log('evaluations: columnas de auditoría agregadas.')
    }
    // Quién y cuándo firmó el acta. Se guarda en la evaluación y no solo en la
    // bitácora para que el dato siga visible aunque la bitácora se depure.
    if (names.length && !names.includes('closed_by')) {
      db.run("ALTER TABLE evaluations ADD COLUMN closed_by TEXT NOT NULL DEFAULT ''")
      db.run('ALTER TABLE evaluations ADD COLUMN closed_at TEXT')
      console.log('evaluations: columnas de cierre de acta agregadas.')
    }
  } catch (e) {
    console.error('No se pudieron agregar las columnas de auditoría:', e)
  }

  // ─── Migración: marca de datos de demostración ───────────────────────
  // Las bases anteriores traen los alumnos de práctica sembrados al arrancar.
  // Se marcan para que la profesora pueda retirarlos sin perder los suyos.
  try {
    const hasColumn = (table: string, column: string) => {
      const cols = db.exec(`PRAGMA table_info(${table})`)
      return cols.length && cols[0].values.some((row: any[]) => String(row[1]) === column)
    }

    if (!hasColumn('students', 'is_demo')) {
      db.run('ALTER TABLE students ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
      // Los 33 alumnos de la lista FOTO 2-M eran los únicos sembrados
      db.run(`UPDATE students SET is_demo = 1 WHERE enrollment_number IN (${LEGACY_DEMO
        .map(n => `'${n}'`).join(',')})`)
      console.log('students: columna is_demo agregada y datos de práctica marcados.')
    }
    if (!hasColumn('groups', 'is_demo')) {
      db.run('ALTER TABLE groups ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
      // Solo los grupos generados por el sembrado anterior y que no tengan
      // ningún alumno real inscrito. Si ella ya usó uno, se respeta.
      db.run(`
        UPDATE groups SET is_demo = 1
        WHERE group_number GLOB '[A-Z]* [0-9]-M'
          AND id NOT IN (
            SELECT e.group_id FROM enrollments e
            JOIN students s ON s.id = e.student_id
            WHERE s.is_demo = 0
          )`)
      console.log('groups: columna is_demo agregada y grupos de práctica marcados.')
    }
  } catch (e) {
    console.error('No se pudo marcar los datos de demostración:', e)
  }

  // ─── Migración: correo institucional de los alumnos ──────────────────
  // El correo se deduce del número de control (matrícula@cuautitlan.tecnm.mx),
  // así que se rellena de una vez para los alumnos que ya estaban capturados.
  // Solo toca los que tienen el correo vacío o uno del dominio institucional
  // que no coincide con su matrícula; un correo personal se respeta.
  try {
    const dominio = `@${INSTITUTIONAL_DOMAIN}`
    const esperado = `enrollment_number || '${dominio}'`
    const res = db.exec(`
      SELECT COUNT(*) FROM students
      WHERE length(enrollment_number) = 9
        AND (email = '' OR email IS NULL
             OR (lower(email) LIKE '%${dominio}' AND lower(email) <> lower(${esperado})))
    `)
    const pendientes = res.length ? Number(res[0].values[0][0]) : 0

    if (pendientes > 0) {
      db.run(`
        UPDATE students
        SET email = ${esperado},
            updated_at = datetime('now','localtime')
        WHERE length(enrollment_number) = 9
          AND (email = '' OR email IS NULL
               OR (lower(email) LIKE '%${dominio}' AND lower(email) <> lower(${esperado})))
      `)
      console.log(`students: correo institucional asignado a ${pendientes} alumno(s).`)
    }
  } catch (e) {
    console.error('No se pudo asignar el correo institucional:', e)
  }

  // ─── Seed: configuración institucional ───────────────────────────────
  // Solo se agregan las claves que falten, sin pisar lo que ella ya cambió.
  for (const [key, value] of DEFAULT_SETTINGS) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value])
  }

  // ─── Seed: usuario admin ─────────────────────────────────────────────
  const stmtUser = db.prepare('SELECT id FROM users WHERE username = ?')
  stmtUser.bind(['admin'])
  const userExists = stmtUser.step()
  stmtUser.free()

  if (!userExists) {
    const hash = bcrypt.hashSync('admin123', 10)
    db.run(
      'INSERT INTO users (username, password_hash, full_name, must_change_password) VALUES (?, ?, ?, 1)',
      ['admin', hash, 'Ripoll Herrera Elena']
    )
    console.log('Usuario admin creado. Contraseña inicial: admin123 (deberá cambiarse al entrar)')
  }

  // ─── Seed: carreras ──────────────────────────────────────────────────
  const stmtCareer = db.prepare('SELECT id FROM careers LIMIT 1')
  const careersExist = stmtCareer.step()
  stmtCareer.free()

  if (!careersExist) {
    console.log('Cargando carreras...')
    for (const c of CAREERS) {
      db.run('INSERT INTO careers (name, code) VALUES (?, ?)', [c.name, c.code])
    }
  }

  // ─── Seed: periodo escolar ───────────────────────────────────────────
  const stmtPeriod = db.prepare('SELECT id FROM school_periods LIMIT 1')
  const periodsExist = stmtPeriod.step()
  stmtPeriod.free()

  if (!periodsExist) {
    // Se calcula con la fecha real de instalación. Un periodo fijo dejaría a la
    // profesora capturando en un semestre que ya pasó.
    const now = new Date()
    const year = now.getFullYear()
    const isFirstHalf = now.getMonth() < 7   // enero a julio
    const name = isFirstHalf ? `${year}-1` : `${year}-2`
    const start = isFirstHalf ? `${year}-02-01` : `${year}-08-01`
    const end = isFirstHalf ? `${year}-07-31` : `${year + 1}-01-31`

    console.log('Creando periodo escolar inicial:', name)
    db.run(
      'INSERT INTO school_periods (name, start_date, end_date, is_active) VALUES (?, ?, ?, 1)',
      [name, start, end]
    )
  }

  // ─── Seed: complementarias ───────────────────────────────────────────
  const stmtComp = db.prepare('SELECT id FROM complementaries LIMIT 1')
  const compsExist = stmtComp.step()
  stmtComp.free()

  if (!compsExist) {
    console.log('Cargando complementarias...')
    for (const c of COMPLEMENTARIES) {
      db.run('INSERT INTO complementaries (name, description) VALUES (?, ?)', [c.name, c.description])
    }
  }
}
