import { ipcMain } from 'electron'
import { settingsRepository } from '../db/repositories/settings.repository'
import { AppError } from '@shared/errors'
import type { Settings } from '@shared/types'

// 参数校验（与 adblock.ipc.ts validateRule 同风格）；字段缺省即跳过，支持部分 patch
const SETTINGS_KEYS = ['aiBackend', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'largeFileThresholdMB'] as const

function validateSettings(patch: Partial<Settings>): void {
  // 拒绝未知键（防御直接 IPC 调用方）
  for (const key of Object.keys(patch)) {
    if (!SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number])) {
      throw new AppError('VALIDATION_ERROR', `非法字段：${key}`)
    }
  }
  if (
    patch.aiBackend !== undefined &&
    patch.aiBackend !== 'none' &&
    patch.aiBackend !== 'openai-compatible' &&
    patch.aiBackend !== 'anthropic'
  ) {
    throw new AppError('VALIDATION_ERROR', 'aiBackend 需为 none/openai-compatible/anthropic')
  }
  if (patch.aiBaseUrl !== undefined && typeof patch.aiBaseUrl !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'aiBaseUrl 需为字符串')
  }
  if (patch.aiApiKey !== undefined && typeof patch.aiApiKey !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'aiApiKey 需为字符串')
  }
  if (patch.aiModel !== undefined && typeof patch.aiModel !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'aiModel 需为字符串')
  }
  if (
    patch.largeFileThresholdMB !== undefined &&
    (typeof patch.largeFileThresholdMB !== 'number' || patch.largeFileThresholdMB <= 0)
  ) {
    throw new AppError('VALIDATION_ERROR', 'largeFileThresholdMB 需为正数')
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => settingsRepository.get())

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new AppError('VALIDATION_ERROR', '无效的设置参数')
    }
    validateSettings(patch)
    return settingsRepository.set(patch)
  })
}
