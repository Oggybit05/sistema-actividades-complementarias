import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: (username: string, password: string) =>
    invoke('auth:login', username, password),
  changePassword: (current: string, next: string) =>
    invoke('auth:changePassword', current, next),
  logout: (reason?: string) => invoke('auth:logout', reason),

  // Configuración institucional
  getSettings: () => invoke('settings:get'),
  saveSettings: (data: unknown) => invoke('settings:save', data),
  pickLogo: () => invoke('settings:pickLogo'),
  pickReportsFolder: () => invoke('settings:pickReportsFolder'),

  // Datos de demostración
  getDemoStatus: () => invoke('demo:status'),
  loadDemoData: () => invoke('demo:load'),
  clearDemoData: () => invoke('demo:clear'),

  // Careers
  getCareers: () => invoke('careers:getAll'),
  createCareer: (data: unknown) => invoke('careers:create', data),
  updateCareer: (id: number, data: unknown) => invoke('careers:update', id, data),
  deleteCareer: (id: number) => invoke('careers:delete', id),

  // Periods
  getPeriods: () => invoke('periods:getAll'),
  createPeriod: (data: unknown) => invoke('periods:create', data),
  updatePeriod: (id: number, data: unknown) => invoke('periods:update', id, data),
  deletePeriod: (id: number) => invoke('periods:delete', id),
  deletePeriodPreview: (id: number) => invoke('periods:deletePreview', id),
  duplicatePeriodPreview: (sourceId: number) => invoke('periods:duplicatePreview', sourceId),
  duplicatePeriod: (opts: unknown) => invoke('periods:duplicate', opts),
  setActivePeriod: (id: number) => invoke('periods:setActive', id),

  // Complementaries
  getComplementaries: () => invoke('complementaries:getAll'),
  createComplementary: (data: unknown) => invoke('complementaries:create', data),
  updateComplementary: (id: number, data: unknown) =>
    invoke('complementaries:update', id, data),
  deleteComplementary: (id: number) => invoke('complementaries:delete', id),

  // Groups
  getGroups: (filters?: unknown) => invoke('groups:getAll', filters),
  createGroup: (data: unknown) => invoke('groups:create', data),
  updateGroup: (id: number, data: unknown) => invoke('groups:update', id, data),
  deleteGroup: (id: number) => invoke('groups:delete', id),
  getGroupRoster: (groupId: number) => invoke('groups:roster', groupId),
  removeGroupStudents: (data: unknown) => invoke('groups:removeStudents', data),
  restoreGroupStudent: (enrollmentId: number) => invoke('groups:restoreStudent', enrollmentId),

  // Students
  getStudents: (filters?: unknown) => invoke('students:getAll', filters),
  getStudent: (id: number) => invoke('students:getOne', id),
  createStudent: (data: unknown) => invoke('students:create', data),
  updateStudent: (id: number, data: unknown) => invoke('students:update', id, data),
  deleteStudent: (id: number) => invoke('students:delete', id),
  detectCareer: (enrollmentNumber: string) => invoke('students:detectCareer', enrollmentNumber),
  getStudentHistory: (id: number) => invoke('students:history', id),

  // Dashboard
  getDashboardSummary: (periodId?: number) => invoke('dashboard:summary', periodId),

  // Enrollments
  getEnrollments: (filters?: unknown) => invoke('enrollments:getAll', filters),
  createEnrollment: (data: unknown) => invoke('enrollments:create', data),
  cancelEnrollment: (id: number, observations?: string) =>
    invoke('enrollments:cancel', id, observations),
  getStudentEnrollments: (studentId: number) =>
    invoke('enrollments:byStudent', studentId),

  // Reports
  exportExcel: (filters: unknown) => invoke('reports:exportExcel', filters),
  exportPdf: (filters: unknown) => invoke('reports:exportPdf', filters),
  exportFinalReport: (params: unknown) => invoke('reports:exportFinal', params),

  // Backup
  backupDatabase: () => invoke('backup:export'),
  restoreDatabase: () => invoke('backup:import'),
  getBackupInfo: () => invoke('backup:info'),
  createLocalBackup: () => invoke('backup:createLocal'),
  inspectBackup: (filePath: string) => invoke('backup:inspect', filePath),
  chooseBackupFile: () => invoke('backup:choose'),
  restoreFromBackup: (filePath: string) => invoke('backup:restoreFrom', filePath),
  deleteBackup: (filePath: string) => invoke('backup:delete', filePath),
  openBackupFolder: () => invoke('backup:openFolder'),
  revealBackupFile: (filePath: string) => invoke('backup:revealFile', filePath),

  // Import
  importSelectFile: () => invoke('import:selectFile'),
  importInspectFile: (filePath: string, sheet?: string) =>
    invoke('import:inspectFile', filePath, sheet),
  importParseFile: (filePath: string, options?: unknown) =>
    invoke('import:parseFile', filePath, options),
  importConfirm: (opts: unknown) => invoke('import:confirm', opts),
  importParseScores: (args: unknown) => invoke('import:parseScores', args),
  importConfirmScores: (args: unknown) => invoke('import:confirmScores', args),
  getEvaluations: (filters?: unknown) => invoke('evaluations:getAll', filters),
  getEvaluationStats: (filters?: unknown) => invoke('evaluations:getStats', filters),
  saveEvaluation: (data: unknown) => invoke('evaluations:save', data),
  saveEvaluationBatch: (items: unknown) => invoke('evaluations:saveBatch', items),
  clearEvaluation: (enrollmentId: number) => invoke('evaluations:clear', enrollmentId),
  clearEvaluationGroup: (groupId: number) => invoke('evaluations:clearGroup', groupId),
  closeEvaluationGroup: (groupId: number) => invoke('evaluations:closeGroup', groupId),
  closeEvaluationPreview: (groupId: number) => invoke('evaluations:closePreview', groupId),
  reopenEvaluationGroup: (groupId: number) => invoke('evaluations:reopenGroup', groupId),
})
