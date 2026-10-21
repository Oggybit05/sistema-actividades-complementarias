import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { initDatabase } from './database/connection'
import { registerAuthHandlers } from './ipc/auth'
import { registerCareerHandlers } from './ipc/careers'
import { registerPeriodHandlers } from './ipc/periods'
import { registerComplementaryHandlers } from './ipc/complementaries'
import { registerGroupHandlers } from './ipc/groups'
import { registerStudentHandlers } from './ipc/students'
import { registerEnrollmentHandlers } from './ipc/enrollments'
import { registerReportHandlers } from './ipc/reports'
import { registerFinalReportHandlers } from './ipc/finalReport'
import { registerBackupHandlers, createAutoBackup } from './ipc/backup'
import { registerImportHandlers } from './ipc/import'
import { registerEvaluationHandlers } from './ipc/evaluations'
import { registerDashboardHandlers } from './ipc/dashboard'
import { registerSettingsHandlers } from './ipc/settings'

const isDev = !app.isPackaged

// La carpeta de datos se fija a mano y NO se deriva del nombre visible de la
// aplicación. Si dependiera del nombre, cambiarlo movería la base de datos a
// otra carpeta y la profesora vería el programa vacío, con sus alumnos y
// calificaciones "perdidos" en la ruta anterior.
app.setPath('userData', path.join(app.getPath('appData'), 'sistema-complementarias'))

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'Sistema de Actividades Complementarias',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Error cargando la interfaz (${errorCode}): ${errorDescription} - ${validatedURL}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`El proceso de la interfaz terminó: ${details.reason}`)
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`Interfaz: ${message} (${sourceId}:${line})`)
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    // win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  win.once('ready-to-show', () => win.show())
  win.webContents.on('dom-ready', () => {
    console.log(`Interfaz cargada: ${win.webContents.getURL()}`)
  })
}

app.whenReady().then(async () => {
  await initDatabase()

  // Copia de seguridad del estado con el que arranca la sesión.
  // Si algo sale mal durante el día, siempre queda el punto de partida.
  const auto = createAutoBackup(app)
  if (auto) console.log('Respaldo automático creado:', auto.file)

  registerAuthHandlers(ipcMain)
  registerCareerHandlers(ipcMain)
  registerPeriodHandlers(ipcMain)
  registerComplementaryHandlers(ipcMain)
  registerGroupHandlers(ipcMain)
  registerStudentHandlers(ipcMain)
  registerEnrollmentHandlers(ipcMain)
  registerReportHandlers(ipcMain)
  registerFinalReportHandlers(ipcMain)
  registerBackupHandlers(ipcMain, dialog, shell, app)
  registerImportHandlers(ipcMain, dialog)
  registerEvaluationHandlers(ipcMain)
  registerDashboardHandlers(ipcMain)
  registerSettingsHandlers(ipcMain, dialog)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
