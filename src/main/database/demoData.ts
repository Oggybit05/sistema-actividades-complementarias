import * as db from './db'

/**
 * Datos de demostración.
 *
 * Viven aquí y NO en las migraciones a propósito: si se sembraran al arrancar,
 * la profesora abriría el programa con 33 alumnos que no son suyos mezclados
 * con los reales, y ya no habría forma de distinguirlos. Se cargan solo cuando
 * ella lo pide y quedan marcados con `is_demo = 1` para poder retirarlos
 * después sin tocar su información.
 */

/** Lista FOTO 2-M: [No. de control, nombre(s), apellidos] */
const SAMPLE_STUDENTS: [string, string, string][] = [
  ['253116294', 'Mireya', 'Aguirre Hernández'],
  ['253103183', 'Leonardo Yael', 'Alonso Ojeda'],
  ['253142136', 'Ingrid Yazmin Aeowin', 'Arroyo Ocampo'],
  ['243107340', 'Juan Antonio', 'Benito Salinas'],
  ['233107139', 'Alexis Xavier', 'Bermeo García'],
  ['243116256', 'Liliana', 'Bravo Tapia'],
  ['253143108', 'Samuel Amauri', 'Cañas González'],
  ['253113418', 'Diana Yoselin', 'Carrillo Tello'],
  ['253137164', 'Luis David', 'Casas Chávez'],
  ['253138231', 'Diana Valeria', 'Castillo Barreto'],
  ['253107313', 'Luis David', 'Castillo Olguín'],
  ['253103223', 'Marco Patricio', 'Cisneros Sánchez'],
  ['253103141', 'Miguel Ángel', 'Cruz Rivero'],
  ['253142178', 'Emiliana', 'De La Luz Mendoza'],
  ['253142168', 'Arón Alfonso', 'Espinosa Vázquez'],
  ['253107164', 'Lesly Valeria', 'García Quiroz'],
  ['253103148', 'Quetzalli', 'Hernández Cabrera'],
  ['253139235', 'Jade Valentina', 'Iribe Vargas'],
  ['253116171', 'Ximena Del Carmen', 'López Hernández'],
  ['253142176', 'Naomi', 'Martínez Domínguez'],
  ['253137141', 'Erick', 'Martínez Flores'],
  ['233138229', 'Santiago', 'Navarro López'],
  ['263137114', 'Karla Evelin', 'Navarro Martínez'],
  ['243138185', 'Ángel', 'Oropeza Sanluis'],
  ['253107202', 'Shirel Alejandra', 'Pardo Piña'],
  ['253107235', 'Rodrigo', 'Pérez Vázquez'],
  ['233116358', 'Citlalli', 'Pineda Magaña'],
  ['253107259', 'Jared Ricardo', 'Ramírez Bautista'],
  ['253103166', 'Gerardo', 'Reséndiz Ramírez'],
  ['253107189', 'Camila', 'Reyes Islas'],
  ['253107300', 'Eduardo Rubén', 'Rico Corona'],
  ['253107163', 'Melany Yoselin', 'Rivas Rico'],
  ['253107166', 'Areli', 'Romero Rocandio'],
]

/** Grupos de ejemplo: [complementaria, cuántos, días, inicio, fin] */
const SAMPLE_GROUPS: [string, number, string, string, string][] = [
  ['Fotografía', 6, 'Lunes,Miércoles', '10:00', '12:00'],
  ['Inteligencia Emocional', 3, 'Martes,Jueves', '10:00', '12:00'],
  ['Yoga y Meditación', 3, 'Lunes,Miércoles', '12:00', '14:00'],
  ['Teatro', 1, 'Viernes', '10:00', '12:00'],
  ['Tanatología', 1, 'Viernes', '12:00', '14:00'],
]

/** Prefijo del grupo a partir del nombre de la complementaria */
const GROUP_PREFIX: Record<string, string> = {
  'Fotografía': 'FOTO',
  'Inteligencia Emocional': 'INTEL',
  'Yoga y Meditación': 'YOGA',
  'Teatro': 'TEATRO',
  'Tanatología': 'TANATO',
}

export interface DemoStatus {
  loaded: boolean
  students: number
  groups: number
  enrollments: number
  /** Datos propios de la profesora; sirve para advertir antes de cargar */
  real_students: number
}

export function getDemoStatus(): DemoStatus {
  const n = (sql: string) => Number((db.get(sql) as any)?.n ?? 0)
  const students = n('SELECT COUNT(*) AS n FROM students WHERE is_demo = 1')
  const groups = n('SELECT COUNT(*) AS n FROM groups WHERE is_demo = 1')
  const enrollments = n(`
    SELECT COUNT(*) AS n FROM enrollments e
    JOIN students s ON s.id = e.student_id WHERE s.is_demo = 1`)
  return {
    loaded: students > 0 || groups > 0,
    students, groups, enrollments,
    real_students: n('SELECT COUNT(*) AS n FROM students WHERE is_demo = 0'),
  }
}

/** Carga alumnos y grupos de ejemplo. Devuelve cuántos quedaron. */
export function loadDemoData(): { students: number; groups: number; skipped: number } {
  let students = 0
  let groups = 0
  let skipped = 0

  db.transaction(() => {
    const period = db.get(
      'SELECT id FROM school_periods WHERE is_active = 1 ORDER BY id LIMIT 1'
    ) as any
    if (!period) throw new Error('Crea un periodo escolar activo antes de cargar la demostración')
    const periodId = Number(period.id)

    // Grupos
    for (const [compName, count, days, start, end] of SAMPLE_GROUPS) {
      const comp = db.get('SELECT id FROM complementaries WHERE name = ?', [compName]) as any
      if (!comp) continue
      const prefix = GROUP_PREFIX[compName] ?? compName.substring(0, 5).toUpperCase()

      for (let i = 1; i <= count; i++) {
        const key = `${prefix} ${i}-M`
        const exists = db.get(
          'SELECT id FROM groups WHERE complementary_id = ? AND period_id = ? AND group_number = ?',
          [comp.id, periodId, key]
        )
        if (exists) { skipped++; continue }

        db.run(`
          INSERT INTO groups (complementary_id, period_id, group_number, capacity,
                              classroom, days, start_time, end_time, is_demo)
          VALUES (?, ?, ?, 40, '', ?, ?, ?, 1)`,
          [comp.id, periodId, key, days, start, end])
        groups++
      }
    }

    // Estudiantes, inscritos al primer grupo de Fotografía
    const fotoGroup = db.get(`
      SELECT g.id FROM groups g
      JOIN complementaries c ON c.id = g.complementary_id
      WHERE c.name = 'Fotografía' AND g.period_id = ? AND g.group_number = 'FOTO 2-M'`,
      [periodId]) as any

    const careerMap: Record<string, number> = {}
    for (const row of db.all('SELECT id, code FROM careers')) {
      careerMap[String(row.code)] = Number(row.id)
    }

    // El semestre se estima con el año de ingreso de la matrícula
    const currentYear = Number(String(new Date().getFullYear()).slice(-2))

    for (const [num, first, last] of SAMPLE_STUDENTS) {
      if (db.get('SELECT id FROM students WHERE enrollment_number = ?', [num])) {
        skipped++
        continue
      }
      const careerId = careerMap[num.substring(3, 6)]
      if (!careerId) { skipped++; continue }

      const entryYear = parseInt(num.substring(0, 2), 10)
      const semester = Math.min(Math.max((currentYear - entryYear) * 2 + 1, 1), 12)

      const { lastInsertRowid } = db.run(`
        INSERT INTO students (enrollment_number, first_name, last_name, career_id, semester, is_demo)
        VALUES (?, ?, ?, ?, ?, 1)`,
        [num, first, last, careerId, semester])
      students++

      if (fotoGroup) {
        db.run('INSERT INTO enrollments (student_id, group_id) VALUES (?, ?)',
          [lastInsertRowid, fotoGroup.id])
      }
    }
  })

  return { students, groups, skipped }
}

/**
 * Retira únicamente lo marcado como demostración.
 *
 * Se borra en cascada manual (evaluaciones → inscripciones → alumnos/grupos)
 * porque las llaves foráneas no están declaradas con ON DELETE CASCADE y un
 * borrado directo dejaría inscripciones apuntando a alumnos inexistentes.
 */
export function clearDemoData(): { students: number; groups: number; enrollments: number } {
  const before = getDemoStatus()

  db.transaction(() => {
    db.run(`
      DELETE FROM evaluations WHERE enrollment_id IN (
        SELECT e.id FROM enrollments e
        LEFT JOIN students s ON s.id = e.student_id
        LEFT JOIN groups g ON g.id = e.group_id
        WHERE s.is_demo = 1 OR g.is_demo = 1
      )`)
    db.run(`
      DELETE FROM enrollments WHERE id IN (
        SELECT e.id FROM enrollments e
        LEFT JOIN students s ON s.id = e.student_id
        LEFT JOIN groups g ON g.id = e.group_id
        WHERE s.is_demo = 1 OR g.is_demo = 1
      )`)
    db.run('DELETE FROM students WHERE is_demo = 1')
    db.run('DELETE FROM groups WHERE is_demo = 1')
  })

  return {
    students: before.students,
    groups: before.groups,
    enrollments: before.enrollments,
  }
}
