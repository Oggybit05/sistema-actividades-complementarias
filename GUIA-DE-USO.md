# Guía de uso — Sistema de Actividades Complementarias

Esta guía está escrita para usar el programa, no para programarlo.
No necesitas saber nada de computación más allá de abrir un archivo.

---

## 1. Primer inicio

1. Abre el programa desde el ícono del escritorio.
2. Entra con:
   - **Usuario:** `admin`
   - **Contraseña:** `admin123`
3. El programa te va a obligar a cambiar esa contraseña. **Hazlo y anótala en
   un lugar seguro.** No hay forma de recuperarla si se pierde; tendrías que
   restaurar un respaldo.

Después ve a **Configuración → Datos de la institución** y llena:

- Nombre de la escuela
- Tu nombre como aparece en los documentos oficiales
- Correo y teléfono (opcional)
- Logo de la institución (opcional, se ve en los reportes)
- Calificación mínima aprobatoria (por defecto **3**)

Esos datos son los que salen impresos en los reportes.

---

## 2. Antes de inscribir a nadie

El programa necesita tres cosas registradas. Se hace una sola vez por semestre:

| Paso | Dónde | Qué se registra |
|---|---|---|
| 1 | **Periodos** | El semestre, por ejemplo `2026-1`, con fecha de inicio y fin. Márcalo como **activo**. |
| 2 | **Complementarias** | Las materias que impartes: Fotografía, Yoga, Teatro, etc. |
| 3 | **Grupos** | Cada grupo con su complementaria, periodo, cupo, aula y horario. |

Un periodo puede durar lo que necesites: un semestre completo, un curso de
verano de dos semanas o incluso un solo día. También pueden **traslaparse** dos
periodos, por ejemplo un intersemestral que cae dentro del semestre regular. Si
las fechas coinciden con otro periodo el programa te lo avisa, pero te deja
guardar: cada grupo queda amarrado a su propio periodo, así que los reportes
nunca se mezclan.

**Para borrar un periodo** ya no hace falta vaciarlo grupo por grupo. El botón
**Eliminar** se lleva de una vez sus grupos, inscripciones y calificaciones.
Antes de borrar te dice exactamente cuántos son y qué complementarias se ven
afectadas, y si hay calificaciones capturadas pide una segunda confirmación.
Los estudiantes no se borran nunca: solo se elimina su participación en ese
periodo. Además se guarda un respaldo automático que aparece en
**Configuración → Respaldos**, por si hiciera falta volver atrás.

Las **carreras** ya vienen cargadas con sus códigos. El programa detecta sola la
carrera de cada alumno a partir de su número de control.

> **Cómo lee el número de control:** `25 3 107 216`
> — los dos primeros dígitos son el año de ingreso,
> — los tres de en medio (`107`) identifican la carrera,
> — los últimos tres son el consecutivo.

---

## 3. Dar de alta alumnos

Tienes dos caminos.

### A) Uno por uno

**Estudiantes → Nuevo estudiante.** Escribe el número de control y el programa
llena la carrera sola.

**El correo también se llena solo.** Como en la escuela el correo siempre es el
número de control seguido de `@cuautitlan.tecnm.mx`, el programa lo arma en
cuanto escribes la matrícula:

> `233107216` → `233107216@cuautitlan.tecnm.mx`

No tienes que escribirlo. Solo cámbialo si algún alumno usa otro correo (por
ejemplo uno personal); en ese caso el programa respeta el que tú pongas.

### B) Desde la lista oficial (recomendado)

**Importar → pestaña "Estudiantes e inscripciones".**

1. Elige el archivo. Sirven PDF, Excel, CSV y TXT.
2. Si es Excel o CSV, aparece la pantalla **Columnas**: el programa propone qué
   contiene cada columna y tú corriges lo que esté mal. Si el Excel tiene varias
   hojas, se abre sola la que trae números de control.
3. Aparece la **vista previa** con tres contadores:
   - **Se importarán** — renglones correctos.
   - **Con aviso** — se importan, pero revísalos (por ejemplo, alumnos que ya
     estaban registrados).
   - **No se importarán** — tienen un problema que el programa no puede
     resolver solo. Cada renglón dice exactamente qué le falta.
4. Abajo eliges si además quieres **inscribirlos** en un grupo. Si el documento
   trae el nombre de la asignatura, el periodo y el grupo, el programa los
   detecta y te dice si ya existen o si los va a crear.
5. Revisa el bloque **"Se ejecutarán estas acciones"** y presiona
   **Confirmar e importar**.

> **Nada se guarda hasta que confirmas.** Si algo se ve mal, cancela y vuelve a
> empezar sin consecuencias.

**Si un PDF no se puede leer:** es un documento escaneado como imagen. El
programa te lo avisa. Usa el archivo de Excel de esa misma lista.

---

## 4. Inscribir alumnos ya registrados

**Inscripciones → Nueva inscripción.** El programa impide automáticamente:

- Inscribir dos veces al mismo alumno **en la misma complementaria** del mismo
  periodo. Sí puede estar inscrito en otras complementarias distintas.
- Pasarse del cupo del grupo.
- Empalmar horarios con otro grupo del mismo alumno.

---

## 5. Capturar calificaciones

**Evaluaciones.** Elige periodo, complementaria y grupo.

La escala es:

| Calificación | Significado |
|---|---|
| 4 | Excelente |
| 3 | Notable |
| 2 | Bueno |
| 1 | Suficiente |
| 0 | No acreditó |

Se aprueba con **3 o más** (esto se puede cambiar en Configuración).

Puedes capturar uno por uno o usar **Guardar todo**. Arriba se ve cuántos van
calificados, cuántos faltan, cuántos aprobaron y el promedio del grupo.

### Cargar calificaciones desde un archivo

**Importar → pestaña "Calificaciones".** Eliges el grupo, luego el archivo, y el
programa cruza los números de control contra la lista de ese grupo. Te avisa de:

- quién no está inscrito en ese grupo,
- calificaciones fuera de la escala 0–4,
- qué calificación anterior se va a reemplazar,
- quiénes del grupo **no** venían en el archivo.

Esta importación **nunca da de alta alumnos nuevos**: solo califica a quien ya
está inscrito.

---

## 6. Cerrar el acta

Cuando termines de calificar un grupo, presiona **Cerrar acta**.

Antes de cerrar se te muestra el resumen: cuántos aprobaron, cuántos no y
**quiénes quedan sin calificar**. Si falta alguien, no te deja cerrar.

Al cerrar:

- Las calificaciones quedan bloqueadas contra cambios accidentales.
- Se registra **quién cerró el acta y en qué fecha y hora**.
- Ese dato aparece en la pantalla, en el PDF y en el Excel.

Si de verdad necesitas corregir algo, existe **Reabrir acta**. Al reabrirla se
borra la firma y hay que volver a cerrarla cuando termines.

---

## 7. Reportes

**Reportes.** Filtra por periodo, complementaria, grupo o carrera y exporta:

- **PDF** — formato oficial con logo, encabezado institucional, tabla completa,
  resumen de acreditados y espacio para firmas. Se genera directo, sin pasar por
  el navegador.
- **Excel** — la misma información, útil si necesitas manipular los datos.

Los dos archivos se guardan en tu carpeta de **Descargas** y el programa te
ofrece abrirlos al terminar.

### Reporte Final (el que entregas cada semestre)

Abajo, en la misma pantalla, está el botón **Generar Reporte Final**. Ese crea el
Excel con la estructura de siempre:

- Una hoja **REPORTE TOTAL** con el concentrado por actividad y la tabla de
  divisiones con sus códigos de color.
- **Una hoja por cada grupo**, con las 13 divisiones, los inscritos, los
  acreditados y los no acreditados. Los renglones de TOTALES llevan fórmula, así
  que si corriges un número a mano el total se recalcula solo.

Toma el periodo que hayas elegido arriba e incluye **todos** sus grupos, aunque
alguno esté vacío; los demás filtros no se aplican, porque el reporte oficial es
del periodo completo.

> **Ojo con las calificaciones pendientes.** El formato oficial solo tiene dos
> columnas: acreditados y no acreditados. Un alumno sin calificación capturada
> cae en *no acreditados*. Si eso pasa, el programa te avisa cuántos son al
> terminar; captura sus calificaciones y vuelve a generar el archivo.

---

## 8. Respaldos — **lo más importante de esta guía**

El programa guarda copias automáticas cada vez que lo cierras, pero **esas copias
están en la misma computadora**. Si el equipo se descompone o se lo roban, se
pierden junto con todo lo demás.

Por eso, cada cierto tiempo aparece un aviso amarillo arriba de la pantalla:

> 💾 Conviene respaldar tu información.

Cuando lo veas:

1. Presiona **Guardar copia ahora**.
2. Elige dónde guardarla.
3. Acepta cuando te pregunte si quieres abrir la carpeta.
4. **Copia ese archivo a una memoria USB o a tu carpeta de la nube.**

El aviso aparece si pasaron más de 7 días o si hiciste más de 50 movimientos
desde la última copia.

### Recuperar una copia

**Configuración → Restaurar respaldo.** El programa:

- Verifica que el archivo sea válido antes de tocar nada.
- Te muestra cuántos alumnos e inscripciones trae esa copia, para que compares.
- Guarda automáticamente una copia de lo que tienes ahora, por si te
  arrepientes.

---

## 9. Seguridad

- La sesión se cierra sola después de 30 minutos sin actividad (configurable).
  Dos minutos antes aparece un aviso; hay que presionar **"Continuar
  trabajando"** para cancelarlo. Un movimiento del mouse no basta, a propósito:
  así el programa no se queda abierto si te levantas del escritorio.
- Nada se borra de verdad. Los alumnos y grupos dados de baja quedan guardados
  como inactivos para no perder el historial.
- Las actas cerradas guardan quién las firmó y cuándo, y ese dato viaja impreso
  en el PDF y en el Excel.

---

## 10. Datos de práctica

Si quieres probar el programa sin miedo, ve a
**Configuración → Datos de práctica → Cargar**. Se agregan alumnos y grupos de
ejemplo marcados como datos de prueba.

Cuando termines, **Retirar datos de práctica** los quita sin tocar nada de lo
que hayas capturado de verdad.

---

## Problemas frecuentes

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| "El PDF no contiene texto seleccionable" | Es un escaneo, una foto del papel | Usa el Excel de esa lista |
| "No hay una carrera registrada con el código XXX" | El número de control trae una carrera que no está en el catálogo | Regístrala en **Carreras** con ese código y vuelve a importar |
| "El acta está cerrada" | Ya firmaste ese grupo | Usa **Reabrir acta** en Evaluaciones |
| "El grupo está lleno" | Se alcanzó el cupo | Súbelo en **Grupos** o crea otro grupo |
| No encuentro un alumno | Probablemente está dado de baja | En **Estudiantes**, cambia el filtro de estado a "Todos" |
