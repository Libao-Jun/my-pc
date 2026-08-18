import { ipcMain } from 'electron'
import { settingsRepository } from '../db/repositories/settings.repository'
import { AppError } from '@shared/errors'
import type { Settings } from '@shared/types'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => settingsRepository.get())

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new AppError('VALIDATION_ERROR', '无效的设置参数')
    }
    return settingsRepository.set(patch)
  })
}
