/**
 * Configuración de electron-builder.
 *
 * Está en un archivo .js y no en package.json por una razón concreta: el
 * proyecto vive dentro de OneDrive, y OneDrive mantiene abiertos los archivos
 * que va sincronizando. Al empaquetar, electron-builder necesita borrar y
 * reescribir `app.asar`, y OneDrive se lo impide:
 *
 *   ⨯ remove ...\resources\app.asar: The process cannot access the file
 *     because it is being used by another process.
 *
 * Por eso la salida se manda a una carpeta fuera de OneDrive, calculada aquí en
 * Node para que funcione igual en cmd y en PowerShell. De paso se evita que
 * OneDrive suba cientos de megas de compilados cada vez.
 */
const path = require('path')
const os = require('os')

const outputDir = path.join(os.homedir(), 'Instaladores', 'Sistema de Actividades Complementarias')

module.exports = {
  appId: 'com.ripoll.complementarias',
  productName: 'Sistema de Actividades Complementarias',
  directories: {
    output: outputDir,
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
  ],
  win: {
    target: 'nsis',
    icon: 'resources/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Sistema de Actividades Complementarias',
    // Instala solo para la usuaria actual: así no pide permisos de
    // administrador, que la profesora puede no tener en la máquina del trabajo.
    perMachine: false,
    artifactName: 'Instalador Sistema de Actividades Complementarias ${version}.${ext}',
  },
  extraResources: [
    { from: 'node_modules/sql.js/dist/sql-wasm.wasm', to: 'sql-wasm.wasm' },
  ],
}

console.log('\nEl instalador se generará en:\n  ' + outputDir + '\n')
