# Sistema de Actividades Complementarias

Aplicación de escritorio para Windows que permite administrar la inscripción y evaluación de estudiantes en actividades complementarias. Funciona completamente offline; los datos se guardan en un archivo SQLite local.

> **¿Vas a usar el programa, no a modificarlo?** Lee [GUIA-DE-USO.md](GUIA-DE-USO.md).
> Este README es la documentación técnica.

## Requisitos para desarrollo

- Node.js 18 o superior
- npm 9 o superior
- Windows 10/11

## Instalación del entorno de desarrollo

```bash
npm install
```

## Ejecutar en modo desarrollo

```bash
npm run dev
```

Esto levanta Vite en `localhost:5173` y abre Electron apuntando a esa URL.

## Credenciales iniciales

- **Usuario:** `admin`
- **Contraseña:** `admin123`

Cambia la contraseña desde **Configuración** después del primer inicio de sesión.

## Generar instalador para Windows

```bash
npm run dist:win
```

El instalador queda en:

```
C:\Users\<usuario>\Instaladores\Sistema de Actividades Complementarias\
    Instalador Sistema de Actividades Complementarias 1.0.0.exe
```

Pesa unos 102 MB e incluye Electron, Node y todas las librerías. La profesora
**no** necesita instalar Node.js, Python ni Visual Studio: solo ejecuta ese
archivo.

### Por qué la salida NO está dentro del proyecto

El proyecto vive dentro de OneDrive, y OneDrive mantiene abiertos los archivos
mientras los sincroniza. Al empaquetar por segunda vez, electron-builder falla:

```
⨯ remove ...\release\win-unpacked\resources\app.asar:
  The process cannot access the file because it is being used by another process.
```

Por eso `electron-builder.config.js` calcula la carpeta de salida con
`os.homedir()`, fuera de OneDrive. De paso se evita que OneDrive suba ~300 MB de
compilados en cada build. Toda la configuración de empaquetado está en ese
archivo; el `package.json` ya no lleva campo `build`.

### Si falla al extraer `winCodeSign`

```
ERROR: Cannot create symbolic link : El cliente no dispone de un privilegio requerido.
       ...\winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

Ese paquete trae enlaces simbólicos de macOS que Windows solo puede crear con
modo desarrollador o como administrador, y que además no se usan para compilar
en Windows. La solución es extraerlo a mano sin la carpeta `darwin`:

```bat
cd "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
"<proyecto>\node_modules\7zip-bin\win\x64\7za.exe" x -bd -y <cualquier-id>.7z -owinCodeSign-2.6.0 "-x!darwin"
```

Al encontrar `winCodeSign-2.6.0` ya extraído, electron-builder deja de
descargarlo y el empaquetado continúa.

## Entregar el programa a la profesora

1. `npm run dist:win`.
2. Copiar **únicamente** el archivo `Instalador ... 1.0.0.exe` a una USB, o
   subirlo a Drive/OneDrive y compartir el enlace.
3. En la computadora de ella: doble clic → Windows muestra *"Windows protegió tu
   PC"* porque el instalador no está firmado digitalmente → **Más información →
   Ejecutar de todas formas**.
4. Elegir carpeta (o dejar la que propone) → Instalar. No pide permisos de
   administrador: `perMachine: false` instala solo para esa usuaria.
5. Se crean el acceso directo del escritorio y la entrada del menú Inicio.
6. Entrar con `admin` / `admin123`; el programa obliga a cambiar la contraseña.
7. Entregarle también `GUIA-DE-USO.md` impreso o en PDF.

Los datos de ella quedan en su propia computadora, en
`%APPDATA%\sistema-complementarias\complementarias.db`. El instalador **no**
lleva la base de datos de desarrollo: arranca vacía, con los catálogos iniciales.

### Actualizar a una versión posterior

Subir `version` en `package.json`, volver a generar y pasarle el nuevo `.exe`.
Se instala encima y **no** borra la base de datos, porque vive en `%APPDATA%` y
no en la carpeta del programa. Aun así, conviene que ella saque un respaldo
manual antes de actualizar.

## Estructura del proyecto

```
src/
  main/           # Proceso principal de Electron (backend local)
    database/     # Conexión SQLite (sql.js), migraciones y helper
    ipc/          # Handlers IPC por módulo
  renderer/       # React + TypeScript (frontend)
    context/      # AuthContext
    pages/        # Páginas de la aplicación
    components/   # Componentes reutilizables
    styles/       # CSS global
  shared/         # Tipos TypeScript compartidos entre main y renderer
resources/        # Íconos y recursos del instalador
```

## Módulos del sistema

| Módulo | Descripción |
|---|---|
| Login | Autenticación local con contraseña hasheada, cambio obligatorio de la clave inicial y cierre por inactividad |
| Panel | Indicadores del periodo activo: inscritos, evaluados, pendientes, aprobación y grupos por llenarse |
| Estudiantes | Alta, edición, baja lógica, búsqueda, filtros e historial por alumno |
| Carreras | Catálogo de carreras con código de 3 dígitos usado para detectar la carrera desde la matrícula |
| Complementarias | Catálogo de materias complementarias |
| Periodos | Periodos escolares de cualquier duración; se permite que se traslapen entre sí |
| Grupos | Grupos por complementaria y periodo, con cupo, horario y retiro de alumnos |
| Inscripciones | Validación de cupo, duplicado por complementaria y conflicto de horario |
| Evaluaciones | Captura 0–4, resumen del grupo, cierre y reapertura de acta con firma |
| Importar | Alta masiva desde PDF/Excel/CSV con mapeo de columnas y errores por fila; importación de calificaciones por separado |
| Reportes | PDF oficial vía `printToPDF` y Excel, ambos con el mismo resumen |
| Reporte Final | Excel con el formato oficial de entrega: hoja `REPORTE TOTAL` + una hoja por grupo (`ipc/finalReport.ts`) |
| Configuración | Contraseña, datos institucionales, respaldos y datos de práctica |

## Reglas de negocio que viven en el proceso principal

Estas validaciones **no** están solo en React; el renderer no puede saltárselas:

- La calificación solo acepta enteros de 0 a 4 (`shared/scores.ts`).
- Un alumno no puede repetir la misma complementaria en el mismo periodo, pero
  sí puede cursar complementarias distintas a la vez.
- Un acta cerrada rechaza cualquier cambio de calificación hasta que se reabra.
- El número de control debe cumplir `AA3CCCXXX` y su código de carrera debe
  existir en el catálogo (`shared/enrollmentNumber.ts`).
- El correo se deriva del número de control
  (`matrícula@cuautitlan.tecnm.mx`, en `shared/institutionalEmail.ts`). Se aplica
  al crear, editar e importar: si viene vacío lo genera, y si trae una dirección
  del dominio institucional que no corresponde a esa matrícula la corrige. Un
  correo de otro dominio se respeta. La migración rellena a los alumnos que ya
  estaban capturados.
- En el Reporte Final, `no acreditados = inscritos − acreditados`. El formato
  oficial solo tiene esas dos columnas, así que un alumno sin calificación cae
  en "no acreditados"; el handler devuelve cuántos son para que la interfaz lo
  advierta antes de entregar el archivo.
- La tabla `audit_log` se sigue escribiendo desde el proceso principal
  (`session.ts`), pero **no se expone a la interfaz**: no hay pantalla ni canal
  IPC para consultarla, editarla o borrarla. El usuario que firma cada
  movimiento se toma de la sesión activa, nunca de la interfaz. Se conserva
  porque `backup.ts` la usa para saber cuántos movimientos van sin respaldo
  externo, y porque queda disponible si más adelante se necesita una aclaración
  académica consultando el archivo `.db`.

## Cómo agregar un canal IPC

Hay que tocar cuatro archivos, en este orden:

1. `src/main/ipc/<modulo>.ts` — el handler.
2. `src/main/main.ts` — registrar el módulo.
3. `src/main/preload.ts` — exponerlo al renderer.
4. `src/renderer/global.d.ts` — declarar el tipo.

Si falta cualquiera de los cuatro, el renderer falla en tiempo de ejecución sin
error de compilación.

## Respaldo de datos

Los datos se guardan en:
```
C:\Users\<usuario>\AppData\Roaming\sistema-complementarias\complementarias.db
```

Esa ruta se fija explícitamente en `main.ts` con `app.setPath('userData', …)` y
**no** se deriva del nombre visible del programa. Si dependiera del nombre,
cambiar el título de la aplicación movería la carpeta y el programa arrancaría
vacío, con los datos anteriores olvidados en la ruta vieja. Si alguna vez hay
que cambiar esa ruta, primero se debe mover el archivo `.db`.

Desde **Configuración → Crear respaldo** puedes guardar una copia en cualquier ubicación (USB, carpeta de nube, etc.). Se recomienda hacer respaldo periódicamente.

## Tecnologías utilizadas

- **Electron** — Aplicación de escritorio para Windows
- **React + TypeScript + Vite** — Interfaz de usuario
- **sql.js** — SQLite en WebAssembly (sin compilación nativa)
- **bcryptjs** — Hash de contraseñas
- **ExcelJS** — Exportación a Excel
- **electron-builder** — Generación del instalador `.exe`
