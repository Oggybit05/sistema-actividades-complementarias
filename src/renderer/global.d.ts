import type { IpcResult } from '@shared/types'

declare global {
  interface Window {
    api: {
      login(username: string, password: string): Promise<IpcResult>
      changePassword(current: string, next: string): Promise<IpcResult>
      logout(reason?: string): Promise<IpcResult>

      getSettings(): Promise<IpcResult>
      saveSettings(data: unknown): Promise<IpcResult>
      pickLogo(): Promise<IpcResult>
      pickReportsFolder(): Promise<IpcResult>

      getDemoStatus(): Promise<IpcResult>
      loadDemoData(): Promise<IpcResult>
      clearDemoData(): Promise<IpcResult>

      getCareers(): Promise<IpcResult>
      createCareer(data: unknown): Promise<IpcResult>
      updateCareer(id: number, data: unknown): Promise<IpcResult>
      deleteCareer(id: number): Promise<IpcResult>

      getPeriods(): Promise<IpcResult>
      createPeriod(data: unknown): Promise<IpcResult>
      updatePeriod(id: number, data: unknown): Promise<IpcResult>
      deletePeriod(id: number): Promise<IpcResult>
      deletePeriodPreview(id: number): Promise<IpcResult>
      duplicatePeriodPreview(sourceId: number): Promise<IpcResult>
      duplicatePeriod(opts: unknown): Promise<IpcResult>
      setActivePeriod(id: number): Promise<IpcResult>

      getComplementaries(): Promise<IpcResult>
      createComplementary(data: unknown): Promise<IpcResult>
      updateComplementary(id: number, data: unknown): Promise<IpcResult>
      deleteComplementary(id: number): Promise<IpcResult>

      getGroups(filters?: unknown): Promise<IpcResult>
      createGroup(data: unknown): Promise<IpcResult>
      updateGroup(id: number, data: unknown): Promise<IpcResult>
      deleteGroup(id: number): Promise<IpcResult>
      getGroupRoster(groupId: number): Promise<IpcResult>
      removeGroupStudents(data: unknown): Promise<IpcResult>
      restoreGroupStudent(enrollmentId: number): Promise<IpcResult>

      getStudents(filters?: unknown): Promise<IpcResult>
      getStudent(id: number): Promise<IpcResult>
      createStudent(data: unknown): Promise<IpcResult>
      updateStudent(id: number, data: unknown): Promise<IpcResult>
      deleteStudent(id: number): Promise<IpcResult>
      detectCareer(enrollmentNumber: string): Promise<IpcResult>
      getStudentHistory(id: number): Promise<IpcResult>

      getDashboardSummary(periodId?: number): Promise<IpcResult>

      getEnrollments(filters?: unknown): Promise<IpcResult>
      createEnrollment(data: unknown): Promise<IpcResult>
      cancelEnrollment(id: number, observations?: string): Promise<IpcResult>
      getStudentEnrollments(studentId: number): Promise<IpcResult>

      exportExcel(filters: unknown): Promise<IpcResult>
      exportPdf(filters: unknown): Promise<IpcResult>
      exportFinalReport(params: unknown): Promise<IpcResult>

      backupDatabase(): Promise<IpcResult>
      restoreDatabase(): Promise<IpcResult>
      getBackupInfo(): Promise<IpcResult>
      createLocalBackup(): Promise<IpcResult>
      inspectBackup(filePath: string): Promise<IpcResult>
      chooseBackupFile(): Promise<IpcResult>
      restoreFromBackup(filePath: string): Promise<IpcResult>
      deleteBackup(filePath: string): Promise<IpcResult>
      openBackupFolder(): Promise<IpcResult>
      revealBackupFile(filePath: string): Promise<IpcResult>

      importSelectFile(): Promise<IpcResult>
      importInspectFile(filePath: string, sheet?: string): Promise<IpcResult>
      importParseFile(filePath: string, options?: unknown): Promise<IpcResult>
      importConfirm(opts: unknown): Promise<IpcResult>
      importParseScores(args: unknown): Promise<IpcResult>
      importConfirmScores(args: unknown): Promise<IpcResult>
      getEvaluations(filters?: unknown): Promise<IpcResult>
      getEvaluationStats(filters?: unknown): Promise<IpcResult>
      saveEvaluation(data: unknown): Promise<IpcResult>
      saveEvaluationBatch(items: unknown): Promise<IpcResult>
      clearEvaluation(enrollmentId: number): Promise<IpcResult>
      clearEvaluationGroup(groupId: number): Promise<IpcResult>
      closeEvaluationGroup(groupId: number): Promise<IpcResult>
      closeEvaluationPreview(groupId: number): Promise<IpcResult>
      reopenEvaluationGroup(groupId: number): Promise<IpcResult>
    }
  }
}

export {}
